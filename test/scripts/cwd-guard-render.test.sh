#!/usr/bin/env bash
# Shell tests for CON-174's `{{block:cwdGuard}}` seam in lib/cli/render.js.
#
# Confirms: (1) the cwdGuard block renders real assert-cwd.sh content into
# executor/evaluator/skeptic/auditor, not a passthrough placeholder; (2) a
# typo'd `{{block:...}}` name is caught (rendered as a visible, greppable
# literal placeholder) rather than silently vanishing — checked: no existing
# test elsewhere asserts on render.js's default-arm passthrough behavior for
# an unrecognized block name.
#
# SAFETY: every invocation runs against a throwaway --out directory, never
# this checkout's own scripts/concertino/ or .claude/ directories.
set -uo pipefail

# CON-181: scope every mktemp/mktemp -d call in this file to a scratch
# TMPDIR removed on exit -- see test/scripts/lib/tmp-scratch.sh.
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp-scratch.sh"
trap con181_cleanup_scratch EXIT

export NO_COLOR=1
unset FORCE_COLOR

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL $1"; echo "       $2"; }
has()  { if grep -qF "$2" "$3" 2>/dev/null; then ok "$1"; else bad "$1" "expected to find [$2] in $3"; fi; }
hasnt(){ if grep -qF "$2" "$3" 2>/dev/null; then bad "$1" "unexpectedly found [$2] in $3"; else ok "$1"; fi; }

echo "cwdGuard block rendering (CON-174)"

# ===========================================================================
# (a) cwdGuard renders real assert-cwd.sh content into each of the four
# worktree-bound role docs, not the literal {{block:cwdGuard}} placeholder.
# ===========================================================================
OUT="$(mktemp -d)"
node "$ROOT/bin/concertino" sync --config="$ROOT/config/examples/concertino.json" --out="$OUT" > "$OUT/sync.txt" 2>&1
RC=$?
if [ "$RC" -eq 0 ]; then ok "sync exits zero"; else bad "sync exits zero" "rc=$RC: $(cat "$OUT/sync.txt")"; fi

for role in executor evaluator skeptic auditor; do
  F="$OUT/.claude/agents/concertino-${role}.md"
  hasnt "${role}.md: no unresolved {{block:cwdGuard}} placeholder" '{{block:cwdGuard}}' "$F"
  has   "${role}.md: renders assert-cwd.sh invocation" "assert-cwd.sh" "$F"
  has   "${role}.md: renders BLOCKER-and-stop instruction" "BLOCKER-and-stop" "$F"
done
rm -rf "$OUT"

# ===========================================================================
# (b) a typo'd block name is caught: render.js's `block()` default arm
# returns the literal `{{block:<name>}}` string for an unrecognized name —
# a visible, greppable marker — rather than throwing or silently emitting
# empty string. Exercised directly against the exported `renderBody`.
# ===========================================================================
PROBE_OUT="$(node -e '
  const { renderBody } = require(process.argv[1]);
  const c = {
    specProvider: { changeDir: "openspec/changes/x", changeRoot: "openspec" },
    project: { baseBranch: "main" },
  };
  const out = renderBody("before {{block:cwdGaurd}} after", c, "claude-code");
  console.log(out);
' "$ROOT/lib/cli/render.js")"

if printf '%s' "$PROBE_OUT" | grep -qF '{{block:cwdGaurd}}'; then
  ok "a typo'd block name ({{block:cwdGaurd}}) renders as a visible, greppable literal placeholder rather than silently vanishing"
else
  bad "a typo'd block name renders as a visible literal placeholder" "$PROBE_OUT"
fi

echo
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
