#!/usr/bin/env bash
# Shell tests for core/scripts/set-ticket-state.sh.
# Run: bash test/scripts/set-ticket-state.test.sh
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/core/scripts/set-ticket-state.sh"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL $1"; echo "       $2"; }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected [$3] got [$2]"; fi; }

echo "set-ticket-state.sh"

seed() {
  D="$(mktemp -d)"
  printf '%s\n' \
    '---' \
    'id: CON-12' \
    'title: A ticket' \
    'state: unstarted' \
    'priority: 2' \
    '---' \
    '' \
    '## Description' \
    '' \
    'Body text with a state: word that must not be rewritten.' \
    > "$D/CON-12.md"
}

# CRLF-terminated variant of seed(): every line, frontmatter and body alike,
# ends \r\n. lib/ui/tickets/local.js's FRONTMATTER_RE accepts \r?\n, so the
# store parses this fine — the write-back script must too.
seed_crlf() {
  D="$(mktemp -d)"
  printf '%s\r\n' \
    '---' \
    'id: CON-12' \
    'title: A ticket' \
    'state: unstarted' \
    'priority: 2' \
    '---' \
    '' \
    '## Description' \
    '' \
    'Body text with a state: word that must not be rewritten.' \
    > "$D/CON-12.md"
}

# CRLF ticket whose BODY has its own line starting literally with `state:` —
# the shape that exposes a closing-fence match too narrow to see \r: if the
# loop never recognises the closing `---\r` line, it keeps treating body
# lines as frontmatter and rewrites this one too.
seed_crlf_body_state() {
  D="$(mktemp -d)"
  printf '%s\r\n' \
    '---' \
    'id: CON-14' \
    'title: A ticket' \
    'state: unstarted' \
    'priority: 2' \
    '---' \
    '' \
    '## Notes' \
    '' \
    'state: this line starts with state: in the body' \
    > "$D/CON-14.md"
}

# --- happy path -------------------------------------------------------------
seed
OUT="$("$SCRIPT" "$D" CON-12 started)"; RC=$?
check "valid transition: exit 0"   "$RC"  "0"
check "valid transition: reports"  "$OUT" "OK CON-12 started"
check "valid transition: rewrote frontmatter" \
  "$(grep -c '^state: started$' "$D/CON-12.md")" "1"
check "valid transition: left the body alone" \
  "$(grep -c 'state: word that must not be rewritten' "$D/CON-12.md")" "1"
check "valid transition: title intact" \
  "$(grep -c '^title: A ticket$' "$D/CON-12.md")" "1"
rm -rf "$D"

# --- idempotence ------------------------------------------------------------
seed
"$SCRIPT" "$D" CON-12 completed >/dev/null
"$SCRIPT" "$D" CON-12 completed >/dev/null
check "idempotent: one state line" "$(grep -c '^state: ' "$D/CON-12.md")" "1"
check "idempotent: value is completed" "$(grep -c '^state: completed$' "$D/CON-12.md")" "1"
rm -rf "$D"

# --- all five states are accepted -------------------------------------------
seed
ALL_OK=0
for s in backlog unstarted started completed canceled; do
  "$SCRIPT" "$D" CON-12 "$s" >/dev/null 2>&1 || ALL_OK=1
done
check "all five states accepted" "$ALL_OK" "0"
rm -rf "$D"

# --- rejections -------------------------------------------------------------
seed
OUT="$("$SCRIPT" "$D" CON-12 in-review 2>&1)"; RC=$?
check "unknown state: exit 1"       "$RC" "1"
case "$OUT" in *"in-review"*) ok "unknown state: names the bad value";;
  *) bad "unknown state: names the bad value" "got [$OUT]";; esac
check "unknown state: file untouched" "$(grep -c '^state: unstarted$' "$D/CON-12.md")" "1"
rm -rf "$D"

seed
"$SCRIPT" "$D" CON-99 started >/dev/null 2>&1; RC=$?
check "missing ticket: exit 1" "$RC" "1"
rm -rf "$D"

seed
printf '%s\n' 'no frontmatter at all' > "$D/CON-13.md"
"$SCRIPT" "$D" CON-13 started >/dev/null 2>&1; RC=$?
check "no frontmatter: exit 1" "$RC" "1"
rm -rf "$D"

# --- CRLF tickets -------------------------------------------------------------
seed_crlf
OUT="$("$SCRIPT" "$D" CON-12 started)"; RC=$?
check "CRLF: exit 0"  "$RC"  "0"
check "CRLF: reports" "$OUT" "OK CON-12 started"
check "CRLF: rewrote frontmatter, CR preserved" \
  "$(grep -c $'^state: started\r$' "$D/CON-12.md")" "1"
check "CRLF: left the body alone" \
  "$(grep -c 'state: word that must not be rewritten' "$D/CON-12.md")" "1"
check "CRLF: body line still ends in CR" \
  "$(grep -c $'Body text with a state: word that must not be rewritten.\r$' "$D/CON-12.md")" "1"
check "CRLF: title intact" \
  "$(grep -c $'^title: A ticket\r$' "$D/CON-12.md")" "1"
rm -rf "$D"

# CRLF ticket with a body line starting `state:` — exercises the
# closing-fence \r blind spot directly: if the loop fails to recognise the
# closing `---\r`, this body line gets overwritten to `state: started` too,
# and the count below comes back 2 instead of 1.
seed_crlf_body_state
"$SCRIPT" "$D" CON-14 started >/dev/null
check "CRLF body-state-line: frontmatter rewritten" \
  "$(grep -c $'^state: started\r$' "$D/CON-14.md")" "1"
check "CRLF body-state-line: body line preserved verbatim" \
  "$(grep -c 'state: this line starts with state: in the body' "$D/CON-14.md")" "1"
rm -rf "$D"

# --- ticket id path traversal ------------------------------------------------
seed
OUTSIDE="$(mktemp -d)"
BAD_ID="../$(basename "$OUTSIDE")/pwned"
OUT="$("$SCRIPT" "$D" "$BAD_ID" started 2>&1)"; RC=$?
check "path traversal: exit 1" "$RC" "1"
case "$OUT" in *"$BAD_ID"*) ok "path traversal: names the bad value";;
  *) bad "path traversal: names the bad value" "got [$OUT]";; esac
check "path traversal: no file written outside tickets-dir" \
  "$([ -e "$OUTSIDE/pwned.md" ] && echo yes || echo no)" "no"
check "path traversal: original ticket untouched" \
  "$(grep -c '^state: unstarted$' "$D/CON-12.md")" "1"
rm -rf "$OUTSIDE"
rm -rf "$D"

seed
OUT="$("$SCRIPT" "$D" '..' started 2>&1)"; RC=$?
check "bare .. id: exit 1" "$RC" "1"
rm -rf "$D"

# --- no leftover temp files -------------------------------------------------
seed
"$SCRIPT" "$D" CON-12 started >/dev/null
check "no temp files left behind" "$(find "$D" -name '*.tmp*' | wc -l | tr -d ' ')" "0"
rm -rf "$D"

echo "  ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ]
