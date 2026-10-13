#!/usr/bin/env bash
# CON-253: a consuming project may gitignore Concertino's rendered output and
# still give every delivery worktree all of it. `concertino sync` declares
# every path it rendered in scripts/concertino/.instrumentation-manifest.json
# (`rendered`); setup-worktree.sh copies each one git did not check out into
# the new worktree; assert-phase.sh setup checks every one is there.
#
# Every case drives the REAL `concertino sync` (bin/concertino) into a
# throwaway consumer git repo, then the RENDERED setup-worktree.sh /
# assert-phase.sh from that repo's own scripts/concertino/, exactly as a lane
# would. The set of paths a case expects in the worktree is derived from the
# filesystem (every file sync created), never from the manifest alone, so a
# manifest that under-reports cannot make these cases pass vacuously.
#
# Run: bash test/scripts/rendered-copy.test.sh
set -uo pipefail

# CON-181: scope every mktemp/mktemp -d call in this file to a scratch
# TMPDIR removed on exit -- see test/scripts/lib/tmp-scratch.sh.
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp-scratch.sh"
trap con181_cleanup_scratch EXIT

export NO_COLOR=1
unset FORCE_COLOR

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL $1"; echo "       $2"; }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected [$3] got [$2]"; fi; }

echo "rendered-copy.test.sh (CON-253: untracked rendered output reaches worktrees)"

# The setup (b) ignore block documented in docs/config-reference.md
# ("Rendered output"). Kept literally identical to the docs; case 0 checks
# that, so the documented block is the one actually exercised here.
IGNORE_BLOCK='# Concertino rendered output (`concertino sync`); setup-worktree.sh copies it into each worktree.
/.concertino/
/scripts/concertino/
/.claude/agents/concertino-*.md
/.claude/commands/concertino-*.md
/.codex/agents/concertino-*.toml
/.codex/prompts/concertino-*.md
/.codex/roles/concertino-*.md
/.opencode/agents/concertino-*.md
/.opencode/commands/concertino-*.md'

g() { git -C "$1" -c user.email=t@t.test -c user.name=t "${@:2}"; }

# new_consumer <gitignore-text> -> prints the repo path. A git repo on main
# with a committed .gitignore and a config rendering all three harnesses,
# no env files, no hooks (both would be noise here).
new_consumer() {
  local d; d="$(mktemp -d)"
  git -C "$d" init -q -b main
  printf '%s\n' "$1" > "$d/.gitignore"
  node -e '
    const fs = require("fs");
    const c = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    delete c["$schema"];
    c.harnesses = ["claude-code", "codex", "opencode"];
    c.worktree.envFiles = [];
    c.worktree.hooks = [];
    fs.writeFileSync(process.argv[2], JSON.stringify(c, null, 2) + "\n");
  ' "$ROOT/config/examples/generic.json" "$d/concertino.config.json"
  printf 'concertino.config.json\n' >> "$d/.gitignore"
  g "$d" add .gitignore
  g "$d" commit -q -m init
  printf '%s' "$d"
}

# Every regular file under $1 outside .git, repo-relative, sorted.
list_files() {
  ( cd "$1" && find . -path ./.git -prune -o -type f -print | sed 's|^\./||' | LC_ALL=C sort )
}

run_sync() {
  ( cd "$1" && node "$ROOT/bin/concertino" sync --out="$1" --config="$1/concertino.config.json" ) >/dev/null 2>&1
}

# run_setup <repo> <ticket> <branch>: the repo's own rendered script, run from
# the main checkout as the orchestrator does. stderr -> $SETUP_ERR.
SETUP_ERR=""
run_setup() {
  local errf; errf="$(mktemp)"
  ( cd "$1" && env -u CODEX_SANDBOX -u CODEX_SANDBOX_NETWORK_DISABLED -u OPENCODE CLAUDECODE=1 \
      "$1/scripts/concertino/setup-worktree.sh" "$2" "$3" ) >/dev/null 2>"$errf"
  local rc=$?
  SETUP_ERR="$(cat "$errf")"
  return $rc
}

write_pv_evidence() {
  mkdir -p "$1/.concertino/runs/$2/evidence"
  cat > "$1/.concertino/runs/$2/evidence/premise-validation.md" <<'EOF'
## Premise Validation

**Claims checked:** none
**Already-done scope:** none
**Sibling collisions:** none found
**Verdict:** no-drift
EOF
}

manifest_list() {
  node -e '
    try {
      const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
      for (const p of (m.rendered || [])) console.log(p);
    } catch (e) {}
  ' "$1/scripts/concertino/.instrumentation-manifest.json" | LC_ALL=C sort
}

# =============================================================================
# 0. the documented ignore block is the one this file exercises
# =============================================================================
DOC_BLOCK="$(awk '/^```gitignore$/{f=1;next} /^```$/{if(f){exit}} f' "$ROOT/docs/config-reference.md")"
check "0.1 docs/config-reference.md's setup (b) ignore block matches this test's" "$DOC_BLOCK" "$IGNORE_BLOCK"
case "$DOC_BLOCK" in
  *settings.json*|*AGENTS.md*|*opencode.json*|*config.toml*|*'/.claude/commands/'$'\n'*|*'/.claude/'$'\n'*)
    bad "0.2 the ignore block never names a shared (non-rendered-only) file" "$DOC_BLOCK" ;;
  *) ok "0.2 the ignore block never names a shared (non-rendered-only) file" ;;
esac

# =============================================================================
# 1. setup (b): rendered output gitignored and untracked -> every rendered
#    path is in the fresh worktree, byte-identical to the main checkout
# =============================================================================
REPO="$(new_consumer "$IGNORE_BLOCK")"
BEFORE="$(list_files "$REPO")"
run_sync "$REPO"
check "1.0 sync exits 0" "$?" "0"
# What sync created, measured on disk (not read from the manifest).
CREATED="$(LC_ALL=C comm -13 <(printf '%s\n' "$BEFORE") <(list_files "$REPO"))"
# AGENTS.md and opencode.json are shared merge targets (hand-authored content
# survives a re-sync), so a setup (b) project still tracks them, like
# .claude/settings.json. Commit them the way such a project would.
g "$REPO" add AGENTS.md opencode.json
g "$REPO" commit -q -m "shared harness files"
check "1.1 main checkout is clean after sync (rendered output is ignored)" "$(git -C "$REPO" status --porcelain)" ""
N_CREATED="$(printf '%s\n' "$CREATED" | grep -c .)"
if [ "$N_CREATED" -ge 40 ]; then ok "1.2 sync created $N_CREATED files (sanity: a real render)"; else bad "1.2 sync created a real render" "only $N_CREATED files"; fi
check "1.3 the manifest declares exactly the files sync created" "$(manifest_list "$REPO")" "$CREATED"

run_setup "$REPO" TEST-1 feat/test-1
RC=$?
check "1.4 setup-worktree.sh exits 0" "$RC" "0"
WT="$REPO/.concertino/worktrees/feat/test-1"
MISSING=(); DIFFERENT=()
while IFS= read -r p; do
  [ -z "$p" ] && continue
  if [ ! -f "$WT/$p" ]; then MISSING+=("$p")
  elif ! cmp -s "$REPO/$p" "$WT/$p"; then DIFFERENT+=("$p"); fi
done <<< "$CREATED"
check "1.5 every rendered path exists in the worktree (missing: ${#MISSING[@]})" "${MISSING[*]:-}" ""
check "1.6 every rendered path is byte-identical to the main checkout" "${DIFFERENT[*]:-}" ""
if [ -x "$WT/scripts/concertino/emit-event.sh" ] && [ -x "$WT/scripts/concertino/lib/git-child-env.selftest.sh" ]; then
  ok "1.7 copied scripts keep their executable bit"
else
  bad "1.7 copied scripts keep their executable bit" "$(ls -l "$WT/scripts/concertino/emit-event.sh" 2>&1)"
fi
check "1.8 the copies are invisible to git in the worktree (nothing for git add -A to sweep)" \
  "$(git -C "$WT" status --porcelain)" ""

# assert-phase.sh setup: the rendered-path postcondition.
write_pv_evidence "$REPO" TEST-1
OUT="$(cd "$REPO" && "$REPO/scripts/concertino/assert-phase.sh" setup "$WT" TEST-1 2>&1)"
check "1.9 assert-phase.sh setup passes with every rendered path present" "$OUT" "PASS setup"
rm -f "$WT/scripts/concertino/tui-attached.sh" "$WT/.claude/agents/concertino-skeptic.md"
ERR="$(cd "$REPO" && "$REPO/scripts/concertino/assert-phase.sh" setup "$WT" TEST-1 2>&1 >/dev/null)"
RC=$?
check "1.10 assert-phase.sh setup fails once a rendered path is gone from the worktree" "$RC" "1"
case "$ERR" in
  *"rendered path(s) missing from worktree"*".claude/agents/concertino-skeptic.md"*"scripts/concertino/tui-attached.sh"*)
    ok "1.11 the failure names every missing rendered path" ;;
  *) bad "1.11 the failure names every missing rendered path" "$ERR" ;;
esac

# Re-running setup for the reused worktree restores what was removed.
run_setup "$REPO" TEST-1 feat/test-1
check "1.12 re-running setup on a reused worktree exits 0" "$?" "0"
if cmp -s "$REPO/scripts/concertino/tui-attached.sh" "$WT/scripts/concertino/tui-attached.sh"; then
  ok "1.13 re-running setup restores a removed rendered path"
else
  bad "1.13 re-running setup restores a removed rendered path" "still missing or different"
fi

# =============================================================================
# 2. setup (a): rendered output tracked -> setup is unchanged; a tracked file
#    is never overwritten, even when the main checkout's copy differs
# =============================================================================
# Mirrors helio's tracked layout: .concertino/ ignored but laws force-added,
# the machine-local manifest ignored, everything else committed.
REPO="$(new_consumer '.concertino/
scripts/concertino/.instrumentation-manifest.json')"
run_sync "$REPO"
check "2.0 sync exits 0" "$?" "0"
g "$REPO" add -A
g "$REPO" add -f .concertino/laws .concertino/workflow-state.template.md
g "$REPO" commit -q -m "track rendered output"
check "2.1 main checkout is clean after committing the render" "$(git -C "$REPO" status --porcelain)" ""
# An uncommitted change to a tracked rendered file in the main checkout (a
# local re-render nobody committed yet). The lane must run what its branch
# has, exactly as before CON-253.
printf '\nLOCAL-UNCOMMITTED-EDIT\n' >> "$REPO/.claude/agents/concertino-executor.md"
printf '\nLOCAL-UNCOMMITTED-EDIT\n' >> "$REPO/.concertino/laws/README.md"
run_setup "$REPO" TEST-2 feat/test-2
check "2.2 setup-worktree.sh exits 0" "$?" "0"
WT="$REPO/.concertino/worktrees/feat/test-2"
check "2.3 a tracked rendered file is never overwritten (agent: committed bytes, not the main checkout's)" \
  "$(git -C "$REPO" show HEAD:.claude/agents/concertino-executor.md | cmp -s - "$WT/.claude/agents/concertino-executor.md" && echo committed || echo overwritten)" "committed"
check "2.4 a force-tracked file under an ignored dir is never overwritten either" \
  "$(git -C "$REPO" show HEAD:.concertino/laws/README.md | cmp -s - "$WT/.concertino/laws/README.md" && echo committed || echo overwritten)" "committed"
check "2.5 the worktree has no modified or untracked files" "$(git -C "$WT" status --porcelain)" ""
check "2.6 the ignored manifest is still copied in" \
  "$(cmp -s "$REPO/scripts/concertino/.instrumentation-manifest.json" "$WT/scripts/concertino/.instrumentation-manifest.json" && echo same || echo missing)" "same"
write_pv_evidence "$REPO" TEST-2
OUT="$(cd "$REPO" && "$REPO/scripts/concertino/assert-phase.sh" setup "$WT" TEST-2 2>&1)"
check "2.7 assert-phase.sh setup passes for a tracked render" "$OUT" "PASS setup"

# =============================================================================
# 3. loud failures: never a worktree that is silently missing scripts
# =============================================================================
fresh_b() {
  local r; r="$(new_consumer "$IGNORE_BLOCK")"
  run_sync "$r"
  g "$r" add AGENTS.md opencode.json
  g "$r" commit -q -m "shared harness files"
  printf '%s' "$r"
}
expect_loud_fail() {
  # $1 label, $2 repo, $3 ticket, $4 branch, $5 substring the error must carry
  run_setup "$2" "$3" "$4"
  local rc=$?
  if [ "$rc" -ne 0 ]; then ok "$1: setup exits non-zero"; else bad "$1: setup exits non-zero" "exit 0"; fi
  case "$SETUP_ERR" in
    *"$5"*) ok "$1: error names the problem" ;;
    *) bad "$1: error names the problem" "stderr: $SETUP_ERR" ;;
  esac
}

# 3.1 manifest missing
REPO="$(fresh_b)"
rm -f "$REPO/scripts/concertino/.instrumentation-manifest.json"
expect_loud_fail "3.1 missing manifest" "$REPO" TEST-31 feat/test-31 "render manifest missing"
case "$SETUP_ERR" in
  *'run `concertino sync` in the main checkout'*) ok "3.1 missing manifest: error says to run concertino sync in the main checkout" ;;
  *) bad "3.1 missing manifest: error says to run concertino sync in the main checkout" "$SETUP_ERR" ;;
esac
check "3.1 missing manifest: no worktree is created" "$([ -e "$REPO/.concertino/worktrees/feat/test-31" ] && echo created || echo none)" "none"

# 3.2 manifest names a path absent from the main checkout
REPO="$(fresh_b)"
rm -f "$REPO/scripts/concertino/squash-branch.sh"
expect_loud_fail "3.2 missing source path" "$REPO" TEST-32 feat/test-32 "scripts/concertino/squash-branch.sh"
case "$SETUP_ERR" in
  *'run `concertino sync` in the main checkout'*) ok "3.2 missing source path: error says to run concertino sync in the main checkout" ;;
  *) bad "3.2 missing source path: error says to run concertino sync in the main checkout" "$SETUP_ERR" ;;
esac
check "3.2 missing source path: no worktree is created" "$([ -e "$REPO/.concertino/worktrees/feat/test-32" ] && echo created || echo none)" "none"

# 3.3 a manifest from a sync that predates the rendered-path list
REPO="$(fresh_b)"
node -e '
  const fs = require("fs"); const p = process.argv[1];
  const m = JSON.parse(fs.readFileSync(p, "utf8")); delete m.rendered;
  fs.writeFileSync(p, JSON.stringify(m));
' "$REPO/scripts/concertino/.instrumentation-manifest.json"
expect_loud_fail "3.3 manifest without a rendered list" "$REPO" TEST-33 feat/test-33 "has no \`rendered\` path list"

# 3.4 an untracked rendered path that is NOT gitignored: copying it would put
#     rendered output in the next `git add -A`, so setup refuses and names it.
REPO="$(new_consumer "$(printf '%s\n' "$IGNORE_BLOCK" | grep -v '^/.claude/commands/')")"
run_sync "$REPO"
g "$REPO" add AGENTS.md opencode.json
g "$REPO" commit -q -m "shared harness files"
expect_loud_fail "3.4 untracked and unignored rendered path" "$REPO" TEST-34 feat/test-34 ".claude/commands/concertino-deliver.md"
case "$SETUP_ERR" in
  *"neither tracked nor gitignored"*) ok "3.4 untracked and unignored: error says why" ;;
  *) bad "3.4 untracked and unignored: error says why" "$SETUP_ERR" ;;
esac

echo ""
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
