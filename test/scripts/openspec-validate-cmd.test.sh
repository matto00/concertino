#!/usr/bin/env bash
# Shell tests for CON-130: the rendered orchestrator's Planning-phase
# `openspec validate` invocation, and `lib/cli/init.js`'s scaffolded
# `validateCmd`, must use the CLI's real surface (`openspec "<NAME>"
# --type change`, exit-status assertion) and never the nonexistent
# `--change` flag. Filed twice (CON-115, CON-130) and survived both times
# because nothing tested it — this is the regression guard (design.md
# Decision 6).
#
# SAFETY: renders a REAL sync (never --dry-run, which writes zero files —
# see design.md Decision 4) into a throwaway --out directory, never this
# checkout's own .claude/.codex/.opencode/scripts directories.
set -uo pipefail

export NO_COLOR=1
unset FORCE_COLOR

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL $1"; echo "       $2"; }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected [$3] got [$2]"; fi; }
has()  { if grep -qF "$2" "$3" 2>/dev/null; then ok "$1"; else bad "$1" "expected to find [$2] in $3"; fi; }
hasnt(){ if grep -qF "$2" "$3" 2>/dev/null; then bad "$1" "unexpectedly found [$2] in $3"; else ok "$1"; fi; }

echo "openspec validate command surface (CON-130)"

# ===========================================================================
# (a) real sync render: rendered orchestrator uses --type change, never --change
# ===========================================================================
OUT="$(mktemp -d)"
node "$ROOT/bin/concertino" sync --out="$OUT" --config="$ROOT/config/examples/helio.json" > "$OUT/sync-out.txt" 2>&1
RC=$?
check "a.1 sync exits zero" "$RC" "0"

ORCH_MD="$OUT/.claude/agents/concertino-orchestrator.md"
# The file-exists precondition is load-bearing: hasnt's grep -qF ... negated
# returns "ok" against a missing file, so an exists-check must run first or
# a render that wrote nothing would report all-green.
[ -s "$ORCH_MD" ] && ok "a.2 rendered concertino-orchestrator.md exists and is non-empty" || bad "a.2 rendered concertino-orchestrator.md exists and is non-empty" "missing or empty: $ORCH_MD"

has "a.3 rendered orchestrator contains the corrected invocation" 'openspec validate "<CHANGE_NAME>" --type change' "$ORCH_MD"
hasnt "a.4 rendered orchestrator contains no broken 'validate --change' anywhere" "validate --change" "$ORCH_MD"

rm -rf "$OUT"

# ===========================================================================
# (b) lib/cli/init.js scaffolds the corrected form for new projects
# ===========================================================================
has "b.1 init.js scaffolds the corrected validateCmd" 'validateCmd: '"'"'openspec validate "<CHANGE_NAME>" --type change'"'"'' "$ROOT/lib/cli/init.js"
hasnt "b.2 init.js does not scaffold the broken --change form" "validateCmd: 'openspec validate --change" "$ROOT/lib/cli/init.js"

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
