#!/usr/bin/env bash
# Known-bad reference script for test-gate-in-isolation.sh's own selftest
# (CON-132). Reproduces the CON-132 incident's exact mechanism: calls bare
# `git init` while GIT_DIR is exported (as Husky exports it for a commit
# from a linked worktree), which re-initialises whatever repo GIT_DIR
# points at — here, the disposable fixture's own main-repo — as bare.
set -uo pipefail
git init -q
