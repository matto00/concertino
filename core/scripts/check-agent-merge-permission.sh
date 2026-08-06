#!/usr/bin/env bash
set -uo pipefail

# ===========================================================================
# check-agent-merge-permission.sh — deterministic check for the Claude Code
# permission grant `agentMerge.enabled: true` requires (CON-88).
#
# Usage:
#   check-agent-merge-permission.sh <WORKTREE_PATH>
#
# `agentMerge.enabled: true` alone is not evidence Claude Code's auto-mode
# permission classifier can see — the classifier only reads the harness's
# own permission surface, `.claude/settings.json`. `concertino sync`
# maintains the grant there (lib/cli/emit.js's emitClaude); this script is
# the deterministic checker both `concertino doctor`/`concertino validate`
# (lib/config.js's checkAgentMergePermission) and the orchestrator's
# pre-auditor-spawn check (core/roles/orchestrator.md,
# {{block:agentMergePermissionCheck}}) call to find out whether it's
# actually there.
#
# The two required rule strings are hardcoded here in shell rather than
# `require()`-d from lib/config.js's agentMergePermissionRules() — no shared
# runtime between Node and the shell scripts in this suite (see
# resolve-speed.sh/speeds.json for the same reason). Keep the two lists in
# sync by hand; see agentMergePermissionRules()'s own comment for the other
# two places that must match.
#
# Reads `<main_checkout>/.claude/settings.json` — NEVER
# `<WORKTREE_PATH>/.claude/settings.json` directly. `.claude/settings.json`
# is written only by `concertino sync`, which targets the main checkout, and
# is gitignored, so a freshly created worktree never has its own copy (see
# design.md Decision 2 of the agent-merge-permission-preflight change). The
# main checkout is resolved FROM WORKTREE_PATH the exact way
# check-merge-readiness.sh already does.
#
# Prints "PASS" and exits 0 only when the main checkout resolves, its
# .claude/settings.json exists, parses as JSON, and its permissions.allow
# array contains BOTH required rule strings. Otherwise prints one
# "FAIL <reason>" line per missing rule (or a resolution/parse failure) to
# stderr and exits non-zero — the same stdout/stderr contract
# assert-phase.sh/check-merge-readiness.sh already use. A missing or
# unparseable settings file, or an unresolvable main checkout, is a FAIL,
# never a silent pass.
# ===========================================================================

WORKTREE_PATH="${1:?usage: check-agent-merge-permission.sh <WORKTREE_PATH>}"

REQUIRED_RULES=(
  'Bash(gh pr merge:*)'
  'Task(concertino-auditor)'
)

FAILED=0
fail() {
  echo "FAIL $*" >&2
  FAILED=1
  return 0
}

if [ ! -d "$WORKTREE_PATH" ]; then
  echo "FAIL worktree dir missing: ${WORKTREE_PATH}" >&2
  exit 1
fi

# Resolve the main checkout FROM WORKTREE_PATH. Duplicated from
# check-merge-readiness.sh's main_checkout() rather than sourced — every
# procedure script in this suite stays standalone (see that script's own
# comment on why, and emit-event.sh's identical duplication of the same
# helper for the same reason).
main_checkout() {
  local common
  common="$(cd "$WORKTREE_PATH" 2>/dev/null && git rev-parse --git-common-dir 2>/dev/null)" || return 1
  [ -z "$common" ] && return 1
  case "$common" in
    /*) ;;
     *) common="$(cd "$WORKTREE_PATH" 2>/dev/null && cd "$common" 2>/dev/null && pwd)" || return 1 ;;
  esac
  ( cd "$(dirname "$common")" 2>/dev/null && pwd ) || return 1
}

ROOT="$(main_checkout)"
if [ -z "${ROOT:-}" ]; then
  echo "FAIL could not resolve main checkout (not inside a git repo?)" >&2
  exit 1
fi

SETTINGS="${ROOT}/.claude/settings.json"
if [ ! -f "$SETTINGS" ]; then
  echo "FAIL no .claude/settings.json found at ${SETTINGS}" >&2
  exit 1
fi

if ! jq -e . "$SETTINGS" >/dev/null 2>&1; then
  echo "FAIL .claude/settings.json is not valid JSON: ${SETTINGS}" >&2
  exit 1
fi

for rule in "${REQUIRED_RULES[@]}"; do
  present="$(jq --arg r "$rule" '[.permissions.allow[]? | select(. == $r)] | length > 0' "$SETTINGS" 2>/dev/null)"
  if [ "$present" != "true" ]; then
    fail "missing permission rule: ${rule}"
  fi
done

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi
echo "PASS"
