#!/usr/bin/env bash
# Shell tests for scripts/concertino/check-merge-readiness.sh (CON-24
# agent-merge-role, extended for the CI-wait / BEHIND-reconcile hotfix, and
# again for CON-166 verdict-SHA binding).
#
# `gh` is stubbed with a minimal fake on PATH so these tests never touch the
# network or a real PR — see mock_gh() below. All git/event-log state is a
# throwaway scratch repo, never this checkout's own.
set -uo pipefail

# CON-181: scope every mktemp/mktemp -d call in this file to a scratch
# TMPDIR removed on exit -- see test/scripts/lib/tmp-scratch.sh.
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp-scratch.sh"
trap con181_cleanup_scratch EXIT

export NO_COLOR=1
unset FORCE_COLOR

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/core/scripts/check-merge-readiness.sh"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL $1"; echo "       $2"; }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected [$3] got [$2]"; fi; }
has()  { if grep -qF "$2" "$3" 2>/dev/null; then ok "$1"; else bad "$1" "expected to find [$2] in $3"; fi; }
lacks(){ if grep -qF "$2" "$3" 2>/dev/null; then bad "$1" "did NOT expect to find [$2] in $3"; else ok "$1"; fi; }

echo "check-merge-readiness.sh (CON-24 agent-merge-role + CI-wait/BEHIND-reconcile hotfix + CON-166 verdict-SHA binding)"

# Keep every test that doesn't specifically exercise polling instant: a
# zero timeout still runs one query (elapsed(0) >= timeout(0) is checked
# AFTER that query), so a still-pending/still-UNKNOWN state fails on the
# first look, exactly like the script's pre-hotfix single-shot behavior.
# Tests that exercise real polling override these locally and restore them
# afterward.
export CONCERTINO_CI_WAIT_TIMEOUT_SEC=0
export CONCERTINO_CI_POLL_INTERVAL_SEC=1
export CONCERTINO_MERGE_RECHECK_TIMEOUT_SEC=0
export CONCERTINO_MERGE_RECHECK_INTERVAL_SEC=1

# CON-166 (design.md Decision 3a): condition 3's SHA-drift check fetches
# `origin/<base>` unconditionally and computes merge-bases against it, so
# every fixture now needs a REAL, fetchable origin remote with the base
# branch present — not just a lone commit with no remote at all. The bare
# origin lives INSIDE the work tree (at .origin-bare) purely so a single
# `rm -rf "$REPO"` still cleans up both.
new_repo() {
  local d o
  d="$(mktemp -d)"
  o="$d/.origin-bare"
  git init -q --bare -b main "$o"
  git init -q -b main "$d"
  git -C "$d" -c user.email=t@t.test -c user.name=t commit -q --allow-empty -m init
  git -C "$d" remote add origin "$o"
  git -C "$d" push -q origin main
  printf '%s' "$d"
}

# The commit every simple fixture's evaluator/skeptic verdict reviews AND the
# branch head being merged, unless a test deliberately diverges them. Since
# origin/main == this same commit (just pushed above), both merge-bases in
# condition 3's comparison resolve to this commit itself, PATHS comes back
# empty, and the leg passes via Decision 1c without ever needing a real diff
# — exactly the "nothing to review" case most of these fixtures are about.
head_sha_of() { git -C "$1" rev-parse HEAD; }

eval_pass()       { printf '{"t":1,"kind":"verdict","role":"evaluator","verdict":"PASS","head_sha":"%s"}' "$1"; }
skeptic_confirm() { printf '{"t":2,"kind":"verdict","role":"skeptic","verdict":"CONFIRM","head_sha":"%s"}' "$1"; }

# $1=mergeable $2=mergeStateStatus $3=reviewDecision("null" or a string)
# $4=headRefOid $5=baseRefName
merge_json() {
  local rd="$3"
  if [ "$rd" != "null" ]; then rd="\"$rd\""; fi
  printf '{"mergeable":"%s","mergeStateStatus":"%s","reviewDecision":%s,"headRefOid":"%s","baseRefName":"%s"}' \
    "$1" "$2" "$rd" "$4" "$5"
}

# A `gh pr view` stub. Serves $GH_MOCK_DIR/rollup.json for the
# statusCheckRollup call, $GH_MOCK_DIR/merge.json for any call requesting
# mergeStateStatus/headRefOid/baseRefName (condition 0's pre-reconcile query,
# condition 2's mergeability+headRefOid query, condition 2b's headRefOid
# re-query, and condition 3's baseRefName-only query all share this one
# fixture file — the script only ever reads the subset of fields it asked
# for), or fails outright when $GH_MOCK_FAIL is set, to simulate an
# unauthenticated/unreachable `gh`. Each call is counted per field-set
# ($GH_MOCK_DIR/rollupcalls, .../mergecalls); if a numbered override file
# (rollup-<n>.json / merge-<n>.json) exists for that call's ordinal, it is
# served instead of the static default — this is how tests simulate state
# changing across the script's own poll/re-query loops without touching the
# network.
MOCKBIN="$(mktemp -d)"
cat > "$MOCKBIN/gh" <<'EOF'
#!/usr/bin/env bash
if [ -n "${GH_MOCK_FAIL:-}" ]; then
  echo "gh: mock failure: $GH_MOCK_FAIL" >&2
  exit 1
fi
for a in "$@"; do
  case "$a" in
    *statusCheckRollup*)
      n=0; [ -f "$GH_MOCK_DIR/rollupcalls" ] && n="$(cat "$GH_MOCK_DIR/rollupcalls")"
      n=$((n+1)); echo "$n" > "$GH_MOCK_DIR/rollupcalls"
      if [ -f "$GH_MOCK_DIR/rollup-$n.json" ]; then cat "$GH_MOCK_DIR/rollup-$n.json"; else cat "$GH_MOCK_DIR/rollup.json"; fi
      exit 0
      ;;
    *mergeStateStatus*|*headRefOid*|*baseRefName*)
      n=0; [ -f "$GH_MOCK_DIR/mergecalls" ] && n="$(cat "$GH_MOCK_DIR/mergecalls")"
      n=$((n+1)); echo "$n" > "$GH_MOCK_DIR/mergecalls"
      if [ -f "$GH_MOCK_DIR/merge-$n.json" ]; then cat "$GH_MOCK_DIR/merge-$n.json"; else cat "$GH_MOCK_DIR/merge.json"; fi
      exit 0
      ;;
  esac
done
echo '{}'
EOF
chmod +x "$MOCKBIN/gh"
export PATH="$MOCKBIN:$PATH"

write_events() {
  # $1 = repo, $2 = ticket, $3.. = lines to write verbatim
  local repo="$1" ticket="$2"; shift 2
  local dir="$repo/.concertino/runs/$ticket"
  mkdir -p "$dir"
  printf '%s\n' "$@" > "$dir/events.jsonl"
}

ALL_PASS_ROLLUP='{"statusCheckRollup":[{"name":"build","conclusion":"SUCCESS"},{"name":"lint","conclusion":"SUCCESS"}]}'

# CON-166 (evaluation-1.md CR 1): the value the auditor role ACTUALLY passes
# as ARCHIVE_PREFIX, derived by rendering the real `core/roles/auditor.md`
# through the real render pipeline against a real example config — never a
# value this test hardcodes on its own, so the test and the caller cannot
# drift apart again the way they did when 166.3 hardcoded "openspec" and
# missed that the auditor was actually passing the change DIRECTORY
# (`openspec/changes/<name>`), not the root.
AUDITOR_ARCHIVE_PREFIX="$(node "$ROOT/test/scripts/derive-auditor-archive-prefix.js")" || {
  echo "FATAL: could not derive the auditor's real ARCHIVE_PREFIX — aborting suite" >&2
  exit 1
}

# Direct regression guard on the derived value itself (evaluation-1.md CR 1):
# the auditor must render the change-dir ROOT, never the per-change
# directory. A future drift back to `<change-dir>` (or any config whose
# changeDir is `<root>/changes/<CHANGE_NAME>`) would make this contain
# `/changes/`, which is exactly the shape that made every archive-shaped
# fixture refuse.
case "$AUDITOR_ARCHIVE_PREFIX" in
  */changes/*|*"<CHANGE_NAME>"*)
    bad "0.1 auditor renders the change-dir ROOT, not the per-change directory" "got [$AUDITOR_ARCHIVE_PREFIX]"
    ;;
  *)
    ok "0.1 auditor renders the change-dir ROOT, not the per-change directory"
    ;;
esac

run_check() {
  # $1 = repo, $2 = branch, $3 = ticket, $4 = archive prefix (defaults to
  # the auditor's real rendered value when omitted) ; result on stdout,
  # stderr captured to $ERR
  local repo="$1" branch="$2" ticket="$3" prefix="${4:-$AUDITOR_ARCHIVE_PREFIX}"
  ERR="$(mktemp)"
  OUT="$("$SCRIPT" "$repo" "$branch" "$ticket" "$prefix" 2>"$ERR")"
  RC=$?
}

# --- all three conditions pass ----------------------------------------------
REPO="$(new_repo)"
HS="$(head_sha_of "$REPO")"
write_events "$REPO" TEST-1 "$(eval_pass "$HS")" "$(skeptic_confirm "$HS")"
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
merge_json MERGEABLE CLEAN null "$HS" main > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$REPO" branch-1 TEST-1
check "1.1 all-pass exits zero" "$RC" "0"
check "1.2 all-pass prints PASS" "$OUT" "PASS"
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"

# --- a pending CI check is distinct from a failed one, and times out named -
REPO="$(new_repo)"
HS="$(head_sha_of "$REPO")"
write_events "$REPO" TEST-2 "$(eval_pass "$HS")" "$(skeptic_confirm "$HS")"
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' '{"statusCheckRollup":[{"name":"build","state":"PENDING"},{"name":"lint","conclusion":"SUCCESS"}]}' > "$GH_MOCK_DIR/rollup.json"
merge_json MERGEABLE CLEAN null "$HS" main > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$REPO" branch-2 TEST-2
# CON-159: pending is a resumable "not yet" (exit 3), NOT a failure (exit 1).
check "2.1 pending CI exits 3, not 0 and not a FAIL's 1" "$RC" "3"
has "2.2 pending CI names the check as pending, not failed" "PENDING build" "$ERR"
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"

# --- a failed CI check is reported distinctly from pending ------------------
REPO="$(new_repo)"
HS="$(head_sha_of "$REPO")"
write_events "$REPO" TEST-3 "$(eval_pass "$HS")" "$(skeptic_confirm "$HS")"
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' '{"statusCheckRollup":[{"name":"build","conclusion":"FAILURE"}]}' > "$GH_MOCK_DIR/rollup.json"
merge_json MERGEABLE CLEAN null "$HS" main > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$REPO" branch-3 TEST-3
has "3.1 failed CI names the check as failed, not pending" "CI failed: build" "$ERR"
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"

# --- SKIPPED/NEUTRAL are terminal non-failures, not failed checks -----------
# Regression guard: a workflow that deliberately no-ops on PRs it does not
# apply to (e.g. a Dependabot-metadata job gated on the PR author) reports
# SKIPPED on every other PR. Treating that as a failed check fails closed on
# every such PR forever -- observed in the wild on helio, where it blocked
# agent-merge on 100% of non-Dependabot PRs.
REPO="$(new_repo)"
HS="$(head_sha_of "$REPO")"
write_events "$REPO" TEST-32 "$(eval_pass "$HS")" "$(skeptic_confirm "$HS")"
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' '{"statusCheckRollup":[{"name":"build","conclusion":"SUCCESS"},{"name":"label-update-type","conclusion":"SKIPPED"},{"name":"advisory","conclusion":"NEUTRAL"}]}' > "$GH_MOCK_DIR/rollup.json"
merge_json MERGEABLE CLEAN null "$HS" main > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$REPO" branch-32 TEST-32
check "3.2 SKIPPED/NEUTRAL alongside SUCCESS exits zero" "$RC" "0"
check "3.3 SKIPPED/NEUTRAL alongside SUCCESS prints PASS" "$OUT" "PASS"
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"

# --- ...but a real failure alongside SKIPPED is still caught ----------------
# Guards the guard: 3.2/3.3 would also pass if the whitelist were widened to
# accept everything, so prove the discrimination survives.
REPO="$(new_repo)"
HS="$(head_sha_of "$REPO")"
write_events "$REPO" TEST-33 "$(eval_pass "$HS")" "$(skeptic_confirm "$HS")"
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' '{"statusCheckRollup":[{"name":"label-update-type","conclusion":"SKIPPED"},{"name":"build","conclusion":"FAILURE"}]}' > "$GH_MOCK_DIR/rollup.json"
merge_json MERGEABLE CLEAN null "$HS" main > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$REPO" branch-33 TEST-33
has "3.4 a real FAILURE beside a SKIPPED is still named as failed" "CI failed: build" "$ERR"
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"

# --- an empty rollup passes the CI check ------------------------------------
REPO="$(new_repo)"
HS="$(head_sha_of "$REPO")"
write_events "$REPO" TEST-4 "$(eval_pass "$HS")" "$(skeptic_confirm "$HS")"
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' '{"statusCheckRollup":[]}' > "$GH_MOCK_DIR/rollup.json"
merge_json MERGEABLE CLEAN null "$HS" main > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$REPO" branch-4 TEST-4
check "4.1 empty rollup passes overall" "$RC" "0"
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"

# --- DIRTY/UNSTABLE fail naming the status (BEHIND now auto-reconciles —
# covered separately below, since it now has real git-mutating side effects
# rather than a simple named failure) --------------------------------------
for status in DIRTY UNSTABLE; do
  REPO="$(new_repo)"
  HS="$(head_sha_of "$REPO")"
  case "$status" in DIRTY) TICKET=TEST-52;; UNSTABLE) TICKET=TEST-53;; esac
  write_events "$REPO" "$TICKET" "$(eval_pass "$HS")" "$(skeptic_confirm "$HS")"
  GH_MOCK_DIR="$(mktemp -d)"
  printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
  merge_json CONFLICTING "$status" null "$HS" main > "$GH_MOCK_DIR/merge.json"
  export GH_MOCK_DIR
  run_check "$REPO" branch-5 "$TICKET"
  has "5.$status not mergeable names the status" "not mergeable: $status" "$ERR"
  rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"
done

# --- BLOCKED + REVIEW_REQUIRED names branch protection specifically ---------
REPO="$(new_repo)"
HS="$(head_sha_of "$REPO")"
write_events "$REPO" TEST-6 "$(eval_pass "$HS")" "$(skeptic_confirm "$HS")"
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
merge_json MERGEABLE BLOCKED REVIEW_REQUIRED "$HS" main > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$REPO" branch-6 TEST-6
has "6.1 BLOCKED+REVIEW_REQUIRED names branch protection specifically" "branch protection requires human review" "$ERR"
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"

# --- BLOCKED without REVIEW_REQUIRED falls back to a generic reason ---------
REPO="$(new_repo)"
HS="$(head_sha_of "$REPO")"
write_events "$REPO" TEST-7 "$(eval_pass "$HS")" "$(skeptic_confirm "$HS")"
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
merge_json MERGEABLE BLOCKED APPROVED "$HS" main > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$REPO" branch-7 TEST-7
has "7.1 BLOCKED without REVIEW_REQUIRED names BLOCKED generically" "not mergeable: BLOCKED" "$ERR"
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"

# --- DRAFT / unenumerated fail CLOSED immediately, never pass silently -----
# (UNKNOWN is now polled as a transient state — covered separately below.)
for status in DRAFT SOMETHING_NEW; do
  REPO="$(new_repo)"
  HS="$(head_sha_of "$REPO")"
  case "$status" in DRAFT) TICKET=TEST-82;; SOMETHING_NEW) TICKET=TEST-83;; esac
  write_events "$REPO" "$TICKET" "$(eval_pass "$HS")" "$(skeptic_confirm "$HS")"
  GH_MOCK_DIR="$(mktemp -d)"
  printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
  merge_json UNKNOWN "$status" null "$HS" main > "$GH_MOCK_DIR/merge.json"
  export GH_MOCK_DIR
  run_check "$REPO" branch-8 "$TICKET"
  check "8.$status fails closed (non-zero exit)" "$([ "$RC" -ne 0 ] && echo nonzero || echo zero)" "nonzero"
  has "8.$status names mergeability as not yet determined" "mergeability not yet determined: $status" "$ERR"
  rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"
done

# --- UNKNOWN mergeability times out named, when it never resolves ----------
REPO="$(new_repo)"
HS="$(head_sha_of "$REPO")"
write_events "$REPO" TEST-84 "$(eval_pass "$HS")" "$(skeptic_confirm "$HS")"
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
merge_json UNKNOWN UNKNOWN null "$HS" main > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$REPO" branch-8 TEST-84
has "8.4 UNKNOWN mergeability names the timeout" "mergeability not yet determined: UNKNOWN (timed out after 0s)" "$ERR"
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"

# --- missing evaluator PASS / skeptic CONFIRM fail the gates check ----------
REPO="$(new_repo)"
HS="$(head_sha_of "$REPO")"
write_events "$REPO" TEST-9 '{"t":1,"kind":"verdict","role":"evaluator","verdict":"FAIL"}' "$(skeptic_confirm "$HS")"
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
merge_json MERGEABLE CLEAN null "$HS" main > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$REPO" branch-9 TEST-9
has "9.1 non-PASS evaluator verdict fails, naming the gate" "evaluator gate not passed" "$ERR"
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"

REPO="$(new_repo)"
HS="$(head_sha_of "$REPO")"
write_events "$REPO" TEST-10 "$(eval_pass "$HS")" '{"t":2,"kind":"verdict","role":"skeptic","verdict":"REFUTE"}'
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
merge_json MERGEABLE CLEAN null "$HS" main > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$REPO" branch-10 TEST-10
has "10.1 non-CONFIRM skeptic verdict fails, naming the gate" "skeptic gate not confirmed" "$ERR"
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"

# --- CON-152: owner override of a budget-exhausted final gate --------------
# HEL-971. A REFUTE resolved by the human answering `proceed-to-delivery` is a
# legitimate resolution the gate had no representation for, so such a run was
# permanently unmergeable by agent-merge.
REPO="$(new_repo)"
HS="$(head_sha_of "$REPO")"
write_events "$REPO" TEST-20 "$(eval_pass "$HS")" \
  '{"t":2,"kind":"verdict","role":"skeptic","verdict":"REFUTE"}' \
  '{"t":3,"kind":"escalation.answered","answer":"proceed-to-delivery"}'
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
merge_json MERGEABLE CLEAN null "$HS" main > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$REPO" branch-20 TEST-20
check "20.1 an override after a REFUTE exits zero" "$RC" "0"
check "20.2 an override after a REFUTE prints PASS" "$OUT" "PASS"
has "20.3 the override is reported as an override, not as a CONFIRM" "cleared by owner override" "$ERR"
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"

# Guards the guard, part 1: a STALE override must not clear a LATER refute.
# Without the index comparison this passes and the gate becomes forgeable by
# replaying an old escalation.
REPO="$(new_repo)"
HS="$(head_sha_of "$REPO")"
write_events "$REPO" TEST-21 "$(eval_pass "$HS")" \
  '{"t":2,"kind":"escalation.answered","answer":"proceed-to-delivery"}' \
  '{"t":3,"kind":"verdict","role":"skeptic","verdict":"REFUTE"}'
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
merge_json MERGEABLE CLEAN null "$HS" main > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$REPO" branch-21 TEST-21
has "21.1 an override PRECEDING the latest REFUTE does not clear the gate" "skeptic gate not confirmed" "$ERR"
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"

# Guards the guard, part 2: a different escalation answer must not clear it.
REPO="$(new_repo)"
HS="$(head_sha_of "$REPO")"
write_events "$REPO" TEST-22 "$(eval_pass "$HS")" \
  '{"t":2,"kind":"verdict","role":"skeptic","verdict":"REFUTE"}' \
  '{"t":3,"kind":"escalation.answered","answer":"extend-final-gate"}'
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
merge_json MERGEABLE CLEAN null "$HS" main > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$REPO" branch-22 TEST-22
has "22.1 a non-proceed escalation answer does not clear the gate" "skeptic gate not confirmed" "$ERR"
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"

# --- "latest" verdict wins even when an earlier one would have failed ------
REPO="$(new_repo)"
HS="$(head_sha_of "$REPO")"
write_events "$REPO" TEST-11 \
  '{"t":1,"kind":"verdict","role":"evaluator","verdict":"FAIL"}' \
  "$(eval_pass "$HS")" \
  "$(skeptic_confirm "$HS")"
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
merge_json MERGEABLE CLEAN null "$HS" main > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$REPO" branch-11 TEST-11
check "11.1 latest evaluator verdict (PASS) wins over an earlier FAIL" "$RC" "0"
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"

# --- a malformed line in the log is skipped, not fatal ----------------------
REPO="$(new_repo)"
HS="$(head_sha_of "$REPO")"
mkdir -p "$REPO/.concertino/runs/TEST-12"
printf '%s\n%s\n%s\n' "$(eval_pass "$HS")" "not valid json at all" "$(skeptic_confirm "$HS")" > "$REPO/.concertino/runs/TEST-12/events.jsonl"
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
merge_json MERGEABLE CLEAN null "$HS" main > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$REPO" branch-12 TEST-12
check "12.1 a torn line elsewhere in the log does not blind the check" "$RC" "0"
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"

# --- an environmental gh failure is worded distinctly -----------------------
REPO="$(new_repo)"
HS="$(head_sha_of "$REPO")"
write_events "$REPO" TEST-13 "$(eval_pass "$HS")" "$(skeptic_confirm "$HS")"
GH_MOCK_DIR="$(mktemp -d)"
export GH_MOCK_DIR
export GH_MOCK_FAIL="not authenticated"
run_check "$REPO" branch-13 TEST-13
has "13.1 a gh failure is worded 'could not query ... via gh'" "could not query PR status via gh" "$ERR"
unset GH_MOCK_FAIL
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"

# --- CI genuinely polls: pending on the first look, SUCCESS on a later one -
export CONCERTINO_CI_WAIT_TIMEOUT_SEC=5
export CONCERTINO_CI_POLL_INTERVAL_SEC=1
REPO="$(new_repo)"
HS="$(head_sha_of "$REPO")"
write_events "$REPO" TEST-14 "$(eval_pass "$HS")" "$(skeptic_confirm "$HS")"
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' '{"statusCheckRollup":[{"name":"build","state":"IN_PROGRESS"}]}' > "$GH_MOCK_DIR/rollup.json"
printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup-2.json"
merge_json MERGEABLE CLEAN null "$HS" main > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$REPO" branch-14 TEST-14
check "14.1 CI that flips IN_PROGRESS->SUCCESS across a poll passes" "$RC" "0"
check "14.2 CI that flips IN_PROGRESS->SUCCESS prints PASS" "$OUT" "PASS"
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"
export CONCERTINO_CI_WAIT_TIMEOUT_SEC=0
export CONCERTINO_CI_POLL_INTERVAL_SEC=1

# --- CI that never resolves genuinely times out (not just skipped) ---------
export CONCERTINO_CI_WAIT_TIMEOUT_SEC=2
export CONCERTINO_CI_POLL_INTERVAL_SEC=1
REPO="$(new_repo)"
HS="$(head_sha_of "$REPO")"
write_events "$REPO" TEST-15 "$(eval_pass "$HS")" "$(skeptic_confirm "$HS")"
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' '{"statusCheckRollup":[{"name":"build","state":"IN_PROGRESS"}]}' > "$GH_MOCK_DIR/rollup.json"
merge_json MERGEABLE CLEAN null "$HS" main > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$REPO" branch-15 TEST-15
# CON-159: a check that is still RUNNING is a resumable "not yet", not a
# failure. Distinct wording, distinct exit code, and conditions 2-3 skipped.
has "15.1 CI still running past the window reports PENDING, after really waiting" "PENDING build" "$ERR"
has "15.2 the PENDING line says it is not a failure and is re-invokable" "not a failure; re-invoke" "$ERR"
check "15.3 PENDING exits 3, distinguishable from a FAIL's 1" "$RC" "3"
if grep -q "^FAIL" "$ERR"; then
  bad "15.4 PENDING must not also emit a FAIL line" "found a FAIL line in $ERR"
else
  ok "15.4 PENDING must not also emit a FAIL line"
fi
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"

# --- CON-159: a genuinely FAILED check is still a FAIL, not PENDING --------
# The guard that keeps 15.x from swallowing real failures: same stuck-window
# setup, but the check reports FAILURE rather than IN_PROGRESS.
export CONCERTINO_CI_WAIT_TIMEOUT_SEC=2
export CONCERTINO_CI_POLL_INTERVAL_SEC=1
REPO="$(new_repo)"
HS="$(head_sha_of "$REPO")"
write_events "$REPO" TEST-152 "$(eval_pass "$HS")" "$(skeptic_confirm "$HS")"
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' '{"statusCheckRollup":[{"name":"build","conclusion":"FAILURE"}]}' > "$GH_MOCK_DIR/rollup.json"
merge_json MERGEABLE CLEAN null "$HS" main > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$REPO" branch-152 TEST-152
has "15.5 a failed check still FAILs rather than reporting PENDING" "CI failed: build" "$ERR"
check "15.6 a failed check exits 1, not 3" "$RC" "1"
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"
export CONCERTINO_CI_WAIT_TIMEOUT_SEC=0
export CONCERTINO_CI_POLL_INTERVAL_SEC=1

# --- mergeability genuinely polls: UNKNOWN then CLEAN across a poll --------
export CONCERTINO_MERGE_RECHECK_TIMEOUT_SEC=5
export CONCERTINO_MERGE_RECHECK_INTERVAL_SEC=1
REPO="$(new_repo)"
HS="$(head_sha_of "$REPO")"
write_events "$REPO" TEST-16 "$(eval_pass "$HS")" "$(skeptic_confirm "$HS")"
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
merge_json UNKNOWN UNKNOWN null "$HS" main > "$GH_MOCK_DIR/merge.json"
merge_json MERGEABLE CLEAN null "$HS" main > "$GH_MOCK_DIR/merge-2.json"
export GH_MOCK_DIR
run_check "$REPO" branch-16 TEST-16
check "16.1 mergeability that flips UNKNOWN->CLEAN across a poll passes" "$RC" "0"
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"
export CONCERTINO_MERGE_RECHECK_TIMEOUT_SEC=0
export CONCERTINO_MERGE_RECHECK_INTERVAL_SEC=1

# --- BEHIND auto-reconcile: real fetch+merge+push, current work preserved,
# new remote changes land, mergeability re-verified CLEAN on the new HEAD --
ORIGIN="$(mktemp -d)"
git init -q --bare -b main "$ORIGIN"

SEED="$(mktemp -d)"
git init -q -b main "$SEED"
git -C "$SEED" config user.email t@t.test; git -C "$SEED" config user.name t
echo "line1" > "$SEED/shared.txt"
git -C "$SEED" add shared.txt
git -C "$SEED" commit -q -m "main: init"
git -C "$SEED" remote add origin "$ORIGIN"
git -C "$SEED" push -q origin main

WORK="$(mktemp -d)"
git clone -q "$ORIGIN" "$WORK"
git -C "$WORK" config user.email t@t.test; git -C "$WORK" config user.name t
git -C "$WORK" checkout -q -b feature-behind
echo "feature work" > "$WORK/feature.txt"
git -C "$WORK" add feature.txt
git -C "$WORK" commit -q -m "feature: current work"
git -C "$WORK" push -q origin feature-behind
FEATURE_TIP_BEFORE="$(git -C "$WORK" rev-parse feature-behind)"

# main advances upstream (a different PR merged) while feature-behind was in flight
echo "line2" >> "$SEED/other.txt"
git -C "$SEED" add other.txt
git -C "$SEED" commit -q -m "main: advanced"
git -C "$SEED" push -q origin main

write_events "$WORK" TEST-17 "$(eval_pass "$FEATURE_TIP_BEFORE")" "$(skeptic_confirm "$FEATURE_TIP_BEFORE")"
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
printf '{"mergeStateStatus":"BEHIND","baseRefName":"main"}' > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
# The script itself performs the reconcile commit mid-run, so the new tip is
# not knowable when this static fixture is written — the condition-2/2b
# headRefOid served below deliberately will NOT match the post-reconcile
# local HEAD, so this run is expected to end in the CON-166 Decision-5
# divergence FAIL (exit 1) rather than PASS. That is fine: this fixture's
# job is to prove the git-level reconciliation side effects (17.3-17.5),
# which happen unconditionally in condition 0, before any of condition
# 2/2b/3 runs. PR-headRefOid equality on a non-reconciling head is proven
# directly in the CON-166 section below.
merge_json MERGEABLE CLEAN null "0000000000000000000000000000000000000000" main > "$GH_MOCK_DIR/merge-2.json"
run_check "$WORK" feature-behind TEST-17
FEATURE_LOG="$(git -C "$WORK" log feature-behind --oneline)"
has "17.3 current work commit still present after reconcile" "feature: current work" <(printf '%s\n' "$FEATURE_LOG")
has "17.4 remote's new commit landed after reconcile" "main: advanced" <(printf '%s\n' "$FEATURE_LOG")
ORIGIN_LOG="$(git --git-dir="$ORIGIN" log feature-behind --oneline)"
has "17.5 reconciled branch was pushed back to origin" "main: advanced" <(printf '%s\n' "$ORIGIN_LOG")
rm -rf "$ORIGIN" "$SEED" "$WORK" "$GH_MOCK_DIR" "$ERR"

# --- BEHIND auto-reconcile: a genuine conflict aborts cleanly, current work
# and origin both left exactly as they were, ESCALATE reason names it ------
ORIGIN="$(mktemp -d)"
git init -q --bare -b main "$ORIGIN"

SEED="$(mktemp -d)"
git init -q -b main "$SEED"
git -C "$SEED" config user.email t@t.test; git -C "$SEED" config user.name t
echo "line1" > "$SEED/shared.txt"
git -C "$SEED" add shared.txt
git -C "$SEED" commit -q -m "main: init"
git -C "$SEED" remote add origin "$ORIGIN"
git -C "$SEED" push -q origin main

WORK="$(mktemp -d)"
git clone -q "$ORIGIN" "$WORK"
git -C "$WORK" config user.email t@t.test; git -C "$WORK" config user.name t
git -C "$WORK" checkout -q -b feature-conflict
echo "feature version" > "$WORK/shared.txt"
git -C "$WORK" add shared.txt
git -C "$WORK" commit -q -m "feature: current work"
git -C "$WORK" push -q origin feature-conflict
FEATURE_TIP_BEFORE="$(git -C "$WORK" rev-parse feature-conflict)"
ORIGIN_TIP_BEFORE="$(git --git-dir="$ORIGIN" rev-parse feature-conflict)"

# main advances the SAME line — a real, unresolvable-without-a-human conflict
echo "main version" > "$SEED/shared.txt"
git -C "$SEED" add shared.txt
git -C "$SEED" commit -q -m "main: advanced, conflicting"
git -C "$SEED" push -q origin main

write_events "$WORK" TEST-18 "$(eval_pass "$FEATURE_TIP_BEFORE")" "$(skeptic_confirm "$FEATURE_TIP_BEFORE")"
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
printf '{"mergeStateStatus":"BEHIND","baseRefName":"main"}' > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$WORK" feature-conflict TEST-18
check "18.1 BEHIND with a real conflict fails (non-zero exit)" "$([ "$RC" -ne 0 ] && echo nonzero || echo zero)" "nonzero"
has "18.2 conflict names BEHIND and the need for human resolution" "not mergeable: BEHIND (auto-reconcile with origin/main hit conflicts" "$ERR"
FEATURE_TIP_AFTER="$(git -C "$WORK" rev-parse feature-conflict)"
check "18.3 current work's branch tip is untouched after an aborted reconcile" "$FEATURE_TIP_AFTER" "$FEATURE_TIP_BEFORE"
check "18.4 the aborted merge leaves no in-progress merge state" "$([ -f "$WORK/.git/MERGE_HEAD" ] && echo present || echo absent)" "absent"
ORIGIN_TIP_AFTER="$(git --git-dir="$ORIGIN" rev-parse feature-conflict)"
check "18.5 origin's branch ref is untouched (no partial push)" "$ORIGIN_TIP_AFTER" "$ORIGIN_TIP_BEFORE"
rm -rf "$ORIGIN" "$SEED" "$WORK" "$GH_MOCK_DIR" "$ERR"

# ============================================================================
# CON-166: verdict-SHA binding (design.md; see tasks.md section 4)
# ============================================================================

# --- 166.1: a source commit landing after review is refused (exit 4) -------
# The headline mutation case: verdicts reviewed commit A; a further source
# commit B lands; the check must refuse with the exact STALE line, exit 4.
REPO="$(new_repo)"
A_SHA="$(head_sha_of "$REPO")"
echo "late fix" > "$REPO/late.txt"
git -C "$REPO" -c user.email=t@t.test -c user.name=t add late.txt
git -C "$REPO" -c user.email=t@t.test -c user.name=t commit -q -m "late fix after review"
B_SHA="$(head_sha_of "$REPO")"
write_events "$REPO" TEST-166-1 "$(eval_pass "$A_SHA")" "$(skeptic_confirm "$A_SHA")"
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
merge_json MERGEABLE CLEAN null "$B_SHA" main > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$REPO" branch-166-1 TEST-166-1
check "166.1.1 a source commit after review exits 4" "$RC" "4"
has "166.1.2 exact STALE line for evaluator" "STALE evaluator reviewed=${A_SHA} head=${B_SHA} changed=late.txt" "$ERR"
has "166.1.3 exact STALE line for skeptic" "STALE skeptic reviewed=${A_SHA} head=${B_SHA} changed=late.txt" "$ERR"
if grep -q "^FAIL" "$ERR"; then
  bad "166.1.4 STALE must not also emit a FAIL line" "found a FAIL line in $ERR"
else
  ok "166.1.4 STALE must not also emit a FAIL line"
fi
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"

# --- 166.2: a fresh verdict at the new head clears the refusal -------------
REPO="$(new_repo)"
A_SHA="$(head_sha_of "$REPO")"
echo "late fix" > "$REPO/late.txt"
git -C "$REPO" -c user.email=t@t.test -c user.name=t add late.txt
git -C "$REPO" -c user.email=t@t.test -c user.name=t commit -q -m "late fix after review"
B_SHA="$(head_sha_of "$REPO")"
write_events "$REPO" TEST-166-2 "$(eval_pass "$B_SHA")" "$(skeptic_confirm "$B_SHA")"
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
merge_json MERGEABLE CLEAN null "$B_SHA" main > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$REPO" branch-166-2 TEST-166-2
check "166.2.1 re-review at the new head clears the refusal (exits zero)" "$RC" "0"
check "166.2.2 re-review at the new head prints PASS" "$OUT" "PASS"
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"

# --- 166.3: the healthy squash-shaped case — head moved, only the archive
# prefix differs — MUST PASS (mutation target: drop the single-sited
# ':(exclude)<prefix>/*' term from step 3 and this goes red) -----------------
#
# skeptic-final-1.md: the archive path here MUST NOT be built from
# $AUDITOR_ARCHIVE_PREFIX — a fixture whose archive path and whose exclusion
# both derive from the SAME variable is green for every value that variable
# takes, including a wrong one (proven: mutation G, reverting auditor.md's
# <change-dir-root> back to <change-dir>, left this fixture green with only
# test 0.1 catching it). This path is therefore a LITERAL, realistic archive
# location — matching what config/examples/helio.json's `openspec` kind
# actually archives to (`<root>/changes/archive/<slug>/...`) — independent
# of the derived value. $AUDITOR_ARCHIVE_PREFIX is still passed explicitly
# as the 4th argument, so this fixture also catches a shapely-but-WRONG
# derived value (e.g. `changeRoot` regressing to `spec` for an openspec
# project): a wrong prefix would either fail to exclude this real
# `openspec/...` path (false refusal) or exclude the wrong tree entirely.
REPO="$(new_repo)"
A_SHA="$(head_sha_of "$REPO")"
mkdir -p "$REPO/openspec/changes/archive/2026-01-01-demo"
echo "archived plan" > "$REPO/openspec/changes/archive/2026-01-01-demo/proposal.md"
git -C "$REPO" -c user.email=t@t.test -c user.name=t add openspec
git -C "$REPO" -c user.email=t@t.test -c user.name=t commit -q -m "archive"
B_SHA="$(head_sha_of "$REPO")"
write_events "$REPO" TEST-166-3 "$(eval_pass "$A_SHA")" "$(skeptic_confirm "$A_SHA")"
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
merge_json MERGEABLE CLEAN null "$B_SHA" main > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$REPO" branch-166-3 TEST-166-3 "$AUDITOR_ARCHIVE_PREFIX"
check "166.3.1 squash-shaped archive-only diff passes (exit 0)" "$RC" "0"
check "166.3.2 squash-shaped archive-only diff prints PASS" "$OUT" "PASS"
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"

# --- 166.4: the reviewed SHA is unresolvable -> refuse ----------------------
REPO="$(new_repo)"
HS="$(head_sha_of "$REPO")"
write_events "$REPO" TEST-166-4 "$(eval_pass deadbeefdeadbeefdeadbeefdeadbeefdeadbeef)" "$(skeptic_confirm "$HS")"
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
merge_json MERGEABLE CLEAN null "$HS" main > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$REPO" branch-166-4 TEST-166-4
check "166.4.1 unresolvable reviewed SHA refuses (exit 4)" "$RC" "4"
has "166.4.2 unresolvable SHA is named" "STALE evaluator reviewed SHA is unresolvable: deadbeefdeadbeefdeadbeefdeadbeefdeadbeef" "$ERR"
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"

# --- 166.5: absent head_sha on the verdict -> refuse ------------------------
REPO="$(new_repo)"
HS="$(head_sha_of "$REPO")"
write_events "$REPO" TEST-166-5 '{"t":1,"kind":"verdict","role":"evaluator","verdict":"PASS"}' "$(skeptic_confirm "$HS")"
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
merge_json MERGEABLE CLEAN null "$HS" main > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$REPO" branch-166-5 TEST-166-5
check "166.5.1 an absent head_sha refuses (exit 4)" "$RC" "4"
has "166.5.2 absent head_sha names the unbound verdict" "STALE evaluator verdict has no recorded head_sha" "$ERR"
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"

# --- 166.6: local HEAD diverged from the PR's headRefOid -> EXIT 1, not 4 ---
REPO="$(new_repo)"
HS="$(head_sha_of "$REPO")"
write_events "$REPO" TEST-166-6 "$(eval_pass "$HS")" "$(skeptic_confirm "$HS")"
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
merge_json MERGEABLE CLEAN null "0000000000000000000000000000000000000000" main > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$REPO" branch-166-6 TEST-166-6
check "166.6.1 local HEAD != PR headRefOid exits 1, not the exit-4 STALE outcome" "$RC" "1"
has "166.6.2 names the divergence" "does not match the pull request's head" "$ERR"
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"

# --- 166.7: a CON-152 owner override waives the skeptic content leg only,
# never the evaluator leg (design.md Decision 6) ---------------------------
REPO="$(new_repo)"
A_SHA="$(head_sha_of "$REPO")"
echo "late fix" > "$REPO/late.txt"
git -C "$REPO" -c user.email=t@t.test -c user.name=t add late.txt
git -C "$REPO" -c user.email=t@t.test -c user.name=t commit -q -m "late fix after review"
B_SHA="$(head_sha_of "$REPO")"
write_events "$REPO" TEST-166-7 "$(eval_pass "$A_SHA")" \
  '{"t":2,"kind":"verdict","role":"skeptic","verdict":"REFUTE"}' \
  '{"t":3,"kind":"escalation.answered","answer":"proceed-to-delivery"}'
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
merge_json MERGEABLE CLEAN null "$B_SHA" main > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$REPO" branch-166-7 TEST-166-7
check "166.7.1 override run still refuses on the evaluator content leg (exit 4)" "$RC" "4"
has "166.7.2 evaluator STALE line still fires" "STALE evaluator reviewed=${A_SHA} head=${B_SHA} changed=late.txt" "$ERR"
has "166.7.3 skeptic content check reported as not performed" "skeptic content check not performed" "$ERR"
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"

# --- 166.8: base-derived paths the branch never touched must PASS; a base
# change to a branch-touched path must refuse (design.md Decision 1, scope) -
ORIGIN="$(mktemp -d)"
git init -q --bare -b main "$ORIGIN"
SEED="$(mktemp -d)"
git init -q -b main "$SEED"
git -C "$SEED" config user.email t@t.test; git -C "$SEED" config user.name t
echo base > "$SEED/base.txt"
git -C "$SEED" add base.txt
git -C "$SEED" commit -q -m "base: init"
git -C "$SEED" remote add origin "$ORIGIN"
git -C "$SEED" push -q origin main

WORK="$(mktemp -d)"
git clone -q "$ORIGIN" "$WORK"
git -C "$WORK" config user.email t@t.test; git -C "$WORK" config user.name t
git -C "$WORK" checkout -q -b feature-166-8
echo "feature" > "$WORK/feature.txt"
git -C "$WORK" add feature.txt
git -C "$WORK" commit -q -m "feature: touches feature.txt only"
REVIEWED_166_8="$(git -C "$WORK" rev-parse HEAD)"

# base advances, touching a path the branch never touched
echo "base v2" >> "$SEED/base.txt"
git -C "$SEED" add base.txt
git -C "$SEED" commit -q -m "base: advanced, untouched-by-branch path"
git -C "$SEED" push -q origin main
git -C "$WORK" fetch -q origin main
git -C "$WORK" merge -q --no-edit origin/main
HEAD_166_8="$(git -C "$WORK" rev-parse HEAD)"

write_events "$WORK" TEST-166-8 "$(eval_pass "$REVIEWED_166_8")" "$(skeptic_confirm "$REVIEWED_166_8")"
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
merge_json MERGEABLE CLEAN null "$HEAD_166_8" main > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$WORK" feature-166-8 TEST-166-8
check "166.8.1 a base merge touching only untouched paths passes" "$RC" "0"
check "166.8.2 a base merge touching only untouched paths prints PASS" "$OUT" "PASS"
rm -rf "$ORIGIN" "$SEED" "$WORK" "$GH_MOCK_DIR" "$ERR"

# Same shape, but the base change lands on a path the branch ALSO touched —
# an unreviewed interaction, must refuse (mutation target: drop the PATHS
# restriction to the union of branch-touched paths and this goes red, since
# it would then also refuse the 166.8 untouched-path case above).
ORIGIN="$(mktemp -d)"
git init -q --bare -b main "$ORIGIN"
SEED="$(mktemp -d)"
git init -q -b main "$SEED"
git -C "$SEED" config user.email t@t.test; git -C "$SEED" config user.name t
printf 'line-a\nline-b\nline-c\n' > "$SEED/shared.txt"
git -C "$SEED" add shared.txt
git -C "$SEED" commit -q -m "base: init"
git -C "$SEED" remote add origin "$ORIGIN"
git -C "$SEED" push -q origin main

WORK="$(mktemp -d)"
git clone -q "$ORIGIN" "$WORK"
git -C "$WORK" config user.email t@t.test; git -C "$WORK" config user.name t
git -C "$WORK" checkout -q -b feature-166-9
sed -i '1s/.*/line-a-FEATURE/' "$WORK/shared.txt"
git -C "$WORK" add shared.txt
git -C "$WORK" commit -q -m "feature: touches shared.txt (line 1)"
REVIEWED_166_9="$(git -C "$WORK" rev-parse HEAD)"

# Non-overlapping edit (line 3), so the merge auto-resolves without conflict
# — the interaction is unreviewed, not unresolvable.
sed -i '3s/.*/line-c-BASE/' "$SEED/shared.txt"
git -C "$SEED" add shared.txt
git -C "$SEED" commit -q -m "base: advanced, SAME path the branch touched"
git -C "$SEED" push -q origin main
git -C "$WORK" fetch -q origin main
git -C "$WORK" merge -q --no-edit origin/main
HEAD_166_9="$(git -C "$WORK" rev-parse HEAD)"

write_events "$WORK" TEST-166-9 "$(eval_pass "$REVIEWED_166_9")" "$(skeptic_confirm "$REVIEWED_166_9")"
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
merge_json MERGEABLE CLEAN null "$HEAD_166_9" main > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$WORK" feature-166-9 TEST-166-9
check "166.9.1 a base merge touching a branch-touched path refuses (exit 4)" "$RC" "4"
has "166.9.2 STALE line names shared.txt" "changed=shared.txt" "$ERR"
rm -rf "$ORIGIN" "$SEED" "$WORK" "$GH_MOCK_DIR" "$ERR"

# --- 166.10: a base the branch ALREADY MERGED, whose local origin/<base>
# tracking ref is stale, is still harmless once fetched — the exact failure
# direction design.md Decision 1b names ("the direction that actually
# bites"). Mutation target: drop step 0's unconditional `git fetch origin
# <base>`, and the stale tracking ref makes MB_H resolve to an ancestor of
# the real base tip, re-admitting the base-derived path (`base.txt`) into
# PATHS as though the branch itself had authored it — a false refusal.
#
# Construction: WORK reviews F1 (touches feature.txt only, forked off X).
# A SEPARATE clone (MERGER) later merges the base's Y advance into the
# feature branch and pushes the merge commit M. WORK then fetches ONLY the
# feature branch ref (not `main`) to pick up M as its new HEAD — so WORK's
# own `origin/main` tracking ref is left stale at X, exactly modelling an
# orchestrator worktree that never itself fetched main after cloning.
ORIGIN="$(mktemp -d)"
git init -q --bare -b main "$ORIGIN"
SEED="$(mktemp -d)"
git init -q -b main "$SEED"
git -C "$SEED" config user.email t@t.test; git -C "$SEED" config user.name t
echo "v1" > "$SEED/base.txt"
git -C "$SEED" add base.txt
git -C "$SEED" commit -q -m "base: init (X)"
git -C "$SEED" remote add origin "$ORIGIN"
git -C "$SEED" push -q origin main

WORK="$(mktemp -d)"
git clone -q "$ORIGIN" "$WORK"
git -C "$WORK" config user.email t@t.test; git -C "$WORK" config user.name t
git -C "$WORK" checkout -q -b feature-166-10
echo "feature" > "$WORK/feature.txt"
git -C "$WORK" add feature.txt
git -C "$WORK" commit -q -m "feature: touches feature.txt only (F1, reviewed)"
REVIEWED_166_10="$(git -C "$WORK" rev-parse HEAD)"
git -C "$WORK" push -q origin feature-166-10

# base advances to Y (a real, non-archive content change)
echo "v2" > "$SEED/base.txt"
git -C "$SEED" add base.txt
git -C "$SEED" commit -q -m "base: advanced (Y)"
git -C "$SEED" push -q origin main

# A separate clone merges Y into the feature branch and pushes the result —
# this is what makes WORK's own git history "already merged" this base
# advance without WORK itself ever having fetched `main`.
MERGER="$(mktemp -d)"
git clone -q "$ORIGIN" "$MERGER"
git -C "$MERGER" config user.email t@t.test; git -C "$MERGER" config user.name t
git -C "$MERGER" checkout -q feature-166-10
git -C "$MERGER" merge -q --no-edit origin/main
HEAD_166_10="$(git -C "$MERGER" rev-parse HEAD)"
git -C "$MERGER" push -q origin feature-166-10

# WORK fetches ONLY the feature branch ref — origin/main in WORK stays at X.
git -C "$WORK" fetch -q origin feature-166-10
git -C "$WORK" checkout -q -B feature-166-10 FETCH_HEAD

write_events "$WORK" TEST-166-10 "$(eval_pass "$REVIEWED_166_10")" "$(skeptic_confirm "$REVIEWED_166_10")"
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
merge_json MERGEABLE CLEAN null "$HEAD_166_10" main > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$WORK" feature-166-10 TEST-166-10
check "166.10.1 already-merged base, stale local tracking ref, still passes once fetched" "$RC" "0"
check "166.10.2 already-merged base, stale local tracking ref, prints PASS" "$OUT" "PASS"
rm -rf "$ORIGIN" "$SEED" "$WORK" "$MERGER" "$GH_MOCK_DIR" "$ERR"

# --- 166.11: an erroring git invocation in the comparison itself refuses --
# (evaluation-1.md CR 2 — task 4.4 requires this, distinctly from 166.4/166.5,
# which exercise `cat-file -e` and the absent-SHA branch, NOT a `git diff`
# that errors after both commits/merge-bases resolve successfully. Decision
# 3: an emptiness-only read of a failing `git diff` would read a broken
# invocation as "no drift", so `stale_check` checks the exit status of every
# `git diff` it runs.)
#
# Constructed by corrupting the REVIEWED commit's TREE object: the commit
# object itself stays intact (so `git cat-file -e "$reviewed^{commit}"`
# still passes, and `git merge-base` — which only walks commit objects, not
# trees — still succeeds), but any `git diff` that has to walk that tree
# to enumerate changed paths fails outright.
REPO="$(new_repo)"
echo "second commit" > "$REPO/second.txt"
git -C "$REPO" -c user.email=t@t.test -c user.name=t add second.txt
git -C "$REPO" -c user.email=t@t.test -c user.name=t commit -q -m "second commit (reviewed, then its tree is corrupted)"
A_SHA="$(head_sha_of "$REPO")"
TREE_SHA="$(git -C "$REPO" rev-parse "${A_SHA}^{tree}")"
OBJ_PATH="$REPO/.git/objects/${TREE_SHA:0:2}/${TREE_SHA:2}"
if [ ! -f "$OBJ_PATH" ]; then
  bad "166.11.0 (setup) tree object exists as a loose object before corruption" "no such file: $OBJ_PATH"
else
  ok "166.11.0 (setup) tree object exists as a loose object before corruption"
fi
rm -f "$OBJ_PATH"
# Sanity-check the corruption actually breaks a real `git diff` outside the
# script under test too — otherwise this fixture would be proving nothing.
if git -C "$REPO" diff --name-only "$A_SHA"^ "$A_SHA" >/dev/null 2>&1; then
  bad "166.11.0b (setup) corrupted tree genuinely breaks git diff" "git diff succeeded despite the corruption"
else
  ok "166.11.0b (setup) corrupted tree genuinely breaks git diff"
fi
if git -C "$REPO" cat-file -e "${A_SHA}^{commit}" 2>/dev/null; then
  ok "166.11.0c (setup) the commit object itself still resolves (cat-file -e)"
else
  bad "166.11.0c (setup) the commit object itself still resolves (cat-file -e)" "cat-file -e failed"
fi
write_events "$REPO" TEST-166-11 "$(eval_pass "$A_SHA")" "$(skeptic_confirm "$A_SHA")"
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
merge_json MERGEABLE CLEAN null "$A_SHA" main > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$REPO" branch-166-11 TEST-166-11
check "166.11.1 an erroring git diff in the comparison refuses (exit 4)" "$RC" "4"
has "166.11.2 names the failure, not a false 'no drift'" "STALE evaluator could not diff reviewed source (git error)" "$ERR"
if grep -qE '^STALE evaluator reviewed=.*changed=$' "$ERR" || grep -q 'changed=$' "$ERR"; then
  bad "166.11.3 must not misreport as an empty-changed-paths STALE" "found an empty changed= in $ERR"
else
  ok "166.11.3 must not misreport as an empty-changed-paths STALE"
fi
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"

# --- 166.12: empty PATHS passes WITHOUT invoking the diff (design.md
# Decision 1c). Mutation target: dropping this guard degenerates the
# pathspec to ":(exclude)<prefix>/*" alone — "everything except the prefix"
# — which re-admits any real content change lying outside the prefix even
# though the branch authored none of it. Constructed as a degenerate branch
# that never diverges from its base at either review time or now, so both
# merge-bases equal the compared commit itself and PATHS is empty by
# construction, while the base (and therefore the "head") still moves with a
# real, non-archive content change between review and now.
ORIGIN="$(mktemp -d)"
git init -q --bare -b main "$ORIGIN"
SEED="$(mktemp -d)"
git init -q -b main "$SEED"
git -C "$SEED" config user.email t@t.test; git -C "$SEED" config user.name t
echo "v1" > "$SEED/base.txt"
git -C "$SEED" add base.txt
git -C "$SEED" commit -q -m "base: init"
git -C "$SEED" remote add origin "$ORIGIN"
git -C "$SEED" push -q origin main
REVIEWED_166_12="$(git -C "$SEED" rev-parse HEAD)"

# The base itself advances with a real, non-archive change — no distinct
# branch commit exists at all; "head" IS the new base tip.
echo "v2" > "$SEED/base.txt"
git -C "$SEED" add base.txt
git -C "$SEED" commit -q -m "base: advanced with a real content change"
git -C "$SEED" push -q origin main
HEAD_166_12="$(git -C "$SEED" rev-parse HEAD)"

write_events "$SEED" TEST-166-12 "$(eval_pass "$REVIEWED_166_12")" "$(skeptic_confirm "$REVIEWED_166_12")"
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
merge_json MERGEABLE CLEAN null "$HEAD_166_12" main > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$SEED" branch-166-12 TEST-166-12
check "166.12.1 empty-PATHS (no branch divergence at all) passes" "$RC" "0"
check "166.12.2 empty-PATHS passes cleanly (prints PASS)" "$OUT" "PASS"
rm -rf "$ORIGIN" "$SEED" "$GH_MOCK_DIR" "$ERR"

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
