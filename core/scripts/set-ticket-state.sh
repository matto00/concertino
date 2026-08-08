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
# rewrite an unrelated file. Rule: starts with an alnum, then alnum/./_/-
# only, and never contains "..". Accepts "CON-12" and kebab-case slugs;
# rejects "/", "..", and a leading dot or dash.
case "$ID" in
  *..*) die "invalid ticket id \"$ID\" — must not contain \"..\"" ;;
esac
[[ "$ID" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || \
  die "invalid ticket id \"$ID\" — expected shape [A-Za-z0-9][A-Za-z0-9._-]*"

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

echo "OK $ID $STATE"
