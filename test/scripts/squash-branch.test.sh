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
# Scenario 8 (CON-170, tasks 3.1-3.3): a pre-commit hook rejection after the
# guard passes must restore the branch, not strand it at the merge-base.
# Also proves hooks still run (D1/D5's double-duty fixture).
# ---------------------------------------------------------------------
echo "Scenario 8: commit failure after a passing guard restores the branch"

make_hook_rejecting_fixture() {
  # $1 = dest dir for the fixture repo (already created), $2 = change dir,
  # $3 = path (OUTSIDE the repo working tree) the hook marks to prove it
  # ran. Installs a rejecting pre-commit hook and a declared, guard-passing
  # commit. The marker lives outside the working tree so writing it never
  # perturbs `git status --porcelain` inside the fixture -- the hook's own
  # untracked-file side effect must not be conflated with the script's.
  local branch_dir="$1" change_dir="$2" marker_path="$3"
  mkdir -p "$branch_dir/$change_dir"
  cat > "$branch_dir/$change_dir/files-modified.md" <<EOF
- \`own-file.txt\` — feature work
EOF
  echo "own work" > "$branch_dir/own-file.txt"
  commit_all "$branch_dir" "executor commit (declaration + own file, consistent)"
  mkdir -p "$branch_dir/.git/hooks"
  # The script's `git commit` invocation redirects the child's stdout/stderr
  # to /dev/null, so proving the hook ran (D1/D5's second job for this
  # fixture) is asserted via a marker FILE the hook writes, not via captured
  # output.
  cat > "$branch_dir/.git/hooks/pre-commit" <<EOF
#!/bin/sh
touch "${marker_path}"
echo "pre-commit: rejecting on purpose (CON-170 fixture)" >&2
exit 1
EOF
  chmod +x "$branch_dir/.git/hooks/pre-commit"
}

BASE8="$(mktemp -d)"
REMOTE8="$BASE8/remote.git"
git init -q --bare "$REMOTE8"
git clone -q "$REMOTE8" "$BASE8/primary" 2>/dev/null
echo "root" > "$BASE8/primary/root.txt"
commit_all "$BASE8/primary" "init"
git -C "$BASE8/primary" branch -M main
git -C "$BASE8/primary" push -q origin main

CHANGE_DIR8="openspec/changes/con-170-restore-demo"
BRANCH8="$BASE8/branch-a"
git clone -q "$REMOTE8" "$BRANCH8" 2>/dev/null
git -C "$BRANCH8" checkout -q -b feature/con-170/CON-170-a origin/main
HOOK_MARKER8="$BASE8/.hook-ran-marker"
make_hook_rejecting_fixture "$BRANCH8" "$CHANGE_DIR8" "$HOOK_MARKER8"

HEAD_BEFORE8="$(git -C "$BRANCH8" rev-parse HEAD)"
TREE_BEFORE8="$(git -C "$BRANCH8" write-tree)"
STATUS_BEFORE8="$(git -C "$BRANCH8" status --porcelain)"
COUNT_BEFORE8="$(git -C "$BRANCH8" rev-list --count HEAD)"

OUT8="$("$SCRIPT" "$BRANCH8" origin main "CON-170 commit should fail" "$CHANGE_DIR8" 2>&1)"
RC8=$?

HEAD_AFTER8="$(git -C "$BRANCH8" rev-parse HEAD)"
TREE_AFTER8="$(git -C "$BRANCH8" write-tree)"
STATUS_AFTER8="$(git -C "$BRANCH8" status --porcelain)"
COUNT_AFTER8="$(git -C "$BRANCH8" rev-list --count HEAD)"

if [ "$RC8" -ne 0 ]; then ok "3.2 hook-rejected commit exits non-zero"; else bad "3.2 hook-rejected commit exits non-zero" "exit=$RC8 output=$OUT8"; fi
if [ "$HEAD_BEFORE8" = "$HEAD_AFTER8" ]; then
  ok "3.2 hook-rejected commit leaves HEAD unchanged (before=$HEAD_BEFORE8)"
else
  bad "3.2 hook-rejected commit leaves HEAD unchanged" "before=$HEAD_BEFORE8 after=$HEAD_AFTER8"
fi
if [ "$TREE_BEFORE8" = "$TREE_AFTER8" ]; then
  ok "3.2 hook-rejected commit leaves the staged tree hash unchanged"
else
  bad "3.2 hook-rejected commit leaves the staged tree hash unchanged" "before=$TREE_BEFORE8 after=$TREE_AFTER8"
fi
if [ "$STATUS_BEFORE8" = "$STATUS_AFTER8" ]; then
  ok "3.2 hook-rejected commit leaves git status --porcelain unchanged"
else
  bad "3.2 hook-rejected commit leaves git status --porcelain unchanged" "before=[$STATUS_BEFORE8] after=[$STATUS_AFTER8]"
fi
if [ "$COUNT_BEFORE8" = "$COUNT_AFTER8" ]; then
  ok "3.2 hook-rejected commit creates no new commit on the branch"
else
  bad "3.2 hook-rejected commit creates no new commit on the branch" "before=$COUNT_BEFORE8 after=$COUNT_AFTER8"
fi
if echo "$OUT8" | grep -qF "FAIL git commit failed after guard passed"; then
  ok "3.2 output names the commit failure"
else
  bad "3.2 output names the commit failure" "output: $OUT8"
fi
if echo "$OUT8" | grep -qF "Branch restored to pre-squash HEAD"; then
  ok "3.2 output names the restoration"
else
  bad "3.2 output names the restoration" "output: $OUT8"
fi
if [ -f "$HOOK_MARKER8" ]; then
  ok "3.1/D5 the fixture's pre-commit hook actually ran (proves hooks still fire, D1's argument)"
else
  bad "3.1/D5 the fixture's pre-commit hook actually ran" "marker file not found at $HOOK_MARKER8"
fi

# --- 3.3: failability -- mutate the real script to delete the explicit
# restore call, re-run the same fixture shape, assert HEAD IS the
# merge-base (the exact stranding this change fixes), then restore. ---
BRANCH8M="$BASE8/branch-mutation"
git clone -q "$REMOTE8" "$BRANCH8M" 2>/dev/null
git -C "$BRANCH8M" checkout -q -b feature/con-170/CON-170-mutation origin/main
make_hook_rejecting_fixture "$BRANCH8M" "$CHANGE_DIR8" "$BASE8/.hook-ran-marker-mutation"
MERGE_BASE8M="$(git -C "$BRANCH8M" merge-base HEAD origin/main)"

cp "$SCRIPT" "$SCRIPT.bak.$$"
python3 - "$SCRIPT" <<'PYEOF'
import sys
path = sys.argv[1]
with open(path) as f:
    text = f.read()
needle = (
    '  echo "FAIL git commit failed after guard passed" >&2\n'
    '  if restore_pre_squash_head; then\n'
    '    echo "Branch restored to pre-squash HEAD ${PRE_SQUASH_HEAD}." >&2\n'
    '  fi\n'
    '  exit 1\n'
)
replacement = (
    '  echo "FAIL git commit failed after guard passed" >&2\n'
    '  exit 1\n'
)
assert needle in text, "restore call not found -- fixture is stale against the real script"
text = text.replace(needle, replacement, 1)
# Also disarm the EXIT trap so the abnormal-termination mechanism (D2's
# second arming path) does not mask this mutation and produce a false pass.
text = text.replace("trap 'restore_pre_squash_head' EXIT\n", "", 1)
with open(path, "w") as f:
    f.write(text)
PYEOF
chmod +x "$SCRIPT"

OUT8M="$("$SCRIPT" "$BRANCH8M" origin main "CON-170 commit should fail (mutated)" "$CHANGE_DIR8" 2>&1)"
RC8M=$?
HEAD_AFTER8M="$(git -C "$BRANCH8M" rev-parse HEAD)"

mv "$SCRIPT.bak.$$" "$SCRIPT"
chmod +x "$SCRIPT"

if [ "$RC8M" -ne 0 ] && [ "$HEAD_AFTER8M" = "$MERGE_BASE8M" ]; then
  ok "3.3 restore is mutation-failable: deleting it reproduces the exact stranding at merge-base ($MERGE_BASE8M)"
else
  bad "3.3 restore is mutation-failable" "expected HEAD == merge-base ($MERGE_BASE8M) with non-zero exit; got exit=$RC8M head=$HEAD_AFTER8M output=$OUT8M"
fi

# ---------------------------------------------------------------------
# Scenario 9 (CON-170 D4 / CON-164 D6, task 3.4): empty prospective staged
# set -- guard passes, nothing staged, commit fails ("nothing to commit"),
# branch restored, no empty commit created.
#
# evaluation-4.md / skeptic-final-1.md CR1: an earlier version of this
# fixture had NO commits beyond origin/main, so merge-base == HEAD and the
# forward reset was a no-op -- HEAD could never move, so "branch restored
# (HEAD unchanged)" passed whether or not any restore existed (confirmed by
# the skeptic's full-revert probe: 8 assertions went red, Scenario 9's three
# stayed green). The fixture now genuinely diverges from the merge-base --
# two commits, the second of which `git rm`s everything the first added --
# so the tree is back to matching the merge-base (prospective staged set is
# still empty) while HEAD itself is two commits ahead. The forward reset is
# therefore a REAL, non-trivial ref movement, and the restore is load-bearing.
# ---------------------------------------------------------------------
echo "Scenario 9: empty staged set after guard passes restores the branch"

BASE9="$(mktemp -d)"
REMOTE9="$BASE9/remote.git"
git init -q --bare "$REMOTE9"
git clone -q "$REMOTE9" "$BASE9/primary" 2>/dev/null
echo "root" > "$BASE9/primary/root.txt"
commit_all "$BASE9/primary" "init"
git -C "$BASE9/primary" branch -M main
git -C "$BASE9/primary" push -q origin main

CHANGE_DIR9="openspec/changes/con-170-empty-demo"
BRANCH9="$BASE9/branch-a"
git clone -q "$REMOTE9" "$BRANCH9" 2>/dev/null
git -C "$BRANCH9" checkout -q -b feature/con-170/CON-170-empty origin/main
mkdir -p "$BRANCH9/$CHANGE_DIR9"
cat > "$BRANCH9/$CHANGE_DIR9/files-modified.md" <<'EOF'
- `own-file.txt` — feature work
EOF
echo "own work" > "$BRANCH9/own-file.txt"
commit_all "$BRANCH9" "executor commit (declared file added)"
git -C "$BRANCH9" rm -q "own-file.txt" "$CHANGE_DIR9/files-modified.md"
commit_all "$BRANCH9" "executor commit (same files removed -- tree back to merge-base, HEAD is not)"

MERGE_BASE9="$(git -C "$BRANCH9" merge-base HEAD origin/main)"
HEAD_BEFORE9="$(git -C "$BRANCH9" rev-parse HEAD)"
COUNT_BEFORE9="$(git -C "$BRANCH9" rev-list --count HEAD)"

# Sanity-check the fixture's own premise before trusting any assertion built
# on it: HEAD must genuinely differ from the merge-base, or the forward
# reset is a no-op and every "HEAD unchanged" assertion below is vacuous
# (exactly the defect this fixture is being rewritten to fix).
if [ "$HEAD_BEFORE9" != "$MERGE_BASE9" ]; then
  ok "3.4 fixture premise: HEAD genuinely differs from the merge-base (head=$HEAD_BEFORE9 merge-base=$MERGE_BASE9)"
else
  bad "3.4 fixture premise: HEAD genuinely differs from the merge-base" "head and merge-base are identical ($HEAD_BEFORE9) -- the forward reset would be a no-op and the assertions below would be vacuous"
fi

OUT9="$("$SCRIPT" "$BRANCH9" origin main "CON-170 empty staged set" "$CHANGE_DIR9" 2>&1)"
RC9=$?

HEAD_AFTER9="$(git -C "$BRANCH9" rev-parse HEAD)"
COUNT_AFTER9="$(git -C "$BRANCH9" rev-list --count HEAD)"

if [ "$RC9" -ne 0 ]; then ok "3.4 empty staged set commit failure exits non-zero"; else bad "3.4 empty staged set commit failure exits non-zero" "exit=$RC9 output=$OUT9"; fi
if [ "$HEAD_BEFORE9" = "$HEAD_AFTER9" ]; then
  ok "3.4 empty staged set: branch restored (HEAD unchanged, and genuinely could have moved: merge-base=$MERGE_BASE9)"
else
  bad "3.4 empty staged set: branch restored (HEAD unchanged)" "before=$HEAD_BEFORE9 after=$HEAD_AFTER9"
fi
if [ "$COUNT_BEFORE9" = "$COUNT_AFTER9" ]; then
  ok "3.4 empty staged set: no empty commit created"
else
  bad "3.4 empty staged set: no empty commit created" "before=$COUNT_BEFORE9 after=$COUNT_AFTER9"
fi

# --- Failability arm (skeptic-final-1.md CR1: "add a mutation arm ... or
# state which existing arm covers it" -- add one, matching 3.3/3.8's shape,
# since the empty-staged-set path is otherwise the only D2/D2a-covered
# no-strand assertion with no dedicated red). Reuse the same restore-deletion
# mutation as Scenario 8's 3.3 arm (same code path is exercised), against
# THIS fixture's genuinely-divergent branch. ---
BRANCH9M="$BASE9/branch-mutation"
git clone -q "$REMOTE9" "$BRANCH9M" 2>/dev/null
git -C "$BRANCH9M" checkout -q -b feature/con-170/CON-170-empty-mutation origin/main
mkdir -p "$BRANCH9M/$CHANGE_DIR9"
cat > "$BRANCH9M/$CHANGE_DIR9/files-modified.md" <<'EOF'
- `own-file.txt` — feature work
EOF
echo "own work" > "$BRANCH9M/own-file.txt"
commit_all "$BRANCH9M" "executor commit (declared file added)"
git -C "$BRANCH9M" rm -q "own-file.txt" "$CHANGE_DIR9/files-modified.md"
commit_all "$BRANCH9M" "executor commit (same files removed -- tree back to merge-base, HEAD is not)"
MERGE_BASE9M="$(git -C "$BRANCH9M" merge-base HEAD origin/main)"

cp "$SCRIPT" "$SCRIPT.bak.$$"
python3 - "$SCRIPT" <<'PYEOF'
import sys
path = sys.argv[1]
with open(path) as f:
    text = f.read()
needle = (
    '  echo "FAIL git commit failed after guard passed" >&2\n'
    '  if restore_pre_squash_head; then\n'
    '    echo "Branch restored to pre-squash HEAD ${PRE_SQUASH_HEAD}." >&2\n'
    '  fi\n'
    '  exit 1\n'
)
replacement = (
    '  echo "FAIL git commit failed after guard passed" >&2\n'
    '  exit 1\n'
)
assert needle in text, "restore call not found -- fixture is stale against the real script"
text = text.replace(needle, replacement, 1)
text = text.replace("trap 'restore_pre_squash_head' EXIT\n", "", 1)
with open(path, "w") as f:
    f.write(text)
PYEOF
MUTATED_HASH9="$(shasum -a 256 "$SCRIPT" 2>/dev/null | cut -d' ' -f1)"
PRISTINE_HASH9="$(shasum -a 256 "$SCRIPT.bak.$$" 2>/dev/null | cut -d' ' -f1)"
if [ -n "$MUTATED_HASH9" ] && [ "$MUTATED_HASH9" != "$PRISTINE_HASH9" ]; then
  ok "3.4 mutation actually changed the script file (hash before != after)"
else
  bad "3.4 mutation actually changed the script file (hash before != after)" "mutation did not take effect -- needle likely stale (skeptic-final-1.md non-blocking note)"
fi
chmod +x "$SCRIPT"

OUT9M="$("$SCRIPT" "$BRANCH9M" origin main "CON-170 empty staged set (mutated)" "$CHANGE_DIR9" 2>&1)"
RC9M=$?
HEAD_AFTER9M="$(git -C "$BRANCH9M" rev-parse HEAD)"

mv "$SCRIPT.bak.$$" "$SCRIPT"
chmod +x "$SCRIPT"

if [ "$RC9M" -ne 0 ] && [ "$HEAD_AFTER9M" = "$MERGE_BASE9M" ]; then
  ok "3.4 restore is mutation-failable on the empty-staged-set input: deleting it reproduces the exact stranding at merge-base ($MERGE_BASE9M)"
else
  bad "3.4 restore is mutation-failable on the empty-staged-set input" "expected HEAD == merge-base ($MERGE_BASE9M) with non-zero exit; got exit=$RC9M head=$HEAD_AFTER9M output=$OUT9M"
fi

# ---------------------------------------------------------------------
# Scenario 10 (task 3.5): success path is unaffected -- the squash commit is
# created and no restore/trap fires, guarding against a spurious misfire.
# ---------------------------------------------------------------------
echo "Scenario 10: successful squash is unaffected by the new restore machinery"

BASE10="$(mktemp -d)"
REMOTE10="$BASE10/remote.git"
git init -q --bare "$REMOTE10"
git clone -q "$REMOTE10" "$BASE10/primary" 2>/dev/null
echo "root" > "$BASE10/primary/root.txt"
commit_all "$BASE10/primary" "init"
git -C "$BASE10/primary" branch -M main
git -C "$BASE10/primary" push -q origin main

CHANGE_DIR10="openspec/changes/con-170-success-demo"
BRANCH10="$BASE10/branch-a"
git clone -q "$REMOTE10" "$BRANCH10" 2>/dev/null
git -C "$BRANCH10" checkout -q -b feature/con-170/CON-170-success origin/main
mkdir -p "$BRANCH10/$CHANGE_DIR10"
cat > "$BRANCH10/$CHANGE_DIR10/files-modified.md" <<'EOF'
- `own-file.txt` — feature work
EOF
echo "own work" > "$BRANCH10/own-file.txt"
commit_all "$BRANCH10" "executor commit (clean, no hook)"

HEAD_BEFORE10="$(git -C "$BRANCH10" rev-parse HEAD)"
OUT10="$("$SCRIPT" "$BRANCH10" origin main "CON-170 clean squash" "$CHANGE_DIR10" 2>&1)"
RC10=$?
HEAD_AFTER10="$(git -C "$BRANCH10" rev-parse HEAD)"

if [ "$RC10" -eq 0 ]; then ok "3.5 successful squash exits 0"; else bad "3.5 successful squash exits 0" "exit=$RC10 output=$OUT10"; fi
if [ "$HEAD_BEFORE10" != "$HEAD_AFTER10" ]; then
  ok "3.5 successful squash moves HEAD to the new squash commit"
else
  bad "3.5 successful squash moves HEAD to the new squash commit" "head unchanged: $HEAD_AFTER10"
fi
if echo "$OUT10" | grep -qF "squash commit created"; then
  ok "3.5 successful squash prints the READY confirmation"
else
  bad "3.5 successful squash prints the READY confirmation" "output: $OUT10"
fi
if echo "$OUT10" | grep -qF "Branch restored"; then
  bad "3.5 successful squash does not print a restore message (trap/explicit restore misfired)" "output: $OUT10"
else
  ok "3.5 successful squash does not print a restore message (no misfire)"
fi

# ---------------------------------------------------------------------
# Scenario 11 (task 3.6): DRY_RUN=1 still mutates nothing on a fixture whose
# wet run would fail at the commit (hook rejection).
# ---------------------------------------------------------------------
echo "Scenario 11: DRY_RUN=1 still mutates nothing on a fixture that would fail wet"

BASE11="$(mktemp -d)"
REMOTE11="$BASE11/remote.git"
git init -q --bare "$REMOTE11"
git clone -q "$REMOTE11" "$BASE11/primary" 2>/dev/null
echo "root" > "$BASE11/primary/root.txt"
commit_all "$BASE11/primary" "init"
git -C "$BASE11/primary" branch -M main
git -C "$BASE11/primary" push -q origin main

CHANGE_DIR11="openspec/changes/con-170-dry-run-fail-demo"
BRANCH11="$BASE11/branch-a"
git clone -q "$REMOTE11" "$BRANCH11" 2>/dev/null
git -C "$BRANCH11" checkout -q -b feature/con-170/CON-170-dry origin/main
make_hook_rejecting_fixture "$BRANCH11" "$CHANGE_DIR11" "$BASE11/.hook-ran-marker"

HEAD_BEFORE11="$(git -C "$BRANCH11" rev-parse HEAD)"
STATUS_BEFORE11="$(git -C "$BRANCH11" status --porcelain)"
OUT11="$(DRY_RUN=1 "$SCRIPT" "$BRANCH11" origin main "CON-170 dry run over a would-fail commit" "$CHANGE_DIR11" 2>&1)"
RC11=$?
HEAD_AFTER11="$(git -C "$BRANCH11" rev-parse HEAD)"
STATUS_AFTER11="$(git -C "$BRANCH11" status --porcelain)"

if [ "$RC11" -eq 0 ]; then ok "3.6 DRY_RUN=1 exits 0 even though the wet commit would fail"; else bad "3.6 DRY_RUN=1 exits 0 even though the wet commit would fail" "exit=$RC11 output=$OUT11"; fi
if [ "$HEAD_BEFORE11" = "$HEAD_AFTER11" ]; then
  ok "3.6 DRY_RUN=1 leaves HEAD unchanged"
else
  bad "3.6 DRY_RUN=1 leaves HEAD unchanged" "before=$HEAD_BEFORE11 after=$HEAD_AFTER11"
fi
if [ "$STATUS_BEFORE11" = "$STATUS_AFTER11" ]; then
  ok "3.6 DRY_RUN=1 leaves the index/worktree unchanged"
else
  bad "3.6 DRY_RUN=1 leaves the index/worktree unchanged" "before=[$STATUS_BEFORE11] after=[$STATUS_AFTER11]"
fi
if echo "$OUT11" | grep -qF "READY dry run: guard passed, nothing committed (DRY_RUN=1)"; then
  ok "3.6 DRY_RUN=1 output contains the dry-run marker"
else
  bad "3.6 DRY_RUN=1 output contains the dry-run marker" "output: $OUT11"
fi

# ---------------------------------------------------------------------
# Scenario 12 (task 3.7): the EXIT trap must be exercised actually firing --
# kill the script with SIGTERM while it is parked inside a slow pre-commit
# hook (after the forward reset, before the commit returns), and assert HEAD
# is restored to the pre-run commit rather than left at the merge-base.
# ---------------------------------------------------------------------
echo "Scenario 12: EXIT trap restores HEAD when the step is killed mid-commit"

make_slow_hook_fixture() {
  # $1 = dest dir, $2 = change dir, $3 = sleep seconds, $4 = marker file path
  # (OUTSIDE the repo working tree, same shape as Scenario 8's
  # make_hook_rejecting_fixture). The hook writes its own PID and the
  # sleep child's PID to sibling files, then touches the marker as its
  # last setup action before sleeping -- so once the marker exists, both
  # PID files are already populated and safe to read. The hook exits
  # non-zero after sleeping, so an orphaned late completion (round-2
  # skeptic note) can never accidentally commit and move HEAD on its own.
  #
  # evaluation-2.md CR1: an earlier version of this fixture embedded a
  # sentinel as a trailing shell `#` comment on the `sleep` line
  # (`sleep 20 # sentinel:...`). That comment is consumed by the hook's OWN
  # shell before `exec`-ing anything; neither the hook shell's argv
  # (`/bin/sh .git/hooks/pre-commit`, a RELATIVE path -- confirmed by direct
  # measurement, so a later attempt to match on the fixture's absolute path
  # would ALSO never match) nor the sleep child's argv (`sleep 20`) ever
  # carries a sentinel or the branch's path, so neither `pgrep -f` approach
  # can work here. Reaping is therefore done by exact PID, read from files
  # the hook itself writes, not by any command-line pattern match.
  local branch_dir="$1" change_dir="$2" sleep_secs="$3" marker_path="$4"
  mkdir -p "$branch_dir/$change_dir"
  cat > "$branch_dir/$change_dir/files-modified.md" <<EOF
- \`own-file.txt\` — feature work
EOF
  echo "own work" > "$branch_dir/own-file.txt"
  commit_all "$branch_dir" "executor commit (declaration + own file, consistent)"
  mkdir -p "$branch_dir/.git/hooks"
  cat > "$branch_dir/.git/hooks/pre-commit" <<EOF
#!/bin/sh
echo \$\$ > "${marker_path}.hookpid"
sleep ${sleep_secs} &
echo \$! > "${marker_path}.sleeppid"
touch "${marker_path}"
wait
exit 1
EOF
  chmod +x "$branch_dir/.git/hooks/pre-commit"
}

pid_still_owned_by() {
  # $1 = pid, $2 = substring expected in that pid's command line. Closes the
  # theoretical PID-reuse window flagged in evaluation-3.md's non-blocking
  # notes: the gap between a PID being recorded and this reap running is
  # well under a second in practice, but a bare `kill -TERM $pid` has no way
  # to tell "the process I recorded" from "an unrelated process the OS
  # reassigned that PID to in the meantime". Reads /proc/<pid>/cmdline where
  # available (Linux); falls back to `ps -o args=` elsewhere. A pid that is
  # no longer alive at all is treated as "not owned" (nothing to kill), not
  # an error.
  local pid="$1" expect="$2" cmdline=""
  if [ -r "/proc/$pid/cmdline" ]; then
    cmdline="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
  else
    cmdline="$(ps -p "$pid" -o args= 2>/dev/null || true)"
  fi
  case "$cmdline" in
    *"$expect"*) return 0 ;;
    *) return 1 ;;
  esac
}

reap_slow_hook_fixture() {
  # $1 = marker path used for make_slow_hook_fixture. Kills the hook shell
  # and its backgrounded sleep child by the exact PIDs the hook itself
  # recorded, not by any command-line pattern -- see make_slow_hook_fixture
  # for why a broad pattern match cannot work here. Each kill is additionally
  # gated on pid_still_owned_by, so a reused PID is never signalled.
  local marker_path="$1" hookpid sleeppid
  hookpid="$(cat "${marker_path}.hookpid" 2>/dev/null || true)"
  sleeppid="$(cat "${marker_path}.sleeppid" 2>/dev/null || true)"
  if [ -n "$sleeppid" ] && pid_still_owned_by "$sleeppid" "sleep"; then
    kill -TERM "$sleeppid" 2>/dev/null || true
  fi
  if [ -n "$hookpid" ] && pid_still_owned_by "$hookpid" "pre-commit"; then
    kill -TERM "$hookpid" 2>/dev/null || true
  fi
}

BASE12="$(mktemp -d)"
REMOTE12="$BASE12/remote.git"
git init -q --bare "$REMOTE12"
git clone -q "$REMOTE12" "$BASE12/primary" 2>/dev/null
echo "root" > "$BASE12/primary/root.txt"
commit_all "$BASE12/primary" "init"
git -C "$BASE12/primary" branch -M main
git -C "$BASE12/primary" push -q origin main

CHANGE_DIR12="openspec/changes/con-170-trap-demo"
BRANCH12="$BASE12/branch-a"
git clone -q "$REMOTE12" "$BRANCH12" 2>/dev/null
git -C "$BRANCH12" checkout -q -b feature/con-170/CON-170-trap origin/main
HOOK_MARKER12="$BASE12/.hook-started-marker"
make_slow_hook_fixture "$BRANCH12" "$CHANGE_DIR12" 20 "$HOOK_MARKER12"

HEAD_BEFORE12="$(git -C "$BRANCH12" rev-parse HEAD)"

"$SCRIPT" "$BRANCH12" origin main "CON-170 kill mid-commit" "$CHANGE_DIR12" >/tmp/con170-scenario12-out.$$ 2>&1 &
SCRIPT_PID12=$!

# Poll for the hook to actually be running (the script is parked inside
# `git commit`, blocked on the sleeping hook) rather than a fixed sleep, to
# avoid a flake if hook startup is slow on a loaded machine. Polls on a
# marker file the hook touches as its LAST setup action (after writing both
# PID files -- see make_slow_hook_fixture), not a process-table match -- see
# evaluation-2.md CR1 for why a command-line-embedded sentinel does not work
# here. evaluation-3.md non-blocking note: this comment previously said
# "first action", contradicting make_slow_hook_fixture's own comment; fixed
# to match the actual order, which is also the order that matters (marker
# present implies both PID files are already populated and safe to read).
WAITED12=0
while [ "$WAITED12" -lt 100 ]; do
  if [ -f "$HOOK_MARKER12" ]; then
    break
  fi
  sleep 0.1
  WAITED12=$((WAITED12 + 1))
done

# The predicate must actually have matched (evaluation-2.md: "assert the
# poll broke out early ... so that a future unmatchable predicate fails
# loudly instead of silently costing ten seconds and testing nothing").
# WAITED12 is in units of 0.1s; well under the 10s (100-iteration) timeout
# bound confirms the poll broke out on the marker rather than exhausting.
if [ -f "$HOOK_MARKER12" ] && [ "$WAITED12" -lt 90 ]; then
  ok "3.7 poll observed the hook starting and broke out early (waited ${WAITED12}00ms, well under the 10s bound)"
else
  bad "3.7 poll observed the hook starting and broke out early" "marker present=$([ -f "$HOOK_MARKER12" ] && echo yes || echo no) waited=${WAITED12}00ms"
fi

kill -TERM "$SCRIPT_PID12" 2>/dev/null || true
wait "$SCRIPT_PID12" 2>/dev/null
RC12=$?

# Round-2 skeptic note: killing the parent orphans the sleeping hook's `git
# commit` child. Reap it by the exact PIDs it recorded (see
# reap_slow_hook_fixture) so a late completion cannot commit after the
# assertion and produce an intermittent flake.
reap_slow_hook_fixture "$HOOK_MARKER12"

HEAD_AFTER12="$(git -C "$BRANCH12" rev-parse HEAD)"
rm -f "/tmp/con170-scenario12-out.$$"

if [ "$HEAD_BEFORE12" = "$HEAD_AFTER12" ]; then
  ok "3.7 EXIT trap restores HEAD when killed mid-commit (before=$HEAD_BEFORE12)"
else
  bad "3.7 EXIT trap restores HEAD when killed mid-commit" "before=$HEAD_BEFORE12 after=$HEAD_AFTER12 rc=$RC12"
fi

# --- 3.8: failability arm for the trap -- delete the trap installation
# line via the PRISTINE_SCRIPT snapshot machinery, re-run, assert HEAD IS at
# the merge-base, then restore. ---
BRANCH12M="$BASE12/branch-mutation"
git clone -q "$REMOTE12" "$BRANCH12M" 2>/dev/null
git -C "$BRANCH12M" checkout -q -b feature/con-170/CON-170-trap-mutation origin/main
HOOK_MARKER12M="$BASE12/.hook-started-marker-mutation"
make_slow_hook_fixture "$BRANCH12M" "$CHANGE_DIR12" 20 "$HOOK_MARKER12M"
MERGE_BASE12M="$(git -C "$BRANCH12M" merge-base HEAD origin/main)"

cp "$SCRIPT" "$SCRIPT.bak.$$"
python3 - "$SCRIPT" <<'PYEOF'
import sys
path = sys.argv[1]
with open(path) as f:
    text = f.read()
needle = "trap 'restore_pre_squash_head' EXIT\n"
assert needle in text, "trap installation line not found -- fixture is stale against the real script"
text = text.replace(needle, "", 1)
with open(path, "w") as f:
    f.write(text)
PYEOF
chmod +x "$SCRIPT"

"$SCRIPT" "$BRANCH12M" origin main "CON-170 kill mid-commit (mutated, no trap)" "$CHANGE_DIR12" >/tmp/con170-scenario12m-out.$$ 2>&1 &
SCRIPT_PID12M=$!

WAITED12M=0
while [ "$WAITED12M" -lt 100 ]; do
  if [ -f "$HOOK_MARKER12M" ]; then
    break
  fi
  sleep 0.1
  WAITED12M=$((WAITED12M + 1))
done

if [ -f "$HOOK_MARKER12M" ] && [ "$WAITED12M" -lt 90 ]; then
  ok "3.8 poll observed the hook starting and broke out early (waited ${WAITED12M}00ms, well under the 10s bound)"
else
  bad "3.8 poll observed the hook starting and broke out early" "marker present=$([ -f "$HOOK_MARKER12M" ] && echo yes || echo no) waited=${WAITED12M}00ms"
fi

kill -TERM "$SCRIPT_PID12M" 2>/dev/null || true
wait "$SCRIPT_PID12M" 2>/dev/null

reap_slow_hook_fixture "$HOOK_MARKER12M"

HEAD_AFTER12M="$(git -C "$BRANCH12M" rev-parse HEAD)"
rm -f "/tmp/con170-scenario12m-out.$$"

mv "$SCRIPT.bak.$$" "$SCRIPT"
chmod +x "$SCRIPT"

if [ "$HEAD_AFTER12M" = "$MERGE_BASE12M" ]; then
  ok "3.8 trap is mutation-failable: deleting the trap install reproduces the exact stranding at merge-base ($MERGE_BASE12M)"
else
  bad "3.8 trap is mutation-failable: deleting the trap install reproduces the exact stranding at merge-base" "expected HEAD == merge-base ($MERGE_BASE12M); got $HEAD_AFTER12M"
fi

# ---------------------------------------------------------------------
# Task 3.9 (CON-170 evaluation-1.md CR2): "the restore itself fails" DOES
# have a practical fixture -- the original claim that inducing a `git reset
# --soft` failure is "genuinely awkward" was false, and settling for
# grep-only verification is exactly what let CR1's false "Branch restored"
# claim through undetected. A `pre-commit` hook that creates the branch's
# own ref lock file before exiting 1 makes the forward `git commit` fail
# AND makes the restoring `git reset --soft` unable to lock that same ref,
# so the restore itself fails deterministically.
# ---------------------------------------------------------------------
echo "Scenario 13 / Task 3.9: restore-itself-fails is reported honestly, not as a false restoration"

BASE13="$(mktemp -d)"
REMOTE13="$BASE13/remote.git"
git init -q --bare "$REMOTE13"
git clone -q "$REMOTE13" "$BASE13/primary" 2>/dev/null
echo "root" > "$BASE13/primary/root.txt"
commit_all "$BASE13/primary" "init"
git -C "$BASE13/primary" branch -M main
git -C "$BASE13/primary" push -q origin main

CHANGE_DIR13="openspec/changes/con-170-restore-fails-demo"

make_restore_failure_fixture() {
  # $1 = dest dir, $2 = change dir, $3 = branch name. The hook locks the
  # branch's own ref (`refs/heads/<branch>.lock`) and then exits 1: the
  # forward reset already succeeded (moving the ref away), so `git commit`
  # fails on the lock, and the restoring `git reset --soft` back to
  # PRE_SQUASH_HEAD then ALSO fails because it cannot acquire the same lock.
  local branch_dir="$1" change_dir="$2" branch_name="$3"
  mkdir -p "$branch_dir/$change_dir"
  cat > "$branch_dir/$change_dir/files-modified.md" <<EOF
- \`own-file.txt\` — feature work
EOF
  echo "own work" > "$branch_dir/own-file.txt"
  commit_all "$branch_dir" "executor commit (declaration + own file, consistent)"
  mkdir -p "$branch_dir/.git/hooks"
  cat > "$branch_dir/.git/hooks/pre-commit" <<HOOK
#!/bin/sh
touch "\$(git rev-parse --git-dir)/refs/heads/${branch_name}.lock"
exit 1
HOOK
  chmod +x "$branch_dir/.git/hooks/pre-commit"
}

BRANCH13_NAME="feature/con-170/CON-170-restore-fails"
BRANCH13="$BASE13/branch-a"
git clone -q "$REMOTE13" "$BRANCH13" 2>/dev/null
git -C "$BRANCH13" checkout -q -b "$BRANCH13_NAME" origin/main
make_restore_failure_fixture "$BRANCH13" "$CHANGE_DIR13" "$BRANCH13_NAME"

HEAD_BEFORE13="$(git -C "$BRANCH13" rev-parse HEAD)"
MERGE_BASE13="$(git -C "$BRANCH13" merge-base HEAD origin/main)"

OUT13="$("$SCRIPT" "$BRANCH13" origin main "CON-170 restore itself fails" "$CHANGE_DIR13" 2>&1)"
RC13=$?
HEAD_AFTER13="$(git -C "$BRANCH13" rev-parse HEAD)"
rm -f "$BRANCH13/.git/refs/heads/${BRANCH13_NAME}.lock" 2>/dev/null || true

if [ "$RC13" -ne 0 ]; then ok "3.9 restore-itself-fails case exits non-zero"; else bad "3.9 restore-itself-fails case exits non-zero" "exit=$RC13 output=$OUT13"; fi
if echo "$OUT13" | grep -qF "could not restore HEAD to"; then
  ok "3.9 restore-itself-fails diagnostic reports the restore failure explicitly"
else
  bad "3.9 restore-itself-fails diagnostic reports the restore failure explicitly" "output: $OUT13"
fi
if echo "$OUT13" | grep -qF "Recover manually via the reflog"; then
  ok "3.9 restore-itself-fails diagnostic points at the reflog"
else
  bad "3.9 restore-itself-fails diagnostic points at the reflog" "output: $OUT13"
fi
# This is CR1's exact bug: the step must NOT claim a restoration that did
# not happen. HEAD is genuinely left at the merge-base here (the forward
# reset succeeded and the restore could not undo it), so this is the
# scenario the false-positive line was printing on.
if echo "$OUT13" | grep -qF "Branch restored to pre-squash HEAD"; then
  bad "3.9 restore-itself-fails does NOT claim a restoration that did not happen" "output: $OUT13"
else
  ok "3.9 restore-itself-fails does NOT claim a restoration that did not happen"
fi
if [ "$HEAD_AFTER13" = "$MERGE_BASE13" ]; then
  ok "3.9 restore-itself-fails: HEAD is genuinely at the merge-base (confirms the fixture actually induces the failure it claims to)"
else
  bad "3.9 restore-itself-fails: HEAD is genuinely at the merge-base" "expected merge-base=$MERGE_BASE13, got $HEAD_AFTER13"
fi

# --- Failability arm: with CR1's fix reverted (unconditional confirmation
# line restored), the "does NOT claim a restoration" assertion above must go
# red on this same fixture. ---
BRANCH13M="$BASE13/branch-mutation"
git clone -q "$REMOTE13" "$BRANCH13M" 2>/dev/null
git -C "$BRANCH13M" checkout -q -b "${BRANCH13_NAME}-mutation" origin/main
make_restore_failure_fixture "$BRANCH13M" "$CHANGE_DIR13" "${BRANCH13_NAME}-mutation"

cp "$SCRIPT" "$SCRIPT.bak.$$"
python3 - "$SCRIPT" <<'PYEOF'
import sys
path = sys.argv[1]
with open(path) as f:
    text = f.read()
fixed = (
    '  if restore_pre_squash_head; then\n'
    '    echo "Branch restored to pre-squash HEAD ${PRE_SQUASH_HEAD}." >&2\n'
    '  fi\n'
)
reverted = (
    '  restore_pre_squash_head\n'
    '  echo "Branch restored to pre-squash HEAD ${PRE_SQUASH_HEAD}." >&2\n'
)
assert fixed in text, "CR1's gated confirmation not found -- fixture is stale against the real script"
text = text.replace(fixed, reverted, 1)
with open(path, "w") as f:
    f.write(text)
PYEOF
chmod +x "$SCRIPT"

OUT13M="$("$SCRIPT" "$BRANCH13M" origin main "CON-170 restore itself fails (mutated, unconditional)" "$CHANGE_DIR13" 2>&1)"
rm -f "$BRANCH13M/.git/refs/heads/${BRANCH13_NAME}-mutation.lock" 2>/dev/null || true

mv "$SCRIPT.bak.$$" "$SCRIPT"
chmod +x "$SCRIPT"

if echo "$OUT13M" | grep -qF "Branch restored to pre-squash HEAD"; then
  ok "3.9 CR1 regression is mutation-failable: reverting the gate reproduces the false restoration claim"
else
  bad "3.9 CR1 regression is mutation-failable: reverting the gate reproduces the false restoration claim" "expected the false claim to reappear; output: $OUT13M"
fi

# ---------------------------------------------------------------------
echo ""
echo "squash-branch.test.sh: ${PASS} passed, ${FAIL} failed"
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
