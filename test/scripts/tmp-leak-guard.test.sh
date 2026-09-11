#!/usr/bin/env bash
# CON-181 guard: every test/*.test.js file, and every test/scripts/*.test.sh
# file, that creates a temp directory/file must route it through the shared
# cleanup mechanism -- test/support/tmp.js's mkTmpDir() for node tests,
# test/scripts/lib/tmp-scratch.sh for shell tests -- rather than calling
# fs.mkdtempSync(os.tmpdir(), ...) / bare `mktemp` directly and leaking it.
#
# This is a static (lint-style) check rather than a live "run the suite
# twice and diff $TMPDIR" measurement, because the latter would double the
# suite's runtime on every `npm test` invocation. See CON-181's PR body for
# the one-time live before/after count that proves the actual fix works;
# this guard exists to keep it working by construction going forward.
#
# Mutation-failable: delete any one of the fixes this checks for (e.g. drop
# `mkTmpDir` from one test file and call fs.mkdtempSync(os.tmpdir(), ...)
# directly again, or drop a shell test's `. lib/tmp-scratch.sh` source line)
# and this test goes red.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  ok   $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL $1"; echo "       $2"; }

echo "tmp-leak-guard (CON-181)"

# --- node --test files: no raw fs.mkdtempSync(os.tmpdir(), ...) -----------
# test/support/tmp.js itself legitimately calls the raw form once (it's the
# thing everything else routes through) -- exclude it from the scan.
RAW_HITS="$(grep -rl "mkdtempSync(path\.join(os\.tmpdir()" "$ROOT/test" --include='*.test.js' 2>/dev/null || true)"
if [ -z "$RAW_HITS" ]; then
  ok "no test/*.test.js file calls fs.mkdtempSync(os.tmpdir(), ...) directly (all route through mkTmpDir)"
else
  bad "no test/*.test.js file calls fs.mkdtempSync(os.tmpdir(), ...) directly (all route through mkTmpDir)" \
      "found raw mkdtempSync(os.tmpdir()) in: $RAW_HITS"
fi

# --- node --test files that DO create temp dirs must require the helper ---
MISSING_REQUIRE=""
for f in "$ROOT"/test/*.test.js; do
  if grep -q "mkTmpDir(" "$f" && ! grep -q "require('\./support/tmp')" "$f"; then
    MISSING_REQUIRE="$MISSING_REQUIRE $f"
  fi
done
if [ -z "$MISSING_REQUIRE" ]; then
  ok "every test/*.test.js file calling mkTmpDir() requires test/support/tmp"
else
  bad "every test/*.test.js file calling mkTmpDir() requires test/support/tmp" \
      "missing require in:$MISSING_REQUIRE"
fi

# --- shell test files that use mktemp must source the scratch-TMPDIR lib --
MISSING_SOURCE=""
for f in "$ROOT"/test/scripts/*.test.sh; do
  base="$(basename "$f")"
  [ "$base" = "tmp-leak-guard.test.sh" ] && continue
  if grep -q "mktemp" "$f" && ! grep -q "lib/tmp-scratch\.sh" "$f"; then
    MISSING_SOURCE="$MISSING_SOURCE $f"
  fi
done
if [ -z "$MISSING_SOURCE" ]; then
  ok "every test/scripts/*.test.sh file using mktemp sources lib/tmp-scratch.sh"
else
  bad "every test/scripts/*.test.sh file using mktemp sources lib/tmp-scratch.sh" \
      "missing source in:$MISSING_SOURCE"
fi

# --- every shell test that sources the scratch lib must actually schedule
# removal of $CON181_SCRATCH_TMPDIR -- either by calling con181_cleanup_scratch
# (directly via `trap con181_cleanup_scratch EXIT`, or from inside an
# existing cleanup/restore handler), or by folding $CON181_SCRATCH_TMPDIR
# into an existing `trap 'rm -rf ...' EXIT` string. Sourcing the lib alone
# only redirects TMPDIR; it does not by itself schedule removal.
MISSING_ARM=""
for f in "$ROOT"/test/scripts/*.test.sh; do
  base="$(basename "$f")"
  [ "$base" = "tmp-leak-guard.test.sh" ] && continue
  if grep -q "lib/tmp-scratch\.sh" "$f" \
     && ! grep -q "con181_cleanup_scratch" "$f" \
     && ! grep -q 'CON181_SCRATCH_TMPDIR"'"'"' EXIT' "$f"; then
    MISSING_ARM="$MISSING_ARM $f"
  fi
done
if [ -z "$MISSING_ARM" ]; then
  ok "every file sourcing lib/tmp-scratch.sh also schedules its removal"
else
  bad "every file sourcing lib/tmp-scratch.sh also schedules its removal" \
      "sources but never removes CON181_SCRATCH_TMPDIR in:$MISSING_ARM"
fi

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
