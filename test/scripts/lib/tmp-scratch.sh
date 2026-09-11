#!/usr/bin/env bash
# CON-181: shared scratch-TMPDIR helper for test/scripts/*.test.sh.
#
# Every bare `mktemp` / `mktemp -d` call in these suites honors $TMPDIR.
# Sourcing this file redirects TMPDIR to a fresh, empty scratch directory for
# the lifetime of this test file's process. That means every mktemp call
# anywhere in the sourcing script -- regardless of what variable it assigns
# to -- lands inside this one scratch dir, so it can all be removed as a
# single group without touching each call site.
#
# This file does NOT install a trap itself, because several suites already
# install their own `trap ... EXIT` for other cleanup (killing background
# processes, restoring HEAD, removing specific mock dirs, ...) and a second
# `trap ... EXIT` would silently replace the first rather than compose with
# it (bash traps are last-write-wins, not additive).
#
# - A script with NO existing EXIT trap should add, right after sourcing
#   this file:
#       trap con181_cleanup_scratch EXIT
# - A script that already has an EXIT trap/cleanup function should call
#   con181_cleanup_scratch from inside that existing handler instead.

CON181_SCRATCH_TMPDIR="$(mktemp -d "${TMPDIR:-/tmp}/concertino-test-scratch.XXXXXX")"
export TMPDIR="$CON181_SCRATCH_TMPDIR"

con181_cleanup_scratch() {
  rm -rf "$CON181_SCRATCH_TMPDIR" 2>/dev/null || true
}
