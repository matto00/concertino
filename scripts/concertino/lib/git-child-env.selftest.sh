#!/usr/bin/env bash
set -euo pipefail

# ===========================================================================
# git-child-env.selftest.sh — regression test for scripts/concertino/lib/
# git-child-env.sh's `git_child` GIT_*-prefix strip.
#
# Simulates the exact linked-worktree-hook detonation mechanism: a "poisoned" hook
# environment (the six repo-locating GIT_* variables pointing at an
# unrelated repo) inherited by a script that targets a DIFFERENT directory
# via `-C`/cwd. Asserts:
#   1. A bare `git` call under the poisoned env IS misdirected onto the
#      poisoned repo (proves the simulation is real, not vacuous).
#   2. The same call routed through `git_child` is NOT misdirected — it
#      still targets the intended directory.
#   3. Each of the four concertino scripts' actual `git_child`-wrapped call
#      sites resolves the intended repo under the same poisoned env.
#
# NOT wired into `.husky/pre-commit` (see npm script comment in
# package.json) and deliberately named outside the `check:` namespace the
# hook enumerates verbatim — a `check:`-prefixed name would invite a future
# author to append it to the hook, at which point this selftest's own
# fixture-building would run as a real hook child under a real poisoned
# GIT_DIR, the exact incident this file exists to prevent from recurring.
#
# CRITICAL: every fixture/poison repo here lives under `mktemp -d`. Never
# run any experiment against this real repository.
# ===========================================================================

# First executable statement: strip GIT_* from THIS process's own
# environment before building any fixture or exporting the simulated
# poisoned environment below. This is the exact HEL-657 mechanism (a
# fixture-building script inheriting a real poisoned GIT_DIR) — the
# selftest itself must not get a second chance to fall into it.
unset -v $(compgen -v GIT_ 2>/dev/null) 2>/dev/null || true

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONCERTINO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/git-child-env.sh"

FAILURES=0
fail() {
  echo "FAIL: $*" >&2
  FAILURES=$((FAILURES + 1))
}
pass() {
  echo "PASS: $*"
}

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

TARGET_REPO="${WORK}/target"
POISONED_REPO="${WORK}/poisoned"
mkdir -p "$TARGET_REPO" "$POISONED_REPO"

git -C "$TARGET_REPO" init --quiet
git -C "$TARGET_REPO" config user.email "selftest@example.com"
git -C "$TARGET_REPO" config user.name "selftest"

git -C "$POISONED_REPO" init --quiet
git -C "$POISONED_REPO" config user.email "selftest@example.com"
git -C "$POISONED_REPO" config user.name "selftest"

# Simulate a hook-exported poisoned environment: the six repo-locating
# GIT_* variables, absolute, pointing at the POISONED repo — mirroring what
# git exports into hook subprocesses from a linked worktree.
poison_env() {
  export GIT_DIR="${POISONED_REPO}/.git"
  export GIT_WORK_TREE="${POISONED_REPO}"
  export GIT_INDEX_FILE="${POISONED_REPO}/.git/index"
  export GIT_COMMON_DIR="${POISONED_REPO}/.git"
  export GIT_OBJECT_DIRECTORY="${POISONED_REPO}/.git/objects"
  export GIT_ALTERNATE_OBJECT_DIRECTORIES=""
}
unpoison_env() {
  unset -v $(compgen -v GIT_ 2>/dev/null) 2>/dev/null || true
}

# --- Dual-arm assertion: bare git IS misdirected, git_child is NOT --------

echo "--- dual-arm assertion ---"

( poison_env
  git -C "$TARGET_REPO" commit --allow-empty -m "bare-git arm" --quiet
) || true

if [ -n "$(git -C "$POISONED_REPO" log --oneline 2>/dev/null || true)" ]; then
  pass "bare 'git -C \$TARGET_REPO' under poisoned env WAS misdirected onto the poisoned repo (simulation is non-vacuous)"
else
  fail "bare 'git -C \$TARGET_REPO' under poisoned env did NOT reach the poisoned repo — simulation is not exercising the bug"
fi

if [ -n "$(git -C "$TARGET_REPO" log --oneline 2>/dev/null || true)" ]; then
  fail "bare 'git -C \$TARGET_REPO' under poisoned env unexpectedly reached the target repo too"
fi

# Reset both repos to a clean, commit-free state before the git_child arm.
rm -rf "${TARGET_REPO}/.git" "${POISONED_REPO}/.git"
git -C "$TARGET_REPO" init --quiet
git -C "$TARGET_REPO" config user.email "selftest@example.com"
git -C "$TARGET_REPO" config user.name "selftest"
git -C "$POISONED_REPO" init --quiet
git -C "$POISONED_REPO" config user.email "selftest@example.com"
git -C "$POISONED_REPO" config user.name "selftest"

( poison_env
  git_child -C "$TARGET_REPO" commit --allow-empty -m "git_child arm" --quiet
) || true

if [ -n "$(git -C "$TARGET_REPO" log --oneline 2>/dev/null || true)" ]; then
  pass "'git_child -C \$TARGET_REPO' under poisoned env correctly targeted the target repo"
else
  fail "'git_child -C \$TARGET_REPO' under poisoned env did NOT reach the target repo"
fi

if [ -n "$(git -C "$POISONED_REPO" log --oneline 2>/dev/null || true)" ]; then
  fail "'git_child -C \$TARGET_REPO' under poisoned env leaked onto the poisoned repo"
else
  pass "'git_child -C \$TARGET_REPO' under poisoned env did not touch the poisoned repo"
fi

unpoison_env

# --- Exercise the four scripts' actual git_child-wrapped call sites -------

echo "--- exercising actual call sites under poisoned env ---"

# assert-phase.sh: exercises `git_child -C <worktree> status --porcelain`
# (and rev-parse) indirectly via its 'delivery' phase check. We call it
# directly against the wrapped helper the script itself sources, rather
# than re-deriving new git plumbing, since assert-phase.sh's own logic is
# out of scope here — only that ITS git_child calls resolve correctly.
rm -rf "${TARGET_REPO}/.git" "${POISONED_REPO}/.git"
git -C "$TARGET_REPO" init --quiet
git -C "$TARGET_REPO" config user.email "selftest@example.com"
git -C "$TARGET_REPO" config user.name "selftest"
git -C "$TARGET_REPO" commit --allow-empty -m "seed" --quiet
git -C "$POISONED_REPO" init --quiet

( poison_env
  RESULT="$(git_child -C "$TARGET_REPO" status --porcelain)"
  if [ -z "$RESULT" ]; then
    exit 0
  else
    exit 1
  fi
) && pass "assert-phase.sh-style 'git_child -C \$TARGET_REPO status' resolved the target repo under poisoned env" \
  || fail "assert-phase.sh-style 'git_child -C \$TARGET_REPO status' did not resolve the target repo under poisoned env"

# cleanup.sh / setup-worktree.sh / start-servers.sh all share the same
# pattern: `git_child rev-parse --show-toplevel` (cwd-based, no -C) and
# `git_child -C <dir> ...`. Confirm the cwd-based form also resolves
# correctly under the poisoned env.
( poison_env
  cd "$TARGET_REPO"
  TOPLEVEL="$(git_child rev-parse --show-toplevel)"
  # Resolve symlinks on both sides (mktemp dirs may be under /tmp -> /private/tmp).
  REAL_TARGET="$(cd "$TARGET_REPO" && pwd -P)"
  REAL_TOPLEVEL="$(cd "$TOPLEVEL" && pwd -P)"
  [ "$REAL_TOPLEVEL" = "$REAL_TARGET" ]
) && pass "cleanup.sh/setup-worktree.sh/start-servers.sh-style cwd-based 'git_child rev-parse --show-toplevel' resolved the target repo under poisoned env" \
  || fail "cwd-based 'git_child rev-parse --show-toplevel' did not resolve the target repo under poisoned env"

# setup-worktree.sh's CONCERTINO_WORKTREE_HOOKS loop: confirm the eval site
# pattern (cd || exit 0; strip; eval) also resolves the target repo, not the
# poisoned one. This mirrors setup-worktree.sh's actual line verbatim (see
# skeptic-final-1.md / HEL-805 cycle 2): a failed cd must unconditionally
# skip the eval, and the GIT_* strip must run unconditionally (independent
# of cd's exit status) whenever cd DID succeed — a `cd && unset || true;
# eval` sequencing bug previously let eval run in the caller's cwd, still
# poisoned, whenever cd failed.
rm -f "${WORK}/hook-output"
( poison_env
  hook='git rev-parse --show-toplevel > "'"${WORK}"'/hook-output"'
  ( cd "$TARGET_REPO" || exit 0; unset -v $(compgen -v GIT_ 2>/dev/null) 2>/dev/null; eval "$hook" >/dev/null 2>&1 ) || true
)
if [ -f "${WORK}/hook-output" ]; then
  HOOK_TOPLEVEL="$(cat "${WORK}/hook-output")"
  REAL_TARGET="$(cd "$TARGET_REPO" && pwd -P)"
  REAL_HOOK_TOPLEVEL="$(cd "$HOOK_TOPLEVEL" && pwd -P)"
  if [ "$REAL_HOOK_TOPLEVEL" = "$REAL_TARGET" ]; then
    pass "setup-worktree.sh CONCERTINO_WORKTREE_HOOKS eval-site strip resolved the target repo under poisoned env"
  else
    fail "setup-worktree.sh CONCERTINO_WORKTREE_HOOKS eval-site strip resolved the wrong repo under poisoned env"
  fi
else
  fail "setup-worktree.sh CONCERTINO_WORKTREE_HOOKS eval-site strip produced no output"
fi

# cd-failure path: when the target directory does not exist, the eval must
# NEVER run at all (not in the target, not in the caller's cwd) — a failed
# cd must not let the hook execute unguarded in the (still-poisoned) caller
# cwd. This is the exact regression skeptic-final-1.md caught: the original
# `cd && unset || true; eval` sequencing let a failed cd short-circuit the
# unset too, so eval ran in the caller's cwd (the real repo root) with
# GIT_* still poisoned.
NONEXISTENT_DIR="${WORK}/does-not-exist"
rm -f "${WORK}/hook-output" "${WORK}/cwd-hook-output"
( poison_env
  cd "$TARGET_REPO"
  hook='pwd > "'"${WORK}"'/cwd-hook-output"; git rev-parse --show-toplevel > "'"${WORK}"'/hook-output" 2>/dev/null || true'
  ( cd "$NONEXISTENT_DIR" || exit 0; unset -v $(compgen -v GIT_ 2>/dev/null) 2>/dev/null; eval "$hook" >/dev/null 2>&1 ) || true
)
if [ -f "${WORK}/cwd-hook-output" ] || [ -f "${WORK}/hook-output" ]; then
  fail "setup-worktree.sh CONCERTINO_WORKTREE_HOOKS eval-site pattern ran the hook despite a failed cd (target dir did not exist) — eval must be unconditionally skipped on cd failure"
else
  pass "setup-worktree.sh CONCERTINO_WORKTREE_HOOKS eval-site pattern correctly skipped the hook entirely when cd failed"
fi

# --- Confirm the four scripts actually source the helper and use git_child

echo "--- static wiring check ---"
for f in assert-phase.sh cleanup.sh setup-worktree.sh start-servers.sh; do
  path="${CONCERTINO_DIR}/${f}"
  if ! grep -q 'source "${SCRIPT_DIR}/lib/git-child-env.sh"' "$path"; then
    fail "${f} does not source lib/git-child-env.sh"
    continue
  fi
  if grep -qE '^\s*(if |elif |while )?git (-C|rev-parse|worktree|show-ref|fetch|status|merge|update-ref|log)|\$\(git (-C|rev-parse|worktree|show-ref|fetch|status|merge|update-ref|log)' "$path"; then
    fail "${f} still contains a bare (unwrapped) git invocation"
  else
    pass "${f} sources the helper and has no remaining bare git invocations"
  fi
done

# Regression guard for the cycle-2 cd/eval sequencing bug (skeptic-final-1.md
# / skeptic-final-2.md): the eval-site test cases above exercise an INLINE
# COPY of setup-worktree.sh's CONCERTINO_WORKTREE_HOOKS pattern, which does
# not by itself catch a regression in the real file (skeptic-final-2.md
# demonstrated this: reverting only the real line to the buggy
# `cd ... && unset ... || true; eval ...` form, selftest untouched, still
# passed "ALL PASS"). Assert directly against setup-worktree.sh's real
# line: cd "$WORKTREE_PATH" || exit 0 (not gated behind &&), followed by
# unset -v $(compgen -v GIT_ ..., followed by eval "$hook", in that order,
# on one line, so a regression in the actual shipped script — even one
# that never touches this selftest — fails this check.
SETUP_WORKTREE="${CONCERTINO_DIR}/setup-worktree.sh"
HOOK_LINE="$(grep -F 'eval "$hook"' "$SETUP_WORKTREE" || true)"
if [ -z "$HOOK_LINE" ]; then
  fail "setup-worktree.sh: could not find the CONCERTINO_WORKTREE_HOOKS eval line at all"
elif printf '%s' "$HOOK_LINE" | grep -qF 'cd "$WORKTREE_PATH" || exit 0' \
  && printf '%s' "$HOOK_LINE" | grep -qE 'cd "\$WORKTREE_PATH" \|\| exit 0;.*unset -v \$\(compgen -v GIT_.*;.*eval "\$hook"'; then
  pass "setup-worktree.sh's real CONCERTINO_WORKTREE_HOOKS eval line matches the fixed cd-||-exit-0/unset/eval sequencing (not gated behind &&)"
else
  fail "setup-worktree.sh's real CONCERTINO_WORKTREE_HOOKS eval line does NOT match the fixed sequencing — found: ${HOOK_LINE}"
fi

echo "---"
if [ "$FAILURES" -eq 0 ]; then
  echo "git-child-env.selftest.sh: ALL PASS"
  exit 0
else
  echo "git-child-env.selftest.sh: ${FAILURES} FAILURE(S)"
  exit 1
fi
