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
#
# `ticket=<ID>` is required; everything else is written through to the JSON
# object verbatim. Values matching an integer or true/false are emitted
# unquoted; everything else is a JSON string.
#
# Writes to  <main checkout>/.concertino/runs/<TICKET>/events.jsonl
# — the MAIN checkout, never the worktree, because cleanup.sh --phase4
# destroys the worktree and would take the run's history with it.
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
ARGS=()
for a in "$@"; do
  if [ "$a" = "--await" ]; then AWAIT=1; else ARGS+=("$a"); fi
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

for kv in ${ARGS+"${ARGS[@]}"}; do
  key="${kv%%=*}"
  val="${kv#*=}"
  [ "$key" = "$kv" ] && continue          # no '=' — ignore
  case "$key" in
    ticket)  TICKET="$val" ;;
    role)    ROLE="$val" ;;
    project) PROJECT="$val" ;;
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
    *)       FIELDS="${FIELDS},\"$(json_escape "$key")\":$(json_value "$val")"
             OTHER_FIELDS="${OTHER_FIELDS},\"$(json_escape "$key")\":$(json_value "$val")"
             ;;
  esac
done

[ -z "$TICKET" ] && exit 0
looks_like_ticket "$TICKET" || exit 0

RUN_DIR="${ROOT}/.concertino/runs/${TICKET}"
mkdir -p "$RUN_DIR" 2>/dev/null || exit 0
LOG="${RUN_DIR}/events.jsonl"

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

if [ "$AWAIT" -eq 0 ]; then
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
  local epoch tmp_dir src ref="" persist_out
  epoch="$(now_ms)"
  tmp_dir="$(mktemp -d 2>/dev/null)" || tmp_dir=""
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
ANSWER_FILE="${RUN_DIR}/answer.json"
if [ -e "$ANSWER_FILE" ]; then
  # A previous --await was killed after a human answered but before this
  # script consumed it (exactly the scenario `on_kill` above now closes off).
  # That answer may belong to a different, earlier escalation — acting on it
  # here would apply a stale approval to a question nobody meant to answer,
  # which is worse than discarding it. So: never consume it, but never vanish
  # it silently either — record that it existed and was thrown away, so the
  # dashboard and `tail -f` both show it rather than a human's decision
  # disappearing with no trace.
  FIELDS=""
  write_line escalation.answer_discarded || true
fi
rm -f "$ANSWER_FILE" 2>/dev/null || true

TIMEOUT_MIN="${CONCERTINO_ESCALATION_TIMEOUT_MIN:-60}"
DEADLINE=$(( $(date +%s) + TIMEOUT_MIN * 60 ))

while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  if [ -f "$ANSWER_FILE" ]; then
    ANSWER="$(node -e '
      try {
        const a = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
        process.stdout.write(String(a.answer == null ? "" : a.answer));
      } catch { process.stdout.write(""); }
    ' "$ANSWER_FILE" 2>/dev/null)"
    if [ -n "$ANSWER" ]; then
      # Disarm before the final write: from here on we are exiting 0 with a
      # real answer, so a signal landing in this last stretch must not
      # overwrite that outcome with a spurious escalation.timeout.
      trap - TERM INT
      # $ANSWER is free text a human typed at the escalation screen — unbounded
      # by construction, so this write needs the cap as much as any other.
      FIELDS=",\"answer\":$(json_value "$ANSWER")"
      write_line escalation.answered
      printf '%s\n' "$ANSWER"
      exit 0
    fi
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
