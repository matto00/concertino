#!/usr/bin/env bash
set -uo pipefail

# ===========================================================================
# emit-event.sh — append one structured event to a run's event log.
#
# The telemetry seam for the Concertino dashboard. Called by the other
# procedure scripts and by the agent roles at the moments they already write
# workflow-state.md, so the dashboard works identically on every harness.
#
# Usage:
#   emit-event.sh <kind> k=v [k=v ...]
#   emit-event.sh escalation --await ticket=<ID> question=<text> options=a,b
#   emit-event.sh escalation --raise-only ticket=<ID> question=<text> options=a,b
#   emit-event.sh escalation --wait-only max_wait_sec=<n> ticket=<ID>
#
# `ticket=<ID>` is required; everything else is written through to the JSON
# object verbatim. Values matching an integer or true/false are emitted
# unquoted; everything else is a JSON string.
#
# `escalation` supports three composable modes (CON-76 — see design.md
# Decision 1 for the full rationale):
#   --await       (unchanged) write escalation.raised (+ the one-time stale-
#                 answer.json-discard check), then block-poll to resolution.
#   --raise-only  write escalation.raised (+ that same discard check), then
#                 return immediately, exit 0, no polling. Used by a subagent
#                 orchestrator that is about to bubble instead of block.
#   --wait-only max_wait_sec=<n> ticket=<id>
#                 skip the write AND the discard check (both already ran once
#                 in the --raise-only/--await call that raised this escalation),
#                 and poll for up to <n> seconds. Exit 0 (resolved), 1 (the
#                 escalation's real deadline reached — escalation.timeout
#                 recorded, terminal), or 2 (still open — this call's own
#                 short budget simply elapsed; call again). Installs no
#                 TERM/INT trap — see design.md Decision 1c.
#
# Writes to  <main checkout>/.concertino/runs/<TICKET>/events.jsonl
# — the MAIN checkout, never the worktree, because cleanup.sh --phase4
# destroys the worktree and would take the run's history with it.
#
# Sources `.concertino.env` (written by `concertino sync` from
# concertino.config.json) so the config is the single source of truth here too,
# the same way every sibling procedure script does. Two locations are checked,
# in order: (1) next to this script file, (2) `scripts/concertino/` under the
# resolved main checkout. The second is what makes this work in the real
# invocation context — escalations are raised from inside a worktree, whose own
# copy of this directory never has `.concertino.env` (it is gitignored and is
# not copied into a worktree by default). The one setting this script reads is
# CONCERTINO_ESCALATION_TIMEOUT_MIN, which sets --await's own deadline; with no
# `.concertino.env` at either location the hardcoded default below applies.
#
# ALWAYS exits 0 in normal mode, including on internal error. Telemetry must
# never fail a delivery run. (--await is the one exception; see below.)
# ===========================================================================

MAX_LINE=4000

# Needed to invoke persist-evidence.sh as a sibling script (same pattern
# start-servers.sh already uses to invoke emit-event.sh) when an oversized
# `context=` field on an escalation has to be persisted rather than inlined.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Millisecond epoch. GNU date supports %3N; BSD/macOS date does not, so fall
# back to node (already a hard requirement for Concertino).
now_ms() {
  local d
  d="$(date +%s%3N 2>/dev/null)"
  case "$d" in
    *N*|'') node -e 'process.stdout.write(String(Date.now()))' ;;
    *) printf '%s' "$d" ;;
  esac
}

KIND="${1:-}"
[ -z "$KIND" ] && exit 0
shift || true

AWAIT=0
RAISE_ONLY=0
WAIT_ONLY=0
ARGS=()
for a in "$@"; do
  case "$a" in
    --await)      AWAIT=1 ;;
    --raise-only) RAISE_ONLY=1 ;;
    --wait-only)  WAIT_ONLY=1 ;;
    *)            ARGS+=("$a") ;;
  esac
done

# Resolve the main checkout. `git rev-parse --git-common-dir` points at the
# shared .git directory from a worktree as well as from the main checkout, but
# it is RELATIVE on some git versions and absolute on others — normalise both.
main_checkout() {
  local common
  common="$(git rev-parse --git-common-dir 2>/dev/null)" || return 1
  [ -z "$common" ] && return 1
  case "$common" in
    /*) ;;
     *) common="$(cd "$common" 2>/dev/null && pwd)" || return 1 ;;
  esac
  ( cd "$(dirname "$common")" 2>/dev/null && pwd ) || return 1
}

# A ticket value feeds directly into RUN_DIR below; unvalidated, a traversal
# shape (`../../../..`) walks out of the runs directory. Same pattern
# assert-phase.sh/start-servers.sh/cleanup.sh already carry.
looks_like_ticket() { [[ "$1" =~ ^[A-Za-z#][A-Za-z0-9_-]*[0-9]$ ]]; }

json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\r'/\\r}"
  s="${s//$'\t'/\\t}"
  # Drop any remaining control characters rather than emit invalid JSON.
  printf '%s' "$s" | tr -d '\000-\010\013\014\016-\037'
}

# Auto-unquote only well-formed JSON numbers. Leading zeros are excluded
# deliberately: bare 007 is a JSON syntax error, and a reader would count the
# whole event as malformed and drop it.
json_value() {
  local v="$1"
  if [[ "$v" =~ ^-?(0|[1-9][0-9]*)$ ]] || [ "$v" = "true" ] || [ "$v" = "false" ]; then
    printf '%s' "$v"
  else
    printf '"%s"' "$(json_escape "$v")"
  fi
}

# The identity fields are string-typed by contract regardless of what they look
# like — a ticket of "42" must stay "42", never become a JSON number, or every
# consumer that treats ticket as a key breaks.
json_string() {
  printf '"%s"' "$(json_escape "$1")"
}

# utf8_safe_prefix <byte-budget>
#
# Reads raw bytes on stdin and writes to stdout the largest prefix that is (a)
# at most <byte-budget> bytes and (b) never ends inside a multi-byte UTF-8
# sequence — backing off to the end of the last whole character when the
# budget lands mid-sequence. A no-op whenever the budget already lands on a
# character boundary (including every plain-ASCII case).
#
# Implemented in node (already a hard dependency of this script) rather than
# `cut -b`/bash substring indexing so behavior is identical regardless of the
# calling shell's locale — this inspects raw bytes, not locale-dependent shell
# string semantics. See design.md Decision 1 for the full rationale and the
# algorithm this mirrors.
utf8_safe_prefix() {
  local budget="$1"
  node -e '
    const buf = require("fs").readFileSync(0);
    const budget = Math.max(0, parseInt(process.argv[1], 10) || 0);
    let end = Math.min(budget, buf.length);
    // Walk backward from just before the cut past any continuation bytes
    // (10xxxxxx) to find the lead byte of the last character starting
    // before `end`. If that character'"'"'s full sequence length would run
    // past `end`, the cut landed mid-sequence — back `end` off to the start
    // of that character.
    let j = end - 1;
    while (j >= 0 && (buf[j] & 0xc0) === 0x80) j--;
    if (j >= 0) {
      const lead = buf[j];
      let seqLen = 1;
      if ((lead & 0xe0) === 0xc0) seqLen = 2;
      else if ((lead & 0xf0) === 0xe0) seqLen = 3;
      else if ((lead & 0xf8) === 0xf0) seqLen = 4;
      if (j + seqLen > end) end = j;
    }
    process.stdout.write(buf.slice(0, end));
  ' "$budget"
}

ROOT="$(main_checkout)" || exit 0

# Config, resolved the same way every sibling procedure script resolves it —
# except this one needs a second location. Branch 1 matches the siblings
# exactly (`.concertino.env` next to the running script): correct when this is
# invoked from the main checkout, and relocatable if a project renders to a
# non-default --out. Branch 2 is the one that fixes the real failure: in a live
# run this script is invoked from inside WORKTREE_PATH, where SCRIPT_DIR is the
# worktree's own copy of scripts/concertino/ and never holds a
# `.concertino.env` (gitignored, and not in `worktree.envFiles` by default), so
# fall back to the main checkout's copy — the one `concertino sync` actually
# generates. ROOT is already resolved above via `git rev-parse
# --git-common-dir`, which points at the main checkout from any worktree.
#
# Note: `source` assigns unconditionally, so a value set here OVERRIDES an
# already-exported variable of the same name from the calling environment. That
# is deliberate and matches the sibling scripts' convention (the config file
# wins over ambient env) — not a bug. Neither branch fires, and nothing errors,
# when no `.concertino.env` exists at either location.
# shellcheck disable=SC1091
if [ -f "${SCRIPT_DIR}/.concertino.env" ]; then
  source "${SCRIPT_DIR}/.concertino.env"
elif [ -f "${ROOT}/scripts/concertino/.concertino.env" ]; then
  source "${ROOT}/scripts/concertino/.concertino.env"
fi

TICKET=""
ROLE="${CONCERTINO_ROLE:-script}"
PROJECT="${CONCERTINO_PROJECT:-$(basename "$ROOT")}"
FIELDS=""
# `context` (escalation-only) is captured separately from every other field so
# the --await path can truncate/persist it on its own if the line doesn't
# fit — see write_escalation_raised() below. OTHER_FIELDS mirrors FIELDS but
# never includes context, so that function can rebuild the line without it.
CONTEXT=""
OTHER_FIELDS=""
# `sub_questions` (multi-part escalation only, CON-46) is likewise captured
# raw — analogous to CONTEXT — so --await can JSON.parse it up front to learn
# `total` (design.md Decision 1's "capture a raw value" task) and so
# write_escalation_raised() can guard its size independently of whether
# `context` is present (design.md Decision 4). Still folded into
# FIELDS/OTHER_FIELDS exactly like any other caller field for the write
# itself — this needs no new encoding path, only the extra raw copy.
SUB_QUESTIONS=""
# --wait-only only (CON-76 design.md Decision 1b) — this call's own short
# per-call poll budget, distinct from the escalation's real deadline. Never
# folded into FIELDS/OTHER_FIELDS: it is a --wait-only invocation parameter,
# not part of any event payload.
MAX_WAIT_SEC=""

for kv in ${ARGS+"${ARGS[@]}"}; do
  key="${kv%%=*}"
  val="${kv#*=}"
  [ "$key" = "$kv" ] && continue          # no '=' — ignore
  case "$key" in
    ticket)       TICKET="$val" ;;
    role)         ROLE="$val" ;;
    project)      PROJECT="$val" ;;
    max_wait_sec) MAX_WAIT_SEC="$val" ;;
    # `t` and `kind` are written by build_line and are structural, not payload.
    # Letting a caller pass them through emits the key twice; JSON.parse keeps
    # the LAST, so a stray `t=` silently reorders the whole log (the reducer
    # sorts by t) and a stray `kind=` rewrites what the event means. Drop them.
    # No current call site does this, but the emitter is called from role prose
    # by a language model, which is exactly where a plausible-looking `t=` comes
    # from.
    t|kind)  ;;
    context)
      # Still folded into FIELDS like any other caller field, so the first
      # (untruncated) candidate line is byte-for-byte what it would have been
      # without this special case — a context that fits behaves identically
      # to any other field. CONTEXT is the extra copy write_escalation_raised
      # needs if that candidate line turns out to be too long.
      CONTEXT="$val"
      FIELDS="${FIELDS},\"context\":$(json_value "$val")"
      ;;
    sub_questions)
      # Raised alongside (never instead of) question/options — CON-46's
      # multi-part shape. Travels as an ordinary JSON-string-encoded field
      # (design.md Decision 1: no new raw-JSON embedding code path), so this
      # still folds into FIELDS/OTHER_FIELDS exactly like the `*)` case below.
      # SUB_QUESTIONS is the extra raw copy write_escalation_raised()'s
      # oversized-payload guard and --await's own up-front `total` parse
      # both need.
      SUB_QUESTIONS="$val"
      FIELDS="${FIELDS},\"sub_questions\":$(json_value "$val")"
      OTHER_FIELDS="${OTHER_FIELDS},\"sub_questions\":$(json_value "$val")"
      ;;
    *)       FIELDS="${FIELDS},\"$(json_escape "$key")\":$(json_value "$val")"
             OTHER_FIELDS="${OTHER_FIELDS},\"$(json_escape "$key")\":$(json_value "$val")"
             ;;
  esac
done

# A terminal event that cannot be ticket-tagged is the one telemetry loss the
# dashboard can never recover from: "terminal" is defined as "has emitted
# run.end" (lib/ui/retention.js), so silently dropping this write leaves the
# run apparently live forever (CON-64). Warn loudly — but still exit 0, since
# telemetry must never fail a delivery run — instead of no-op'ing without a
# trace. Non-terminal kinds keep the silent drop: losing one of those costs a
# log line, not the run's terminal state.
if [ -z "$TICKET" ] || ! looks_like_ticket "$TICKET"; then
  if [ "$KIND" = "run.end" ]; then
    echo "emit-event.sh: WARNING: ${KIND} with missing/malformed ticket '${TICKET}' — event NOT written;" >&2
    echo "the run will appear stuck (non-terminal) on the dashboard. Pass the canonical ticket ID explicitly." >&2
  fi
  exit 0
fi

# Canonicalise case UNCONDITIONALLY, not only when a differently-cased run
# directory is already found to exist (CON-80 design.md Decision 2). Runs
# after the shape check above, never widening it — only the letters
# looks_like_ticket already permits (`[A-Za-z#][A-Za-z0-9_-]*[0-9]`) are
# touched by `tr`; `#`, digits, `_`, `-` pass through unchanged. This is what
# makes a lowercase-suffix branch (whose basename-inferring caller never
# passes the canonical id) still land in the same RUN_DIR as a call site that
# was told the ticket id explicitly — a second, independent line of defense
# under the explicit-argument fix in assert-phase.sh/start-servers.sh.
TICKET="$(printf '%s' "$TICKET" | tr '[:lower:]' '[:upper:]')"

RUN_DIR="${ROOT}/.concertino/runs/${TICKET}"
mkdir -p "$RUN_DIR" 2>/dev/null || exit 0
LOG="${RUN_DIR}/events.jsonl"
# Defined here (not just before the poll loop, as before CON-76) so
# --wait-only — which never runs write_escalation_raised() or the discard
# check — can still reference it.
ANSWER_FILE="${RUN_DIR}/answer.json"

build_line() {
  printf '{"t":%s,"kind":%s,"project":%s,"ticket":%s,"role":%s%s}' \
    "$(now_ms)" \
    "$(json_string "$1")" \
    "$(json_string "$PROJECT")" \
    "$(json_string "$TICKET")" \
    "$(json_string "$ROLE")" \
    "$FIELDS"
}

# Build the line for KIND, enforce the byte cap, append it. Every event written
# by this script goes through here — the cap keeps each line under PIPE_BUF so
# concurrent O_APPEND writes from the orchestrator and a sub-agent can never
# interleave, and a per-call-site check is a guarantee waiting to be forgotten.
# LC_ALL=C makes ${#line} count bytes rather than characters, which is what
# PIPE_BUF actually cares about.
#
# Returns non-zero if the append failed. Callers decide what that means:
# ordinary telemetry ignores it (a lost event must never fail a delivery run),
# but --await must not wait on an escalation it could not record.
write_line() {
  local kind="$1" line
  line="$(build_line "$kind")"
  if [ "$(LC_ALL=C; echo ${#line})" -gt "$MAX_LINE" ]; then
    # Drop the caller's fields rather than emit a torn or invalid line.
    FIELDS=",\"truncated\":true"
    line="$(build_line "$kind")"
  fi
  printf '%s\n' "$line" >> "$LOG" 2>/dev/null || return 1
  return 0
}

if [ "$AWAIT" -eq 0 ] && [ "$RAISE_ONLY" -eq 0 ] && [ "$WAIT_ONLY" -eq 0 ]; then
  write_line "$KIND" || true      # a lost event never fails the run
  exit 0
fi

# escalation.raised's `context` field (if any) gets its own write path: an
# oversized context is what pays down the byte budget — truncated visibly and
# persisted via persist-evidence.sh — never `question`/`options`, and never
# silently. See design.md Decision 3 for the full sequence this implements.
write_escalation_raised() {
  local line
  line="$(build_line escalation.raised)"
  if [ "$(LC_ALL=C; echo ${#line})" -le "$MAX_LINE" ]; then
    printf '%s\n' "$line" >> "$LOG" 2>/dev/null || return 1
    return 0
  fi

  # design.md Decision 4: an oversized `sub_questions` payload must fail the
  # raise outright, never reaching either of the two lossy fallbacks below —
  # not the "no context to blame" branch just under this, and not the
  # binary-search truncation loop further down, which would otherwise let a
  # small, legitimately-truncatable `context` mask an oversized
  # `sub_questions` array sneaking through as `{"truncated":true}`. So this
  # check runs BEFORE either fallback, and is independent of whether `context`
  # is present: rebuild the candidate line from OTHER_FIELDS (which never
  # includes `context` by construction) and see whether it still doesn't fit
  # with `context` entirely out of the picture. If `sub_questions` (or some
  # other non-context field) is unfittable on its own, bail now — same exit-1
  # contract the pre-existing "no context to blame" branch already has.
  if [ -n "$SUB_QUESTIONS" ]; then
    local saved_fields="$FIELDS" no_context_line
    FIELDS="$OTHER_FIELDS"
    no_context_line="$(build_line escalation.raised)"
    FIELDS="$saved_fields"
    if [ "$(LC_ALL=C; echo ${#no_context_line})" -gt "$MAX_LINE" ]; then
      return 1
    fi
  fi

  # Too long, and there's no context to blame — this is the pre-existing
  # question/options-too-big case. Fall through to the same last-resort every
  # other event kind already uses.
  if [ -z "$CONTEXT" ]; then
    write_line escalation.raised
    return $?
  fi

  # Persist the full context BEFORE touching FIELDS, so a failed persist can't
  # leave FIELDS half-mutated. Named by raise time (not by kind/question) so
  # concurrent or successive escalations on the same ticket never collide or
  # overwrite each other's persisted context.
  #
  # Staged under ROOT (the main checkout), not mktemp's default /tmp:
  # persist-evidence.sh now requires SOURCE_PATH to be inside SOME git working
  # tree (it FAILs otherwise, by design — see persist-evidence.sh's header), and
  # a bare /tmp directory never is one. ROOT is guaranteed to be a real git
  # working tree — it was itself resolved via git above (`main_checkout()`) —
  # so anchoring the temp dir there keeps this call compliant regardless of
  # whether emit-event.sh is running from the main checkout or a worktree.
  local epoch tmp_dir src ref="" persist_out
  epoch="$(now_ms)"
  tmp_dir="$(mktemp -d "${ROOT}/.escalation-context-tmp.XXXXXX" 2>/dev/null)" || tmp_dir=""
  if [ -n "$tmp_dir" ]; then
    src="${tmp_dir}/escalation-context-${epoch}.txt"
    printf '%s' "$CONTEXT" > "$src" 2>/dev/null
    if persist_out="$("${SCRIPT_DIR}/persist-evidence.sh" "$TICKET" "$src" 2>/dev/null)"; then
      ref="${persist_out#READY ref=}"
    fi
    # Clean up the temp file regardless of outcome — the durable copy (if any)
    # is what matters now; leaving this behind would leak into /tmp on every
    # oversized escalation.
    rm -rf "$tmp_dir" 2>/dev/null || true
  fi

  local total
  total="$(printf '%s' "$CONTEXT" | LC_ALL=C wc -c | tr -d ' ')"

  # Binary search the largest byte-prefix of CONTEXT whose truncated line
  # (prefix + visible marker + context_truncated/[context_ref]) still fits.
  # Build-then-measure, per design.md's stated mitigation — JSON escaping and
  # the marker's own digit count make the exact budget non-obvious to compute
  # analytically, so evaluate the real candidate line instead of estimating.
  local lo=0 hi="$total" mid best_fields="" best_line=""
  while [ "$lo" -le "$hi" ]; do
    mid=$(( (lo + hi) / 2 ))
    local prefix marker candidate fields_try line_try actual_bytes
    # utf8_safe_prefix backs the candidate off to the last whole UTF-8
    # character before byte `mid` when `mid` would otherwise land inside a
    # multi-byte sequence — see design.md Decision 1. A no-op for any budget
    # that already lands on a character boundary (every ASCII candidate).
    prefix="$(printf '%s' "$CONTEXT" | utf8_safe_prefix "$mid")"
    # The marker reports the actual byte length of the (possibly backed-off)
    # prefix, never the requested `mid` — see design.md Decision 2. Otherwise
    # a back-off would make the marker overstate what is actually shown.
    actual_bytes="$(printf '%s' "$prefix" | LC_ALL=C wc -c | tr -d ' ')"
    if [ -n "$ref" ]; then
      marker=" … [truncated, ${actual_bytes} of ${total} bytes shown — full context: ${ref}]"
    else
      marker=" … [truncated, ${actual_bytes} of ${total} bytes shown]"
    fi
    candidate="${prefix}${marker}"
    fields_try="${OTHER_FIELDS},\"context\":$(json_value "$candidate"),\"context_truncated\":true"
    [ -n "$ref" ] && fields_try="${fields_try},\"context_ref\":$(json_string "$ref")"
    FIELDS="$fields_try"
    line_try="$(build_line escalation.raised)"
    if [ "$(LC_ALL=C; echo ${#line_try})" -le "$MAX_LINE" ]; then
      best_fields="$fields_try"
      best_line="$line_try"
      lo=$((mid + 1))
    else
      hi=$((mid - 1))
    fi
  done

  if [ -n "$best_line" ]; then
    FIELDS="$best_fields"
    printf '%s\n' "$best_line" >> "$LOG" 2>/dev/null || return 1
    return 0
  fi

  # Even an empty context (plus its own bookkeeping keys) doesn't fit — some
  # OTHER field (question/options) is itself pathologically large. This is
  # not expected to trigger for realistic escalations; fall through to the
  # same last-resort every other event kind already uses.
  FIELDS="$OTHER_FIELDS"
  write_line escalation.raised
  return $?
}

# A previous --await was killed after a human answered but before this script
# consumed it (exactly the scenario `on_kill` below now closes off). That
# answer may belong to a different, earlier escalation — acting on it here
# would apply a stale approval to a question nobody meant to answer, which is
# worse than discarding it. So: never consume it, but never vanish it silently
# either — record that it existed and was thrown away, so the dashboard and
# `tail -f` both show it rather than a human's decision disappearing with no
# trace.
#
# CON-76 design.md Decision 1a: this check belongs to the *write*
# (--await/--raise-only), not the poll (--wait-only) — it is safe only
# because it runs once, immediately after that same call's own raise, before
# anything could have legitimately answered the escalation that raise just
# created. Repeating it on every --wait-only poll (Decision 3 calls it
# repeatedly against the SAME still-open escalation) would discard a genuine
# answer landing in the gap between two polls, mistaking it for stale leftover
# state from an earlier escalation. So this runs exactly once per escalation,
# as part of the write, never as part of --wait-only.
discard_stale_answer() {
  if [ -e "$ANSWER_FILE" ]; then
    FIELDS=""
    write_line escalation.answer_discarded || true
  fi
  rm -f "$ANSWER_FILE" 2>/dev/null || true
}

# Shared by --await's and --wait-only's poll loops (CON-76): checks
# ANSWER_FILE for a resolution matching MULTI_PART/TOTAL (both already set by
# the caller). On a genuine resolution: disarms any kill trap (a no-op when
# none is installed, as for --wait-only — see design.md Decision 1c), records
# escalation.answered, prints the answer(s) to stdout exactly as before this
# refactor, and returns 0. Returns 1 (no output, no write) when not yet
# resolved — the caller keeps polling.
try_resolve() {
  if [ "$MULTI_PART" -eq 1 ]; then
    # design.md Decision 2/spec.md: resolved ONLY when the file parses AND
    # `complete === true` — never on file-presence alone, and never by
    # independently re-deriving completeness from `subAnswers.length`. A
    # parseable file with `complete: false` (or missing/malformed) is treated
    # identically to the file not existing yet: keep polling.
    [ -f "$ANSWER_FILE" ] || return 1
    local sub_answers_json
    sub_answers_json="$(node -e '
      try {
        const a = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
        if (a && a.complete === true) {
          process.stdout.write(JSON.stringify(Array.isArray(a.subAnswers) ? a.subAnswers : []));
        }
      } catch { /* not resolved yet — keep polling */ }
    ' "$ANSWER_FILE" 2>/dev/null)"
    [ -n "$sub_answers_json" ] || return 1
    # Disarm before the final write — same reasoning as the single-question
    # path just below.
    trap - TERM INT
    # `sub_answers` mirrors the existing singular `answer` field — a
    # JSON-string-encoded value through the same generic mechanism
    # `sub_questions` itself uses (design.md Decision 5).
    FIELDS=",\"sub_answers\":$(json_value "$sub_answers_json")"
    write_line escalation.answered
    # One sub-answer per line, in sub-question order — the stdout contract
    # stays "read stdout, get the answer(s)" without inventing a second
    # output channel (design.md Decision 5).
    printf '%s' "$sub_answers_json" | node -e '
      let s = "";
      process.stdin.on("data", (d) => { s += d; });
      process.stdin.on("end", () => {
        let arr;
        try { arr = JSON.parse(s); } catch { arr = []; }
        for (const a of arr) process.stdout.write(String(a == null ? "" : a) + "\n");
      });
    '
    return 0
  fi

  [ -f "$ANSWER_FILE" ] || return 1
  local answer
  answer="$(node -e '
    try {
      const a = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
      process.stdout.write(String(a.answer == null ? "" : a.answer));
    } catch { process.stdout.write(""); }
  ' "$ANSWER_FILE" 2>/dev/null)"
  [ -n "$answer" ] || return 1
  # Disarm before the final write: from here on we are exiting 0 with a real
  # answer, so a signal landing in this last stretch must not overwrite that
  # outcome with a spurious escalation.timeout.
  trap - TERM INT
  # $answer is free text a human typed at the escalation screen — unbounded by
  # construction, so this write needs the cap as much as any other.
  FIELDS=",\"answer\":$(json_value "$answer")"
  write_line escalation.answered
  printf '%s\n' "$answer"
  return 0
}

# --- --wait-only: poll an already-raised escalation, bounded by this call's
# own short budget (CON-76 design.md Decisions 1b/1c/2/3) ------------------
if [ "$WAIT_ONLY" -eq 1 ]; then
  # design.md Decision 1b: default a missing/malformed max_wait_sec rather
  # than let arithmetic below fail on an empty or non-numeric value.
  case "$MAX_WAIT_SEC" in
    ''|*[!0-9]*) MAX_WAIT_SEC=25 ;;
  esac

  # Reads the LAST escalation.raised event logged for $TICKET and prints one
  # field of it ("raised_at" or "sub_questions"); empty if none is found.
  # Re-derived fresh on every call (design.md Decision 2) — never cached
  # across --wait-only invocations, since each is its own process.
  read_raised_field() {
    node -e '
      try {
        const fs = require("fs");
        const raw = fs.readFileSync(process.argv[1], "utf8");
        const ticket = process.argv[2];
        const field = process.argv[3];
        let last = null;
        for (const line of raw.split("\n")) {
          if (!line.trim()) continue;
          let ev;
          try { ev = JSON.parse(line); } catch { continue; }
          if (ev && ev.kind === "escalation.raised" && ev.ticket === ticket) last = ev;
        }
        if (!last) { process.stdout.write(""); process.exit(0); }
        const v = field === "raised_at" ? last.t : last.sub_questions;
        process.stdout.write(v == null ? "" : String(v));
      } catch (e) { process.stdout.write(""); }
    ' "$LOG" "$TICKET" "$1" 2>/dev/null
  }

  RAISED_AT="$(read_raised_field raised_at)"
  # design.md Decision 1b: sub_questions/total detection reads from the same
  # already-logged escalation.raised event raised_at is read from — the same
  # source, never a separately-supplied total= argument.
  SUB_QUESTIONS="$(read_raised_field sub_questions)"

  MULTI_PART=0
  TOTAL=0
  if [ -n "$SUB_QUESTIONS" ]; then
    MULTI_PART=1
    TOTAL="$(printf '%s' "$SUB_QUESTIONS" | node -e '
      try {
        const arr = JSON.parse(require("fs").readFileSync(0, "utf8"));
        process.stdout.write(String(Array.isArray(arr) ? arr.length : 0));
      } catch { process.stdout.write("0"); }
    ' 2>/dev/null)"
    [ -z "$TOTAL" ] && TOTAL=0
  fi

  # design.md Decision 2: the REAL deadline is anchored to the persisted
  # raise time, not to this call's own start time — it survives being split
  # across many short --wait-only calls. Left unset (never reached) when no
  # escalation.raised event is found for this ticket at all — a caller error,
  # not a case this call can usefully treat as "timed out".
  TIMEOUT_MIN="${CONCERTINO_ESCALATION_TIMEOUT_MIN:-60}"
  if [ -n "$RAISED_AT" ]; then
    REAL_DEADLINE_MS=$(( RAISED_AT + TIMEOUT_MIN * 60 * 1000 ))
  fi

  # design.md Decision 1c: no on_kill trap here — a TERM/INT during this call
  # simply ends the process with no event written, leaving the escalation
  # exactly as open as it was before this poll attempt.

  CALL_DEADLINE=$(( $(date +%s) + MAX_WAIT_SEC ))
  while [ "$(date +%s)" -lt "$CALL_DEADLINE" ]; do
    if try_resolve; then
      exit 0
    fi
    if [ -n "$RAISED_AT" ] && [ "$(now_ms)" -ge "$REAL_DEADLINE_MS" ]; then
      # The escalation's own real deadline — not this call's max_wait_sec —
      # has been reached: terminal, exactly as --await's own timeout is.
      FIELDS=""
      write_line escalation.timeout || true
      exit 1
    fi
    sleep 1
  done

  # This call's own short budget elapsed first — still open, neither resolved
  # nor timed out. No discard, no write. The caller calls --wait-only again.
  exit 2
fi

# An escalation always lands in the log as `escalation.raised`, whatever kind
# the caller passed, so the reducer has one thing to look for. Relabelling
# before the write is deliberate: the longer kind string has to be inside the
# byte cap, not sneaked past it afterwards.
#
# If that write fails there is nothing for a human to answer — the dashboard
# will never show the escalation, so polling for an answer would block for the
# full timeout on a question nobody was asked. Bail immediately instead and let
# the caller fall back to presenting the escalation in chat, exactly as it does
# on timeout.
if ! write_escalation_raised; then
  exit 1
fi
discard_stale_answer

# --- --raise-only: write escalation.raised (above) and return immediately -
if [ "$RAISE_ONLY" -eq 1 ]; then
  exit 0
fi

# --- --await from here down: unchanged behavior ----------------------------

# design.md Decision 1/2: when raised with `sub_questions`, --await is in
# multi-part mode. Learn `total` (the sub-question count) up front, before
# entering the poll loop, so the completeness check below never has to
# re-derive it from `answer.json` itself (a stale/mismatched `total` inside
# that file is exactly the kind of divergence the explicit `complete` field —
# not `subAnswers.length` — is meant to catch structurally). A malformed
# `sub_questions` value degrades to `total=0`, which simply never matches any
# real `answer.json`'s `complete:true` and so never resolves — the caller
# already gets nothing usable from a malformed payload either way.
MULTI_PART=0
TOTAL=0
if [ -n "$SUB_QUESTIONS" ]; then
  MULTI_PART=1
  TOTAL="$(printf '%s' "$SUB_QUESTIONS" | node -e '
    try {
      const arr = JSON.parse(require("fs").readFileSync(0, "utf8"));
      process.stdout.write(String(Array.isArray(arr) ? arr.length : 0));
    } catch { process.stdout.write("0"); }
  ' 2>/dev/null)"
  [ -z "$TOTAL" ] && TOTAL=0
fi

# A harness-imposed call timeout (Claude Code's Bash tool defaults to 120000ms
# — well inside this script's own default wait) kills the process with SIGTERM
# (Ctrl-C sends SIGINT), not by letting this script's own deadline elapse. With
# no trap, that kill reaches no code below: the log is left holding
# `escalation.raised` forever, with nothing to tell the dashboard the wait
# ended. Record the truth — this wait ended without an answer — before dying.
#
# Exit directly rather than clearing the trap and re-raising the signal: a
# script that reaches this point is, by construction, running as the
# backgrounded half of `--await` (the caller invoked it as a blocking foreground
# call, but under job-control-off — the normal case for a non-interactive
# script — bash auto-ignores INT/QUIT for async jobs at spawn). `trap - INT`
# would revert to exactly that inherited SIG_IGN, so a self-sent `kill -s INT
# "$$"` silently no-ops and the process sails on to its 60-minute default
# deadline instead of dying — the trap would then have recorded
# escalation.timeout while the process itself kept running, which is worse
# than doing nothing. A plain `exit` has no such failure mode.
on_kill() {
  FIELDS=""
  write_line escalation.timeout || true
  exit 1
}
trap on_kill TERM INT

# --- blocking escalation ---------------------------------------------------
# Poll for the answer file the dashboard writes. This is the whole control
# plane: no keystroke injection, no detecting when a harness is at a prompt,
# and identical on Codex or a local-model harness.
TIMEOUT_MIN="${CONCERTINO_ESCALATION_TIMEOUT_MIN:-60}"
DEADLINE=$(( $(date +%s) + TIMEOUT_MIN * 60 ))

while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  if try_resolve; then
    exit 0
  fi
  sleep 1
done

# Timed out: tell the log, and exit non-zero so the caller falls back to its
# own escalation path (printing the question to chat). The dashboard is an
# accelerator for escalations — never a new way for a run to hang.
# Disarm first: this is already writing escalation.timeout, so a signal
# arriving in this last stretch must not race on_kill into writing it twice.
trap - TERM INT
FIELDS=""
write_line escalation.timeout || true
exit 1
