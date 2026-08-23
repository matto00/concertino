#!/usr/bin/env bash
set -uo pipefail

# ===========================================================================
# check-gate-chain-change.sh — mechanically classifies a branch's diff as
# touching the target repo's commit-gate chain.
#
# Usage:
#   check-gate-chain-change.sh <WORKTREE_PATH> <BASE_REF> [TICKET_ID]
#
# <BASE_REF> is anything `git merge-base HEAD <BASE_REF>` accepts (a plain
# branch name, `origin/main`, a SHA, ...). [TICKET_ID] is accepted for
# call-site symmetry with the other procedure scripts but is not currently
# used by this script itself.
#
# A diff is "gate-chain-touching" (CON-132, design.md Decision 1) when it
# changes:
#   - any path under `.husky/`, or
#   - a script FILE referenced from `.husky/pre-commit`'s own command list,
#     resolved through `package.json`'s `scripts` map (a plain `npm run
#     <name>` / `npm test` reference to a script whose command names a
#     file-shaped token).
#
# Resolution is a small, dependency-free bash+node routine (this repo already
# requires node) — NOT a shell parser. Known limitation, documented rather
# than silently downgraded: an unusual `.husky/pre-commit` invocation style
# (a script invoked some way other than a plain `npm run <name>` /
# `npm test` reference to a `package.json` `scripts` entry naming a file
# path) is a false negative here. Scope is deliberately the incident's own
# class (`.husky/**` + hook-invoked scripts), not a general live-infra
# detector — see design.md's Non-Goals / Risks sections.
#
# Output (stdout):
#   GATECHAIN yes|no
#   HUSKY <path>     -- one line per changed path under .husky/ (yes only)
#   SCRIPT <path>    -- one line per changed, hook-invoked script FILE path
#                        (yes only) -- this is the set that needs its own
#                        isolation-test evidence (design.md Decision 2/3).
#
# Exit 0 always on a successful classification (yes or no is not a failure);
# non-zero only on a real inability to classify (missing worktree, git
# failure).
# ===========================================================================

WORKTREE_PATH="${1:?usage: check-gate-chain-change.sh <WORKTREE_PATH> <BASE_REF> [TICKET_ID]}"
BASE_REF="${2:?usage: check-gate-chain-change.sh <WORKTREE_PATH> <BASE_REF> [TICKET_ID]}"
# TICKET_ID (arg 3) intentionally unused today; accepted for call-site symmetry.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/lib/git-child-env.sh"

if [ ! -d "$WORKTREE_PATH" ]; then
  echo "FAIL worktree dir missing: ${WORKTREE_PATH}" >&2
  exit 1
fi

MERGE_BASE="$(git_child -C "$WORKTREE_PATH" merge-base HEAD "$BASE_REF" 2>/dev/null)" || MERGE_BASE=""
if [ -n "$MERGE_BASE" ]; then
  CHANGED_FILES="$(git_child -C "$WORKTREE_PATH" diff --name-only "${MERGE_BASE}...HEAD" 2>/dev/null)"
else
  # No resolvable merge-base (e.g. BASE_REF unreachable in this fixture/test
  # repo) — fall back to a direct two-dot diff against BASE_REF itself
  # rather than failing outright.
  CHANGED_FILES="$(git_child -C "$WORKTREE_PATH" diff --name-only "${BASE_REF}" HEAD 2>/dev/null)"
  if [ -z "$CHANGED_FILES" ]; then
    echo "FAIL could not resolve diff for ${WORKTREE_PATH} against ${BASE_REF}" >&2
    exit 1
  fi
fi

# Resolve the set of hook-invoked script FILE paths: read .husky/pre-commit
# (if present), extract `npm run <name>` / `npm test` references, resolve
# each through package.json's "scripts" map, and pull out any file-shaped
# token from the resulting command.
resolve_hook_scripts() {
  node -e '
    const fs = require("fs");
    const path = require("path");
    const worktree = process.argv[1];

    let hookText = "";
    try {
      hookText = fs.readFileSync(path.join(worktree, ".husky", "pre-commit"), "utf8");
    } catch (e) {
      process.exit(0); // no hook file -> no hook-invoked scripts
    }

    let pkg = {};
    try {
      pkg = JSON.parse(fs.readFileSync(path.join(worktree, "package.json"), "utf8"));
    } catch (e) {
      // no/unparseable package.json -> nothing resolvable
    }
    const scripts = (pkg && pkg.scripts) || {};

    const names = new Set();
    const re = /\bnpm\s+(?:run(?:-script)?\s+([A-Za-z0-9:_-]+)|(test)\b)/g;
    let m;
    while ((m = re.exec(hookText))) {
      names.add(m[1] || "test");
    }

    const filePaths = new Set();
    for (const name of names) {
      const cmd = scripts[name];
      if (!cmd) continue;
      for (const tok of cmd.split(/\s+/)) {
        if (/^(npm|npx|node|bash|sh|--.*)$/.test(tok)) continue;
        if (/[\/.]/.test(tok)) {
          filePaths.add(tok.replace(/^\.\//, ""));
        }
      }
    }
    for (const f of filePaths) process.stdout.write(f + "\n");
  ' "$WORKTREE_PATH"
}

HOOK_SCRIPTS="$(resolve_hook_scripts)"

FLAGGED=0
HUSKY_LINES=""
SCRIPT_LINES=""

while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in
    .husky/*)
      FLAGGED=1
      HUSKY_LINES="${HUSKY_LINES}HUSKY ${f}"$'\n'
      ;;
  esac
  if [ -n "$HOOK_SCRIPTS" ]; then
    while IFS= read -r hs; do
      [ -z "$hs" ] && continue
      if [ "$f" = "$hs" ]; then
        FLAGGED=1
        SCRIPT_LINES="${SCRIPT_LINES}SCRIPT ${f}"$'\n'
      fi
    done <<< "$HOOK_SCRIPTS"
  fi
done <<< "$CHANGED_FILES"

if [ "$FLAGGED" -eq 1 ]; then
  echo "GATECHAIN yes"
  printf '%s' "$HUSKY_LINES"
  printf '%s' "$SCRIPT_LINES"
else
  echo "GATECHAIN no"
fi
