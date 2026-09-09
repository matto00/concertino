#!/usr/bin/env bash
set -uo pipefail

# ===========================================================================
# squash-branch.test.sh (CON-129) — throwaway-repo acceptance test for the
# guarded Delivery squash step.
#
# Every fixture repo built here lives under a fresh temp dir created by
# `mktemp -d`. NEVER this repo (concertino) or helio. All assertions invoke
# the REAL `core/scripts/squash-branch.sh` file via subprocess against its
# real repo path — never an inline reimplementation of its logic — so a
# guard that's actually broken in the real file cannot pass by accident
# (the self-referential-test trap a past review caught).
# ===========================================================================

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/core/scripts/squash-branch.sh"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  ok   $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL $1"; echo "       $2"; }

# CON-151: restore from a snapshot taken NOW, not from git HEAD. The former
# `git checkout -- core/scripts/squash-branch.sh` did not restore this test's
# own mutation -- it discarded ANY uncommitted change to that file, so merely
# running this suite silently reverted a legitimate in-progress edit to the
# script, with no error and no diff to notice. Snapshotting the live file
# restores exactly what was there, whether or not it matches HEAD.
PRISTINE_SCRIPT="$(mktemp)"
cp "$ROOT/core/scripts/squash-branch.sh" "$PRISTINE_SCRIPT"
restore_script() {
  cp "$PRISTINE_SCRIPT" "$ROOT/core/scripts/squash-branch.sh" 2>/dev/null || true
  rm -f "$PRISTINE_SCRIPT" "$ROOT/core/scripts/squash-branch.sh".bak.* \
        "$ROOT/core/scripts/squash-branch.sh".bak2.* \
        "$ROOT/core/scripts/squash-branch.sh".bak3.* 2>/dev/null || true
}
# Belt-and-braces: whatever else happens, the real script must never be left
# mutated when this test process exits.
trap restore_script EXIT

commit_all() {
  local repo="$1" msg="$2"
  git -C "$repo" add -A
  git -C "$repo" -c user.email=t@t.com -c user.name=t commit -q -m "$msg"
}

# ---------------------------------------------------------------------
# Scenario 1 (tasks 3.1-3.4): base advances mid-run with a sibling merge;
# prove the naive `git reset --soft origin/main` WOULD revert it, then
# prove the real script does not, then prove the guard can be made to fail
# by mutating the real file in place.
# ---------------------------------------------------------------------
echo "Scenario 1: base advanced mid-run must not be absorbed as a revert"

BASE1="$(mktemp -d)"
REMOTE1="$BASE1/remote.git"
PRIMARY1="$BASE1/primary"
BRANCH1="$BASE1/branch-checkout"

git init -q --bare "$REMOTE1"
git clone -q "$REMOTE1" "$PRIMARY1" 2>/dev/null
echo "root" > "$PRIMARY1/root.txt"
commit_all "$PRIMARY1" "init"
git -C "$PRIMARY1" branch -M main
git -C "$PRIMARY1" push -q origin main

# Second clone as the feature branch's own checkout (this simulates the
# worktree the executor works in).
git clone -q "$REMOTE1" "$BRANCH1" 2>/dev/null
git -C "$BRANCH1" checkout -q -b feature/con-129/CON-129 origin/main
echo "own work" > "$BRANCH1/own-file.txt"
commit_all "$BRANCH1" "feature commit 1"
echo "own work 2" >> "$BRANCH1/own-file.txt"
commit_all "$BRANCH1" "feature commit 2"

# Meanwhile, a SIBLING run merges to origin/main via the primary checkout —
# this simulates HEL-772 landing while HEL-548 (this branch) is still in
# Execution/Evaluation.
echo "sibling feature" > "$PRIMARY1/sibling-file.txt"
commit_all "$PRIMARY1" "sibling merge: unrelated work"
git -C "$PRIMARY1" push -q origin main

git -C "$BRANCH1" fetch -q origin

# What the naive reset would do to a REAL repo, stated before any experiment:
# `git reset --soft origin/main` reads origin/main's CURRENT tip (which now
# includes the sibling commit) rather than the commit this branch actually
# diverged from. Since origin/main is now AHEAD of the merge-base by the
# sibling commit, and the feature branch's own commits are on top of the old
# main, resetting to the live tip and then committing "everything currently
# different from origin/main" would stage sibling-file.txt for DELETION
# (it exists on origin/main but the reset target now includes it as
# "already committed", except our tree lacks it via checkout — in the
# canonical failure this manifests as the sibling's files disappearing from
# the squashed diff / being staged as reverted). We demonstrate this
# concretely via the mutated-script scenario below (3.4) rather than via a
# second hand-rolled naive command here, exactly to avoid re-deriving the
# bug from an inline copy of the buggy logic.
echo "  [pre-check] if reset naively against origin/main's live tip, the" \
     "sibling commit's file (sibling-file.txt) would be excluded from what" \
     "the feature branch \"owns\", and a squash commit built off that reset" \
     "would stage sibling-file.txt for deletion relative to the prior tree."

CHANGE_DIR1="openspec/changes/con-129-demo"
mkdir -p "$BRANCH1/$CHANGE_DIR1"
cat > "$BRANCH1/$CHANGE_DIR1/files-modified.md" <<'EOF'
- `own-file.txt` — feature work
EOF
commit_all "$BRANCH1" "add change artifacts"

OUT1="$("$SCRIPT" "$BRANCH1" origin main "CON-129 test squash" "$CHANGE_DIR1" 2>&1)"
RC1=$?
if [ "$RC1" -eq 0 ]; then ok "3.3 real script exits 0 against the advanced-base fixture"; else bad "3.3 real script exits 0 against the advanced-base fixture" "exit=$RC1 output=$OUT1"; fi

if git -C "$BRANCH1" show --name-only --pretty=format: HEAD 2>/dev/null | grep -qx "sibling-file.txt"; then
  bad "3.3 squash commit must not touch sibling-file.txt" "it appeared in HEAD's file list"
else
  ok "3.3 squash commit does not touch sibling-file.txt"
fi

if git -C "$BRANCH1" show --name-only --pretty=format: HEAD 2>/dev/null | grep -qx "own-file.txt"; then
  ok "3.3 squash commit contains the branch's own file"
else
  bad "3.3 squash commit contains the branch's own file" "own-file.txt missing from HEAD"
fi

echo "$OUT1" | grep -qi "base ${BASE1##*/}" 2>/dev/null # no-op guard against unbound var warnings
if echo "$OUT1" | grep -qi "advanced"; then
  ok "3.1/D3 base advancement is logged"
else
  bad "3.1/D3 base advancement is logged" "no 'advanced' text in output: $OUT1"
fi

# --- 3.4: prove the guard can actually fire by mutating the REAL script ---
echo "Scenario 1b: guard must fire when the real script is degraded to the naive reset"

BRANCH1B="$BASE1/branch-checkout-2"
git clone -q "$REMOTE1" "$BRANCH1B" 2>/dev/null
git -C "$BRANCH1B" checkout -q -b feature/con-129/CON-129-b origin/main
git -C "$BRANCH1B" reset -q --hard "$(git -C "$BRANCH1" merge-base HEAD origin/main)" 2>/dev/null || true
# Rebuild the same feature commits on the pre-sibling base for a clean second fixture.
git -C "$BRANCH1B" checkout -q -b feature/con-129/CON-129-c "$(git -C "$PRIMARY1" rev-parse HEAD~1)"
echo "own work" > "$BRANCH1B/own-file.txt"
commit_all "$BRANCH1B" "feature commit 1"
echo "own work 2" >> "$BRANCH1B/own-file.txt"
commit_all "$BRANCH1B" "feature commit 2"
mkdir -p "$BRANCH1B/$CHANGE_DIR1"
cat > "$BRANCH1B/$CHANGE_DIR1/files-modified.md" <<'EOF'
- `own-file.txt` — feature work
EOF
commit_all "$BRANCH1B" "add change artifacts"
git -C "$BRANCH1B" fetch -q origin

cp "$SCRIPT" "$SCRIPT.bak.$$"
cat > "$SCRIPT" <<'NAIVE'
#!/usr/bin/env bash
set -uo pipefail
WORKTREE_PATH="$1"; BASE_REMOTE="$2"; BASE_BRANCH="$3"; SUBJECT="$4"
git -C "$WORKTREE_PATH" reset --soft "${BASE_REMOTE}/${BASE_BRANCH}"
git -C "$WORKTREE_PATH" commit -q -m "$SUBJECT"
echo "READY naive squash"
exit 0
NAIVE
chmod +x "$SCRIPT"

OUT1B="$("$SCRIPT" "$BRANCH1B" origin main "CON-129 naive squash" "$CHANGE_DIR1" 2>&1)"
if git -C "$BRANCH1B" show --name-only --pretty=format: HEAD 2>/dev/null | grep -qx "sibling-file.txt"; then
  ok "3.4 naive (mutated) script reproduces the revert (sibling-file.txt staged/committed)"
else
  bad "3.4 naive (mutated) script reproduces the revert" "sibling-file.txt did not appear; naive fixture invalid: $OUT1B"
fi

mv "$SCRIPT.bak.$$" "$SCRIPT"
chmod +x "$SCRIPT"

BRANCH1C="$BASE1/branch-checkout-3"
git clone -q "$REMOTE1" "$BRANCH1C" 2>/dev/null
git -C "$BRANCH1C" checkout -q -b feature/con-129/CON-129-d "$(git -C "$PRIMARY1" rev-parse HEAD~1)"
echo "own work" > "$BRANCH1C/own-file.txt"
commit_all "$BRANCH1C" "feature commit 1"
echo "own work 2" >> "$BRANCH1C/own-file.txt"
commit_all "$BRANCH1C" "feature commit 2"
mkdir -p "$BRANCH1C/$CHANGE_DIR1"
cat > "$BRANCH1C/$CHANGE_DIR1/files-modified.md" <<'EOF'
- `own-file.txt` — feature work
EOF
commit_all "$BRANCH1C" "add change artifacts"
git -C "$BRANCH1C" fetch -q origin

OUT1C="$("$SCRIPT" "$BRANCH1C" origin main "CON-129 restored squash" "$CHANGE_DIR1" 2>&1)"
RC1C=$?
if [ "$RC1C" -eq 0 ] && ! git -C "$BRANCH1C" show --name-only --pretty=format: HEAD 2>/dev/null | grep -qx "sibling-file.txt"; then
  ok "3.4 real (restored) script passes again after trap-restore"
else
  bad "3.4 real (restored) script passes again after trap-restore" "exit=$RC1C output=$OUT1C"
fi

# ---------------------------------------------------------------------
# Scenario 2 (tasks 3.5): files-modified.md guard, non-default change-dir.
# ---------------------------------------------------------------------
echo "Scenario 2: files-modified.md guard trips on an undeclared stray file (non-default change-dir)"

BASE2="$(mktemp -d)"
REMOTE2="$BASE2/remote.git"
BRANCH2="$BASE2/branch-checkout"

git init -q --bare "$REMOTE2"
git clone -q "$REMOTE2" "$BASE2/primary" 2>/dev/null
echo "root" > "$BASE2/primary/root.txt"
commit_all "$BASE2/primary" "init"
git -C "$BASE2/primary" branch -M main
git -C "$BASE2/primary" push -q origin main

git clone -q "$REMOTE2" "$BRANCH2" 2>/dev/null
git -C "$BRANCH2" checkout -q -b feature/con-129/CON-129-e origin/main
CHANGE_DIR2="spec/changes/con-129-demo"
mkdir -p "$BRANCH2/$CHANGE_DIR2"
cat > "$BRANCH2/$CHANGE_DIR2/files-modified.md" <<'EOF'
- `declared-file.txt` — the only file this run declares
EOF
echo "declared" > "$BRANCH2/declared-file.txt"
echo "stray" > "$BRANCH2/stray-unrelated-file.txt"
commit_all "$BRANCH2" "executor commit (with an undeclared stray file)"

HEAD_BEFORE2="$(git -C "$BRANCH2" rev-parse HEAD)"
COMMIT_COUNT_BEFORE2="$(git -C "$BRANCH2" rev-list --count HEAD)"

OUT2="$("$SCRIPT" "$BRANCH2" origin main "CON-129 should not commit" "$CHANGE_DIR2" 2>&1)"
RC2=$?
if [ "$RC2" -ne 0 ]; then ok "3.5 guard exits non-zero for an undeclared stray file"; else bad "3.5 guard exits non-zero for an undeclared stray file" "exit=0 output=$OUT2"; fi
if echo "$OUT2" | grep -qF "stray-unrelated-file.txt"; then
  ok "3.5 guard output names the unexpected file explicitly"
else
  bad "3.5 guard output names the unexpected file explicitly" "output: $OUT2"
fi
# No new commit should have been created, and — per the validate-before-reset
# contract (CON-163) — HEAD must not have moved at all: the guard now runs
# BEFORE any reset, so a refusal leaves the branch's own commits exactly
# where the executor left them, reachable from HEAD. Compare against values
# recorded before the run, never against a literal.
COMMIT_COUNT2="$(git -C "$BRANCH2" rev-list --count HEAD)"
if [ "$COMMIT_COUNT2" -eq "$COMMIT_COUNT_BEFORE2" ]; then
  ok "3.5 no squash commit was created on guard trip (commit count unchanged)"
else
  bad "3.5 no squash commit was created on guard trip (commit count unchanged)" "before=$COMMIT_COUNT_BEFORE2 after=$COMMIT_COUNT2"
fi
HEAD_AFTER2="$(git -C "$BRANCH2" rev-parse HEAD)"
if [ "$HEAD_AFTER2" = "$HEAD_BEFORE2" ]; then
  ok "3.5 HEAD is unchanged across the guard trip"
else
  bad "3.5 HEAD is unchanged across the guard trip" "before=$HEAD_BEFORE2 after=$HEAD_AFTER2"
fi
# The stray file is not lost: it is still present and reachable from HEAD.
# In this fixture it was committed by the executor before the script ran, so
# the index is legitimately clean after the fix (nothing was ever reset) —
# the old "remains staged" form cannot hold under the new ordering. What
# matters is that the file still exists on the branch's own history.
if git -C "$BRANCH2" show --name-only --pretty=format: HEAD 2>/dev/null | grep -qx "stray-unrelated-file.txt"; then
  ok "3.5 the stray file remains reachable from HEAD after the guard trip (work not lost)"
else
  bad "3.5 the stray file remains reachable from HEAD after the guard trip (work not lost)" "not found in HEAD's tree"
fi

echo "Scenario 2b: deleting the guard block from the real script makes this fail (exit 0, commits)"
cp "$SCRIPT" "$SCRIPT.bak2.$$"
# Neutralize the "Any staged path outside the allowed union" hard-stop by
# turning its exit 1 into exit 0, mutating the REAL file in place (not an
# inline copy) via a targeted, unique-line sed substitution.
python3 - "$SCRIPT" <<'PYEOF'
import sys
path = sys.argv[1]
with open(path) as f:
    lines = f.readlines()
target = '    echo "Refusing to commit. Investigate before re-running." >&2\n'
idx = lines.index(target)
# The next line is this stop's "exit 1" — comment it out so control falls
# through to the commit section below, proving the guard block (not some
# other unrelated line) was what stopped the commit.
assert lines[idx + 1].strip() == "exit 1", lines[idx + 1]
lines[idx + 1] = "    : # guard exit removed by test mutation\n"
with open(path, "w") as f:
    f.writelines(lines)
PYEOF
chmod +x "$SCRIPT"

BRANCH2B="$BASE2/branch-checkout-2"
git clone -q "$REMOTE2" "$BRANCH2B" 2>/dev/null
git -C "$BRANCH2B" checkout -q -b feature/con-129/CON-129-f origin/main
mkdir -p "$BRANCH2B/$CHANGE_DIR2"
cat > "$BRANCH2B/$CHANGE_DIR2/files-modified.md" <<'EOF'
- `declared-file.txt` — the only file this run declares
EOF
echo "declared" > "$BRANCH2B/declared-file.txt"
echo "stray" > "$BRANCH2B/stray-unrelated-file.txt"
commit_all "$BRANCH2B" "executor commit (with an undeclared stray file)"

OUT2B="$("$SCRIPT" "$BRANCH2B" origin main "CON-129 guard removed" "$CHANGE_DIR2" 2>&1)"
RC2B=$?
if [ "$RC2B" -eq 0 ]; then
  ok "3.5 guard-removed mutation now fails-to-fail (exits 0, proving the guard block was load-bearing)"
else
  bad "3.5 guard-removed mutation now fails-to-fail" "expected exit 0 (bug reproduced) but got exit=$RC2B output=$OUT2B"
fi

mv "$SCRIPT.bak2.$$" "$SCRIPT"
chmod +x "$SCRIPT"

BRANCH2C="$BASE2/branch-checkout-3"
git clone -q "$REMOTE2" "$BRANCH2C" 2>/dev/null
git -C "$BRANCH2C" checkout -q -b feature/con-129/CON-129-g origin/main
mkdir -p "$BRANCH2C/$CHANGE_DIR2"
cat > "$BRANCH2C/$CHANGE_DIR2/files-modified.md" <<'EOF'
- `declared-file.txt` — the only file this run declares
EOF
echo "declared" > "$BRANCH2C/declared-file.txt"
echo "stray" > "$BRANCH2C/stray-unrelated-file.txt"
commit_all "$BRANCH2C" "executor commit (with an undeclared stray file)"

OUT2C="$("$SCRIPT" "$BRANCH2C" origin main "CON-129 restored guard" "$CHANGE_DIR2" 2>&1)"
RC2C=$?
if [ "$RC2C" -ne 0 ]; then
  ok "3.5 restored real script trips the guard again after trap-restore"
else
  bad "3.5 restored real script trips the guard again after trap-restore" "exit=$RC2C output=$OUT2C"
fi

# ---------------------------------------------------------------------
# Scenario 2d (task 3.2, design.md D4): mutation proof for the
# validate-before-reset ordering (CON-163). The regression guard added
# above (HEAD unchanged across a refused run) must be mutation-failable by
# reintroducing the EARLY reset specifically -- not by weakening the guard's
# strictness, which would prove the wrong thing. Uses a fixture whose branch
# carries its own commit past the merge-base (declared-file.txt +
# stray-unrelated-file.txt, committed via commit_all below), so HEAD and the
# merge-base do not coincide and the assertion is not vacuous.
# ---------------------------------------------------------------------
echo "Scenario 2d: mutation proof -- reintroducing the early reset makes the HEAD-unchanged guard go red"

BRANCH2D="$BASE2/branch-checkout-4"
git clone -q "$REMOTE2" "$BRANCH2D" 2>/dev/null
git -C "$BRANCH2D" checkout -q -b feature/con-129/CON-129-h origin/main
mkdir -p "$BRANCH2D/$CHANGE_DIR2"
cat > "$BRANCH2D/$CHANGE_DIR2/files-modified.md" <<'EOF'
- `declared-file.txt` — the only file this run declares
EOF
echo "declared" > "$BRANCH2D/declared-file.txt"
echo "stray" > "$BRANCH2D/stray-unrelated-file.txt"
commit_all "$BRANCH2D" "executor commit (with an undeclared stray file)"

cp "$SCRIPT" "$SCRIPT.bak.$$"
# Reintroduce the early reset at its OLD position -- immediately after the
# merge-base is computed, before the staged-set inspection -- exactly the
# defect CON-163 fixes. This is the ordering mutation, not a guard-strictness
# mutation.
python3 - "$SCRIPT" <<'PYEOF'
import sys
path = sys.argv[1]
with open(path) as f:
    lines = f.readlines()
target = "# --- Staged file set (prospective: computed against the merge-base without\n"
idx = lines.index(target)
early_reset = (
    'if ! git_wt reset --soft "$MERGE_BASE" >/dev/null 2>&1; then\n'
    '  echo "FAIL git reset --soft ${MERGE_BASE} failed" >&2\n'
    '  exit 1\n'
    'fi\n\n'
)
lines.insert(idx, early_reset)
with open(path, "w") as f:
    f.writelines(lines)
PYEOF
chmod +x "$SCRIPT"

HEAD_BEFORE2D="$(git -C "$BRANCH2D" rev-parse HEAD)"
OUT2D="$("$SCRIPT" "$BRANCH2D" origin main "CON-129 should not commit" "$CHANGE_DIR2" 2>&1)"
RC2D=$?
HEAD_AFTER2D="$(git -C "$BRANCH2D" rev-parse HEAD)"

if [ "$RC2D" -ne 0 ] && [ "$HEAD_AFTER2D" != "$HEAD_BEFORE2D" ]; then
  ok "3.2 HEAD-unchanged guard is mutation-failable by reintroducing the early reset (HEAD moved: before=$HEAD_BEFORE2D after=$HEAD_AFTER2D)"
else
  bad "3.2 HEAD-unchanged guard is mutation-failable by reintroducing the early reset" "expected refusal with HEAD moved; got exit=$RC2D before=$HEAD_BEFORE2D after=$HEAD_AFTER2D output=$OUT2D"
fi

mv "$SCRIPT.bak.$$" "$SCRIPT"
chmod +x "$SCRIPT"

# ---------------------------------------------------------------------
# Scenario 3 (tasks 3.6): always print staged count/list, no violations.
# ---------------------------------------------------------------------
echo "Scenario 3: staged count + list always printed on an ordinary clean squash"

BASE3="$(mktemp -d)"
REMOTE3="$BASE3/remote.git"
BRANCH3="$BASE3/branch-checkout"

git init -q --bare "$REMOTE3"
git clone -q "$REMOTE3" "$BASE3/primary" 2>/dev/null
echo "root" > "$BASE3/primary/root.txt"
commit_all "$BASE3/primary" "init"
git -C "$BASE3/primary" branch -M main
git -C "$BASE3/primary" push -q origin main

git clone -q "$REMOTE3" "$BRANCH3" 2>/dev/null
git -C "$BRANCH3" checkout -q -b feature/con-129/CON-129-h origin/main
CHANGE_DIR3="openspec/changes/con-129-clean-demo"
mkdir -p "$BRANCH3/$CHANGE_DIR3"
cat > "$BRANCH3/$CHANGE_DIR3/files-modified.md" <<'EOF'
- `clean-file.txt` — the only file this run declares
EOF
echo "clean" > "$BRANCH3/clean-file.txt"
commit_all "$BRANCH3" "clean executor commit"

OUT3="$("$SCRIPT" "$BRANCH3" origin main "CON-129 clean squash" "$CHANGE_DIR3" 2>&1)"
RC3=$?
if [ "$RC3" -eq 0 ]; then ok "3.6 clean squash exits 0"; else bad "3.6 clean squash exits 0" "exit=$RC3 output=$OUT3"; fi
if echo "$OUT3" | grep -qF "Staged file count:"; then
  ok "3.6 staged file count is printed"
else
  bad "3.6 staged file count is printed" "output: $OUT3"
fi
if echo "$OUT3" | grep -qF "clean-file.txt"; then
  ok "3.6 staged file list names the staged file"
else
  bad "3.6 staged file list names the staged file" "output: $OUT3"
fi
# Order: count/list must appear before "READY" (the commit having happened).
COUNT_LINE="$(echo "$OUT3" | grep -n "Staged file count:" | head -1 | cut -d: -f1)"
READY_LINE="$(echo "$OUT3" | grep -n "^READY" | head -1 | cut -d: -f1)"
if [ -n "$COUNT_LINE" ] && [ -n "$READY_LINE" ] && [ "$COUNT_LINE" -lt "$READY_LINE" ]; then
  ok "3.6 staged count/list printed before the commit-confirming READY line"
else
  bad "3.6 staged count/list printed before the commit-confirming READY line" "count_line=$COUNT_LINE ready_line=$READY_LINE"
fi

# ---------------------------------------------------------------------
# Scenario 4 (tasks 3.7): unparseable files-modified.md, non-default change-dir.
# ---------------------------------------------------------------------
echo "Scenario 4: unparseable files-modified.md fails loudly, --allow-empty-declaration opts in"

BASE4="$(mktemp -d)"
REMOTE4="$BASE4/remote.git"

git init -q --bare "$REMOTE4"
git clone -q "$REMOTE4" "$BASE4/primary" 2>/dev/null
echo "root" > "$BASE4/primary/root.txt"
commit_all "$BASE4/primary" "init"
git -C "$BASE4/primary" branch -M main
git -C "$BASE4/primary" push -q origin main

CHANGE_DIR4="spec/changes/con-129-unparseable-demo"

make_branch4() {
  local dir="$1"
  git clone -q "$REMOTE4" "$dir" 2>/dev/null
  git -C "$dir" checkout -q -b "feature/con-129/$(basename "$dir")" origin/main
  mkdir -p "$dir/$CHANGE_DIR4"
  cat > "$dir/$CHANGE_DIR4/files-modified.md" <<'EOF'
This run touched about 190 files across the reorganized directory tree; see
the accompanying commit for the full list rather than an enumeration here.
EOF
  echo "outstanding" > "$dir/outstanding-file.txt"
  commit_all "$dir" "executor commit (free-form, unenumerated declaration)"
}

BRANCH4A="$BASE4/branch-a"
make_branch4 "$BRANCH4A"
HEAD_BEFORE4A="$(git -C "$BRANCH4A" rev-parse HEAD)"
OUT4A="$("$SCRIPT" "$BRANCH4A" origin main "CON-129 unparseable, no opt-in" "$CHANGE_DIR4" 2>&1)"
RC4A=$?
if [ "$RC4A" -ne 0 ]; then ok "3.7 unparseable declaration fails loudly without --allow-empty-declaration"; else bad "3.7 unparseable declaration fails loudly without --allow-empty-declaration" "exit=0 output=$OUT4A"; fi
if echo "$OUT4A" | grep -qF "outstanding-file.txt" && echo "$OUT4A" | grep -qi "190 files"; then
  ok "3.7 output includes both the raw declaration content and the outstanding staged path"
else
  bad "3.7 output includes both the raw declaration content and the outstanding staged path" "output: $OUT4A"
fi
HEAD_AFTER4A="$(git -C "$BRANCH4A" rev-parse HEAD)"
if [ "$HEAD_AFTER4A" = "$HEAD_BEFORE4A" ]; then
  ok "3.3 HEAD is unchanged across the missing/unparseable-declaration refusal"
else
  bad "3.3 HEAD is unchanged across the missing/unparseable-declaration refusal" "before=$HEAD_BEFORE4A after=$HEAD_AFTER4A"
fi

BRANCH4B="$BASE4/branch-b"
make_branch4 "$BRANCH4B"
OUT4B="$("$SCRIPT" "$BRANCH4B" origin main "CON-129 unparseable, with opt-in" "$CHANGE_DIR4" --allow-empty-declaration 2>&1)"
RC4B=$?
if [ "$RC4B" -eq 0 ]; then ok "3.7 --allow-empty-declaration opts in and succeeds"; else bad "3.7 --allow-empty-declaration opts in and succeeds" "exit=$RC4B output=$OUT4B"; fi

# ---------------------------------------------------------------------
# Scenario 5 (CON-151): a grouped bullet declares EVERY path on it, and the
# widened parse does not overshoot into over-declaring.
# ---------------------------------------------------------------------
echo "Scenario 5: grouped-bullet declarations (CON-151)"

BASE5="$(mktemp -d)"
REMOTE5="$BASE5/remote.git"
git init -q --bare "$REMOTE5"
git clone -q "$REMOTE5" "$BASE5/primary" 2>/dev/null
echo "root" > "$BASE5/primary/root.txt"
commit_all "$BASE5/primary" "init"
git -C "$BASE5/primary" branch -M main
git -C "$BASE5/primary" push -q origin main
CHANGE_DIR5="spec/changes/con-151-demo"

# 5a: three paths on ONE bullet, plus a continuation line. Before the fix the
# parse kept only alpha.txt, so beta/gamma tripped the guard as "undeclared".
BRANCH5A="$BASE5/branch-a"
git clone -q "$REMOTE5" "$BRANCH5A" 2>/dev/null
git -C "$BRANCH5A" checkout -q -b feature/con-151/CON-151-a origin/main
mkdir -p "$BRANCH5A/$CHANGE_DIR5"
cat > "$BRANCH5A/$CHANGE_DIR5/files-modified.md" <<'EOF'
- `alpha.txt`, `beta.txt` and `gamma.txt` — all three rewritten together
EOF
for f in alpha beta gamma; do echo "$f" > "$BRANCH5A/$f.txt"; done
commit_all "$BRANCH5A" "executor commit (grouped bullet)"
OUT5A="$("$SCRIPT" "$BRANCH5A" origin main "CON-151 grouped bullet" "$CHANGE_DIR5" 2>&1)"
RC5A=$?
if [ "$RC5A" -eq 0 ]; then
  ok "CON-151 every path on a grouped bullet is declared"
else
  bad "CON-151 every path on a grouped bullet is declared" "exit=$RC5A output=$OUT5A"
fi

# 5b: guards the guard. A genuinely undeclared stray must STILL trip, and an
# inline code span on a bullet (`--allow-empty-declaration`) must not become a
# declaration. Over-declaring is the one direction that would weaken D2a.
BRANCH5B="$BASE5/branch-b"
git clone -q "$REMOTE5" "$BRANCH5B" 2>/dev/null
git -C "$BRANCH5B" checkout -q -b feature/con-151/CON-151-b origin/main
mkdir -p "$BRANCH5B/$CHANGE_DIR5"
cat > "$BRANCH5B/$CHANGE_DIR5/files-modified.md" <<'EOF'
- `alpha.txt`, `beta.txt` — declared pair; pass `--allow-empty-declaration` to skip
  `sneaky.txt` — continuation line, carries no bullet, declares nothing
EOF
for f in alpha beta sneaky; do echo "$f" > "$BRANCH5B/$f.txt"; done
commit_all "$BRANCH5B" "executor commit (undeclared continuation-line file)"
OUT5B="$("$SCRIPT" "$BRANCH5B" origin main "CON-151 no overshoot" "$CHANGE_DIR5" 2>&1)"
RC5B=$?
if [ "$RC5B" -ne 0 ] && echo "$OUT5B" | grep -qF "sneaky.txt"; then
  ok "CON-151 a continuation-line path is still undeclared and still trips the guard"
else
  bad "CON-151 a continuation-line path is still undeclared and still trips the guard" "exit=$RC5B output=$OUT5B"
fi
if echo "$OUT5B" | grep -q "continuation line carrying no bullet declares nothing"; then
  ok "CON-151 refusal explains the bullet/continuation format rule"
else
  bad "CON-151 refusal explains the bullet/continuation format rule" "output: $OUT5B"
fi

# ---------------------------------------------------------------------
# Scenario 6 (CON-162, tasks 4.1-4.5, 4.4c): the guard must validate the
# STAGED BLOB of files-modified.md, not the worktree copy, and an
# index/worktree divergence of the declaration file itself must be a loud
# refusal rather than silently resolved either way.
# ---------------------------------------------------------------------
echo "Scenario 6: CON-162 -- guard validates the staged declaration blob, not the worktree copy"

BASE6="$(mktemp -d)"
REMOTE6="$BASE6/remote.git"
git init -q --bare "$REMOTE6"
git clone -q "$REMOTE6" "$BASE6/primary" 2>/dev/null
echo "root" > "$BASE6/primary/root.txt"
commit_all "$BASE6/primary" "init"
git -C "$BASE6/primary" branch -M main
git -C "$BASE6/primary" push -q origin main
CHANGE_DIR6="openspec/changes/con-162-demo"

# --- 4.1: stage one declaration content, write DIFFERENT content to disk;
# the script must refuse and commit nothing. ---
BRANCH6A="$BASE6/branch-a"
git clone -q "$REMOTE6" "$BRANCH6A" 2>/dev/null
git -C "$BRANCH6A" checkout -q -b feature/con-162/CON-162-a origin/main
mkdir -p "$BRANCH6A/$CHANGE_DIR6"
cat > "$BRANCH6A/$CHANGE_DIR6/files-modified.md" <<'EOF'
- `own-file.txt` — feature work
EOF
echo "own work" > "$BRANCH6A/own-file.txt"
commit_all "$BRANCH6A" "executor commit (declaration + own file)"
# Executor keeps editing the declaration on disk AFTER committing it, without
# re-staging -- the exact HEL-732 shape.
cat > "$BRANCH6A/$CHANGE_DIR6/files-modified.md" <<'EOF'
- `own-file.txt` — feature work (corrected wording)
EOF

HEAD_BEFORE6A="$(git -C "$BRANCH6A" rev-parse HEAD)"
COUNT_BEFORE6A="$(git -C "$BRANCH6A" rev-list --count HEAD)"
OUT6A="$("$SCRIPT" "$BRANCH6A" origin main "CON-162 divergent declaration" "$CHANGE_DIR6" 2>&1)"
RC6A=$?
if [ "$RC6A" -ne 0 ]; then ok "4.1 divergent worktree declaration is refused"; else bad "4.1 divergent worktree declaration is refused" "exit=0 output=$OUT6A"; fi
if echo "$OUT6A" | grep -qi "differs between the staged index and the worktree"; then
  ok "4.1 refusal names the index/worktree divergence"
else
  bad "4.1 refusal names the index/worktree divergence" "output: $OUT6A"
fi
HEAD_AFTER6A="$(git -C "$BRANCH6A" rev-parse HEAD)"
COUNT_AFTER6A="$(git -C "$BRANCH6A" rev-list --count HEAD)"
if [ "$HEAD_AFTER6A" = "$HEAD_BEFORE6A" ] && [ "$COUNT_AFTER6A" = "$COUNT_BEFORE6A" ]; then
  ok "4.1 no squash commit created; HEAD unchanged"
else
  bad "4.1 no squash commit created; HEAD unchanged" "before=$HEAD_BEFORE6A/$COUNT_BEFORE6A after=$HEAD_AFTER6A/$COUNT_AFTER6A"
fi

# --- 4.2: the divergent on-disk declaration must not be able to authorise a
# staged file the STAGED declaration does not declare (the live-bypass
# shape from the probe at fc88cd0). ---
BRANCH6B="$BASE6/branch-b"
git clone -q "$REMOTE6" "$BRANCH6B" 2>/dev/null
git -C "$BRANCH6B" checkout -q -b feature/con-162/CON-162-b origin/main
mkdir -p "$BRANCH6B/$CHANGE_DIR6"
cat > "$BRANCH6B/$CHANGE_DIR6/files-modified.md" <<'EOF'
- `own-file.txt` — feature work
EOF
echo "own work" > "$BRANCH6B/own-file.txt"
commit_all "$BRANCH6B" "executor commit (declaration + own file)"
# Stage an UNDECLARED file (per the committed declaration).
echo "sneaky" > "$BRANCH6B/sneaky.txt"
git -C "$BRANCH6B" add sneaky.txt
# Then "correct" the declaration ON DISK ONLY to permit it, without staging
# that correction -- the committed blob still does not declare sneaky.txt.
cat > "$BRANCH6B/$CHANGE_DIR6/files-modified.md" <<'EOF'
- `own-file.txt` — feature work
- `sneaky.txt` — added later
EOF

HEAD_BEFORE6B="$(git -C "$BRANCH6B" rev-parse HEAD)"
OUT6B="$("$SCRIPT" "$BRANCH6B" origin main "CON-162 bypass attempt" "$CHANGE_DIR6" 2>&1)"
RC6B=$?
# Pin WHICH refusal fired, not merely that the script exited non-zero --
# a bare non-zero exit is also satisfied by an unrelated early failure (e.g.
# a broken merge-base computation), which would not actually exercise the
# divergence guard this scenario is named for.
if [ "$RC6B" -ne 0 ] && echo "$OUT6B" | grep -qi "differs between the staged index and the worktree"; then
  ok "4.2 divergent worktree declaration cannot authorise an undeclared staged file"
else
  bad "4.2 divergent worktree declaration cannot authorise an undeclared staged file" "exit=$RC6B (bypass succeeded, or wrong refusal fired) output=$OUT6B"
fi
HEAD_AFTER6B="$(git -C "$BRANCH6B" rev-parse HEAD)"
if [ "$HEAD_AFTER6B" = "$HEAD_BEFORE6B" ]; then
  ok "4.2 HEAD unchanged (sneaky.txt not committed)"
else
  bad "4.2 HEAD unchanged (sneaky.txt not committed)" "before=$HEAD_BEFORE6B after=$HEAD_AFTER6B"
fi

# --- 4.3 (D5, structural): the same divergence WITH
# --allow-empty-declaration passed still refuses. ---
BRANCH6C="$BASE6/branch-c"
git clone -q "$REMOTE6" "$BRANCH6C" 2>/dev/null
git -C "$BRANCH6C" checkout -q -b feature/con-162/CON-162-c origin/main
mkdir -p "$BRANCH6C/$CHANGE_DIR6"
cat > "$BRANCH6C/$CHANGE_DIR6/files-modified.md" <<'EOF'
- `own-file.txt` — feature work
EOF
echo "own work" > "$BRANCH6C/own-file.txt"
commit_all "$BRANCH6C" "executor commit (declaration + own file)"
cat > "$BRANCH6C/$CHANGE_DIR6/files-modified.md" <<'EOF'
- `own-file.txt` — feature work (corrected wording)
EOF
OUT6C="$("$SCRIPT" "$BRANCH6C" origin main "CON-162 divergence + flag" "$CHANGE_DIR6" --allow-empty-declaration 2>&1)"
RC6C=$?
# Pin the divergence refusal specifically -- see the 4.2 comment above for why
# a bare non-zero exit is not sufficient evidence that this refusal fired.
if [ "$RC6C" -ne 0 ] && echo "$OUT6C" | grep -qi "differs between the staged index and the worktree"; then
  ok "4.3 --allow-empty-declaration does not suppress the divergence refusal"
else
  bad "4.3 --allow-empty-declaration does not suppress the divergence refusal" "exit=$RC6C output=$OUT6C"
fi

# --- 4.3b (D5, CR3): declaration on disk but NOT in the index, with
# --allow-empty-declaration passed, still refuses and commits nothing. ---
BRANCH6D="$BASE6/branch-d"
git clone -q "$REMOTE6" "$BRANCH6D" 2>/dev/null
git -C "$BRANCH6D" checkout -q -b feature/con-162/CON-162-d origin/main
echo "own work" > "$BRANCH6D/own-file.txt"
commit_all "$BRANCH6D" "executor commit (own file only)"
mkdir -p "$BRANCH6D/$CHANGE_DIR6"
cat > "$BRANCH6D/$CHANGE_DIR6/files-modified.md" <<'EOF'
- `own-file.txt` — feature work
EOF
# Deliberately never `git add` the declaration: untracked at squash time.
HEAD_BEFORE6D="$(git -C "$BRANCH6D" rev-parse HEAD)"
OUT6D="$("$SCRIPT" "$BRANCH6D" origin main "CON-162 untracked declaration + flag" "$CHANGE_DIR6" --allow-empty-declaration 2>&1)"
RC6D=$?
# Pin the D4 not-in-index refusal specifically (its distinguishing text is the
# same "no staged blob in the index" diagnostic 4.4 asserts) -- see the 4.2
# comment above for why a bare non-zero exit is not sufficient evidence.
if [ "$RC6D" -ne 0 ] && echo "$OUT6D" | grep -qi "no staged blob in the index"; then
  ok "4.3b --allow-empty-declaration does not suppress the not-in-index refusal"
else
  bad "4.3b --allow-empty-declaration does not suppress the not-in-index refusal" "exit=$RC6D output=$OUT6D"
fi
HEAD_AFTER6D="$(git -C "$BRANCH6D" rev-parse HEAD)"
if [ "$HEAD_AFTER6D" = "$HEAD_BEFORE6D" ]; then
  ok "4.3b HEAD unchanged"
else
  bad "4.3b HEAD unchanged" "before=$HEAD_BEFORE6D after=$HEAD_AFTER6D"
fi

# --- 4.4: declaration on disk but not in the index refuses with its own
# diagnostic, and the remedy text (git add ...) is present. ---
BRANCH6E="$BASE6/branch-e"
git clone -q "$REMOTE6" "$BRANCH6E" 2>/dev/null
git -C "$BRANCH6E" checkout -q -b feature/con-162/CON-162-e origin/main
echo "own work" > "$BRANCH6E/own-file.txt"
commit_all "$BRANCH6E" "executor commit (own file only)"
mkdir -p "$BRANCH6E/$CHANGE_DIR6"
cat > "$BRANCH6E/$CHANGE_DIR6/files-modified.md" <<'EOF'
- `own-file.txt` — feature work
EOF
OUT6E="$("$SCRIPT" "$BRANCH6E" origin main "CON-162 untracked declaration" "$CHANGE_DIR6" 2>&1)"
RC6E=$?
if [ "$RC6E" -ne 0 ]; then ok "4.4 declaration on disk but not staged is refused"; else bad "4.4 declaration on disk but not staged is refused" "exit=0 output=$OUT6E"; fi
if echo "$OUT6E" | grep -qF "git add ${CHANGE_DIR6}/files-modified.md"; then
  ok "4.4 refusal states the self-service remedy (git add ...)"
else
  bad "4.4 refusal states the self-service remedy (git add ...)" "output: $OUT6E"
fi

# --- 4.4b (D4a / 3.2): declaration absent on disk with a staged blob
# present -- the blob must still be parsed and enforced, so an undeclared
# staged file is still refused (the structural check that D4a's exemption
# did not become a blanket amnesty). ---
BRANCH6F="$BASE6/branch-f"
git clone -q "$REMOTE6" "$BRANCH6F" 2>/dev/null
git -C "$BRANCH6F" checkout -q -b feature/con-162/CON-162-f origin/main
mkdir -p "$BRANCH6F/$CHANGE_DIR6"
cat > "$BRANCH6F/$CHANGE_DIR6/files-modified.md" <<'EOF'
- `own-file.txt` — feature work
EOF
echo "own work" > "$BRANCH6F/own-file.txt"
commit_all "$BRANCH6F" "executor commit (declaration + own file)"
# Remove the declaration from the worktree WITHOUT staging the deletion --
# the index still carries the committed blob.
rm "$BRANCH6F/$CHANGE_DIR6/files-modified.md"
# Stage an undeclared file: the enforced blob does not declare it.
echo "sneaky" > "$BRANCH6F/sneaky.txt"
git -C "$BRANCH6F" add sneaky.txt
OUT6F="$("$SCRIPT" "$BRANCH6F" origin main "CON-162 D4a enforcement" "$CHANGE_DIR6" 2>&1)"
RC6F=$?
if [ "$RC6F" -ne 0 ]; then
  ok "4.4b D4a still enforces the blob (undeclared staged file refused)"
else
  bad "4.4b D4a still enforces the blob (undeclared staged file refused)" "exit=0 output=$OUT6F"
fi
# Anchored to the "unexpected file" refusal reason, not merely to the
# filename appearing anywhere (the routine "Staged files:" listing above the
# refusal also contains sneaky.txt, so a bare grep for the filename would not
# actually pin that the blob was enforced as the refusal's cause).
if echo "$OUT6F" | grep -qi "exceeds the run's declared touched-file set" && echo "$OUT6F" | grep -qF "sneaky.txt"; then
  ok "4.4b refusal names the undeclared file as the cause"
else
  bad "4.4b refusal names the undeclared file as the cause" "output: $OUT6F"
fi

# --- 4.4c (CR1, round 2): staged blob present, NO worktree file, blob
# declares every staged path -- the script must COMMIT, proving the D7
# divergence detector was never reached on this path. ---
BRANCH6G="$BASE6/branch-g"
git clone -q "$REMOTE6" "$BRANCH6G" 2>/dev/null
git -C "$BRANCH6G" checkout -q -b feature/con-162/CON-162-g origin/main
mkdir -p "$BRANCH6G/$CHANGE_DIR6"
cat > "$BRANCH6G/$CHANGE_DIR6/files-modified.md" <<'EOF'
- `own-file.txt` — feature work
EOF
echo "own work" > "$BRANCH6G/own-file.txt"
commit_all "$BRANCH6G" "executor commit (declaration + own file)"
rm "$BRANCH6G/$CHANGE_DIR6/files-modified.md"
OUT6G="$("$SCRIPT" "$BRANCH6G" origin main "CON-162 D4a clean pass" "$CHANGE_DIR6" 2>&1)"
RC6G=$?
if [ "$RC6G" -eq 0 ]; then
  ok "4.4c D4a shape with a fully-declaring blob commits (divergence detector not reached)"
else
  bad "4.4c D4a shape with a fully-declaring blob commits (divergence detector not reached)" "exit=$RC6G output=$OUT6G"
fi

# --- 4.5 (regression): ordinary run, declaration identical in index and
# worktree, still commits normally. ---
BRANCH6H="$BASE6/branch-h"
git clone -q "$REMOTE6" "$BRANCH6H" 2>/dev/null
git -C "$BRANCH6H" checkout -q -b feature/con-162/CON-162-h origin/main
mkdir -p "$BRANCH6H/$CHANGE_DIR6"
cat > "$BRANCH6H/$CHANGE_DIR6/files-modified.md" <<'EOF'
- `own-file.txt` — feature work
EOF
echo "own work" > "$BRANCH6H/own-file.txt"
commit_all "$BRANCH6H" "executor commit (declaration + own file, consistent)"
OUT6H="$("$SCRIPT" "$BRANCH6H" origin main "CON-162 ordinary consistent run" "$CHANGE_DIR6" 2>&1)"
RC6H=$?
if [ "$RC6H" -eq 0 ]; then
  ok "4.5 ordinary consistent-declaration run still commits"
else
  bad "4.5 ordinary consistent-declaration run still commits" "exit=$RC6H output=$OUT6H"
fi

# ---------------------------------------------------------------------
# Scenario 7 (CON-164, tasks 2.1-2.6, 3.1-3.3): DRY_RUN=1 must run the full
# guard and report the same verdict without ever mutating the branch.
# ---------------------------------------------------------------------
echo "Scenario 7: DRY_RUN=1 consults the guard without committing"

BASE7="$(mktemp -d)"
REMOTE7="$BASE7/remote.git"

git init -q --bare "$REMOTE7"
git clone -q "$REMOTE7" "$BASE7/primary" 2>/dev/null
echo "root" > "$BASE7/primary/root.txt"
commit_all "$BASE7/primary" "init"
git -C "$BASE7/primary" branch -M main
git -C "$BASE7/primary" push -q origin main

CHANGE_DIR7="openspec/changes/con-164-dry-run-demo"

# --- 7a (task 2.1-2.3): passing fixture -- guard would pass. Prove
# DRY_RUN=1 exits 0, prints the dry-run marker, and mutates nothing. ---
BRANCH7A="$BASE7/branch-a"
git clone -q "$REMOTE7" "$BRANCH7A" 2>/dev/null
git -C "$BRANCH7A" checkout -q -b feature/con-164/CON-164-a origin/main
mkdir -p "$BRANCH7A/$CHANGE_DIR7"
cat > "$BRANCH7A/$CHANGE_DIR7/files-modified.md" <<'EOF'
- `own-file.txt` — feature work
EOF
echo "own work" > "$BRANCH7A/own-file.txt"
commit_all "$BRANCH7A" "executor commit (declaration + own file, consistent)"

HEAD_BEFORE7A="$(git -C "$BRANCH7A" rev-parse HEAD)"
TREE_BEFORE7A="$(git -C "$BRANCH7A" write-tree)"
STATUS_BEFORE7A="$(git -C "$BRANCH7A" status --porcelain)"
COUNT_BEFORE7A="$(git -C "$BRANCH7A" rev-list --count HEAD)"

OUT7A="$(DRY_RUN=1 "$SCRIPT" "$BRANCH7A" origin main "CON-164 dry run passing" "$CHANGE_DIR7" 2>&1)"
RC7A=$?

HEAD_AFTER7A="$(git -C "$BRANCH7A" rev-parse HEAD)"
TREE_AFTER7A="$(git -C "$BRANCH7A" write-tree)"
STATUS_AFTER7A="$(git -C "$BRANCH7A" status --porcelain)"
COUNT_AFTER7A="$(git -C "$BRANCH7A" rev-list --count HEAD)"

if [ "$RC7A" -eq 0 ]; then
  ok "2.3 DRY_RUN=1 on a passing fixture exits 0"
else
  bad "2.3 DRY_RUN=1 on a passing fixture exits 0" "exit=$RC7A output=$OUT7A"
fi
if [ "$HEAD_BEFORE7A" = "$HEAD_AFTER7A" ]; then
  ok "2.3 DRY_RUN=1 does not move HEAD"
else
  bad "2.3 DRY_RUN=1 does not move HEAD" "before=$HEAD_BEFORE7A after=$HEAD_AFTER7A"
fi
if [ "$TREE_BEFORE7A" = "$TREE_AFTER7A" ]; then
  ok "2.3 DRY_RUN=1 leaves the staged tree hash unchanged"
else
  bad "2.3 DRY_RUN=1 leaves the staged tree hash unchanged" "before=$TREE_BEFORE7A after=$TREE_AFTER7A"
fi
if [ "$STATUS_BEFORE7A" = "$STATUS_AFTER7A" ]; then
  ok "2.3 DRY_RUN=1 leaves git status --porcelain unchanged"
else
  bad "2.3 DRY_RUN=1 leaves git status --porcelain unchanged" "before=[$STATUS_BEFORE7A] after=[$STATUS_AFTER7A]"
fi
if [ "$COUNT_BEFORE7A" = "$COUNT_AFTER7A" ]; then
  ok "2.3 DRY_RUN=1 creates no squash commit (commit count unchanged)"
else
  bad "2.3 DRY_RUN=1 creates no squash commit (commit count unchanged)" "before=$COUNT_BEFORE7A after=$COUNT_AFTER7A"
fi
if echo "$OUT7A" | grep -qF "READY dry run: guard passed, nothing committed (DRY_RUN=1)"; then
  ok "2.3 DRY_RUN=1 output contains the dry-run marker"
else
  bad "2.3 DRY_RUN=1 output contains the dry-run marker" "output: $OUT7A"
fi
if echo "$OUT7A" | grep -qF "squash commit created"; then
  bad "2.3 DRY_RUN=1 output does not contain the wet 'squash commit created' wording" "output: $OUT7A"
else
  ok "2.3 DRY_RUN=1 output does not contain the wet 'squash commit created' wording"
fi

# --- 7b (task 2.4): refusal-path identity -- same fixture, run once with
# DRY_RUN=1 and once without; same exit code, same refusal diagnostic. Not
# cited as evidence dry-run mode exists (task 2.6): it passes vacuously
# against a script that ignores DRY_RUN entirely. 2.3 above is load-bearing.
# ---------------------------------------------------------------------
BRANCH7B_WET="$BASE7/branch-b-wet"
git clone -q "$REMOTE7" "$BRANCH7B_WET" 2>/dev/null
git -C "$BRANCH7B_WET" checkout -q -b feature/con-164/CON-164-b-wet origin/main
mkdir -p "$BRANCH7B_WET/$CHANGE_DIR7"
cat > "$BRANCH7B_WET/$CHANGE_DIR7/files-modified.md" <<'EOF'
- `declared-file.txt` — the only file this run declares
EOF
echo "declared" > "$BRANCH7B_WET/declared-file.txt"
echo "stray" > "$BRANCH7B_WET/stray-unrelated-file.txt"
commit_all "$BRANCH7B_WET" "executor commit (with an undeclared stray file)"
OUT7B_WET="$("$SCRIPT" "$BRANCH7B_WET" origin main "CON-164 refusal wet" "$CHANGE_DIR7" 2>&1)"
RC7B_WET=$?

BRANCH7B_DRY="$BASE7/branch-b-dry"
git clone -q "$REMOTE7" "$BRANCH7B_DRY" 2>/dev/null
git -C "$BRANCH7B_DRY" checkout -q -b feature/con-164/CON-164-b-dry origin/main
mkdir -p "$BRANCH7B_DRY/$CHANGE_DIR7"
cat > "$BRANCH7B_DRY/$CHANGE_DIR7/files-modified.md" <<'EOF'
- `declared-file.txt` — the only file this run declares
EOF
echo "declared" > "$BRANCH7B_DRY/declared-file.txt"
echo "stray" > "$BRANCH7B_DRY/stray-unrelated-file.txt"
commit_all "$BRANCH7B_DRY" "executor commit (with an undeclared stray file)"
OUT7B_DRY="$(DRY_RUN=1 "$SCRIPT" "$BRANCH7B_DRY" origin main "CON-164 refusal dry" "$CHANGE_DIR7" 2>&1)"
RC7B_DRY=$?

if [ "$RC7B_WET" -eq "$RC7B_DRY" ] && [ "$RC7B_DRY" -ne 0 ]; then
  ok "2.4 DRY_RUN=1 refusal exit code matches the wet refusal exit code"
else
  bad "2.4 DRY_RUN=1 refusal exit code matches the wet refusal exit code" "wet=$RC7B_WET dry=$RC7B_DRY"
fi
if [ "$OUT7B_WET" = "$OUT7B_DRY" ]; then
  ok "2.4 DRY_RUN=1 refusal diagnostic is byte-identical to the wet refusal diagnostic"
else
  bad "2.4 DRY_RUN=1 refusal diagnostic is byte-identical to the wet refusal diagnostic" "wet=[$OUT7B_WET] dry=[$OUT7B_DRY]"
fi

# --- 7c (task 2.5): exact-match semantics -- DRY_RUN=true must take the wet
# path and commit, proving no looser truthiness test was adopted. Uses its
# own fresh fixture so this commit does not make 7a's assertions
# order-dependent. ---
BRANCH7C="$BASE7/branch-c"
git clone -q "$REMOTE7" "$BRANCH7C" 2>/dev/null
git -C "$BRANCH7C" checkout -q -b feature/con-164/CON-164-c origin/main
mkdir -p "$BRANCH7C/$CHANGE_DIR7"
cat > "$BRANCH7C/$CHANGE_DIR7/files-modified.md" <<'EOF'
- `own-file-c.txt` — feature work
EOF
echo "own work" > "$BRANCH7C/own-file-c.txt"
commit_all "$BRANCH7C" "executor commit (declaration + own file, consistent)"

HEAD_BEFORE7C="$(git -C "$BRANCH7C" rev-parse HEAD)"
OUT7C="$(DRY_RUN=true "$SCRIPT" "$BRANCH7C" origin main "CON-164 truthy DRY_RUN" "$CHANGE_DIR7" 2>&1)"
RC7C=$?
HEAD_AFTER7C="$(git -C "$BRANCH7C" rev-parse HEAD)"

if [ "$RC7C" -eq 0 ] && [ "$HEAD_BEFORE7C" != "$HEAD_AFTER7C" ]; then
  ok "2.5 DRY_RUN=true (not exact-match '1') takes the wet path and commits"
else
  bad "2.5 DRY_RUN=true (not exact-match '1') takes the wet path and commits" "exit=$RC7C before=$HEAD_BEFORE7C after=$HEAD_AFTER7C output=$OUT7C"
fi
if echo "$OUT7C" | grep -qF "squash commit created"; then
  ok "2.5 DRY_RUN=true output is the wet success message"
else
  bad "2.5 DRY_RUN=true output is the wet success message" "output: $OUT7C"
fi

# --- 7d (tasks 3.1-3.2, D4a): failability proof -- mutate the real script to
# delete the dry-run early return, re-run the 2.3 passing fixture with
# DRY_RUN=1, and assert HEAD moved. Assert the mutation actually changed the
# file (task 3.1a) before trusting the result. Reuses the file's existing
# snapshot-and-trap machinery (PRISTINE_SCRIPT / restore_script / trap). ---
BRANCH7D="$BASE7/branch-d"
git clone -q "$REMOTE7" "$BRANCH7D" 2>/dev/null
git -C "$BRANCH7D" checkout -q -b feature/con-164/CON-164-d origin/main
mkdir -p "$BRANCH7D/$CHANGE_DIR7"
cat > "$BRANCH7D/$CHANGE_DIR7/files-modified.md" <<'EOF'
- `own-file-d.txt` — feature work
EOF
echo "own work" > "$BRANCH7D/own-file-d.txt"
commit_all "$BRANCH7D" "executor commit (declaration + own file, consistent)"

cp "$SCRIPT" "$SCRIPT.bak3.$$"
BEFORE_MUTATE_HASH="$(sha256sum "$SCRIPT" | cut -d' ' -f1)"
# Delete the dry-run early-return block: the marker line, its exit 0, and the
# guarding `if` block. Anchored on the marker string per task 3.1a.
python3 - "$SCRIPT" <<'PYEOF'
import sys
path = sys.argv[1]
with open(path) as f:
    lines = f.readlines()
marker_idx = None
for i, line in enumerate(lines):
    if "READY dry run:" in line:
        marker_idx = i
        break
assert marker_idx is not None, "dry-run marker line not found"
# The block is: if [ "$DRY_RUN_MODE" = "1" ]; then / echo marker / exit 0 / fi
start = marker_idx - 1
assert lines[start].strip().startswith("if"), lines[start]
end = marker_idx + 2
assert lines[end].strip() == "fi", lines[end]
del lines[start:end + 1]
with open(path, "w") as f:
    f.writelines(lines)
PYEOF
chmod +x "$SCRIPT"
AFTER_MUTATE_HASH="$(sha256sum "$SCRIPT" | cut -d' ' -f1)"

if [ "$BEFORE_MUTATE_HASH" != "$AFTER_MUTATE_HASH" ]; then
  ok "3.1a mutation actually changed the script file (hash before != after)"
else
  bad "3.1a mutation actually changed the script file (hash before != after)" "hash unchanged: $BEFORE_MUTATE_HASH"
fi

HEAD_BEFORE7D="$(git -C "$BRANCH7D" rev-parse HEAD)"
OUT7D_MUTATED="$(DRY_RUN=1 "$SCRIPT" "$BRANCH7D" origin main "CON-164 mutated should still commit" "$CHANGE_DIR7" 2>&1)"
RC7D_MUTATED=$?
HEAD_AFTER7D_MUTATED="$(git -C "$BRANCH7D" rev-parse HEAD)"

if [ "$RC7D_MUTATED" -eq 0 ] && [ "$HEAD_BEFORE7D" != "$HEAD_AFTER7D_MUTATED" ]; then
  ok "3.1 mutation-guarded no-mutation proof is failable: deleting the dry-run early return makes DRY_RUN=1 commit anyway (HEAD moved: before=$HEAD_BEFORE7D after=$HEAD_AFTER7D_MUTATED)"
else
  bad "3.1 mutation-guarded no-mutation proof is failable: deleting the dry-run early return makes DRY_RUN=1 commit anyway" "expected exit 0 with HEAD moved; got exit=$RC7D_MUTATED before=$HEAD_BEFORE7D after=$HEAD_AFTER7D_MUTATED output=$OUT7D_MUTATED"
fi

# Restore, then prove the restored real script does NOT move HEAD on the
# same fixture (task 3.2/3.3 transcript: mutated-moved vs restored-unchanged).
mv "$SCRIPT.bak3.$$" "$SCRIPT"
chmod +x "$SCRIPT"

BRANCH7D2="$BASE7/branch-d2"
git clone -q "$REMOTE7" "$BRANCH7D2" 2>/dev/null
git -C "$BRANCH7D2" checkout -q -b feature/con-164/CON-164-d2 origin/main
mkdir -p "$BRANCH7D2/$CHANGE_DIR7"
cat > "$BRANCH7D2/$CHANGE_DIR7/files-modified.md" <<'EOF'
- `own-file-d2.txt` — feature work
EOF
echo "own work" > "$BRANCH7D2/own-file-d2.txt"
commit_all "$BRANCH7D2" "executor commit (declaration + own file, consistent)"

HEAD_BEFORE7D2="$(git -C "$BRANCH7D2" rev-parse HEAD)"
OUT7D_RESTORED="$(DRY_RUN=1 "$SCRIPT" "$BRANCH7D2" origin main "CON-164 restored should not commit" "$CHANGE_DIR7" 2>&1)"
RC7D_RESTORED=$?
HEAD_AFTER7D2="$(git -C "$BRANCH7D2" rev-parse HEAD)"

if [ "$RC7D_RESTORED" -eq 0 ] && [ "$HEAD_BEFORE7D2" = "$HEAD_AFTER7D2" ]; then
  ok "3.2 restored real script leaves HEAD unchanged under DRY_RUN=1 after trap-restore"
else
  bad "3.2 restored real script leaves HEAD unchanged under DRY_RUN=1 after trap-restore" "exit=$RC7D_RESTORED before=$HEAD_BEFORE7D2 after=$HEAD_AFTER7D2 output=$OUT7D_RESTORED"
fi

# Task 3.3: the mutation transcript is committed, static evidence in the
# change directory (openspec/changes/squash-branch-dry-run-mode/mutation-
# transcript.txt) -- it is NOT regenerated on every ordinary test run. This
# suite is permanent; the change directory is not (it disappears once the
# change is archived), so writing into it unconditionally would dirty a
# tracked file on every `npm test` and, post-archive, would target a
# directory that no longer exists. Always compute the transcript to a
# throwaway temp file; only copy it into the change directory when a caller
# explicitly opts in via CON164_RECORD_TRANSCRIPT=1 (to deliberately
# regenerate the committed evidence), and even then, report -- rather than
# silently swallow via a failed redirect -- the case where the change
# directory is gone.
CON164_TRANSCRIPT_TMP="$(mktemp)"
{
  echo "CON-164 dry-run mutation-failability transcript"
  echo "================================================="
  echo
  echo "Mutated run (dry-run early return deleted from squash-branch.sh):"
  echo "  HEAD before: $HEAD_BEFORE7D"
  echo "  HEAD after:  $HEAD_AFTER7D_MUTATED"
  echo "  exit code:   $RC7D_MUTATED"
  echo "  HEAD moved:  $([ "$HEAD_BEFORE7D" != "$HEAD_AFTER7D_MUTATED" ] && echo yes || echo no)"
  echo
  echo "  --- output ---"
  echo "$OUT7D_MUTATED"
  echo "  --------------"
  echo
  echo "Restored run (pristine squash-branch.sh, same DRY_RUN=1 invocation shape):"
  echo "  HEAD before: $HEAD_BEFORE7D2"
  echo "  HEAD after:  $HEAD_AFTER7D2"
  echo "  exit code:   $RC7D_RESTORED"
  echo "  HEAD moved:  $([ "$HEAD_BEFORE7D2" != "$HEAD_AFTER7D2" ] && echo yes || echo no)"
  echo
  echo "  --- output ---"
  echo "$OUT7D_RESTORED"
  echo "  --------------"
} > "$CON164_TRANSCRIPT_TMP"

if [ "${CON164_RECORD_TRANSCRIPT:-0}" = "1" ]; then
  CON164_TRANSCRIPT_DEST="$ROOT/openspec/changes/squash-branch-dry-run-mode/mutation-transcript.txt"
  if [ -d "$(dirname "$CON164_TRANSCRIPT_DEST")" ]; then
    cp "$CON164_TRANSCRIPT_TMP" "$CON164_TRANSCRIPT_DEST"
    echo "  (CON164_RECORD_TRANSCRIPT=1: mutation transcript written to $CON164_TRANSCRIPT_DEST)"
  else
    echo "  INFO CON164_RECORD_TRANSCRIPT=1 set but $(dirname "$CON164_TRANSCRIPT_DEST") no longer exists (change likely archived) -- transcript left only at $CON164_TRANSCRIPT_TMP"
  fi
fi
rm -f "$CON164_TRANSCRIPT_TMP"

# ---------------------------------------------------------------------
echo ""
echo "squash-branch.test.sh: ${PASS} passed, ${FAIL} failed"
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
