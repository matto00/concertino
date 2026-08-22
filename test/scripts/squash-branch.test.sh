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

restore_script() {
  git -C "$ROOT" checkout -q -- "core/scripts/squash-branch.sh" 2>/dev/null || true
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

OUT2="$("$SCRIPT" "$BRANCH2" origin main "CON-129 should not commit" "$CHANGE_DIR2" 2>&1)"
RC2=$?
if [ "$RC2" -ne 0 ]; then ok "3.5 guard exits non-zero for an undeclared stray file"; else bad "3.5 guard exits non-zero for an undeclared stray file" "exit=0 output=$OUT2"; fi
if echo "$OUT2" | grep -qF "stray-unrelated-file.txt"; then
  ok "3.5 guard output names the unexpected file explicitly"
else
  bad "3.5 guard output names the unexpected file explicitly" "output: $OUT2"
fi
# No new commit should have been created: the guard trips AFTER the
# (already-performed) `reset --soft <merge-base>`, so HEAD is back at the
# merge-base (1 commit — "init") with the executor's work left staged, not
# committed. Confirm via the staged diff, not a commit that was never made.
COMMIT_COUNT2="$(git -C "$BRANCH2" rev-list --count HEAD)"
if [ "$COMMIT_COUNT2" -eq 1 ]; then
  ok "3.5 no squash commit was created on guard trip (HEAD still at merge-base)"
else
  bad "3.5 no squash commit was created on guard trip (HEAD still at merge-base)" "commit count=$COMMIT_COUNT2"
fi
if git -C "$BRANCH2" diff --cached --name-only | grep -qF "stray-unrelated-file.txt"; then
  ok "3.5 the stray file remains staged (uncommitted) after the guard trip"
else
  bad "3.5 the stray file remains staged (uncommitted) after the guard trip" "not found in staged diff"
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
OUT4A="$("$SCRIPT" "$BRANCH4A" origin main "CON-129 unparseable, no opt-in" "$CHANGE_DIR4" 2>&1)"
RC4A=$?
if [ "$RC4A" -ne 0 ]; then ok "3.7 unparseable declaration fails loudly without --allow-empty-declaration"; else bad "3.7 unparseable declaration fails loudly without --allow-empty-declaration" "exit=0 output=$OUT4A"; fi
if echo "$OUT4A" | grep -qF "outstanding-file.txt" && echo "$OUT4A" | grep -qi "190 files"; then
  ok "3.7 output includes both the raw declaration content and the outstanding staged path"
else
  bad "3.7 output includes both the raw declaration content and the outstanding staged path" "output: $OUT4A"
fi

BRANCH4B="$BASE4/branch-b"
make_branch4 "$BRANCH4B"
OUT4B="$("$SCRIPT" "$BRANCH4B" origin main "CON-129 unparseable, with opt-in" "$CHANGE_DIR4" --allow-empty-declaration 2>&1)"
RC4B=$?
if [ "$RC4B" -eq 0 ]; then ok "3.7 --allow-empty-declaration opts in and succeeds"; else bad "3.7 --allow-empty-declaration opts in and succeeds" "exit=$RC4B output=$OUT4B"; fi

# ---------------------------------------------------------------------
echo ""
echo "squash-branch.test.sh: ${PASS} passed, ${FAIL} failed"
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
