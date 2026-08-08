#!/usr/bin/env bash
# Shell tests for core/scripts/next-ticket-id.sh.
# Run: bash test/scripts/next-ticket-id.test.sh
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/core/scripts/next-ticket-id.sh"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL $1"; echo "       $2"; }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected [$3] got [$2]"; fi; }

echo "next-ticket-id.sh"

# --- empty dir: first ticket is number 1 ------------------------------------
D="$(mktemp -d)"
OUT="$("$SCRIPT" "$D" CON)"
RC=$?
check "empty dir: exit 0"              "$RC"  "0"
check "empty dir: READY id=CON-1"      "$OUT" "READY id=CON-1 path=${D}/CON-1.md"
rm -rf "$D"

# --- existing -1/-2: next ticket continues at 3 ------------------------------
D="$(mktemp -d)"
touch "$D/CON-1.md" "$D/CON-2.md"
OUT="$("$SCRIPT" "$D" CON)"
RC=$?
check "existing 1,2: exit 0"           "$RC"  "0"
check "existing 1,2: READY id=CON-3"   "$OUT" "READY id=CON-3 path=${D}/CON-3.md"
rm -rf "$D"

# --- numbering is independent per prefix ------------------------------------
D="$(mktemp -d)"
touch "$D/CON-1.md" "$D/CON-2.md" "$D/CON-3.md"
touch "$D/ABC-1.md"
touch "$D/ZED-1.md" "$D/ZED-2.md"
OUT_CON="$("$SCRIPT" "$D" CON)"
OUT_ABC="$("$SCRIPT" "$D" ABC)"
OUT_ZED="$("$SCRIPT" "$D" ZED)"
check "independent numbering: CON continues at 4" \
  "$OUT_CON" "READY id=CON-4 path=${D}/CON-4.md"
check "independent numbering: ABC continues at 2" \
  "$OUT_ABC" "READY id=ABC-2 path=${D}/ABC-2.md"
check "independent numbering: ZED continues at 3" \
  "$OUT_ZED" "READY id=ZED-3 path=${D}/ZED-3.md"
rm -rf "$D"

# --- missing tickets dir is created, not treated as a failure --------------
D="$(mktemp -d)"
SUBDIR="$D/tickets"
[ ! -e "$SUBDIR" ] && ok "missing dir: does not pre-exist" || bad "missing dir: does not pre-exist" "unexpected pre-existing $SUBDIR"
OUT="$("$SCRIPT" "$SUBDIR" CON 2>/tmp/next-ticket-id-test-err)"
RC=$?
check "missing dir: exit 0"          "$RC"  "0"
check "missing dir: READY id=CON-1"  "$OUT" "READY id=CON-1 path=${SUBDIR}/CON-1.md"
check "missing dir: directory now exists" "$([ -d "$SUBDIR" ] && echo yes || echo no)" "yes"
rm -f /tmp/next-ticket-id-test-err
rm -rf "$D"

# --- invalid prefix shape fails with FAIL and no READY line ----------------
for BAD_PREFIX in "con-1" "1CON" "CON_X" "CON-X" "#CON"; do
  D="$(mktemp -d)"
  OUT="$("$SCRIPT" "$D" "$BAD_PREFIX" 2>/tmp/next-ticket-id-test-err)"
  RC=$?
  check "invalid prefix [${BAD_PREFIX}]: exit non-zero" "$([ "$RC" -ne 0 ] && echo yes || echo no)" "yes"
  check "invalid prefix [${BAD_PREFIX}]: no READY line" "$(printf '%s' "$OUT" | grep -c '^READY')" "0"
  check "invalid prefix [${BAD_PREFIX}]: FAIL on stderr" "$(grep -c '^FAIL' /tmp/next-ticket-id-test-err)" "1"
  rm -f /tmp/next-ticket-id-test-err
  rm -rf "$D"
done

# --- a tickets-dir path that exists but is not a directory fails ------------
D="$(mktemp -d)"
FILE_PATH="$D/not-a-dir"
touch "$FILE_PATH"
OUT="$("$SCRIPT" "$FILE_PATH" CON 2>/tmp/next-ticket-id-test-err)"
RC=$?
check "non-dir path: exit non-zero" "$([ "$RC" -ne 0 ] && echo yes || echo no)" "yes"
check "non-dir path: no READY line" "$(printf '%s' "$OUT" | grep -c '^READY')" "0"
check "non-dir path: FAIL on stderr" "$(grep -c '^FAIL' /tmp/next-ticket-id-test-err)" "1"
rm -f /tmp/next-ticket-id-test-err
rm -rf "$D"

# --- unreadable tickets dir fails --------------------------------------------
if [ "$(id -u)" -ne 0 ]; then
  D="$(mktemp -d)"
  chmod 000 "$D"
  OUT="$("$SCRIPT" "$D" CON 2>/tmp/next-ticket-id-test-err)"
  RC=$?
  check "unreadable dir: exit non-zero" "$([ "$RC" -ne 0 ] && echo yes || echo no)" "yes"
  check "unreadable dir: no READY line" "$(printf '%s' "$OUT" | grep -c '^READY')" "0"
  check "unreadable dir: FAIL on stderr" "$(grep -c '^FAIL' /tmp/next-ticket-id-test-err)" "1"
  chmod 755 "$D"
  rm -f /tmp/next-ticket-id-test-err
  rm -rf "$D"
else
  echo "  skip unreadable-dir case (running as root)"
fi

# --- unexpected pre-existing target fails loudly instead of colliding ------
# The scan can never legitimately produce this state (a matching file whose
# number is at or above the computed NEXT would have raised HIGHEST past it).
# To exercise the safety re-check anyway, this fabricates exactly that
# "impossible" state by sourcing the script with `basename` stubbed out so
# the scan loop fails to recognise a file that genuinely already sits at the
# computed target path — the same effect a scan/regex bug would have, without
# needing an actual bug or a timing race to reproduce it (mirrors
# next-report-number.test.sh's technique).
D="$(mktemp -d)"
touch "$D/CON-1.md"
OUT="$(
  basename() { echo "not-a-match.md"; }
  set -- "$D" CON
  source "$SCRIPT" 2>/tmp/next-ticket-id-test-err
)"
RC=$?
check "unexpected pre-existing target: exit non-zero" "$([ "$RC" -ne 0 ] && echo yes || echo no)" "yes"
check "unexpected pre-existing target: no READY line" "$(printf '%s' "$OUT" | grep -c '^READY')" "0"
check "unexpected pre-existing target: FAIL on stderr" "$(grep -c '^FAIL' /tmp/next-ticket-id-test-err)" "1"
check "unexpected pre-existing target: existing file untouched" \
  "$([ -f "$D/CON-1.md" ] && echo yes || echo no)" "yes"
rm -f /tmp/next-ticket-id-test-err
rm -rf "$D"

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
