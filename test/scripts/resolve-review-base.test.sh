#!/usr/bin/env bash
# Shell tests for scripts/concertino/resolve-review-base.sh (CON-152):
# resolving the review diff base LIVE, on every call, against a
# freshly-fetched remote base branch, rather than a bare local `main` ref
# that never moves (or a value cached once and reused across the run).
#
# Every case runs the REAL script against a throwaway `mktemp -d` fixture
# repo with a real bare "origin" remote, never a reimplementation.
set -uo pipefail

# CON-181: scope every mktemp/mktemp -d call in this file to a scratch
# TMPDIR removed on exit -- see test/scripts/lib/tmp-scratch.sh. This
# file already installs its own EXIT trap below, so cleanup() calls
# con181_cleanup_scratch instead of a second `trap ... EXIT`.
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp-scratch.sh"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/core/scripts/resolve-review-base.sh"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL $1"; echo "       $2"; }
has()  { if printf '%s' "$2" | grep -qF "$3"; then ok "$1"; else bad "$1" "expected to find [$3] in: $2"; fi; }
lacks(){ if printf '%s' "$2" | grep -qF "$3"; then bad "$1" "did NOT expect [$3] in: $2"; else ok "$1"; fi; }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected [$3] got [$2]"; fi; }
is_sha(){ if printf '%s' "$2" | grep -qE '^[0-9a-f]{40}$'; then ok "$1"; else bad "$1" "expected a bare 40-hex SHA, got: [$2]"; fi; }

echo "resolve-review-base.sh (CON-152)"

CLEANUP_DIRS=()
cleanup() { con181_cleanup_scratch; local d; for d in "${CLEANUP_DIRS[@]:-}"; do [ -n "$d" ] && rm -rf "$d"; done; }
trap cleanup EXIT

# --- Fixture: a bare "origin" + a worktree-like clone branched off it -------
# Mirrors the real incident: a local worktree is created off origin/main at
# some commit, work happens on a ticket branch, and THEN a sibling ticket's
# PR merges to origin/main — after the worktree already exists. A bare
# `main...HEAD` (or a stale local `main` ref) picks up that sibling commit;
# the fix must not.
new_fixture() {
  local d o base="${1:-main}"
  d="$(mktemp -d)"
  CLEANUP_DIRS+=("$d")
  o="$d/.origin-bare"
  git init -q --bare -b "$base" "$o"

  local seed
  seed="$(mktemp -d)"
  git init -q -b "$base" "$seed"
  echo "seed" > "$seed/README.md"
  git -C "$seed" add -A
  git -C "$seed" -c user.email=t@t.test -c user.name=t commit -q -m seed
  git -C "$seed" remote add origin "$o"
  git -C "$seed" push -q origin "$base"
  rm -rf "$seed"

  local wt
  wt="$d/wt"
  git clone -q "$o" "$wt"
  git -C "$wt" checkout -q -b bug/some-ticket/CON-999
  printf '%s' "$wt"
}

# --- Case 1: sibling merge lands on origin/main AFTER the worktree exists --
WT="$(new_fixture main)"
ORIGIN_URL="$(git -C "$WT" remote get-url origin)"

echo "ticket change" > "$WT/ticket.txt"
git -C "$WT" add -A
git -C "$WT" -c user.email=t@t.test -c user.name=t commit -q -m "ticket commit"

SIBLING="$(mktemp -d)"; CLEANUP_DIRS+=("$SIBLING")
git clone -q "$ORIGIN_URL" "$SIBLING"
echo "sibling change" > "$SIBLING/sibling.txt"
git -C "$SIBLING" add -A
git -C "$SIBLING" -c user.email=t@t.test -c user.name=t commit -q -m "sibling PR merge"
git -C "$SIBLING" push -q origin main

OUT="$("$SCRIPT" "$WT" main origin 2>&1)"
RC=$?
check "resolves successfully" "$RC" "0"
is_sha "prints a bare SHA (no BASE_SHA prefix, no other output)" "$OUT"

BASE_SHA="$OUT"
SEED_SHA="$(cd "$WT" && git rev-parse HEAD~1)"
check "resolved base is the true divergence point (seed), not origin's live tip" "$BASE_SHA" "$SEED_SHA"

DIFF_FILES="$(cd "$WT" && git diff --name-only "${BASE_SHA}...HEAD" 2>/dev/null)"
has "diff includes the ticket's own file" "$DIFF_FILES" "ticket.txt"
lacks "diff EXCLUDES the sibling merge that landed after worktree creation" "$DIFF_FILES" "sibling.txt"

# --- Case 2: missing worktree dir fails closed, stdout carries NOTHING -----
OUT2="$("$SCRIPT" "/nonexistent/$$/nowhere" main origin 2>/dev/null)"
ERR2="$("$SCRIPT" "/nonexistent/$$/nowhere" main origin 2>&1 1>/dev/null)"
RC2=$?
check "missing worktree dir exits 1" "$RC2" "1"
check "missing worktree dir: stdout is empty (never a guessed value)" "$OUT2" ""
has "missing worktree dir reports FAIL on stderr" "$ERR2" "FAIL"

# --- Case 3: unfetchable remote/base fails closed rather than guessing -----
LONE="$(mktemp -d)"; CLEANUP_DIRS+=("$LONE")
git init -q -b main "$LONE"
git -C "$LONE" -c user.email=t@t.test -c user.name=t commit -q --allow-empty -m init
OUT3="$("$SCRIPT" "$LONE" main origin 2>/dev/null)"
ERR3="$("$SCRIPT" "$LONE" main origin 2>&1 1>/dev/null)"
RC3=$?
check "no origin remote configured exits 1" "$RC3" "1"
check "no origin remote: stdout is empty" "$OUT3" ""
has "no origin remote reports FAIL on stderr" "$ERR3" "FAIL"

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
LIVE_BASE_AFTER_RECONCILE="$OUT4"
ORIGIN_MAIN_TIP="$(cd "$WT" && git rev-parse origin/main)"
check "live base after reconcile is origin/main's new tip (the branch now contains it)" \
  "$LIVE_BASE_AFTER_RECONCILE" "$ORIGIN_MAIN_TIP"

LIVE_DIFF="$(cd "$WT" && git diff --name-only "${LIVE_BASE_AFTER_RECONCILE}...HEAD" 2>/dev/null)"
has "live post-reconcile diff still includes the ticket's own file" "$LIVE_DIFF" "ticket.txt"
lacks "live post-reconcile diff excludes the sibling file (already absorbed, not new)" "$LIVE_DIFF" "sibling.txt"

STALE_DIFF="$(cd "$WT" && git diff --name-only "${STALE_CACHED_SHA}...HEAD" 2>/dev/null)"
has "PROOF this is a real defect class: the STALE cached-SHA diff wrongly includes the sibling file" "$STALE_DIFF" "sibling.txt"

# --- Case 5: same shape via a SQUASH (squash-branch.sh's own approach —
# reset --soft to the merge-base computed AT SQUASH TIME) rather than a
# merge — confirms live resolution stays correct however the branch
# reconciles, not just via the merge path condition-0 happens to take.
SQ="$(mktemp -d)"; CLEANUP_DIRS+=("$SQ")
git clone -q "$ORIGIN_URL" "$SQ"
git -C "$SQ" checkout -q -b bug/some-other-ticket/CON-1000
echo "sq ticket" > "$SQ/sq-ticket.txt"
git -C "$SQ" add -A
git -C "$SQ" -c user.email=t@t.test -c user.name=t commit -q -m "sq ticket commit"
echo "sq ticket 2" >> "$SQ/sq-ticket.txt"
git -C "$SQ" add -A
git -C "$SQ" -c user.email=t@t.test -c user.name=t commit -q -m "sq ticket commit 2"
git -C "$SQ" fetch -q origin main
SQ_MERGE_BASE="$(git -C "$SQ" merge-base HEAD origin/main)"
git -C "$SQ" reset -q --soft "$SQ_MERGE_BASE"
git -C "$SQ" -c user.email=t@t.test -c user.name=t commit -q -m "squashed"
OUT5="$("$SCRIPT" "$SQ" main origin 2>&1)"
RC5=$?
check "resolves successfully after a squash" "$RC5" "0"
LIVE_BASE_AFTER_SQUASH="$OUT5"
check "live base after squash matches the squash's own merge-base (no drift between the two)" \
  "$LIVE_BASE_AFTER_SQUASH" "$SQ_MERGE_BASE"
SQ_DIFF="$(cd "$SQ" && git diff --name-only "${LIVE_BASE_AFTER_SQUASH}...HEAD" 2>/dev/null)"
has "post-squash live diff includes the squashed ticket file" "$SQ_DIFF" "sq-ticket.txt"
lacks "post-squash live diff excludes sibling/seed content" "$SQ_DIFF" "sibling.txt"

# --- Case 6 (CON-152 cycle 2, HIGH finding 3): a caller that omits
# BASE_BRANCH/BASE_REMOTE (e.g. a resumed/older run whose workflow-state.md
# predates REVIEW_BASE_BRANCH/REVIEW_BASE_REMOTE) must fall back to the
# hardcoded main/origin default when NO .concertino.env is present — never
# fail outright, and never silently improvise something else.
FB="$(mktemp -d)"; CLEANUP_DIRS+=("$FB")
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
check "no BASE_BRANCH/BASE_REMOTE args, no .concertino.env: still resolves (main/origin default)" "$RC6" "0"
is_sha "no-args fallback prints a bare SHA" "$OUT6"

# --- Case 7 (CON-152 cycle 3, MEDIUM finding 3): resolve-review-base.sh must
# source the SAME co-located `.concertino.env` setup-worktree.sh sources
# (core/scripts/setup-worktree.sh's own `[ -f "${SCRIPT_DIR}/.concertino.env" ]
# && source ...` pattern) — a project whose real base branch is NOT "main"
# (e.g. "develop") must resolve against develop without needing the caller
# to pass it explicitly every time, and WITHOUT silently resolving against
# an unrelated "origin/main" that happens to exist.
DEVWT="$(new_fixture develop)"
echo "dev ticket" > "$DEVWT/dev-ticket.txt"
git -C "$DEVWT" add -A
git -C "$DEVWT" -c user.email=t@t.test -c user.name=t commit -q -m "dev ticket commit"

TMPBIN="$(mktemp -d)"; CLEANUP_DIRS+=("$TMPBIN")
cp "$SCRIPT" "$TMPBIN/resolve-review-base.sh"
chmod +x "$TMPBIN/resolve-review-base.sh"
cat > "$TMPBIN/.concertino.env" <<'EOF'
CONCERTINO_BASE_BRANCH=develop
CONCERTINO_BASE_REMOTE=origin
EOF

OUT7="$("$TMPBIN/resolve-review-base.sh" "$DEVWT" 2>&1)"
RC7=$?
check "no-args resolves against develop via a co-located .concertino.env" "$RC7" "0"
DEV_SEED_SHA="$(cd "$DEVWT" && git rev-parse HEAD~1)"
check "resolved base is develop's seed commit (not a hardcoded main default)" "$OUT7" "$DEV_SEED_SHA"

# The whole point of finding 3: WITHOUT that colocated .concertino.env (the
# unmodified script, called with no args, against the exact same develop-
# based fixture), the hardcoded main/origin default is not merely "less
# convenient" — it FAILS outright, because this fixture has no "main" ref
# at all. A caller that skipped sourcing config would get a loud FAIL here,
# not a silently-wrong answer against some unrelated main — but forces
# every no-args call in a non-main-based project to fail, which is the
# defect this finding is about.
OUT7B="$("$SCRIPT" "$DEVWT" 2>&1)"
RC7B=$?
check "same fixture, no .concertino.env: the hardcoded main/origin default fails closed" "$RC7B" "1"
has "failure names the wrong (hardcoded) ref it tried" "$OUT7B" "origin/main"

# --- Case 8 (CON-152 cycle 3, LOW finding 5 — M2 mutation coverage): a
# worktree whose LOCAL origin/<base> tracking ref is STALE relative to the
# real remote must still resolve correctly, because the script re-fetches —
# and this must be a scenario where skipping that fetch actually produces a
# DIFFERENT, WRONG answer. Case 1 does NOT establish this: there, the
# "correct" merge-base (seed) is identical whether or not the sibling
# commit was ever fetched, so a "skip fetch" mutant of this script still
# passed case 1 (cycle 2's own mutation testing missed this). Here, the
# ticket branch's own commit gets folded into origin/main by a THIRD party
# (a squash-merge of this exact ticket, done entirely without WT ever
# fetching) — so the LIVE merge-base (after a real fetch) is the ticket's
# own tip (nothing left to review — it's already merged), while the STALE
# local tracking ref (never fetched) still reports the OLD pre-merge base,
# wrongly showing the ticket's file as still "changed".
M2WT="$(new_fixture main)"
M2_ORIGIN_URL="$(git -C "$M2WT" remote get-url origin)"
echo "m2 ticket" > "$M2WT/m2-ticket.txt"
git -C "$M2WT" add -A
git -C "$M2WT" -c user.email=t@t.test -c user.name=t commit -q -m "m2 ticket commit"
M2_TICKET_SHA="$(cd "$M2WT" && git rev-parse HEAD)"
M2_STALE_LOCAL_BEFORE="$(cd "$M2WT" && git rev-parse origin/main)"

# A separate party folds the ticket's own commit into origin/main — e.g. a
# squash-merge landed via GitHub — entirely without WT's own local tracking
# ref ever being updated.
M2_MERGER="$(mktemp -d)"; CLEANUP_DIRS+=("$M2_MERGER")
git clone -q "$M2_ORIGIN_URL" "$M2_MERGER"
git -C "$M2_MERGER" fetch -q "$M2WT" "bug/some-ticket/CON-999:refs/remotes/wt/ticket"
git -C "$M2_MERGER" merge -q --no-edit refs/remotes/wt/ticket
git -C "$M2_MERGER" push -q origin main

check "M2 fixture premise: WT's local origin/main tracking ref is still stale" \
  "$M2_STALE_LOCAL_BEFORE" "$(cd "$M2WT" && git rev-parse origin/main)"

OUT8="$("$SCRIPT" "$M2WT" main origin 2>&1)"
RC8=$?
check "resolves successfully against the now-fetched remote" "$RC8" "0"
check "the LIVE (fetched) base is the ticket's own commit — nothing left unreviewed" \
  "$OUT8" "$M2_TICKET_SHA"
M2_LOCAL_AFTER="$(cd "$M2WT" && git rev-parse origin/main)"
check "the script's own fetch actually advanced the local tracking ref" \
  "$M2_LOCAL_AFTER" "$(cd "$M2_MERGER" && git rev-parse HEAD)"

M2_LIVE_DIFF="$(cd "$M2WT" && git diff --name-only "${OUT8}...HEAD" 2>/dev/null)"
check "live diff against the fetched base is empty (ticket already fully merged)" "$M2_LIVE_DIFF" ""

echo "resolve-review-base.sh: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
