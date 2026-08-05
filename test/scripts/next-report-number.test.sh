#!/usr/bin/env bash
# Shell tests for core/scripts/next-report-number.sh.
# Run: bash test/scripts/next-report-number.test.sh
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/core/scripts/next-report-number.sh"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL $1"; echo "       $2"; }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected [$3] got [$2]"; fi; }

echo "next-report-number.sh"

# --- empty dir: first report is number 1 -----------------------------------
D="$(mktemp -d)"
OUT="$("$SCRIPT" "$D" evaluation)"
RC=$?
check "empty dir: exit 0"            "$RC"  "0"
check "empty dir: READY number=1"    "$OUT" "READY number=1 path=${D}/evaluation-1.md"
rm -rf "$D"

# --- existing -1/-2: next report continues at 3 -----------------------------
D="$(mktemp -d)"
touch "$D/evaluation-1.md" "$D/evaluation-2.md"
OUT="$("$SCRIPT" "$D" evaluation)"
RC=$?
check "existing 1,2: exit 0"           "$RC"  "0"
check "existing 1,2: READY number=3"   "$OUT" "READY number=3 path=${D}/evaluation-3.md"
rm -rf "$D"

# --- numbering is independent per kind --------------------------------------
D="$(mktemp -d)"
touch "$D/evaluation-1.md" "$D/evaluation-2.md" "$D/evaluation-3.md"
touch "$D/skeptic-design-1.md"
touch "$D/skeptic-final-1.md" "$D/skeptic-final-2.md"
OUT_EVAL="$("$SCRIPT" "$D" evaluation)"
OUT_SD="$("$SCRIPT" "$D" skeptic-design)"
OUT_SF="$("$SCRIPT" "$D" skeptic-final)"
check "independent numbering: evaluation continues at 4" \
  "$OUT_EVAL" "READY number=4 path=${D}/evaluation-4.md"
check "independent numbering: skeptic-design continues at 2" \
  "$OUT_SD" "READY number=2 path=${D}/skeptic-design-2.md"
check "independent numbering: skeptic-final continues at 3" \
  "$OUT_SF" "READY number=3 path=${D}/skeptic-final-3.md"
rm -rf "$D"

# --- missing change dir fails without printing a READY line ----------------
D="$(mktemp -d)"
OUT="$("$SCRIPT" "$D/does-not-exist" evaluation 2>/tmp/next-report-number-test-err)"
RC=$?
check "missing dir: exit non-zero"  "$([ "$RC" -ne 0 ] && echo yes || echo no)" "yes"
check "missing dir: no READY line"  "$(printf '%s' "$OUT" | grep -c '^READY')" "0"
check "missing dir: FAIL on stderr" "$(grep -c '^FAIL' /tmp/next-report-number-test-err)" "1"
rm -f /tmp/next-report-number-test-err
rm -rf "$D"

# --- unreadable change dir fails ---------------------------------------------
if [ "$(id -u)" -ne 0 ]; then
  D="$(mktemp -d)"
  chmod 000 "$D"
  OUT="$("$SCRIPT" "$D" evaluation 2>/tmp/next-report-number-test-err)"
  RC=$?
  check "unreadable dir: exit non-zero" "$([ "$RC" -ne 0 ] && echo yes || echo no)" "yes"
  check "unreadable dir: no READY line" "$(printf '%s' "$OUT" | grep -c '^READY')" "0"
  check "unreadable dir: FAIL on stderr" "$(grep -c '^FAIL' /tmp/next-report-number-test-err)" "1"
  chmod 755 "$D"
  rm -f /tmp/next-report-number-test-err
  rm -rf "$D"
else
  echo "  skip unreadable-dir case (running as root)"
fi

# --- unknown kind fails ------------------------------------------------------
D="$(mktemp -d)"
OUT="$("$SCRIPT" "$D" bogus-kind 2>/tmp/next-report-number-test-err)"
RC=$?
check "unknown kind: exit non-zero" "$([ "$RC" -ne 0 ] && echo yes || echo no)" "yes"
check "unknown kind: no READY line" "$(printf '%s' "$OUT" | grep -c '^READY')" "0"
check "unknown kind: FAIL on stderr" "$(grep -c '^FAIL' /tmp/next-report-number-test-err)" "1"
rm -f /tmp/next-report-number-test-err
rm -rf "$D"

# --- unexpected pre-existing target fails loudly instead of colliding ------
# The scan can never legitimately produce this state (a matching file whose
# number is at or above the computed NEXT would have raised HIGHEST past it).
# To exercise the safety re-check anyway, this fabricates exactly that
# "impossible" state by sourcing the script with `basename` stubbed out so
# the scan loop fails to recognise a file that genuinely already sits at the
# computed target path — the same effect a scan/regex bug would have, without
# needing an actual bug or a timing race to reproduce it.
D="$(mktemp -d)"
touch "$D/evaluation-1.md"
OUT="$(
  basename() { echo "not-a-match.md"; }
  set -- "$D" evaluation
  source "$SCRIPT" 2>/tmp/next-report-number-test-err
)"
RC=$?
check "unexpected pre-existing target: exit non-zero" "$([ "$RC" -ne 0 ] && echo yes || echo no)" "yes"
check "unexpected pre-existing target: no READY line" "$(printf '%s' "$OUT" | grep -c '^READY')" "0"
check "unexpected pre-existing target: FAIL on stderr" "$(grep -c '^FAIL' /tmp/next-report-number-test-err)" "1"
check "unexpected pre-existing target: existing file untouched" \
  "$([ -f "$D/evaluation-1.md" ] && echo yes || echo no)" "yes"
rm -f /tmp/next-report-number-test-err
rm -rf "$D"

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
