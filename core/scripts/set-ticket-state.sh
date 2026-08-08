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
# <state> is one of: backlog unstarted started completed canceled
# — Linear's own state.type vocabulary, shared so both providers agree.
#
# Rewrites ONLY the `state:` line inside the leading `---` frontmatter block.
# A `state:` occurring in the body is never touched. Writes via a temp file
# and rename so a crash mid-write leaves the previous file intact, the same
# discipline lib/ui/cache.js#write uses.
#
# Exit 0 with `OK <id> <state>` on success; exit 1 with a message on stderr
# for a missing file, an unknown state, or a file with no frontmatter
# `state:` line to rewrite. The orchestrator treats a non-zero exit exactly
# as it treats any other FAIL -> BLOCKER.
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

FILE="$DIR/$ID.md"
[ -f "$FILE" ] || die "no ticket at $FILE"

# The frontmatter block is the text between the first line (which must be
# `---`) and the next `---`. Everything after it is body and is copied
# through untouched.
head -n 1 "$FILE" | grep -qx -- '---' || die "$FILE has no frontmatter block"

TMP="$FILE.$$.tmp"
FOUND=0

{
  # Line 1 is the opening ---, emitted as-is.
  IFS= read -r line || true
  printf '%s\n' "$line"

  # Frontmatter: rewrite `state:`, stop at the closing ---.
  while IFS= read -r line; do
    if [ "$line" = "---" ]; then
      printf '%s\n' "$line"
      break
    fi
    case "$line" in
      state:*) printf 'state: %s\n' "$STATE"; FOUND=1 ;;
      *)       printf '%s\n' "$line" ;;
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

echo "OK $ID $STATE"
