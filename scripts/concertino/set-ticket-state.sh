#!/usr/bin/env bash
set -uo pipefail

# ===========================================================================
# set-ticket-state.sh — set a local ticket's state.
#
# CON-44. The status write-back seam for ticketProvider.kind "local": the
# orchestrator under that provider has Bash and no MCP tools, and this repo
# puts every state mutation behind a canonical script rather than letting an
# agent hand-roll it (see emit-event.sh, persist-evidence.sh).
#
# Usage:
#   set-ticket-state.sh <tickets-dir> <TICKET_ID> <state>
#
# <tickets-dir> exists only so this script's own test suite
# (test/scripts/set-ticket-state.test.sh) can exercise it against an
# isolated mktemp -d scratch directory, never to let production choose a
# different tickets location — the design doc's Decision 3 documents this
# as a deliberate exception, and the only production call site
# (lib/cli/render.js's rendered orchestrator prose) always passes the
# literal string "tickets". See
# docs/superpowers/specs/2026-08-07-local-ticket-provider-design.md.
#
# <state> is one of: backlog unstarted started completed canceled
# — Linear's own state.type vocabulary, shared so both providers agree.
#
# Rewrites ONLY the `state:` line inside the leading `---` frontmatter block.
# A `state:` occurring in the body is never touched. Writes via a temp file
# and rename so a crash mid-write leaves the previous file intact, the same
# discipline lib/ui/cache.js#write uses.
#
# CRLF-safe: lib/ui/tickets/local.js's FRONTMATTER_RE accepts `\r?\n` line
# endings, so this script has to accept and preserve them too, rather than
# rejecting a CRLF ticket the store itself parses fine. `read -r` leaves any
# trailing \r attached to `$line` (it only strips the \n delimiter), so every
# passed-through line already carries the file's own ending; the one line
# this script GENERATES (the rewritten `state:` line) explicitly re-appends
# the same \r so a CRLF file is not silently downgraded to mixed endings.
#
# Exit 0 with `OK <id> <state>` on success; exit 1 with a message on stderr
# for a missing file, an unknown state, a malformed <TICKET_ID>, or a file
# with no frontmatter `state:` line to rewrite. The orchestrator treats a
# non-zero exit exactly as it treats any other FAIL -> BLOCKER.
# ===========================================================================

STATES="backlog unstarted started completed canceled"

die() { echo "set-ticket-state: $*" >&2; exit 1; }

[ "$#" -eq 3 ] || die "usage: set-ticket-state.sh <tickets-dir> <TICKET_ID> <state>"

DIR="$1"
ID="$2"
STATE="$3"

case " $STATES " in
  *" $STATE "*) ;;
  *) die "unknown state \"$STATE\" — expected one of: $STATES" ;;
esac

# The id feeds directly into FILE below; unvalidated, a traversal shape
# (`../secret/OTHER-1`) walks outside <tickets-dir> and rewrites a file
# nowhere near it. This is not a privilege boundary — the orchestrator
# invoking this script already has Bash and could write anywhere directly —
# but a typo'd or mis-derived id must fail loudly rather than silently
# rewrite an unrelated file.
#
# The pattern below is the project's CANONICAL ticket shape, byte-identical to
# lib/ui/ticket.js's TICKET_RE and the copies in assert-phase.sh,
# start-servers.sh, emit-event.sh and persist-evidence.sh — guarded against
# drift by test/scripts/ticket-pattern.test.sh. This script originally shipped
# its own looser variant that also accepted dots, which is exactly the shape
# ticket.js documents as breaking tmux's `session:window.pane` addressing, and
# which would have let this script write a state to a file the dashboard and
# the delivery scripts both refuse to touch.
#
# The explicit ".." case stays as defence in depth: the pattern already
# excludes dots, but this reports the traversal attempt by name rather than as
# a generic shape mismatch.
case "$ID" in
  *..*) die "invalid ticket id \"$ID\" — must not contain \"..\"" ;;
esac
[[ "$ID" =~ ^[A-Za-z#][A-Za-z0-9_-]*[0-9]$ ]] || \
  die "invalid ticket id \"$ID\" — expected the canonical ticket shape (letters/digits/#/_/-, ending in a digit)"

FILE="$DIR/$ID.md"
[ -f "$FILE" ] || die "no ticket at $FILE"

# The frontmatter block is the text between the first line (which must be
# `---`, optionally CRLF-terminated) and the next such line. Everything
# after it is body and is copied through untouched. CR (the CRLF file's own
# line-ending remainder `read -r` leaves attached to the line) is captured
# into $CR so the rewritten `state:` line below can reuse it.
FIRST_LINE="$(head -n 1 "$FILE")"
case "$FIRST_LINE" in
  ---)      CR="" ;;
  $'---\r') CR=$'\r' ;;
  *)        die "$FILE has no frontmatter block" ;;
esac

TMP="$FILE.$$.tmp"
FOUND=0

{
  # Line 1 is the opening ---, emitted as-is (already carries \r if present).
  IFS= read -r line || true
  printf '%s\n' "$line"

  # Frontmatter: rewrite `state:`, stop at the closing --- — matched with or
  # without a trailing \r, same as the opening fence above.
  while IFS= read -r line; do
    case "$line" in
      ---|$'---\r')
        printf '%s\n' "$line"
        break
        ;;
      state:*)
        # $CR reuses the file's own line ending rather than hardcoding \n,
        # so a CRLF file is never silently downgraded to mixed endings.
        printf 'state: %s%s\n' "$STATE" "$CR"
        FOUND=1
        ;;
      *)
        printf '%s\n' "$line"
        ;;
    esac
  done

  # Body: verbatim.
  cat
} < "$FILE" > "$TMP"

# FOUND is set in the same subshell-free block above, but the `{ } < f > t`
# grouping keeps it in this shell, so it is readable here.
if [ "$FOUND" -ne 1 ]; then
  rm -f "$TMP"
  die "$FILE has no frontmatter \"state:\" line to set"
fi

mv "$TMP" "$FILE" || { rm -f "$TMP"; die "could not replace $FILE"; }

# CON-90: the rewrite above is a working-tree-only edit. When <tickets-dir>
# is inside a real git working tree, commit it (pathspec-limited to just
# this one file) so the state transition is durable in history, then make
# one best-effort, non-forced push so a collaborator sees it without being
# handed the main checkout directly. Neither step is a precondition for
# success — the file rewrite already succeeded — so any failure here is
# noted on stderr and never turns into a non-zero exit. See design.md
# Decisions 1-4 in openspec/changes/local-status-writeback-fix/.
#
# Every git command below is run with `-C "$DIR"` and, per design.md
# Decision 2, pathspecs are the file's BASENAME only ("$ID.md"), never the
# existing $FILE variable (which already carries the $DIR/ prefix and would
# double-prefix against -C "$DIR", failing whenever $DIR is relative — the
# exact shape the orchestrator's real call site uses).
if git -C "$DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  if git -C "$DIR" add -- "$ID.md" && \
     git -C "$DIR" commit -q -m "tickets: $ID -> $STATE" -- "$ID.md" >/dev/null 2>&1; then
    # Best-effort push, only after a successful commit. Mirrors
    # cleanup.sh's BASE_REMOTE resolution exactly (including sourcing
    # .concertino.env the same way, if present) so no new config surface is
    # introduced.
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    # shellcheck disable=SC1091
    [ -f "${SCRIPT_DIR}/.concertino.env" ] && source "${SCRIPT_DIR}/.concertino.env"
    REMOTE="${CONCERTINO_BASE_REMOTE:-origin}"

    BRANCH="$(git -C "$DIR" symbolic-ref --short HEAD 2>/dev/null)" || BRANCH=""
    if [ -n "$BRANCH" ]; then
      if ! git -C "$DIR" push "$REMOTE" "HEAD:$BRANCH" >/dev/null 2>&1; then
        echo "set-ticket-state: committed $ID -> $STATE locally, but push to $REMOTE/$BRANCH did not land (offline, no access, or the branch has diverged) — commit remains local-only" >&2
      fi
    fi
    # Detached HEAD: skip the push attempt entirely, no error.
  else
    echo "set-ticket-state: wrote $ID -> $STATE but could not commit it in $DIR (e.g. no git identity configured) — change is uncommitted in the working tree" >&2
  fi
fi

echo "OK $ID $STATE"
