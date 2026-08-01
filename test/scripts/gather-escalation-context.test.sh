#!/usr/bin/env bash
# Shell tests for core/scripts/gather-escalation-context.sh.
# Run: bash test/scripts/gather-escalation-context.test.sh
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/core/scripts/gather-escalation-context.sh"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL $1"; echo "       $2"; }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected [$3] got [$2]"; fi; }

echo "gather-escalation-context.sh"

# --- dependency: every field present, alternative omitted -> defaults ------
OUT="$("$SCRIPT" dependency package=zod version=3.23.0 purpose="parse ticket payloads" file=lib/ui/ticket.js 2>/tmp/gec-err)"
RC=$?
check "dependency exits 0"          "$RC" "0"
check "dependency mentions package"  "$(printf '%s' "$OUT" | grep -c 'zod')" "1"
check "dependency mentions version"  "$(printf '%s' "$OUT" | grep -c '3.23.0')" "1"
check "dependency mentions purpose"  "$(printf '%s' "$OUT" | grep -c 'parse ticket payloads')" "1"
check "dependency mentions file"     "$(printf '%s' "$OUT" | grep -c 'lib/ui/ticket.js')" "1"
check "dependency states a default alternative" \
  "$(printf '%s' "$OUT" | grep -ci 'none identified')" "1"
rm -f /tmp/gec-err

# --- dependency: alternative explicitly given, not defaulted ---------------
OUT="$("$SCRIPT" dependency package=zod version=3.23.0 purpose=parse file=lib/ui/ticket.js alternative="valibot already in package.json")"
check "dependency uses the given alternative, not the default" \
  "$(printf '%s' "$OUT" | grep -c 'valibot already in package.json')" "1"
check "dependency does not also print the default when given one" \
  "$(printf '%s' "$OUT" | grep -ci 'none identified')" "0"

# --- api-change happy path --------------------------------------------------
OUT="$("$SCRIPT" api-change current="fn(a)" proposed="fn(a, b)" callsites="lib/x.js:12, lib/y.js:40")"
RC=$?
check "api-change exits 0"          "$RC" "0"
check "api-change mentions current"  "$(printf '%s' "$OUT" | grep -c 'fn(a)')" "1"
check "api-change mentions proposed" "$(printf '%s' "$OUT" | grep -c 'fn(a, b)')" "1"
check "api-change mentions callsites" "$(printf '%s' "$OUT" | grep -c 'lib/x.js:12, lib/y.js:40')" "1"

# --- budget: includes the surviving change request verbatim ----------------
OUT="$("$SCRIPT" budget counter=3 last_verdict=FAIL change_request="add a callsite check in reducer.js")"
RC=$?
check "budget exits 0"              "$RC" "0"
check "budget mentions counter"      "$(printf '%s' "$OUT" | grep -c '\b3\b')" "1"
check "budget mentions last verdict" "$(printf '%s' "$OUT" | grep -c 'FAIL')" "1"
check "budget mentions change request verbatim" \
  "$(printf '%s' "$OUT" | grep -c 'add a callsite check in reducer.js')" "1"

# --- blocker happy path ------------------------------------------------------
OUT="$("$SCRIPT" blocker command="npm run dev" exit_code=127 output="sh: vite: command not found")"
RC=$?
check "blocker exits 0"             "$RC" "0"
check "blocker mentions command"     "$(printf '%s' "$OUT" | grep -c 'npm run dev')" "1"
check "blocker mentions exit code"   "$(printf '%s' "$OUT" | grep -c '127')" "1"
check "blocker mentions output"      "$(printf '%s' "$OUT" | grep -c 'vite: command not found')" "1"

# --- contradiction happy path ------------------------------------------------
OUT="$("$SCRIPT" contradiction requirement_a="always log in UTC" requirement_b="always log in local time")"
RC=$?
check "contradiction exits 0"        "$RC" "0"
check "contradiction mentions requirement A" "$(printf '%s' "$OUT" | grep -c 'always log in UTC')" "1"
check "contradiction mentions requirement B" "$(printf '%s' "$OUT" | grep -c 'always log in local time')" "1"

# --- ticket-ambiguity happy path --------------------------------------------
OUT="$("$SCRIPT" ticket-ambiguity signal=scope-boundary detail="does X belong in this ticket or a follow-up" draft_excerpt="likely acceptable to leave X out for now")"
RC=$?
check "ticket-ambiguity exits 0"          "$RC" "0"
check "ticket-ambiguity mentions signal"  "$(printf '%s' "$OUT" | grep -c 'scope-boundary')" "1"
check "ticket-ambiguity mentions detail"  "$(printf '%s' "$OUT" | grep -c 'does X belong in this ticket or a follow-up')" "1"
check "ticket-ambiguity mentions draft excerpt" \
  "$(printf '%s' "$OUT" | grep -c 'likely acceptable to leave X out for now')" "1"

# --- ticket-ambiguity: missing required fields fails without partial context
OUT="$("$SCRIPT" ticket-ambiguity signal=hedge-phrase 2>/tmp/gec-err)"
RC=$?
check "ticket-ambiguity missing fields: exit non-zero" "$([ "$RC" -ne 0 ] && echo yes || echo no)" "yes"
check "ticket-ambiguity missing fields: nothing on stdout" \
  "$(printf '%s' "$OUT" | wc -c | tr -d ' ')" "0"
check "ticket-ambiguity missing fields: FAIL on stderr" "$(grep -c '^FAIL' /tmp/gec-err)" "1"
check "ticket-ambiguity missing fields: names the missing fields" \
  "$(grep -c 'detail' /tmp/gec-err)" "1"
rm -f /tmp/gec-err

# --- missing required field fails without printing partial context ---------
OUT="$("$SCRIPT" dependency package=zod 2>/tmp/gec-err)"
RC=$?
check "missing field: exit non-zero"      "$([ "$RC" -ne 0 ] && echo yes || echo no)" "yes"
check "missing field: nothing on stdout"  "$(printf '%s' "$OUT" | wc -c | tr -d ' ')" "0"
check "missing field: FAIL on stderr"     "$(grep -c '^FAIL' /tmp/gec-err)" "1"
check "missing field: names the missing fields" \
  "$(grep -c 'version' /tmp/gec-err)" "1"
rm -f /tmp/gec-err

# --- unrecognized kind fails immediately ------------------------------------
OUT="$("$SCRIPT" not-a-real-kind foo=bar 2>/tmp/gec-err)"
RC=$?
check "unknown kind: exit non-zero"       "$([ "$RC" -ne 0 ] && echo yes || echo no)" "yes"
check "unknown kind: nothing on stdout"   "$(printf '%s' "$OUT" | wc -c | tr -d ' ')" "0"
check "unknown kind: FAIL on stderr"       "$(grep -c '^FAIL' /tmp/gec-err)" "1"
check "unknown kind: names the bad kind"   "$(grep -c 'not-a-real-kind' /tmp/gec-err)" "1"
rm -f /tmp/gec-err

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
