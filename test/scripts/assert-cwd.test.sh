#!/usr/bin/env bash
# Shell tests for core/scripts/assert-cwd.sh (CON-174 spawn-cwd guard).
#
# Mutation-scoped: each case names the mutant it kills (design.md Decision 5).
# All fixtures are real, throwaway git worktrees — never this checkout's own.
set -uo pipefail

# CON-181: scope every mktemp/mktemp -d call in this file to a scratch
# TMPDIR removed on exit -- see test/scripts/lib/tmp-scratch.sh.
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp-scratch.sh"
trap con181_cleanup_scratch EXIT

export NO_COLOR=1
unset FORCE_COLOR

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/core/scripts/assert-cwd.sh"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL $1"; echo "       $2"; }
has()  { if grep -qF "$2" <<<"$3"; then ok "$1"; else bad "$1" "expected to find [$2] in [$3]"; fi; }

echo "assert-cwd.sh (CON-174)"

# --- fixture repo with a real worktree tree ---------------------------------
# Layout mirrors the REAL on-disk shape (`.concertino/worktrees` nested
# *inside* the driver's own repo root, not a sibling of it): $MAIN_REPO/.git
# (main checkout, doubling as the driver's own ambient cwd), $BASE =
# $MAIN_REPO/.concertino/worktrees, with $BASE/lane1-branch (worktree A,
# ticket lane 1) and $BASE/lane2-branch (worktree B, ticket lane 2) beneath
# it. This makes MAIN_REPO a genuine strict ancestor of both worktrees, not
# a mere sibling of BASE (CR #1, evaluation-1.md) — a mutant that rejects an
# ambient outside BASE but still an ancestor of WORKTREE_PATH would wrongly
# FAIL this exact case, and must be shown to.
SCRATCH="$(mktemp -d)"
MAIN_REPO="$SCRATCH/main-repo"
git init -q -b main "$MAIN_REPO"
git -C "$MAIN_REPO" -c user.email=t@t.test -c user.name=t commit -q --allow-empty -m init

BASE="$MAIN_REPO/.concertino/worktrees"
mkdir -p "$BASE"

LANE1_BRANCH="bug/lane-one/CON-1"
LANE1_WT="$BASE/$LANE1_BRANCH"
mkdir -p "$(dirname "$LANE1_WT")"
git -C "$MAIN_REPO" worktree add -q -b "$LANE1_BRANCH" "$LANE1_WT" >/dev/null

LANE2_BRANCH="bug/lane-two/CON-2"
LANE2_WT="$BASE/$LANE2_BRANCH"
mkdir -p "$(dirname "$LANE2_WT")"
git -C "$MAIN_REPO" worktree add -q -b "$LANE2_BRANCH" "$LANE2_WT" >/dev/null

# The driver/orchestrator's own root: a genuine strict ancestor of LANE2_WT
# (MAIN_REPO contains BASE which contains LANE2_WT) that is itself outside
# BASE — the real normal-spawn shape (round 2's measured counterexample).
ANCESTOR_DIR="$MAIN_REPO"

# An unrelated directory in a DIFFERENT repository entirely.
OTHER_REPO="$SCRATCH/unrelated-repo"
git init -q -b main "$OTHER_REPO"
git -C "$OTHER_REPO" -c user.email=t@t.test -c user.name=t commit -q --allow-empty -m init

# ---------------------------------------------------------------------------
# Case 1a: correct spawn, ambient is a genuine strict ancestor of
# WORKTREE_PATH (MAIN_REPO contains BASE which contains LANE2_WT) that is
# itself outside BASE — the real normal-spawn shape. Kills both a mutant
# that requires ambient == WORKTREE_PATH AND the round-2 regression mutant
# that rejects any ambient outside BASE which happens to still be an
# ancestor of WT (see evaluation-1.md CR #1 — the prior fixture had
# ANCESTOR_DIR as a mere sibling of BASE, which could not catch this).
OUT="$("$SCRIPT" "$ANCESTOR_DIR" "$LANE2_WT" "$LANE2_BRANCH" 2>&1)"; RC=$?
if [ "$RC" -eq 0 ]; then ok "1a: ancestor ambient -> exit 0"; else bad "1a: ancestor ambient -> exit 0" "got rc=$RC out=[$OUT]"; fi
has "1a: READY output" "READY" "$OUT"

# ---------------------------------------------------------------------------
# Case 1b: correct spawn, ambient is unrelated dir in a DIFFERENT repo
# entirely — not an ancestor of WORKTREE_PATH by any path relation, not
# under BASE. Kills a mutant that tolerates only the ancestor relation
# (a prefix test against WORKTREE_PATH) instead of the BASE-containment test.
OUT="$("$SCRIPT" "$OTHER_REPO" "$LANE2_WT" "$LANE2_BRANCH" 2>&1)"; RC=$?
if [ "$RC" -eq 0 ]; then ok "1b: unrelated-repo ambient -> exit 0"; else bad "1b: unrelated-repo ambient -> exit 0" "got rc=$RC out=[$OUT]"; fi
has "1b: READY output" "READY" "$OUT"

# ---------------------------------------------------------------------------
# Case 2: misdirected spawn — AMBIENT_PWD is a genuinely different,
# pre-existing worktree under the SAME base, on a different branch. Mirrors
# the live incident. Kills the mutant that deletes the "under BASE but not
# under WT" collision check.
OUT="$("$SCRIPT" "$LANE1_WT" "$LANE2_WT" "$LANE2_BRANCH" 2>&1)"; RC=$?
if [ "$RC" -ne 0 ]; then ok "2: cross-worktree ambient -> nonzero exit"; else bad "2: cross-worktree ambient -> nonzero exit" "got rc=$RC out=[$OUT]"; fi
has "2: FAIL cwd-mismatch" "FAIL cwd-mismatch" "$OUT"

# ---------------------------------------------------------------------------
# Case 3: ambient == WORKTREE_PATH (correct), but WORKTREE_PATH itself is
# checked out to the wrong branch relative to BRANCH. Kills the mutant that
# deletes/no-ops the branch check.
OUT="$("$SCRIPT" "$LANE2_WT" "$LANE2_WT" "some/other/BRANCH" 2>&1)"; RC=$?
if [ "$RC" -ne 0 ]; then ok "3: branch mismatch -> nonzero exit"; else bad "3: branch mismatch -> nonzero exit" "got rc=$RC out=[$OUT]"; fi
has "3: FAIL branch-mismatch" "FAIL branch-mismatch" "$OUT"

# ---------------------------------------------------------------------------
# Case 4: WORKTREE_PATH itself missing. Kills a mutant that hardcodes
# exit 0 / skips existence checks.
MISSING_WT="$BASE/bug/does-not-exist/CON-999"
OUT="$("$SCRIPT" "$ANCESTOR_DIR" "$MISSING_WT" "bug/does-not-exist/CON-999" 2>&1)"; RC=$?
if [ "$RC" -ne 0 ]; then ok "4: missing worktree -> nonzero exit"; else bad "4: missing worktree -> nonzero exit" "got rc=$RC out=[$OUT]"; fi
has "4: FAIL worktree-missing" "FAIL worktree-missing" "$OUT"

# ---------------------------------------------------------------------------
# Boundary: AMB == BASE (ambient is the worktrees-base dir itself, not
# inside any other ticket's worktree) is tolerated, not a collision.
OUT="$("$SCRIPT" "$BASE" "$LANE2_WT" "$LANE2_BRANCH" 2>&1)"; RC=$?
if [ "$RC" -eq 0 ]; then ok "boundary: ambient==BASE -> exit 0"; else bad "boundary: ambient==BASE -> exit 0" "got rc=$RC out=[$OUT]"; fi

rm -rf "$SCRATCH"

echo
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
