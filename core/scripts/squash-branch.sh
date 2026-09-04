#!/usr/bin/env bash
set -uo pipefail

# ===========================================================================
# squash-branch.sh — canonical, guarded Delivery-phase squash (CON-129).
#
# Fixes the incident where an improvised `git reset --soft origin/main`
# staged an 85-file revert of a sibling run's freshly-merged work: when the
# base ref advances mid-run, resetting against its LIVE TIP stages every
# intervening commit as a deletion. This script instead resets against the
# branch's TRUE MERGE-BASE (never the base ref's current tip), and refuses to
# commit if the staged set contains anything outside the run's own declared
# touched-file set.
#
# Usage:
#   squash-branch.sh <WORKTREE_PATH> <BASE_REMOTE> <BASE_BRANCH> <SUBJECT> \
#                     <CHANGE_DIR> [--allow-empty-declaration]
#
#   <WORKTREE_PATH>   path to the git worktree to operate in.
#   <BASE_REMOTE>     remote name the base branch lives on (e.g. origin).
#   <BASE_BRANCH>     base branch name (e.g. main).
#   <SUBJECT>         full commit message (subject + trailer) for the squash
#                     commit. Passed as a single argument; this script does
#                     not construct it.
#   <CHANGE_DIR>      the change directory, ALREADY SUBSTITUTED by the caller
#                     (e.g. openspec/changes/<name>, or whatever
#                     specProvider.changeDir resolves to for this project).
#                     NEVER hardcoded here: core/scripts/** is copied
#                     verbatim by lib/cli/emit.js with no variable
#                     substitution, while specProvider.changeDir is itself
#                     configurable (lib/cli/init.js emits a different default
#                     for specProvider.kind: 'none'). Mirrors
#                     next-report-number.sh's caller-passes-the-path
#                     convention.
#   --allow-empty-declaration   opt-in required when files-modified.md is
#                     missing, or parses to zero declared paths, while staged
#                     files outside the change-dir allowlist remain. Without
#                     it, that case is a loud stop, not a silent pass.
#
# Guard (design.md D2/D2a/D2b):
#   1. Reset target is ALWAYS `git merge-base --all HEAD <base-remote>/<base-
#      branch>` (D1) — never the base ref's tip directly. More than one
#      merge-base (criss-cross history) is a loud stop, not a guess.
#   2. Base-advancement is logged (commits between merge-base and base tip)
#      but never blocks or forces a rebase (D3) — D1 already makes the reset
#      safe regardless of how far the base advanced.
#   3. After `git reset --soft <merge-base>`, the staged file set
#      (`git diff --cached --name-only`) is compared against the union of:
#        (a) the fixed allowlist glob `<CHANGE_DIR>/**`
#        (b) paths parsed from `<CHANGE_DIR>/files-modified.md`, extracting
#            ONLY lines matching `^\s*[-*]\s*` followed by a backtick-quoted
#            path (D2a) — lines carrying no leading bullet are never scanned,
#            so a continuation line declares nothing. On a qualifying bullet
#            EVERY backtick-quoted, path-shaped span counts, not merely the
#            first (D2a-ii), so a grouped bullet declares all of its paths.
#            A span is path-shaped if it contains `/` or a dotted extension;
#            inline code spans on a bullet are therefore never treated as
#            paths.
#      Any staged path outside that union is a loud stop, no commit.
#      A missing/unparseable files-modified.md while staged files remain
#      outside the allowlist is ALSO a loud stop, unless
#      --allow-empty-declaration was passed.
#   4. The staged file count + full list is ALWAYS printed before any commit,
#      unconditionally — not only on guard failure.
#
# On any stop: prints a clear report, exits non-zero, commits nothing. On
# success: creates the squash commit and exits 0.
# ===========================================================================

WORKTREE_PATH="${1:?usage: squash-branch.sh <WORKTREE_PATH> <BASE_REMOTE> <BASE_BRANCH> <SUBJECT> <CHANGE_DIR> [--allow-empty-declaration]}"
BASE_REMOTE="${2:?usage: squash-branch.sh <WORKTREE_PATH> <BASE_REMOTE> <BASE_BRANCH> <SUBJECT> <CHANGE_DIR> [--allow-empty-declaration]}"
BASE_BRANCH="${3:?usage: squash-branch.sh <WORKTREE_PATH> <BASE_REMOTE> <BASE_BRANCH> <SUBJECT> <CHANGE_DIR> [--allow-empty-declaration]}"
SUBJECT="${4:?usage: squash-branch.sh <WORKTREE_PATH> <BASE_REMOTE> <BASE_BRANCH> <SUBJECT> <CHANGE_DIR> [--allow-empty-declaration]}"
CHANGE_DIR="${5:?usage: squash-branch.sh <WORKTREE_PATH> <BASE_REMOTE> <BASE_BRANCH> <SUBJECT> <CHANGE_DIR> [--allow-empty-declaration]}"
ALLOW_EMPTY_DECLARATION=0
if [ "${6:-}" = "--allow-empty-declaration" ]; then
  ALLOW_EMPTY_DECLARATION=1
fi

if [ ! -d "$WORKTREE_PATH" ]; then
  echo "FAIL worktree path does not exist: ${WORKTREE_PATH}" >&2
  exit 1
fi

BASE_REF="${BASE_REMOTE}/${BASE_BRANCH}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/git-child-env.sh
source "${SCRIPT_DIR}/lib/git-child-env.sh"

git_wt() { git_child -C "$WORKTREE_PATH" "$@"; }

# --- D1: compute the true merge-base, refuse to guess under criss-cross ---
MERGE_BASES="$(git_wt merge-base --all HEAD "$BASE_REF" 2>/dev/null)"
if [ -z "$MERGE_BASES" ]; then
  echo "FAIL could not compute merge-base between HEAD and ${BASE_REF}" >&2
  exit 1
fi
MERGE_BASE_COUNT="$(printf '%s\n' "$MERGE_BASES" | grep -c .)"
if [ "$MERGE_BASE_COUNT" -gt 1 ]; then
  echo "FAIL ambiguous merge-base (criss-cross history) between HEAD and ${BASE_REF}:" >&2
  printf '%s\n' "$MERGE_BASES" >&2
  echo "Refusing to guess which one is correct. Resolve manually." >&2
  exit 1
fi
MERGE_BASE="$MERGE_BASES"

# --- D3: log base advancement, never gate on it ---
BASE_TIP="$(git_wt rev-parse "$BASE_REF" 2>/dev/null || true)"
if [ -n "$BASE_TIP" ] && [ "$BASE_TIP" != "$MERGE_BASE" ]; then
  ADVANCED_COUNT="$(git_wt rev-list --count "${MERGE_BASE}..${BASE_TIP}" 2>/dev/null || echo "?")"
  echo "INFO base ${BASE_REF} has advanced ${ADVANCED_COUNT} commit(s) past the merge-base since this branch diverged (${MERGE_BASE}). Squashing against the merge-base, not the live tip."
else
  echo "INFO base ${BASE_REF} has not advanced past the merge-base."
fi

# --- D1: reset against the merge-base, never the base ref's live tip ---
if ! git_wt reset --soft "$MERGE_BASE" >/dev/null 2>&1; then
  echo "FAIL git reset --soft ${MERGE_BASE} failed" >&2
  exit 1
fi

# --- Staged file set ---
STAGED_FILES="$(git_wt diff --cached --name-only)"
STAGED_COUNT=0
if [ -n "$STAGED_FILES" ]; then
  STAGED_COUNT="$(printf '%s\n' "$STAGED_FILES" | grep -c .)"
fi

# --- D2: build allowlist = <CHANGE_DIR>/** union files-modified.md paths ---
# Normalize CHANGE_DIR: strip any trailing slash for consistent prefix match.
CHANGE_DIR_NORM="${CHANGE_DIR%/}"

FILES_MODIFIED_PATH="${WORKTREE_PATH%/}/${CHANGE_DIR_NORM}/files-modified.md"
DECLARED_PATHS=""
if [ -f "$FILES_MODIFIED_PATH" ]; then
  # D2a: only lines starting (after leading whitespace) with a markdown
  # bullet immediately followed by a backtick-quoted path qualify. Prose
  # lines, and continuation lines carrying no bullet, are never scanned.
  #
  # D2a-ii (CON-151): a qualifying bullet declares EVERY backtick-quoted
  # path on it, not just the first. The original single-capture sed
  # (`s/...`([^`]+)`.*/\1/`) silently dropped every path after the first on
  # a grouped bullet, so a declaration that looked complete parsed as
  # partial and the guard refused files the author had genuinely declared.
  # That direction is fail-closed (a loud refusal, never a silent pass), so
  # it cost runs time rather than safety -- but the fix must not overshoot
  # into over-declaring, which WOULD weaken the guard. Hence the path-shaped
  # filter below: a span counts only if it contains a `/` or a dotted
  # extension, so inline code spans on a bullet (`--allow-empty-declaration`,
  # `Option[T]`) cannot enter the allowlist.
  DECLARED_PATHS="$(grep -E '^[[:space:]]*[-*][[:space:]]*`[^`]+`' "$FILES_MODIFIED_PATH" \
    | grep -oE '`[^`]+`' \
    | tr -d '`' \
    | grep -E '(/|\.[A-Za-z0-9]+$)')"
fi
DECLARED_COUNT=0
if [ -n "$DECLARED_PATHS" ]; then
  DECLARED_COUNT="$(printf '%s\n' "$DECLARED_PATHS" | grep -c .)"
fi

is_allowed() {
  local f="$1"
  # (a) change-dir allowlist
  case "$f" in
    "${CHANGE_DIR_NORM}"/*|"${CHANGE_DIR_NORM}") return 0 ;;
  esac
  # (b) declared in files-modified.md
  if [ -n "$DECLARED_PATHS" ]; then
    while IFS= read -r d; do
      [ -z "$d" ] && continue
      if [ "$f" = "$d" ]; then
        return 0
      fi
    done <<< "$DECLARED_PATHS"
  fi
  return 1
}

UNEXPECTED=""
if [ -n "$STAGED_FILES" ]; then
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    if ! is_allowed "$f"; then
      UNEXPECTED="${UNEXPECTED}${f}
"
    fi
  done <<< "$STAGED_FILES"
fi

# --- Always print staged count + list before any commit ---
echo "Staged file count: ${STAGED_COUNT}"
if [ "$STAGED_COUNT" -gt 0 ]; then
  echo "Staged files:"
  printf '%s\n' "$STAGED_FILES" | sed 's/^/  /'
else
  echo "Staged files: (none)"
fi

# --- D2a/D2b: unparseable/missing declaration while unexpected files remain ---
if [ "$DECLARED_COUNT" -eq 0 ] && [ -n "$UNEXPECTED" ]; then
  if [ "$ALLOW_EMPTY_DECLARATION" -ne 1 ]; then
    echo "FAIL no usable declaration in files-modified.md while staged files remain outside the allowlist (${CHANGE_DIR_NORM}/**)." >&2
    if [ -f "$FILES_MODIFIED_PATH" ]; then
      echo "--- raw files-modified.md content ---" >&2
      cat "$FILES_MODIFIED_PATH" >&2
      echo "--------------------------------------" >&2
    else
      echo "(files-modified.md is missing at ${FILES_MODIFIED_PATH})" >&2
    fi
    echo "Staged paths outside the allowlist:" >&2
    printf '%s' "$UNEXPECTED" | sed 's/^/  /' >&2
    echo "Pass --allow-empty-declaration to proceed anyway, or append the real paths to files-modified.md and re-run." >&2
    exit 1
  fi
  # --allow-empty-declaration explicitly opts in for this case: proceed to
  # commit without the generic "unexpected staged file" hard stop below,
  # which exists to guard the case where a declaration WAS parseable.
else
  # --- Any staged path outside the allowed union is a hard stop ---
  if [ -n "$UNEXPECTED" ]; then
    echo "FAIL staged file set exceeds the run's declared touched-file set. Unexpected file(s):" >&2
    printf '%s' "$UNEXPECTED" | sed 's/^/  /' >&2
    echo "(allowed: ${CHANGE_DIR_NORM}/** plus paths declared in ${FILES_MODIFIED_PATH})" >&2
    echo "Declaration format: each path must be a backtick-quoted, path-shaped span on a line" >&2
    echo "starting with a '-' or '*' bullet. A grouped bullet may declare several paths and all" >&2
    echo "of them count, but a continuation line carrying no bullet declares nothing -- if a file" >&2
    echo "above looks already declared, check that its line actually starts with a bullet." >&2
    echo "Refusing to commit. Investigate before re-running." >&2
    exit 1
  fi
fi

# --- Guard passed: create the squash commit ---
if ! git_wt commit -q -m "$SUBJECT" >/dev/null 2>&1; then
  echo "FAIL git commit failed after guard passed" >&2
  exit 1
fi

echo "READY squash commit created on $(git_wt rev-parse --abbrev-ref HEAD 2>/dev/null || echo HEAD)"
exit 0
