#!/usr/bin/env bash
# Shell tests for scripts/concertino/resolve-review-base.sh (CON-152):
# resolving the review diff base ONCE per run against a freshly-fetched
# remote base branch, rather than a bare local `main` ref that never moves.
#
# Every case runs the REAL script against a throwaway `mktemp -d` fixture
# repo with a real bare "origin" remote, never a reimplementation.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/core/scripts/resolve-review-base.sh"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL $1"; echo "       $2"; }
has()  { if printf '%s' "$2" | grep -qF "$3"; then ok "$1"; else bad "$1" "expected to find [$3] in: $2"; fi; }
lacks(){ if printf '%s' "$2" | grep -qF "$3"; then bad "$1" "did NOT expect [$3] in: $2"; else ok "$1"; fi; }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected [$3] got [$2]"; fi; }

echo "resolve-review-base.sh (CON-152)"

# --- Fixture: a bare "origin" + a worktree-like clone branched off it -------
# Mirrors the real incident: a local worktree is created off origin/main at
# some commit, work happens on a ticket branch, and THEN a sibling ticket's
# PR merges to origin/main — after the worktree already exists. A bare
# `main...HEAD` (or a stale local `main` ref) picks up that sibling commit;
# the fix must not.
new_fixture() {
  local d o
  d="$(mktemp -d)"
  o="$d/.origin-bare"
  git init -q --bare -b main "$o"

  # Seed origin/main with one commit.
  local seed
  seed="$(mktemp -d)"
  git init -q -b main "$seed"
  echo "seed" > "$seed/README.md"
  git -C "$seed" add -A
  git -C "$seed" -c user.email=t@t.test -c user.name=t commit -q -m seed
  git -C "$seed" remote add origin "$o"
  git -C "$seed" push -q origin main
  rm -rf "$seed"

  # The "worktree": clone origin at that seed commit, then branch.
  local wt
  wt="$d/wt"
  git clone -q "$o" "$wt"
  git -C "$wt" checkout -q -b bug/some-ticket/CON-999
  printf '%s' "$wt"
}

# --- Case 1: sibling merge lands on origin/main AFTER the worktree exists --
WT="$(new_fixture)"
ORIGIN_URL="$(git -C "$WT" remote get-url origin)"

# Ticket work: one commit on the branch.
echo "ticket change" > "$WT/ticket.txt"
git -C "$WT" add -A
git -C "$WT" -c user.email=t@t.test -c user.name=t commit -q -m "ticket commit"

# Sibling merge lands on origin/main via a SEPARATE clone (simulating another
# worktree/session merging its own PR), independent of this worktree's local
# refs.
SIBLING="$(mktemp -d)"
git clone -q "$ORIGIN_URL" "$SIBLING"
echo "sibling change" > "$SIBLING/sibling.txt"
git -C "$SIBLING" add -A
git -C "$SIBLING" -c user.email=t@t.test -c user.name=t commit -q -m "sibling PR merge"
git -C "$SIBLING" push -q origin main
rm -rf "$SIBLING"

# The worktree's own local "main" ref (if it has one at all) is now stale —
# it still points at the seed commit, never the sibling merge.
OUT="$("$SCRIPT" "$WT" main origin 2>&1)"
RC=$?
check_rc() { if [ "$1" -eq "$2" ]; then ok "$3"; else bad "$3" "expected exit $2 got $1: $OUT"; fi; }
check_rc "$RC" 0 "resolves successfully"
has "prints BASE_SHA" "$OUT" "BASE_SHA "

BASE_SHA="$(printf '%s' "$OUT" | sed -n 's/^BASE_SHA //p')"
SEED_SHA="$(cd "$WT" && git rev-parse HEAD~1)"
check "resolved base is the true divergence point (seed), not origin's live tip" "$BASE_SHA" "$SEED_SHA"

# The whole point: a diff computed from this base against HEAD must contain
# the ticket's own commit but NOT the sibling merge that landed on
# origin/main after the worktree was created.
DIFF_FILES="$(cd "$WT" && git diff --name-only "${BASE_SHA}...HEAD" 2>/dev/null)"
has "diff includes the ticket's own file" "$DIFF_FILES" "ticket.txt"
lacks "diff EXCLUDES the sibling merge that landed after worktree creation" "$DIFF_FILES" "sibling.txt"

# --- Case 2: missing worktree dir fails closed ------------------------------
OUT2="$("$SCRIPT" "/nonexistent/$$/nowhere" main origin 2>&1)"
RC2=$?
check "missing worktree dir exits 1" "$RC2" "1"
has "missing worktree dir reports FAIL" "$OUT2" "FAIL"

# --- Case 3: unfetchable remote/base fails closed rather than guessing -----
LONE="$(mktemp -d)"
git init -q -b main "$LONE"
git -C "$LONE" -c user.email=t@t.test -c user.name=t commit -q --allow-empty -m init
OUT3="$("$SCRIPT" "$LONE" main origin 2>&1)"
RC3=$?
check "no origin remote configured exits 1" "$RC3" "1"
has "no origin remote reports FAIL" "$OUT3" "FAIL"

# --- Case 4 (CON-152 cycle 2, CRITICAL finding 1): after the branch itself
# RECONCILES against the moved base (a real `git merge origin/main`, exactly
# what check-pr-mergeable.sh's/check-merge-readiness.sh's BEHIND
# auto-reconcile does mid-run), the LIVE-resolved base must reflect that —
# and a SHA cached from BEFORE the reconcile must NOT be reused, or the
# sibling's own files spuriously reappear as "changed by this ticket".
STALE_CACHED_SHA="$BASE_SHA" # from Case 1, before any reconcile

FETCH_OUT="$(cd "$WT" && git fetch origin main 2>&1)"
MERGE_OUT="$(cd "$WT" && git merge --no-edit origin/main 2>&1)"
check "fixture premise: the reconcile merge actually succeeded" "$?" "0"

OUT4="$("$SCRIPT" "$WT" main origin 2>&1)"
RC4=$?
check "resolves successfully after reconcile" "$RC4" "0"
LIVE_BASE_AFTER_RECONCILE="$(printf '%s' "$OUT4" | sed -n 's/^BASE_SHA //p')"
ORIGIN_MAIN_TIP="$(cd "$WT" && git rev-parse origin/main)"
check "live base after reconcile is origin/main's new tip (the branch now contains it)" \
  "$LIVE_BASE_AFTER_RECONCILE" "$ORIGIN_MAIN_TIP"

LIVE_DIFF="$(cd "$WT" && git diff --name-only "${LIVE_BASE_AFTER_RECONCILE}...HEAD" 2>/dev/null)"
has "live post-reconcile diff still includes the ticket's own file" "$LIVE_DIFF" "ticket.txt"
lacks "live post-reconcile diff excludes the sibling file (already absorbed, not new)" "$LIVE_DIFF" "sibling.txt"

# The failure mode this whole finding is about: reusing the SHA cached
# BEFORE the reconcile (what a "resolve once at Setup, record the SHA"
# design — cycle 1 of this very PR — would do) now spuriously re-flags
# sibling.txt as part of THIS ticket's diff, because the merge commit
# introduced it relative to that stale base.
STALE_DIFF="$(cd "$WT" && git diff --name-only "${STALE_CACHED_SHA}...HEAD" 2>/dev/null)"
has "PROOF this is a real defect class: the STALE cached-SHA diff wrongly includes the sibling file" "$STALE_DIFF" "sibling.txt"

# --- Case 5: same shape via a SQUASH (squash-branch.sh's own approach —
# reset --soft to the merge-base computed AT SQUASH TIME) rather than a
# merge — confirms live resolution stays correct however the branch
# reconciles, not just via the merge path condition-0 happens to take.
SQ="$(mktemp -d)"
git clone -q "$ORIGIN_URL" "$SQ"
git -C "$SQ" checkout -q -b bug/some-other-ticket/CON-1000
echo "sq ticket" > "$SQ/sq-ticket.txt"
git -C "$SQ" add -A
git -C "$SQ" -c user.email=t@t.test -c user.name=t commit -q -m "sq ticket commit"
echo "sq ticket 2" >> "$SQ/sq-ticket.txt"
git -C "$SQ" add -A
git -C "$SQ" -c user.email=t@t.test -c user.name=t commit -q -m "sq ticket commit 2"
# A fresh merge-base computed live, then squash onto it — mirrors
# squash-branch.sh's own "compute merge-base fresh at squash time" pattern.
git -C "$SQ" fetch -q origin main
SQ_MERGE_BASE="$(git -C "$SQ" merge-base HEAD origin/main)"
git -C "$SQ" reset -q --soft "$SQ_MERGE_BASE"
git -C "$SQ" -c user.email=t@t.test -c user.name=t commit -q -m "squashed"
OUT5="$("$SCRIPT" "$SQ" main origin 2>&1)"
RC5=$?
check "resolves successfully after a squash" "$RC5" "0"
LIVE_BASE_AFTER_SQUASH="$(printf '%s' "$OUT5" | sed -n 's/^BASE_SHA //p')"
check "live base after squash matches the squash's own merge-base (no drift between the two)" \
  "$LIVE_BASE_AFTER_SQUASH" "$SQ_MERGE_BASE"
SQ_DIFF="$(cd "$SQ" && git diff --name-only "${LIVE_BASE_AFTER_SQUASH}...HEAD" 2>/dev/null)"
has "post-squash live diff includes the squashed ticket file" "$SQ_DIFF" "sq-ticket.txt"
lacks "post-squash live diff excludes sibling/seed content" "$SQ_DIFF" "sibling.txt"

# --- Case 6 (CON-152 cycle 2, HIGH finding 3): a caller that omits
# BASE_BRANCH/BASE_REMOTE (e.g. a resumed/older run whose workflow-state.md
# predates REVIEW_BASE_BRANCH/REVIEW_BASE_REMOTE) must fall back to the same
# main/origin default setup-worktree.sh itself uses — never fail outright,
# and never silently improvise something else.
FB="$(mktemp -d)"
FBO="$FB/.origin-bare"
git init -q --bare -b main "$FBO"
git init -q -b main "$FB"
echo "seed" > "$FB/README.md"
git -C "$FB" add -A
git -C "$FB" -c user.email=t@t.test -c user.name=t commit -q -m seed
git -C "$FB" remote add origin "$FBO"
git -C "$FB" push -q origin main
echo "ticket" > "$FB/ticket.txt"
git -C "$FB" add -A
git -C "$FB" -c user.email=t@t.test -c user.name=t commit -q -m "ticket commit"
OUT6="$("$SCRIPT" "$FB" 2>&1)"
RC6=$?
check "no BASE_BRANCH/BASE_REMOTE args: still resolves (default fallback)" "$RC6" "0"
has "no-args fallback prints BASE_SHA" "$OUT6" "BASE_SHA "
rm -rf "$FB"

rm -rf "$WT" "$LONE" "$(dirname "$WT")" "$SQ"

echo "resolve-review-base.sh: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
