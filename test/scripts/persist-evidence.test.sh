#!/usr/bin/env bash
# Shell tests for core/scripts/persist-evidence.sh. Run: bash test/scripts/persist-evidence.test.sh
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/core/scripts/persist-evidence.sh"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL $1"; echo "       $2"; }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected [$3] got [$2]"; fi; }

# Each test runs in a throwaway git repo so the script's main-checkout
# resolution is exercised for real.
new_repo() {
  local d; d="$(mktemp -d)"
  git -C "$d" init -q
  git -C "$d" commit -q --allow-empty -m init
  printf '%s' "$d"
}

echo "persist-evidence.sh"

# --- copies the artifact into the MAIN checkout's evidence dir, not the worktree ---
REPO="$(new_repo)"
git -C "$REPO" worktree add -q "$REPO/wt" -b feat 2>/dev/null
printf 'hello proposal\n' > "$REPO/wt/proposal.md"
OUT="$(cd "$REPO/wt" && "$SCRIPT" TICKET-1 "$REPO/wt/proposal.md")"
RC=$?
REF="$(printf '%s' "$OUT" | sed -n 's/^READY ref=//p')"
check "exit 0 on success"        "$RC" "0"
check "READY line printed"       "$([ -n "$REF" ] && echo yes || echo no)" "yes"
check "ref lands in main checkout's evidence dir" \
  "$REF" "$REPO/.concertino/runs/TICKET-1/evidence/proposal.md"
check "ref file exists"          "$([ -f "$REF" ] && echo yes || echo no)" "yes"
check "ref content matches source" "$(cat "$REF")" "hello proposal"
check "not copied into the worktree" \
  "$([ -f "$REPO/wt/.concertino/runs/TICKET-1/evidence/proposal.md" ] && echo yes || echo no)" "no"
rm -rf "$REPO"

# --- ref survives the worktree being removed (the whole point of the script) ---
REPO="$(new_repo)"
git -C "$REPO" worktree add -q "$REPO/wt" -b feat 2>/dev/null
printf 'design content\n' > "$REPO/wt/design.md"
OUT="$(cd "$REPO/wt" && "$SCRIPT" TICKET-2 "$REPO/wt/design.md")"
REF="$(printf '%s' "$OUT" | sed -n 's/^READY ref=//p')"
git -C "$REPO" worktree remove --force "$REPO/wt"
check "ref still exists after worktree removal" "$([ -f "$REF" ] && echo yes || echo no)" "yes"
check "ref still readable after worktree removal" "$(cat "$REF" 2>/dev/null)" "design content"
rm -rf "$REPO"

# --- missing source fails without printing a READY line --------------------
REPO="$(new_repo)"
OUT="$(cd "$REPO" && "$SCRIPT" TICKET-3 "$REPO/does-not-exist.md" 2>/tmp/persist-evidence-test-err)"
RC=$?
check "exit non-zero on missing source" "$([ "$RC" -ne 0 ] && echo yes || echo no)" "yes"
check "no READY line on failure" "$(printf '%s' "$OUT" | grep -c '^READY')" "0"
check "FAIL printed to stderr" "$(grep -c '^FAIL' /tmp/persist-evidence-test-err)" "1"
rm -f /tmp/persist-evidence-test-err
rm -rf "$REPO"

# --- re-running is idempotent: overwrites with current content -------------
REPO="$(new_repo)"
printf 'v1\n' > "$REPO/report.md"
OUT1="$(cd "$REPO" && "$SCRIPT" TICKET-4 "$REPO/report.md")"
REF1="$(printf '%s' "$OUT1" | sed -n 's/^READY ref=//p')"
printf 'v2\n' > "$REPO/report.md"
OUT2="$(cd "$REPO" && "$SCRIPT" TICKET-4 "$REPO/report.md")"
REF2="$(printf '%s' "$OUT2" | sed -n 's/^READY ref=//p')"
check "same ref path across re-runs" "$REF2" "$REF1"
check "re-run reflects the current source content" "$(cat "$REF2")" "v2"
rm -rf "$REPO"

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
