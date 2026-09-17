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

# CON-193 (tasks.md 2.5/3.3d no-op guarantee): counts `git merge-base`
# invocations made DURING the run, on top of the real `git` binary (so the
# script's own git calls still work). Condition 3's stale-check already
# calls `git merge-base` FOUR times on every healthy fixture (each role's
# leg calls it twice — once against its reviewed SHA, once against
# VERIFIED_HEAD — times two roles, evaluator/skeptic) — that is this
# counter's BASELINE, not zero. Condition 4 is a genuine no-op (task 2.5)
# only if an empty/absent protectedPaths list adds NOTHING on top of that
# baseline; if the empty-list guard around condition 4's own PP_MB
# computation is ever removed, this counter goes up
# by exactly one, which run_check_spied's caller asserts against.
REAL_GIT="$(command -v git)"
run_check_spied() {
  # Same contract as run_check, but also sets $MERGEBASE_CALLS to the
  # number of `git merge-base` invocations made by the run.
  local repo="$1" branch="$2" ticket="$3" prefix="${4:-$AUDITOR_ARCHIVE_PREFIX}"
  local spy_dir; spy_dir="$(mktemp -d)"
  cat > "$spy_dir/git" <<EOF
#!/usr/bin/env bash
# git is invoked as "git -C <dir> merge-base ..." here, so "merge-base" is
# not necessarily \$1 -- scan all args, not just the first.
for a in "\$@"; do
  if [ "\$a" = "merge-base" ]; then
    n=0
    [ -f "$spy_dir/mergebasecalls" ] && n="\$(cat "$spy_dir/mergebasecalls")"
    n=\$((n+1))
    echo "\$n" > "$spy_dir/mergebasecalls"
    break
  fi
done
exec "$REAL_GIT" "\$@"
EOF
  chmod +x "$spy_dir/git"
  ERR="$(mktemp)"
  OUT="$(PATH="$spy_dir:$PATH" "$SCRIPT" "$repo" "$branch" "$ticket" "$prefix" 2>"$ERR")"
  RC=$?
  MERGEBASE_CALLS=0
  [ -f "$spy_dir/mergebasecalls" ] && MERGEBASE_CALLS="$(cat "$spy_dir/mergebasecalls")"
  rm -rf "$spy_dir"
}

# CON-193 (round 4, self-caught regression): every fixture ABOVE this point
# invokes `$SCRIPT` -- the real file living inside THIS checkout
# (core/scripts/check-merge-readiness.sh) -- so `SCRIPT_DIR`/`REPO_ROOT`
# inside the script always resolve to THIS checkout's own root, which DOES
# have `lib/config.js`. That is exactly why 133/133 fixtures stayed green
# while condition 4's `node -e` call unconditionally `require()`d
# `${REPO_ROOT}/lib/config.js` even for an empty/absent `protectedPaths` --
# no fixture ever exercised the shape a REAL consuming repo is in, where
# `scripts/concertino/check-merge-readiness.sh` is a byte-copied file with
# no `lib/` anywhere above it (concertino ships `scripts/concertino/*.sh`
# and role/law templates into a consumer's tree; it does NOT ship its own
# `lib/`). This is a genuine coverage gap this suite had, not merely an
# untested edge -- reported explicitly, not glossed over.
#
# `deployed_script_dir()` builds that real shape: a throwaway directory
# containing ONLY a copy of the script and its two sourced lib/*.sh
# dependencies (auditor-lease.sh, pr-reconcile.sh — the full source list;
# neither sources anything further), laid out exactly as
# `scripts/concertino/` is, with NO top-level `lib/config.js` anywhere in
# its tree. `run_check_deployed` invokes THAT copy, not `$SCRIPT`, so
# `REPO_ROOT` genuinely resolves to a directory with no `lib/config.js` --
# the actual production consumer shape.
deployed_script_dir() {
  local dir; dir="$(mktemp -d)"
  mkdir -p "$dir/scripts/concertino/lib"
  cp "$SCRIPT" "$dir/scripts/concertino/check-merge-readiness.sh"
  cp "$ROOT/core/scripts/lib/auditor-lease.sh" "$ROOT/core/scripts/lib/pr-reconcile.sh" "$dir/scripts/concertino/lib/"
  chmod +x "$dir/scripts/concertino/check-merge-readiness.sh"
  printf '%s' "$dir"
}

run_check_deployed() {
  # Same contract as run_check, but invokes a COPY of the script deployed
  # into a directory with no lib/config.js anywhere above it (the real
  # consuming-repo shape), not $SCRIPT itself.
  local deploy_dir="$1" repo="$2" branch="$3" ticket="$4" prefix="${5:-$AUDITOR_ARCHIVE_PREFIX}"
  ERR="$(mktemp)"
  OUT="$("$deploy_dir/scripts/concertino/check-merge-readiness.sh" "$repo" "$branch" "$ticket" "$prefix" 2>"$ERR")"
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

# --- CON-189/CON-187 design.md Decision 9 / tasks.md 5.3 / verdict-category --
# --- spec's historical-tolerance scenario: readiness half (evaluation-1.md --
# --- CR1) --------------------------------------------------------------------
# check-merge-readiness.sh's own code is untouched by this change (its jq
# selection reads only .verdict/.head_sha — never .category or .gate), so a
# historical verdict missing category (eval_pass/skeptic_confirm already
# never set it — this is the same shape every fixture above already uses)
# and one carrying a malformed head_sha (short, not the 40-hex form the new
# emit-time validation would refuse going forward — exactly the shape of the
# three already-malformed corpus entries this change's own premise-validation
# found) must reach the exact same outcome the script already produces for
# an unresolvable/malformed reviewed SHA (166.4/166.5 above), proving nothing
# regressed for a log written before this change existed.

# 189.1: an uncategorized-but-otherwise-normal pair still passes cleanly —
# the historical-tolerance happy path (design.md Decision 9's first scenario:
# "a pre-change log still renders ... reaches the same outcome").
REPO="$(new_repo)"
HS="$(head_sha_of "$REPO")"
write_events "$REPO" TEST-189-1 "$(eval_pass "$HS")" "$(skeptic_confirm "$HS")"
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
merge_json MERGEABLE CLEAN null "$HS" main > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$REPO" branch-189-1 TEST-189-1
check "189.1.1 uncategorized evaluator+skeptic verdicts: still all-pass exits zero" "$RC" "0"
check "189.1.2 uncategorized evaluator+skeptic verdicts: still prints PASS" "$OUT" "PASS"
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"

# 189.2: an uncategorized evaluator verdict alongside a skeptic verdict
# carrying a malformed (8-character) head_sha — the exact shape of the
# HEL-1105/HEL-1121 corpus entries CON-187's own ticket.md documents as
# already-existing defects this change does not (and cannot) retroactively
# fix. Reaches the same STALE/unresolvable-SHA refusal 166.4/166.5 already
# assert for a well-formed-but-nonexistent SHA — the malformed length is not
# specially detected or crashed on by the read path, it is simply another
# unresolvable value.
REPO="$(new_repo)"
HS="$(head_sha_of "$REPO")"
write_events "$REPO" TEST-189-2 "$(eval_pass "$HS")" \
  '{"t":2,"kind":"verdict","role":"skeptic","verdict":"CONFIRM","head_sha":"deadbeef"}'
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
merge_json MERGEABLE CLEAN null "$HS" main > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$REPO" branch-189-2 TEST-189-2
check "189.2.1 malformed (8-char) skeptic head_sha: refuses exactly as an unresolvable SHA does (exit 4)" "$RC" "4"
has "189.2.2 malformed head_sha is named in the refusal, same as 166.4's unresolvable-SHA message shape" \
  "STALE skeptic reviewed SHA is unresolvable: deadbeef" "$ERR"
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"

# =============================================================================
# CON-193: agentMerge.protectedPaths — condition 4.
#
# `concertino.config.json` is written directly to the fixture repo's
# filesystem root (never committed/tracked) — the script reads it via
# `fs.readFileSync`, not `git show`, matching design.md Decision 2's "read
# from the main checkout" contract, which for these single-checkout fixtures
# (not a linked worktree) means ROOT == the fixture repo root itself.
# =============================================================================

write_protected_config() {
  # $1 = repo, $2.. = glob patterns (JSON-quoted by the caller)
  local repo="$1"; shift
  local globs="$*"
  printf '{"agentMerge":{"protectedPaths":[%s]}}' "$globs" > "$repo/concertino.config.json"
}

# --- P1: a diff touching a protected glob refuses, naming the path ---------
REPO="$(new_repo)"
mkdir -p "$REPO/record"
echo "x" > "$REPO/record/foo.md"
git -C "$REPO" add record/foo.md
git -C "$REPO" -c user.email=t@t.test -c user.name=t commit -q -m "touch protected path"
HS="$(head_sha_of "$REPO")"
write_events "$REPO" TEST-P1 "$(eval_pass "$HS")" "$(skeptic_confirm "$HS")"
write_protected_config "$REPO" '"record/**"'
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
merge_json MERGEABLE CLEAN null "$HS" main > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$REPO" branch-p1 TEST-P1
check "P1.1 a protected-path match refuses with exit 5" "$RC" "5"
lacks "P1.2 a protected-path match does not print PASS" "PASS" "$ERR"
[ "$OUT" != "PASS" ] && ok "P1.2b PASS not printed on stdout either" || bad "P1.2b PASS not printed on stdout either" "got PASS on stdout"
has "P1.3 the matched path is named" "PROTECTED record/foo.md" "$ERR"
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"

# --- P2: multiple matches are ALL named, not just the first ----------------
REPO="$(new_repo)"
mkdir -p "$REPO/record" "$REPO/docs"
echo "x" > "$REPO/record/foo.md"
echo "y" > "$REPO/record/bar.md"
echo "z" > "$REPO/CHARTER.md"
git -C "$REPO" add record/foo.md record/bar.md CHARTER.md
git -C "$REPO" -c user.email=t@t.test -c user.name=t commit -q -m "touch three protected paths"
HS="$(head_sha_of "$REPO")"
write_events "$REPO" TEST-P2 "$(eval_pass "$HS")" "$(skeptic_confirm "$HS")"
write_protected_config "$REPO" '"record/**","CHARTER.md"'
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
merge_json MERGEABLE CLEAN null "$HS" main > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$REPO" branch-p2 TEST-P2
check "P2.1 multiple matches: exit 5" "$RC" "5"
has "P2.2 first matched path named" "PROTECTED record/foo.md" "$ERR"
has "P2.3 second matched path named" "PROTECTED record/bar.md" "$ERR"
has "P2.4 third matched path named" "PROTECTED CHARTER.md" "$ERR"
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"

# --- P3: a diff touching no protected glob is unaffected --------------------
REPO="$(new_repo)"
mkdir -p "$REPO/src"
echo "x" > "$REPO/src/thing.txt"
git -C "$REPO" add src/thing.txt
git -C "$REPO" -c user.email=t@t.test -c user.name=t commit -q -m "ordinary change"
HS="$(head_sha_of "$REPO")"
write_events "$REPO" TEST-P3 "$(eval_pass "$HS")" "$(skeptic_confirm "$HS")"
write_protected_config "$REPO" '"record/**"'
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
merge_json MERGEABLE CLEAN null "$HS" main > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$REPO" branch-p3 TEST-P3
check "P3.1 non-matching diff with protectedPaths configured: exits zero" "$RC" "0"
check "P3.2 non-matching diff with protectedPaths configured: prints PASS" "$OUT" "PASS"
lacks "P3.3 no PROTECTED line emitted" "PROTECTED" "$ERR"
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"

# --- P4: an empty/absent protectedPaths list is a complete no-op -----------
REPO="$(new_repo)"
mkdir -p "$REPO/record"
echo "x" > "$REPO/record/foo.md"
git -C "$REPO" add record/foo.md
git -C "$REPO" -c user.email=t@t.test -c user.name=t commit -q -m "touch what would be protected, if configured"
HS="$(head_sha_of "$REPO")"
write_events "$REPO" TEST-P4 "$(eval_pass "$HS")" "$(skeptic_confirm "$HS")"
# No concertino.config.json at all — absent, not merely empty-array.
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
merge_json MERGEABLE CLEAN null "$HS" main > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$REPO" branch-p4 TEST-P4
check "P4.1 absent protectedPaths: exits zero" "$RC" "0"
check "P4.2 absent protectedPaths: prints PASS" "$OUT" "PASS"
lacks "P4.3 no PROTECTED line emitted" "PROTECTED" "$ERR"
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"

REPO="$(new_repo)"
mkdir -p "$REPO/record"
echo "x" > "$REPO/record/foo.md"
git -C "$REPO" add record/foo.md
git -C "$REPO" -c user.email=t@t.test -c user.name=t commit -q -m "touch what would be protected, if configured (empty array)"
HS="$(head_sha_of "$REPO")"
write_events "$REPO" TEST-P42 "$(eval_pass "$HS")" "$(skeptic_confirm "$HS")"
write_protected_config "$REPO"
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
merge_json MERGEABLE CLEAN null "$HS" main > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$REPO" branch-p42 TEST-P42
check "P42.1 explicit empty-array protectedPaths: exits zero" "$RC" "0"
check "P42.2 explicit empty-array protectedPaths: prints PASS" "$OUT" "PASS"
lacks "P42.3 no PROTECTED line emitted" "PROTECTED" "$ERR"
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"

# --- P43: the no-op guarantee is git-call-observable, not just output-shaped
# (tasks.md 2.5/3.3d) -- an empty protectedPaths list must add ZERO git
# calls on top of condition 3's own baseline (measured: FOUR `git
# merge-base` calls -- each role's stale_check leg calls merge-base twice,
# once against its reviewed SHA and once against VERIFIED_HEAD, times two
# roles), not merely produce no visible output.
REPO="$(new_repo)"
mkdir -p "$REPO/record"
echo "x" > "$REPO/record/foo.md"
git -C "$REPO" add record/foo.md
git -C "$REPO" -c user.email=t@t.test -c user.name=t commit -q -m "touch what would be protected, if configured (no-op git-call check)"
HS="$(head_sha_of "$REPO")"
write_events "$REPO" TEST-P43 "$(eval_pass "$HS")" "$(skeptic_confirm "$HS")"
write_protected_config "$REPO"
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
merge_json MERGEABLE CLEAN null "$HS" main > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check_spied "$REPO" branch-p43 TEST-P43
check "P43.1 empty protectedPaths adds no git merge-base calls beyond condition 3's own baseline of 4" "$MERGEBASE_CALLS" "4"
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"

# --- P5: exit 1 dominates exit 5 (a hard failure alongside a match) --------
REPO="$(new_repo)"
mkdir -p "$REPO/record"
echo "x" > "$REPO/record/foo.md"
git -C "$REPO" add record/foo.md
git -C "$REPO" -c user.email=t@t.test -c user.name=t commit -q -m "touch protected path, alongside a hard failure"
HS="$(head_sha_of "$REPO")"
write_events "$REPO" TEST-P5 "$(eval_pass "$HS")" "$(skeptic_confirm "$HS")"
write_protected_config "$REPO" '"record/**"'
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' '{"statusCheckRollup":[{"name":"build","conclusion":"FAILURE"}]}' > "$GH_MOCK_DIR/rollup.json"
merge_json MERGEABLE CLEAN null "$HS" main > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$REPO" branch-p5 TEST-P5
check "P5.1 a hard CI failure alongside a protected match: exit 1, not 5" "$RC" "1"
has "P5.2 the CI failure reason is still reported" "CI failed: build" "$ERR"
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"

# --- P6: exit 5 dominates exit 4 (protected match alongside a stale SHA) ---
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
git -C "$WORK" checkout -q -b feature-p6
mkdir -p "$WORK/record"
echo "x" > "$WORK/record/foo.md"
git -C "$WORK" add record/foo.md
git -C "$WORK" commit -q -m "feature: touches record/foo.md (reviewed here)"
REVIEWED_P6="$(git -C "$WORK" rev-parse HEAD)"
# a late, unreviewed commit lands AFTER the verdicts above were recorded —
# triggers condition 3's STALE outcome (exit 4) independent of condition 4
echo late > "$WORK/late.txt"
git -C "$WORK" add late.txt
git -C "$WORK" -c user.email=t@t.test -c user.name=t commit -q -m "late fix after review"
HEAD_P6="$(git -C "$WORK" rev-parse HEAD)"

write_events "$WORK" TEST-P6 "$(eval_pass "$REVIEWED_P6")" "$(skeptic_confirm "$REVIEWED_P6")"
write_protected_config "$WORK" '"record/**"'
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
merge_json MERGEABLE CLEAN null "$HEAD_P6" main > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$WORK" feature-p6 TEST-P6
check "P6.1 a protected match alongside a stale SHA: exit 5, not 4" "$RC" "5"
has "P6.2 the matched path is still named" "PROTECTED record/foo.md" "$ERR"
rm -rf "$ORIGIN" "$SEED" "$WORK" "$GH_MOCK_DIR" "$ERR"

# --- P7 (design.md Decision 1 glob semantics): record/** spans nested dirs -
REPO="$(new_repo)"
mkdir -p "$REPO/record/nested/deep"
echo "x" > "$REPO/record/nested/deep/c.md"
git -C "$REPO" add record/nested/deep/c.md
git -C "$REPO" -c user.email=t@t.test -c user.name=t commit -q -m "touch deeply nested record path"
HS="$(head_sha_of "$REPO")"
write_events "$REPO" TEST-P7 "$(eval_pass "$HS")" "$(skeptic_confirm "$HS")"
write_protected_config "$REPO" '"record/**"'
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
merge_json MERGEABLE CLEAN null "$HS" main > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$REPO" branch-p7 TEST-P7
check "P7.1 record/** matches a deeply nested path: exit 5" "$RC" "5"
has "P7.2 the nested path is named" "PROTECTED record/nested/deep/c.md" "$ERR"
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"

# --- P8: scripts/check-*.sh does NOT match scripts/nested/check-bar.sh -----
REPO="$(new_repo)"
mkdir -p "$REPO/scripts/nested"
echo "x" > "$REPO/scripts/nested/check-bar.sh"
git -C "$REPO" add scripts/nested/check-bar.sh
git -C "$REPO" -c user.email=t@t.test -c user.name=t commit -q -m "touch only the nested script"
HS="$(head_sha_of "$REPO")"
write_events "$REPO" TEST-P8 "$(eval_pass "$HS")" "$(skeptic_confirm "$HS")"
write_protected_config "$REPO" '"scripts/check-*.sh"'
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
merge_json MERGEABLE CLEAN null "$HS" main > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$REPO" branch-p8 TEST-P8
check "P8.1 scripts/check-*.sh does not cross into a subdirectory: exits zero" "$RC" "0"
check "P8.2 scripts/check-*.sh does not cross into a subdirectory: prints PASS" "$OUT" "PASS"
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"

# --- P9: CHARTER.md does NOT match docs/CHARTER.md (root-anchored) --------
REPO="$(new_repo)"
mkdir -p "$REPO/docs"
echo "x" > "$REPO/docs/CHARTER.md"
git -C "$REPO" add docs/CHARTER.md
git -C "$REPO" -c user.email=t@t.test -c user.name=t commit -q -m "touch only the nested CHARTER.md"
HS="$(head_sha_of "$REPO")"
write_events "$REPO" TEST-P9 "$(eval_pass "$HS")" "$(skeptic_confirm "$HS")"
write_protected_config "$REPO" '"CHARTER.md"'
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
merge_json MERGEABLE CLEAN null "$HS" main > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$REPO" branch-p9 TEST-P9
check "P9.1 root-anchored CHARTER.md does not match docs/CHARTER.md: exits zero" "$RC" "0"
check "P9.2 root-anchored CHARTER.md does not match docs/CHARTER.md: prints PASS" "$OUT" "PASS"
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"

# --- P10: an unclosed character class is not a silent pass -----------------
REPO="$(new_repo)"
mkdir -p "$REPO/record"
echo "x" > "$REPO/record/foo.md"
git -C "$REPO" add record/foo.md
git -C "$REPO" -c user.email=t@t.test -c user.name=t commit -q -m "touch a path a malformed glob was meant to protect"
HS="$(head_sha_of "$REPO")"
write_events "$REPO" TEST-P10 "$(eval_pass "$HS")" "$(skeptic_confirm "$HS")"
write_protected_config "$REPO" '"record/[unclosed"'
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
merge_json MERGEABLE CLEAN null "$HS" main > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$REPO" branch-p10 TEST-P10
check "P10.1 a malformed (unclosed '[') glob does not silently pass" "$RC" "1"
lacks "P10.2 PASS is not printed for a malformed glob" "PASS" "$OUT"
has "P10.3 the malformed pattern is surfaced" "malformed" "$ERR"
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"

# --- P11 (CON-193, skeptic-final-1.md, standing constraint C2): a
# `!`-prefixed protectedPaths entry is git EXCLUDE pathspec magic, not a
# plain glob. An exclude-only pathspec has no positive pathspec to pair
# with, so it matches NOTHING — the diff genuinely touches the path, but
# without the new detection the run would silently print PASS/exit 0,
# indistinguishable in shape from a legitimate non-match. This reproduces
# the skeptic's own repro exactly (config-validation-bypassing entry
# reaching the script directly, mirroring an operator who hand-edits
# concertino.config.json without running `concertino validate`).
REPO="$(new_repo)"
mkdir -p "$REPO/record"
echo "x" > "$REPO/record/foo.md"
git -C "$REPO" add record/foo.md
git -C "$REPO" -c user.email=t@t.test -c user.name=t commit -q -m "touch a path an exclude-magic glob was meant to protect"
HS="$(head_sha_of "$REPO")"
write_events "$REPO" TEST-P11 "$(eval_pass "$HS")" "$(skeptic_confirm "$HS")"
write_protected_config "$REPO" '"!record/**"'
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
merge_json MERGEABLE CLEAN null "$HS" main > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$REPO" branch-p11 TEST-P11
check "P11.1 a leading-'!' (exclude-magic) glob does not silently pass" "$RC" "1"
lacks "P11.2 PASS is not printed for an exclude-magic glob" "PASS" "$OUT"
has "P11.3 the pathspec-magic pattern is surfaced as malformed" "malformed" "$ERR"
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"

# --- P12: a leading-":" pathspec-magic entry (":(exclude)...") is rejected
# the same way — the class rejection, not just the one shape demonstrated.
REPO="$(new_repo)"
mkdir -p "$REPO/record"
echo "x" > "$REPO/record/foo.md"
git -C "$REPO" add record/foo.md
git -C "$REPO" -c user.email=t@t.test -c user.name=t commit -q -m "touch a path a :(exclude)-magic glob was meant to protect"
HS="$(head_sha_of "$REPO")"
write_events "$REPO" TEST-P12 "$(eval_pass "$HS")" "$(skeptic_confirm "$HS")"
write_protected_config "$REPO" '":(exclude)record/**"'
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
merge_json MERGEABLE CLEAN null "$HS" main > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$REPO" branch-p12 TEST-P12
check "P12.1 a leading-':' (:(exclude) magic) glob does not silently pass" "$RC" "1"
lacks "P12.2 PASS is not printed for a :(exclude)-magic glob" "PASS" "$OUT"
has "P12.3 the pathspec-magic pattern is surfaced as malformed" "malformed" "$ERR"
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"

# --- P13: positive control for P11 -- same fixture, the PLAIN (non-magic)
# glob still correctly refuses via the ordinary match path (exit 5), proving
# P11/P12's exit-1 outcome is the new magic-rejection firing, not some
# unrelated breakage that makes every protectedPaths fixture fail alike.
REPO="$(new_repo)"
mkdir -p "$REPO/record"
echo "x" > "$REPO/record/foo.md"
git -C "$REPO" add record/foo.md
git -C "$REPO" -c user.email=t@t.test -c user.name=t commit -q -m "touch protected path (positive control for P11/P12)"
HS="$(head_sha_of "$REPO")"
write_events "$REPO" TEST-P13 "$(eval_pass "$HS")" "$(skeptic_confirm "$HS")"
write_protected_config "$REPO" '"record/**"'
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
merge_json MERGEABLE CLEAN null "$HS" main > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$REPO" branch-p13 TEST-P13
check "P13.1 positive control: the plain (non-magic) glob still refuses via exit 5" "$RC" "5"
has "P13.2 positive control: the matched path is still named" "PROTECTED record/foo.md" "$ERR"
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"

# --- P14 (CON-193, skeptic-final-2.md, standing constraint C3 — REGRESSION
# TEST for the shape that defeated cycle-2): a leading-SPACE entry
# (" !record/**") passes neither `startsWith('!')` nor `startsWith(':')`
# (round-2's denylist), so it reached git as `:(glob) !record/**` and
# silently matched nothing even though the diff genuinely touched the
# path. This fixture is committed specifically so that regression cannot
# silently return -- it is red against the cycle-2 denylist (demonstrated
# in the delivery report's mutation transcript) and green against the
# current positive allowlist.
REPO="$(new_repo)"
mkdir -p "$REPO/record"
echo "x" > "$REPO/record/foo.md"
git -C "$REPO" add record/foo.md
git -C "$REPO" -c user.email=t@t.test -c user.name=t commit -q -m "touch a path a leading-space exclude-magic glob was meant to protect"
HS="$(head_sha_of "$REPO")"
write_events "$REPO" TEST-P14 "$(eval_pass "$HS")" "$(skeptic_confirm "$HS")"
write_protected_config "$REPO" '" !record/**"'
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
merge_json MERGEABLE CLEAN null "$HS" main > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$REPO" branch-p14 TEST-P14
check "P14.1 a leading-space (exclude-magic) glob does not silently pass" "$RC" "1"
lacks "P14.2 PASS is not printed for a leading-space exclude-magic glob" "PASS" "$OUT"
has "P14.3 the malformed pattern is surfaced" "malformed" "$ERR"
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"

# --- P15: positive control for P14 -- same fixture, the PLAIN (no leading
# space) glob still correctly refuses via the ordinary match path (exit 5).
REPO="$(new_repo)"
mkdir -p "$REPO/record"
echo "x" > "$REPO/record/foo.md"
git -C "$REPO" add record/foo.md
git -C "$REPO" -c user.email=t@t.test -c user.name=t commit -q -m "touch protected path (positive control for P14)"
HS="$(head_sha_of "$REPO")"
write_events "$REPO" TEST-P15 "$(eval_pass "$HS")" "$(skeptic_confirm "$HS")"
write_protected_config "$REPO" '"record/**"'
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
merge_json MERGEABLE CLEAN null "$HS" main > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$REPO" branch-p15 TEST-P15
check "P15.1 positive control: the plain glob (no leading space) still refuses via exit 5" "$RC" "5"
has "P15.2 positive control: the matched path is still named" "PROTECTED record/foo.md" "$ERR"
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"

# --- P16: a bare interior/trailing-whitespace-free but otherwise-magic-free
# glob containing ".." (path escape) is rejected too (C3's allowlist rule,
# not merely the two demonstrated shapes) -- proves the allowlist rejects
# by construction, not by re-adding a third prefix check.
REPO="$(new_repo)"
mkdir -p "$REPO/record"
echo "x" > "$REPO/record/foo.md"
git -C "$REPO" add record/foo.md
git -C "$REPO" -c user.email=t@t.test -c user.name=t commit -q -m "touch a path a path-escape glob was meant to protect"
HS="$(head_sha_of "$REPO")"
write_events "$REPO" TEST-P16 "$(eval_pass "$HS")" "$(skeptic_confirm "$HS")"
write_protected_config "$REPO" '"record/../record/**"'
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
merge_json MERGEABLE CLEAN null "$HS" main > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$REPO" branch-p16 TEST-P16
check "P16.1 a '..'-containing pattern does not silently pass" "$RC" "1"
lacks "P16.2 PASS is not printed for a '..'-containing pattern" "PASS" "$OUT"
has "P16.3 the malformed pattern is surfaced" "malformed" "$ERR"
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"

# --- P17 (CON-193, skeptic-final-3.md, standing constraint C4 -- the
# FOURTH disarm shape, and the reason condition 4 no longer reimplements
# the accept/reject predicate in bash at all): a DIACRITIC entry
# ("récord/**") is a well-formed, non-empty, non-whitespace string that a
# LOCALE-COLLATION-AWARE bash `[[ =~ ]]` character class (under the
# ambient LANG=en_US.UTF-8 this suite runs under -- confirmed via `locale`
# in the delivery report, not assumed) would have silently ACCEPTED as
# "just another Latin letter", while the real diff genuinely touches the
# ASCII `record/**` directory and ":(glob)récord/**" matches nothing.
# Condition 4 now delegates the entire accept/reject decision to
# lib/config.js's isPlainRelativeGlob (ASCII-only, not locale-dependent)
# via the SAME node -e call that already reads the config, rather than
# re-deriving the rule a fourth time in bash -- this fixture is the
# regression test for that fix, run under this suite's own real ambient
# locale (never LANG=C-pinned for the test itself; that would hide
# exactly the defect this fixture exists to catch).
REPO="$(new_repo)"
mkdir -p "$REPO/record"
echo "x" > "$REPO/record/foo.md"
git -C "$REPO" add record/foo.md
git -C "$REPO" -c user.email=t@t.test -c user.name=t commit -q -m "touch a path a diacritic-magic glob was meant to protect"
HS="$(head_sha_of "$REPO")"
write_events "$REPO" TEST-P17 "$(eval_pass "$HS")" "$(skeptic_confirm "$HS")"
write_protected_config "$REPO" '"récord/**"'
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
merge_json MERGEABLE CLEAN null "$HS" main > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$REPO" branch-p17 TEST-P17
check "P17.1 a diacritic ('récord/**') glob does not silently pass" "$RC" "1"
lacks "P17.2 PASS is not printed for a diacritic glob" "PASS" "$OUT"
has "P17.3 the malformed pattern is surfaced" "malformed" "$ERR"
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"

# --- P18: positive control for P17 -- same fixture, the PLAIN (ASCII,
# no diacritic) glob still correctly refuses via the ordinary match path
# (exit 5), proving P17's exit-1 outcome is the new delegated-predicate
# rejection firing, not some unrelated breakage.
REPO="$(new_repo)"
mkdir -p "$REPO/record"
echo "x" > "$REPO/record/foo.md"
git -C "$REPO" add record/foo.md
git -C "$REPO" -c user.email=t@t.test -c user.name=t commit -q -m "touch protected path (positive control for P17)"
HS="$(head_sha_of "$REPO")"
write_events "$REPO" TEST-P18 "$(eval_pass "$HS")" "$(skeptic_confirm "$HS")"
write_protected_config "$REPO" '"record/**"'
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
merge_json MERGEABLE CLEAN null "$HS" main > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$REPO" branch-p18 TEST-P18
check "P18.1 positive control: the plain (ASCII) glob still refuses via exit 5" "$RC" "5"
has "P18.2 positive control: the matched path is still named" "PROTECTED record/foo.md" "$ERR"
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"

# --- P19 (CON-193, round 4, self-caught regression -- consuming-repo no-op
# shape): a REAL consuming repo's rendered script (deployed_script_dir --
# no lib/config.js anywhere above it), with a REAL concertino.config.json
# present (the ordinary case: every project using concertino has one) that
# sets agentMerge.enabled but never sets protectedPaths at all. This must
# behave EXACTLY as before this whole capability existed -- a no-op, never
# a refusal -- because there is nothing to validate. `10d7c28` (the
# commit right before this fix) required lib/config.js UNCONDITIONALLY,
# before ever checking whether protectedPaths was even non-empty, so this
# fixture failed with exit 1 there for every consuming repo with
# agentMerge enabled, regardless of whether protectedPaths was ever set --
# a strictly worse break than the round-3 defect this predicate exists to
# close.
DEPLOY="$(deployed_script_dir)"
REPO="$(new_repo)"
HS="$(head_sha_of "$REPO")"
write_events "$REPO" TEST-P19 "$(eval_pass "$HS")" "$(skeptic_confirm "$HS")"
printf '{"agentMerge":{"enabled":true}}' > "$REPO/concertino.config.json"
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
merge_json MERGEABLE CLEAN null "$HS" main > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check_deployed "$DEPLOY" "$REPO" branch-p19 TEST-P19
check "P19.1 consuming repo (no lib/config.js), config present but no protectedPaths: exits zero" "$RC" "0"
check "P19.2 consuming repo (no lib/config.js), config present but no protectedPaths: prints PASS" "$OUT" "PASS"
rm -rf "$DEPLOY" "$REPO" "$GH_MOCK_DIR" "$ERR"

# --- P20: companion to P19 -- same consuming-repo shape (no lib/config.js
# anywhere above the deployed script), but THIS time protectedPaths IS
# configured (non-empty). There is genuinely something to validate and the
# predicate genuinely cannot be reached -- this must still FAIL CLOSED
# (never silently pass), distinguishing "nothing configured, no-op" (P19)
# from "something configured, cannot validate it, refuse" (P20). Testing
# only one of these two arms would hide the other.
DEPLOY="$(deployed_script_dir)"
REPO="$(new_repo)"
HS="$(head_sha_of "$REPO")"
write_events "$REPO" TEST-P20 "$(eval_pass "$HS")" "$(skeptic_confirm "$HS")"
printf '{"agentMerge":{"enabled":true,"protectedPaths":["record/**"]}}' > "$REPO/concertino.config.json"
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
merge_json MERGEABLE CLEAN null "$HS" main > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check_deployed "$DEPLOY" "$REPO" branch-p20 TEST-P20
check "P20.1 consuming repo (no lib/config.js), protectedPaths configured: fails closed, not a silent pass" "$RC" "1"
lacks "P20.2 PASS is not printed when the predicate cannot be reached" "PASS" "$OUT"
has "P20.3 the failure names that protectedPaths could not be validated" "protectedPaths" "$ERR"
rm -rf "$DEPLOY" "$REPO" "$GH_MOCK_DIR" "$ERR"

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
