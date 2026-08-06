#!/usr/bin/env bash
# Shell tests for scripts/concertino/check-agent-merge-permission.sh (CON-88
# agent-merge-permission-preflight): the deterministic PASS/FAIL check for
# the Claude Code permission grant `agentMerge.enabled: true` requires.
#
# All git/settings-file state is a throwaway scratch repo, never this
# checkout's own — mirrors check-merge-readiness.test.sh's `new_repo`-style
# isolation and its `ok/bad/check/has` helper shape.
set -uo pipefail

export NO_COLOR=1
unset FORCE_COLOR

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/core/scripts/check-agent-merge-permission.sh"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL $1"; echo "       $2"; }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected [$3] got [$2]"; fi; }
has()  { if grep -qF "$2" "$3" 2>/dev/null; then ok "$1"; else bad "$1" "expected to find [$2] in $3"; fi; }

echo "check-agent-merge-permission.sh (CON-88 agent-merge-permission-preflight)"

new_repo() {
  local d; d="$(mktemp -d)"
  git -C "$d" init -q -b main
  git -C "$d" -c user.email=t@t.test -c user.name=t commit -q --allow-empty -m init
  printf '%s' "$d"
}

write_settings() {
  # $1 = repo, $2.. = raw JSON body to write verbatim to .claude/settings.json
  local repo="$1"; shift
  mkdir -p "$repo/.claude"
  printf '%s' "$1" > "$repo/.claude/settings.json"
}

run_check() {
  # $1 = worktree path ; result on stdout, stderr captured to $ERR
  ERR="$(mktemp)"
  OUT="$("$SCRIPT" "$1" 2>"$ERR")"
  RC=$?
}

BOTH_RULES='{"permissions":{"allow":["Bash(gh pr merge:*)","Task(concertino-auditor)"]}}'
ONE_RULE='{"permissions":{"allow":["Bash(gh pr merge:*)"]}}'

# --- both rules present ------------------------------------------------------
REPO="$(new_repo)"
write_settings "$REPO" "$BOTH_RULES"
run_check "$REPO"
check "1.1 both rules present exits zero" "$RC" "0"
check "1.2 both rules present prints PASS" "$OUT" "PASS"
rm -rf "$REPO" "$ERR"

# --- one rule missing --------------------------------------------------------
REPO="$(new_repo)"
write_settings "$REPO" "$ONE_RULE"
run_check "$REPO"
check "2.1 one rule missing fails (non-zero exit)" "$([ "$RC" -ne 0 ] && echo nonzero || echo zero)" "nonzero"
has "2.2 one rule missing names the specific missing rule" "missing permission rule: Task(concertino-auditor)" "$ERR"
rm -rf "$REPO" "$ERR"

# --- both rules missing (empty allow) ----------------------------------------
REPO="$(new_repo)"
write_settings "$REPO" '{"permissions":{"allow":[]}}'
run_check "$REPO"
check "3.1 both rules missing fails (non-zero exit)" "$([ "$RC" -ne 0 ] && echo nonzero || echo zero)" "nonzero"
has "3.2 names Bash(gh pr merge:*) as missing" "missing permission rule: Bash(gh pr merge:*)" "$ERR"
has "3.3 names Task(concertino-auditor) as missing" "missing permission rule: Task(concertino-auditor)" "$ERR"
rm -rf "$REPO" "$ERR"

# --- settings.json missing entirely ------------------------------------------
REPO="$(new_repo)"
run_check "$REPO"
check "4.1 missing settings.json fails (non-zero exit)" "$([ "$RC" -ne 0 ] && echo nonzero || echo zero)" "nonzero"
has "4.2 missing settings.json names the reason, not a generic message" "no .claude/settings.json found" "$ERR"
rm -rf "$REPO" "$ERR"

# --- settings.json is not valid JSON -----------------------------------------
REPO="$(new_repo)"
mkdir -p "$REPO/.claude"
printf 'not valid json at all' > "$REPO/.claude/settings.json"
run_check "$REPO"
check "5.1 invalid JSON fails (non-zero exit)" "$([ "$RC" -ne 0 ] && echo nonzero || echo zero)" "nonzero"
has "5.2 invalid JSON names the parse failure" "not valid JSON" "$ERR"
rm -rf "$REPO" "$ERR"

# --- main checkout cannot be resolved ----------------------------------------
NOTAREPO="$(mktemp -d)"
run_check "$NOTAREPO"
check "6.1 not a git repo fails (non-zero exit)" "$([ "$RC" -ne 0 ] && echo nonzero || echo zero)" "nonzero"
has "6.2 not a git repo names the resolution failure" "could not resolve main checkout" "$ERR"
rm -rf "$NOTAREPO" "$ERR"

# --- invoked from a real worktree whose MAIN checkout carries the grant -----
# The load-bearing scenario this whole script exists for: a worktree has no
# .claude/ of its own (gitignored, never copied by setup-worktree.sh), but
# the check must still PASS because it resolves and reads the main
# checkout's settings.json, never the worktree's own.
REPO="$(new_repo)"
write_settings "$REPO" "$BOTH_RULES"
WT="$(mktemp -d)"
rmdir "$WT"
git -C "$REPO" worktree add -q -b agent-merge-check-branch "$WT" >/dev/null 2>&1
if [ ! -d "$WT/.claude" ]; then
  ok "7.1 worktree itself has no .claude/ (setup precondition holds)"
else
  bad "7.1 worktree itself has no .claude/ (setup precondition holds)" "found $WT/.claude — test setup is wrong"
fi
run_check "$WT"
check "7.2 checked from a worktree, main checkout's grant passes" "$RC" "0"
check "7.3 checked from a worktree, prints PASS" "$OUT" "PASS"
git -C "$REPO" worktree remove -f "$WT" >/dev/null 2>&1
rm -rf "$REPO" "$WT" "$ERR" 2>/dev/null

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
