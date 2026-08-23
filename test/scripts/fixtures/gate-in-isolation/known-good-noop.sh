#!/usr/bin/env bash
# Known-good reference script for test-gate-in-isolation.sh's own selftest
# (CON-132). Only reads state (never mutates it) -- the safe baseline the
# selftest asserts is detected as leaving the fixture intact.
set -uo pipefail
git status >/dev/null 2>&1 || true
echo "known-good: no-op"
