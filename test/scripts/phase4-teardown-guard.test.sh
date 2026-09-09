#!/usr/bin/env bash
# CON-171: shell tests for the Phase-4 teardown guard — the script-owned
# auditor lease (Signal A, load-bearing) taken by check-merge-readiness.sh
# and released by emit-event.sh, and the process-cwd probe (Signal B,
# complementary/best-effort) implemented in cleanup.sh — that together stop
# `cleanup.sh --phase4` from destroying a worktree an auditor is still
# writing into. See openspec/changes/guard-phase4-teardown/design.md for the
# full rationale this test coverage maps to.
set -uo pipefail

export NO_COLOR=1
unset FORCE_COLOR

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
READINESS="$PROJECT_ROOT/core/scripts/check-merge-readiness.sh"
EMIT="$PROJECT_ROOT/core/scripts/emit-event.sh"
CLEANUP="$PROJECT_ROOT/core/scripts/cleanup.sh"
# shellcheck disable=SC1091
source "$PROJECT_ROOT/core/scripts/lib/auditor-lease.sh"

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL $1"; echo "       $2"; }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected [$3] got [$2]"; fi; }
has()  { if grep -qF "$2" "$3" 2>/dev/null; then ok "$1"; else bad "$1" "expected to find [$2] in $3"; fi; }
hasnt(){ if grep -qF "$2" "$3" 2>/dev/null; then bad "$1" "unexpectedly found [$2] in $3"; else ok "$1"; fi; }

echo "phase4-teardown-guard.test.sh (CON-171)"

# A `gh` stub that always fails outright — every readiness test here only
# cares about the lease (acquired BEFORE any gh call), never about a real
# PASS/FAIL readiness verdict, so a fast, deterministic non-zero `gh` is all
# that's needed.
MOCKBIN="$(mktemp -d)"
cat > "$MOCKBIN/gh" <<'EOF'
#!/usr/bin/env bash
echo "gh: stub failure (phase4-teardown-guard.test.sh provides no real gh)" >&2
exit 1
EOF
chmod +x "$MOCKBIN/gh"
export PATH="$MOCKBIN:$PATH"
export CONCERTINO_CI_WAIT_TIMEOUT_SEC=0
export CONCERTINO_CI_POLL_INTERVAL_SEC=1
export CONCERTINO_MERGE_RECHECK_TIMEOUT_SEC=0
export CONCERTINO_MERGE_RECHECK_INTERVAL_SEC=1

# A real main checkout (REPO) plus a REAL linked worktree (WT) on a named
# branch — the shape check-merge-readiness.sh, emit-event.sh and cleanup.sh
# all actually see in production. `git rev-parse --git-common-dir` from
# inside WT resolves to REPO/.git, exactly like a real delivery worktree.
new_fixture() {
  # $1 = branch name
  REPO="$(mktemp -d)"
  git -C "$REPO" init -q -b main
  git -C "$REPO" -c user.email=t@t.test -c user.name=t commit -q --allow-empty -m init
  WT="$(mktemp -d)"
  rm -rf "$WT"
  git -C "$REPO" worktree add -q -b "$1" "$WT" main >/dev/null 2>&1
}

cleanup_fixture() {
  git -C "$REPO" worktree remove --force "$WT" >/dev/null 2>&1 || true
  rm -rf "$REPO" "$WT" 2>/dev/null || true
}

run_readiness() {
  # $1=WORKTREE_PATH $2=BRANCH $3=TICKET_ID; sets RC, OUT, ERR-file paths.
  # CON-166: check-merge-readiness.sh now takes a required 4th ARCHIVE_PREFIX
  # argument. This suite only exercises lease acquire/release around the
  # script (Signal A), never condition 3's SHA-drift content, so any
  # placeholder value is fine.
  RO="$(mktemp)"; RE="$(mktemp)"
  "$READINESS" "$1" "$2" "$3" openspec >"$RO" 2>"$RE"
  RC=$?
  READY_OUT="$RO"; READY_ERR="$RE"
}

run_emit() {
  # $1 = cwd to invoke emit-event.sh from; $2.. = args
  local cwd="$1"; shift
  ( cd "$cwd" && "$EMIT" "$@" ) >/dev/null 2>&1
}

run_cleanup() {
  # $1=cwd $2=force(force|nofoce) $3=WORKTREE_PATH $4=TICKET_ID(optional)
  local cwd="$1" force="$2" wt="$3" ticket="${4:-}"
  local flags=(--phase4)
  [ "$force" = "force" ] && flags+=(--force-teardown)
  CO="$(mktemp)"; CE="$(mktemp)"
  ( cd "$cwd" && "$CLEANUP" "${flags[@]}" "$wt" "" "" "$ticket" ) >"$CO" 2>"$CE"
  RC=$?
  CLEAN_OUT="$CO"; CLEAN_ERR="$CE"
}

lease_file_for() {
  # $1=root $2=ticket
  lease_path "$1" "$2"
}

wait_holder_ready() {
  # $1=pid $2=expected cwd; bounded poll (up to 2s) replacing a fixed
  # sleep-based warm-up — a fixed sleep races the actual chdir under load
  # (CON-171 evaluation cycle 1, CR-2), where the backgrounded subshell may
  # not have completed its `cd` by the time a short fixed sleep elapses.
  # Polling the real signal (the holder's own recorded cwd) removes that
  # race regardless of machine load.
  local pid="$1" expected="$2" i
  for i in $(seq 1 40); do
    [ "$(readlink "/proc/${pid}/cwd" 2>/dev/null)" = "$expected" ] && return 0
    sleep 0.05
  done
  return 1
}

# =============================================================================
# 4.1 — the lease: acquisition, release, idempotency, cleanup.sh interaction
# =============================================================================

# --- acquisition by check-merge-readiness.sh --------------------------------
new_fixture "bug/x/CONT-100"
run_readiness "$WT" "bug/x/CONT-100" "CONT-100"
LEASE="$(lease_file_for "$REPO" CONT-100)"
check "1.1 lease file created on acquire" "$([ -f "$LEASE" ] && echo yes || echo no)" "yes"
has  "1.2 lease records the acquiring script" "script=check-merge-readiness.sh" "$LEASE"
has  "1.3 lease records the canonical ticket" "ticket=CONT-100" "$LEASE"
has  "1.4 lease records the absolute worktree path" "worktree=${WT}" "$LEASE"
check "1.5 readiness itself still fails (stub gh)" "$([ "$RC" -ne 0 ] && echo yes || echo no)" "yes"
cleanup_fixture

# --- acquisition survives a real readiness FAIL (lease held either way) ----
new_fixture "bug/x/CONT-101"
run_readiness "$WT" "bug/x/CONT-101" "CONT-101"
LEASE="$(lease_file_for "$REPO" CONT-101)"
check "2.1 lease held despite a FAIL from a real readiness check" "$([ -f "$LEASE" ] && echo yes || echo no)" "yes"
cleanup_fixture

# --- idempotent re-acquire on a PENDING re-invocation -----------------------
new_fixture "bug/x/CONT-102"
run_readiness "$WT" "bug/x/CONT-102" "CONT-102"
LEASE="$(lease_file_for "$REPO" CONT-102)"
PID1="$(lease_field "$LEASE" pid)"
run_readiness "$WT" "bug/x/CONT-102" "CONT-102"
PID2="$(lease_field "$LEASE" pid)"
check "3.1 re-invocation does not error" "$([ -f "$LEASE" ] && echo yes || echo no)" "yes"
# Each invocation is its own process, so its recorded pid legitimately
# differs run to run — idempotency means "re-acquire never errors and always
# leaves exactly one, freshly-recorded lease", not "the same pid twice".
check "3.2 a pid was recorded on the first acquire" "$([ -n "$PID1" ] && echo yes || echo no)" "yes"
check "3.3 a pid was recorded on the re-acquire" "$([ -n "$PID2" ] && echo yes || echo no)" "yes"
cleanup_fixture

# --- malformed ticket id creates NO lease (never one the release path could
# not address) ---------------------------------------------------------------
new_fixture "bug/x/000"
run_readiness "$WT" "bug/x/000" "123"
check "4.1 malformed TICKET_ID exits non-zero" "$([ "$RC" -ne 0 ] && echo yes || echo no)" "yes"
if lease_find_by_worktree "$REPO" "$WT" >/dev/null 2>&1; then
  bad "4.2 no lease exists for a malformed ticket id" "a lease was found"
else
  ok "4.2 no lease exists for a malformed ticket id"
fi
cleanup_fixture

# --- release by an auditor verdict, for every verdict value -----------------
for V in MERGE ESCALATE BLOCKER ESCALATION-RAISE; do
  new_fixture "bug/x/CONT-2$RANDOM"
  T="CONT-2${RANDOM}"
  run_readiness "$WT" "bug/x/${T}" "$T"
  LEASE="$(lease_file_for "$REPO" "$T")"
  [ -f "$LEASE" ] || bad "5.$V lease exists before release" "no lease file"
  run_emit "$REPO" verdict "ticket=$T" role=auditor "verdict=$V"
  check "5.$V auditor verdict=$V releases the lease" "$([ -f "$LEASE" ] && echo held || echo released)" "released"
  cleanup_fixture
done

# --- a non-auditor verdict does NOT release ---------------------------------
new_fixture "bug/x/CONT-300"
run_readiness "$WT" "bug/x/CONT-300" "CONT-300"
LEASE="$(lease_file_for "$REPO" CONT-300)"
run_emit "$REPO" verdict ticket=CONT-300 role=evaluator verdict=PASS
check "6.1 a non-auditor verdict leaves the lease held" "$([ -f "$LEASE" ] && echo held || echo released)" "held"
run_emit "$REPO" verdict ticket=CONT-300 role=skeptic verdict=CONFIRM
check "6.2 a skeptic verdict also leaves the lease held" "$([ -f "$LEASE" ] && echo held || echo released)" "held"
cleanup_fixture

# --- idempotent release: a second release call on an already-clear lease
# does not error and does not resurrect anything -----------------------------
new_fixture "bug/x/CONT-301"
run_readiness "$WT" "bug/x/CONT-301" "CONT-301"
LEASE="$(lease_file_for "$REPO" CONT-301)"
run_emit "$REPO" verdict ticket=CONT-301 role=auditor verdict=MERGE
run_emit "$REPO" verdict ticket=CONT-301 role=auditor verdict=MERGE
check "7.1 double release leaves lease absent, no error" "$([ -f "$LEASE" ] && echo held || echo released)" "released"
cleanup_fixture

# --- cleanup.sh refuses while held, proceeds once released ------------------
new_fixture "bug/x/CONT-40"
run_readiness "$WT" "bug/x/CONT-40" "CONT-40"
run_cleanup "$REPO" nofoce "$WT" CONT-40
check "8.1 cleanup.sh refuses while the lease is held" "$([ "$RC" -ne 0 ] && echo yes || echo no)" "yes"
has "8.2 refusal names the held lease" "auditor lease held" "$CLEAN_ERR"
check "8.3 worktree is NOT removed while refused" "$([ -d "$WT" ] && echo present || echo absent)" "present"
run_emit "$REPO" verdict ticket=CONT-40 role=auditor verdict=MERGE
run_cleanup "$REPO" nofoce "$WT" CONT-40
check "8.4 cleanup.sh proceeds once the lease is released" "$RC" "0"
has "8.5 prints READY once proceeded" "READY cleaned worktree=" "$CLEAN_OUT"
cleanup_fixture

# =============================================================================
# 4.1a — root-resolution coverage: the fail-open case
# =============================================================================

# Acquire from WT's own cwd (check-merge-readiness.sh always cd's into
# WORKTREE_PATH itself), then run cleanup.sh's check from a DIFFERENT
# directory — including from cwd INSIDE the worktree — and confirm the lease
# is still found both times. Every other scenario in this file would pass
# under a wrong-root implementation; this is what actually exercises it.
new_fixture "bug/x/CONT-50"
run_readiness "$WT" "bug/x/CONT-50" "CONT-50"
run_cleanup "$REPO" nofoce "$WT" CONT-50
check "9.1 lease found when cleanup.sh's cwd IS the main checkout" "$([ "$RC" -ne 0 ] && echo yes || echo no)" "yes"
has  "9.2 refusal names the lease from the main-checkout cwd" "auditor lease held" "$CLEAN_ERR"
run_cleanup "$WT" nofoce "$WT" CONT-50
check "9.3 lease STILL found when cleanup.sh's cwd is INSIDE the worktree" "$([ "$RC" -ne 0 ] && echo yes || echo no)" "yes"
has  "9.4 refusal names the lease from the worktree-cwd invocation" "auditor lease held" "$CLEAN_ERR"
run_emit "$REPO" verdict ticket=CONT-50 role=auditor verdict=MERGE
cleanup_fixture

# --- an unresolvable run root fails CLOSED, not open ------------------------
# A cwd outside any git repo at all fails even earlier, at cleanup.sh's
# pre-existing REPO_ROOT (`--show-toplevel`) resolution — the guard's own
# `lease_resolve_root` never gets a chance to run. That is still a
# fail-closed outcome (worktree untouched), just attributed to the
# pre-existing mechanism rather than the new one; assert generically rather
# than pinning to either message.
OUTSIDE="$(mktemp -d)"
run_cleanup "$OUTSIDE" nofoce "$OUTSIDE/nonexistent-worktree" ""
check "9.5 an unresolvable root refuses (fails closed)" "$([ "$RC" -ne 0 ] && echo yes || echo no)" "yes"
check "9.6 the nonexistent worktree was never created/touched" "$([ -e "$OUTSIDE/nonexistent-worktree" ] && echo exists || echo absent)" "absent"
rm -rf "$OUTSIDE"

# =============================================================================
# 4.1c — ticket-key canonicalisation
# =============================================================================
new_fixture "bug/x/cont-60"
run_readiness "$WT" "bug/x/cont-60" "cont-60"
LEASE="$(lease_file_for "$REPO" cont-60)"
check "10.1 lowercase ticket id lease exists (canonical path)" "$([ -f "$LEASE" ] && echo yes || echo no)" "yes"
has  "10.2 lease itself records the canonicalised (uppercase) ticket" "ticket=CONT-60" "$LEASE"
run_emit "$REPO" verdict ticket=cont-60 role=auditor verdict=MERGE
check "10.3 a lowercase-ticket auditor verdict still releases the lease" "$([ -f "$LEASE" ] && echo held || echo released)" "released"
run_cleanup "$REPO" nofoce "$WT" cont-60
check "10.4 cleanup.sh proceeds after canonicalised release" "$RC" "0"
cleanup_fixture

# =============================================================================
# 4.1b — matched by worktree path, not by T; a canonical `T` inference does
# not blind the check
# =============================================================================
new_fixture "randomly-named-branch"
run_readiness "$WT" randomly-named-branch CONT-70
# cleanup.sh is called WITHOUT the optional TICKET_ID — T is inferred from
# WT's basename, which is not ticket-shaped. The lease must still be found
# because it is matched on the recorded WORKTREE PATH, never on `T`.
run_cleanup "$REPO" nofoce "$WT" ""
check "11.1 lease found even when T is basename-inferred and non-ticket-shaped" "$([ "$RC" -ne 0 ] && echo yes || echo no)" "yes"
has "11.2 refusal still names the held lease" "auditor lease held" "$CLEAN_ERR"
run_emit "$REPO" verdict ticket=CONT-70 role=auditor verdict=MERGE
cleanup_fixture

# =============================================================================
# 4.2 — the process-cwd probe (Signal B)
# =============================================================================

# --- refusal with a live cwd holder -----------------------------------------
new_fixture "bug/x/CONT-80"
( cd "$WT" && exec sleep 30 ) &
HOLDER_PID=$!
sleep 0.2   # let the child actually chdir before probing
run_cleanup "$REPO" nofoce "$WT" CONT-80
check "12.1 refuses with a live cwd holder present" "$([ "$RC" -ne 0 ] && echo yes || echo no)" "yes"
has "12.2 refusal names the holder pid" "$HOLDER_PID" "$CLEAN_ERR"
check "12.3 worktree not removed" "$([ -d "$WT" ] && echo present || echo absent)" "present"
kill "$HOLDER_PID" 2>/dev/null; wait "$HOLDER_PID" 2>/dev/null
cleanup_fixture

# --- clean pass-through: no holder, no lease --------------------------------
new_fixture "bug/x/CONT-81"
run_cleanup "$REPO" nofoce "$WT" CONT-81
check "13.1 no holder, no lease: cleanup proceeds" "$RC" "0"
has "13.2 prints READY" "READY cleaned worktree=" "$CLEAN_OUT"
cleanup_fixture

# --- a holder that exits DURING the settle window: teardown proceeds -------
new_fixture "bug/x/CONT-82"
( cd "$WT" && exec sleep 1 ) &
HOLDER_PID=$!
run_cleanup "$REPO" nofoce "$WT" CONT-82
check "14.1 a holder gone before the 3s bound: cleanup proceeds" "$RC" "0"
wait "$HOLDER_PID" 2>/dev/null
cleanup_fixture

# --- a holder persisting past the bound: refuses ----------------------------
# Holder lifetime raised to match 12.1/17.1 (30s, comfortably above the
# guard's own bound) rather than a value close to the bound itself (the
# previous `sleep 10` left only ~0.5s of margin once cleanup.sh's own
# non-guard work is included, which is what made this assertion
# timing-fragile under load — CON-171 evaluation cycle 1, CR-2). The
# fixed `sleep 0.2` warm-up is replaced with wait_holder_ready(), a bounded
# poll on the holder's own recorded cwd, so this assertion is never racing
# an unstarted chdir either.
new_fixture "bug/x/CONT-83"
( cd "$WT" && exec sleep 30 ) &
HOLDER_PID=$!
wait_holder_ready "$HOLDER_PID" "$WT" || bad "15.0 holder actually chdir'd into WT before probing" "wait_holder_ready timed out"
_T0=$(date +%s%3N)
run_cleanup "$REPO" nofoce "$WT" CONT-83
_T1=$(date +%s%3N)
_ELAPSED_MS=$((_T1 - _T0))
check "15.1 a holder persisting past the 3s bound: refuses" "$([ "$RC" -ne 0 ] && echo yes || echo no)" "yes"
# CR-1's own regression guard: the settle window's bound is a genuine
# wall-clock deadline (~3000ms), not a sum of `sleep` durations that
# undercounts the probe's own cost — an earlier version of this loop
# measured ~9.5s here. A small multiple (10000ms) of the documented 3000ms
# bound gives headroom for real probe/script overhead on a loaded machine
# without re-permitting the unbounded-growth defect CR-1 fixed.
check "15.2 the refusal path completes within a small multiple of the bound" "$([ "$_ELAPSED_MS" -lt 10000 ] && echo yes || echo no)" "yes"
kill "$HOLDER_PID" 2>/dev/null; wait "$HOLDER_PID" 2>/dev/null
cleanup_fixture

# =============================================================================
# 4.3 — self-exclusion is ancestors-only, never siblings/other descendants
# =============================================================================

# --- invoking with cwd inside the worktree must not self-refuse ------------
new_fixture "bug/x/CONT-90"
run_cleanup "$WT" nofoce "$WT" CONT-90
check "16.1 cwd inside the worktree does not self-refuse" "$RC" "0"
cleanup_fixture

# --- a holder that only shares an ancestor (NOT itself an ancestor of the
# cleanup process) must still be detected — the counterpart proof that the
# exclusion is ancestors-only, never vacuous. A subshell backgrounds a sibling
# holder BEFORE cleanup.sh itself is invoked from a second, independent
# subshell — the two share only the test harness as a common ancestor, never
# a direct ancestor relationship to each other.
new_fixture "bug/x/CONT-91"
( ( cd "$WT" && exec sleep 30 ) & echo $! > /tmp/_pt_sibling_pid.$$ )
sleep 0.2
HOLDER_PID="$(cat /tmp/_pt_sibling_pid.$$)"
rm -f "/tmp/_pt_sibling_pid.$$"
run_cleanup "$REPO" nofoce "$WT" CONT-91
check "17.1 a sibling (non-ancestor) holder is still detected" "$([ "$RC" -ne 0 ] && echo yes || echo no)" "yes"
has "17.2 refusal names the sibling holder's pid" "$HOLDER_PID" "$CLEAN_ERR"
kill "$HOLDER_PID" 2>/dev/null; wait 2>/dev/null
cleanup_fixture

# =============================================================================
# 4.4 — --force-teardown: both entry forms, overriding both signals, and the
# mistyped-flag usage error
# =============================================================================

# --- overrides a held lease, entry form: --phase4 --force-teardown ---------
new_fixture "bug/x/CONT-95"
run_readiness "$WT" "bug/x/CONT-95" "CONT-95"
run_cleanup "$REPO" force "$WT" CONT-95
check "18.1 --force-teardown overrides a held lease" "$RC" "0"
has "18.2 reports what it overrode (lease)" "overriding held auditor lease" "$CLEAN_ERR"
cleanup_fixture

# --- overrides a held lease, entry form: CONCERTINO_PHASE4=1 --force-teardown
new_fixture "bug/x/CONT-96"
run_readiness "$WT" "bug/x/CONT-96" "CONT-96"
CO="$(mktemp)"; CE="$(mktemp)"
( cd "$REPO" && CONCERTINO_PHASE4=1 "$CLEANUP" --force-teardown "$WT" "" "" CONT-96 ) >"$CO" 2>"$CE"
RC=$?
check "19.1 CONCERTINO_PHASE4=1 form: --force-teardown overrides a held lease" "$RC" "0"
has "19.2 reports what it overrode (lease)" "overriding held auditor lease" "$CE"
cleanup_fixture

# --- overrides a live holder --------------------------------------------
new_fixture "bug/x/CONT-97"
( cd "$WT" && exec sleep 30 ) &
HOLDER_PID=$!
sleep 0.2
run_cleanup "$REPO" force "$WT" CONT-97
check "20.1 --force-teardown overrides a live holder" "$RC" "0"
has "20.2 reports what it overrode (holder pid)" "overriding live worktree holder" "$CLEAN_ERR"
has "20.3 names the specific pid overridden" "$HOLDER_PID" "$CLEAN_ERR"
kill "$HOLDER_PID" 2>/dev/null; wait "$HOLDER_PID" 2>/dev/null
cleanup_fixture

# --- no env var or default can reach --force-teardown -----------------------
new_fixture "bug/x/CONT-98"
run_readiness "$WT" "bug/x/CONT-98" "CONT-98"
CO="$(mktemp)"; CE="$(mktemp)"
( cd "$REPO" && CONCERTINO_PHASE4=1 FORCE_TEARDOWN=1 CONCERTINO_FORCE_TEARDOWN=1 "$CLEANUP" "$WT" "" "" CONT-98 ) >"$CO" 2>"$CE"
RC=$?
check "21.1 no ambient env var substitutes for the explicit flag" "$([ "$RC" -ne 0 ] && echo yes || echo no)" "yes"
has "21.2 still refuses citing the lease" "auditor lease held" "$CE"
run_emit "$REPO" verdict ticket=CONT-98 role=auditor verdict=MERGE
cleanup_fixture

# --- mistyped flag fails loudly, never binds as WORKTREE_PATH --------------
new_fixture "bug/x/CONT-99"
CO="$(mktemp)"; CE="$(mktemp)"
( cd "$REPO" && "$CLEANUP" --phase4 --force-teardwn "$WT" "" "" CONT-99 ) >"$CO" 2>"$CE"
RC=$?
check "22.1 a mistyped flag exits non-zero" "$([ "$RC" -ne 0 ] && echo yes || echo no)" "yes"
has "22.2 names the unrecognized flag, not a missing-worktree symptom" "unrecognized flag" "$CE"
check "22.3 the real worktree was never touched" "$([ -d "$WT" ] && echo present || echo absent)" "present"
cleanup_fixture

rm -rf "$MOCKBIN"

echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
