# git-child-env.sh — hermetic environment for child `git` invocations (bash).
#
# WHY THIS EXISTS
# ---------------
# Git exports repo-locating variables (GIT_DIR, GIT_INDEX_FILE,
# GIT_WORK_TREE, GIT_COMMON_DIR, GIT_OBJECT_DIRECTORY,
# GIT_ALTERNATE_OBJECT_DIRECTORIES, ...) into hook subprocesses. From a
# LINKED WORKTREE the exported GIT_DIR is absolute
# (<repo>/.git/worktrees/<name>) and beats `-C <dir>`/cwd-based discovery
# unconditionally. A script that targets a different directory via `-C` or
# cwd still operates on the REAL repository if it inherits a poisoned
# GIT_DIR. Ported into core/ by CON-133 from a consuming project's own
# incident (a fixture `git init`, run as a live hook child, re-initialised
# the real repo as bare via an inherited GIT_DIR) — see this file's
# selftest for the reproduction.
#
# This mirrors `scripts/lib/git-child-env.mjs`'s `nonGitChildEnv`: a
# GIT_*-namespace PREFIX STRIP, not an enumerated denylist. The first fix to
# this class of bug was a six-name denylist that missed
# GIT_AUTHOR_DATE/GIT_COMMITTER_DATE/GIT_CONFIG_PARAMETERS within hours.
# Denylists fail open; a prefix strip catches every GIT_*-namespaced
# variable, including ones nobody has thought of yet.
#
# Usage: source this file, then call `git_child` wherever a bare `git`
# invocation would otherwise be used:
#
#   source "${SCRIPT_DIR}/lib/git-child-env.sh"
#   git_child -C "$REPO_ROOT" rev-parse --show-toplevel
#
# `git_child` runs in a `()` subshell (not `{ }`) so the `unset` never leaks
# into the caller's own environment — only the one child `git` invocation
# loses its GIT_* variables.
git_child() (
  unset -v $(compgen -v GIT_ 2>/dev/null) 2>/dev/null || true
  exec git "$@"
)
