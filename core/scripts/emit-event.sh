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

ROOT="$(main_checkout)" || exit 0

TICKET=""
ROLE="${CONCERTINO_ROLE:-script}"
PROJECT="${CONCERTINO_PROJECT:-$(basename "$ROOT")}"
FIELDS=""

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
    *)       FIELDS="${FIELDS},\"$(json_escape "$key")\":$(json_value "$val")" ;;
  esac
done

[ -z "$TICKET" ] && exit 0

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
if ! write_line escalation.raised; then
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
