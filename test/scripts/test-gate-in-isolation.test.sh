#!/usr/bin/env bash
# Shell tests for core/scripts/test-gate-in-isolation.sh (CON-132).
#
# Every case runs the REAL helper against a throwaway repo (never this
# checkout, never the real concertino repo) so `persist-evidence.sh`'s own
# main-checkout resolution lands inside the throwaway repo, exactly like
# test/scripts/persist-evidence.test.sh's own pattern.
#
# Proves the methodology (known-bad reference script IS detected as
# corrupting the fixture; known-good reference script is detected as
# leaving it intact), decoupled from whatever real target script a delivery
# run later exercises — see design.md Decision 5 / the Risks section.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/core/scripts/test-gate-in-isolation.sh"
FIXTURES_DIR="$ROOT/test/scripts/fixtures/gate-in-isolation"

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL $1"; echo "       $2"; }
has()  { if printf '%s' "$2" | grep -qF "$3"; then ok "$1"; else bad "$1" "expected to find [$3] in: $2"; fi; }

echo "test-gate-in-isolation.sh (CON-132)"

new_repo_with_worktree() {
  local d; d="$(mktemp -d)"
  git -C "$d" init -q -b main
  git -C "$d" -c user.email=t@t.test -c user.name=t commit -q --allow-empty -m init
  git -C "$d" worktree add -q "$d/wt" -b feat 2>/dev/null
  printf '%s' "$d"
}

# --- Case A: known-bad reference script is DETECTED as corrupting the fixture ---
REPO_A="$(new_repo_with_worktree)"
cp "$FIXTURES_DIR/known-bad-git-init.sh" "$REPO_A/wt/known-bad.sh"
chmod +x "$REPO_A/wt/known-bad.sh"
OUT_A="$(cd "$REPO_A/wt" && "$SCRIPT" CON-132 "./known-bad.sh" 2>&1)"
RC_A=$?
[ "$RC_A" -ne 0 ] && ok "known-bad script: helper exits non-zero" \
  || bad "known-bad script: helper exits non-zero" "exit code was 0"
has "known-bad script: FAIL corruption message" "$OUT_A" "corrupted the fixture"
TRANSCRIPT_A="${REPO_A}/.concertino/runs/CON-132/evidence/.concertino/gate-chain-isolation-evidence/known-bad.sh.md"
[ -f "$TRANSCRIPT_A" ] && ok "known-bad script: transcript persisted" \
  || bad "known-bad script: transcript persisted" "missing: $TRANSCRIPT_A"
if [ -f "$TRANSCRIPT_A" ]; then
  has "known-bad script: transcript records FAIL verdict" "$(cat "$TRANSCRIPT_A")" "**FAIL**"
fi
rm -rf "$REPO_A"

# --- Case B: known-good reference script is DETECTED as leaving fixture intact ---
REPO_B="$(new_repo_with_worktree)"
cp "$FIXTURES_DIR/known-good-noop.sh" "$REPO_B/wt/known-good.sh"
chmod +x "$REPO_B/wt/known-good.sh"
OUT_B="$(cd "$REPO_B/wt" && "$SCRIPT" CON-132 "./known-good.sh" 2>&1)"
RC_B=$?
[ "$RC_B" -eq 0 ] && ok "known-good script: helper exits zero" \
  || bad "known-good script: helper exits zero" "exit code was $RC_B: $OUT_B"
has "known-good script: PASS line printed" "$OUT_B" "PASS known-good.sh"
TRANSCRIPT_B="${REPO_B}/.concertino/runs/CON-132/evidence/.concertino/gate-chain-isolation-evidence/.__known-good.sh.md"
# Destination naming flattens "/" -> "__"; "./known-good.sh" resolves relative
# to WORKTREE_PATH as "known-good.sh" (no leading "./" survives git's
# toplevel-relative resolution) — assert against the actual persisted path
# instead of assuming the exact flattening of a "./"-prefixed argument.
FOUND_TRANSCRIPT_B="$(find "${REPO_B}/.concertino/runs/CON-132/evidence" -name '*known-good*' 2>/dev/null | head -1)"
[ -n "$FOUND_TRANSCRIPT_B" ] && ok "known-good script: transcript persisted" \
  || bad "known-good script: transcript persisted" "no matching transcript under ${REPO_B}/.concertino/runs/CON-132/evidence"
if [ -n "$FOUND_TRANSCRIPT_B" ]; then
  has "known-good script: transcript records PASS verdict" "$(cat "$FOUND_TRANSCRIPT_B")" "**PASS**"
fi
rm -rf "$REPO_B"

# --- Case C: a real target already-safe under the hook-shaped env produces ---
# --- passing evidence from its single run (the case the round-1 REFUTE'd  ---
# --- red/green design made unobtainable) -----------------------------------
REPO_C="$(new_repo_with_worktree)"
cat > "$REPO_C/wt/safe-gate.sh" <<'EOF'
#!/usr/bin/env bash
# A representative "already safe" gate: reads git state via -C, never a
# bare `git init`/`git` call that would inherit an ambient GIT_DIR.
set -uo pipefail
git -C "$(pwd)" rev-parse --show-toplevel >/dev/null 2>&1 || true
exit 0
EOF
chmod +x "$REPO_C/wt/safe-gate.sh"
OUT_C="$(cd "$REPO_C/wt" && "$SCRIPT" CON-132 "./safe-gate.sh" 2>&1)"
RC_C=$?
[ "$RC_C" -eq 0 ] && ok "already-safe target: single run produces passing evidence" \
  || bad "already-safe target: single run produces passing evidence" "exit code was $RC_C: $OUT_C"
rm -rf "$REPO_C"

echo ""
echo "test-gate-in-isolation.sh: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
