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
write_line() {
  local kind="$1" line
  line="$(build_line "$kind")"
  if [ "$(LC_ALL=C; echo ${#line})" -gt "$MAX_LINE" ]; then
    # Drop the caller's fields rather than emit a torn or invalid line.
    FIELDS=",\"truncated\":true"
    line="$(build_line "$kind")"
  fi
  printf '%s\n' "$line" >> "$LOG" 2>/dev/null || return 0
}

if [ "$AWAIT" -eq 1 ]; then
  # An escalation always lands in the log as `escalation.raised`, whatever kind
  # the caller passed, so the reducer has one thing to look for. Relabelling
  # before the write is deliberate: the longer kind string has to be inside the
  # byte cap, not sneaked past it afterwards.
  write_line escalation.raised
else
  write_line "$KIND"
fi

[ "$AWAIT" -eq 0 ] && exit 0

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
FIELDS=""
write_line escalation.timeout
exit 1
