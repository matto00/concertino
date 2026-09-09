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

# CON-168: a.4 forbids the broken form, but the role doc legitimately QUOTES it
# in order to warn about it (CON-154). A plain substring assertion cannot tell
# "uses the broken form" from "documents that the broken form is broken", so it
# punished exactly the documentation we most want to keep -- and, because that
# doc change reached main without a CI run, left main red until an unrelated PR
# inherited the failure.
#
# The fix is a marker, not a looser assertion: a deliberate mention is wrapped in
# <!-- documented-as-broken:start --> / <!-- documented-as-broken:end -->, those
# regions are stripped, and the assertion runs against everything else. An
# UNMARKED occurrence still fails, which is the property a.5/a.6 below prove by
# mutation.
strip_documented_as_broken() {
  sed '/documented-as-broken:start/,/documented-as-broken:end/d' "$1"
}

# An UNBALANCED marker is the amnesty this whole mechanism exists to prevent:
# `sed '/start/,/end/d'` with no matching end address deletes from the start
# marker to END OF FILE, so one dropped end-marker line -- a merge conflict, a
# copy-paste slip -- silently removes everything after it from the assertion and
# the suite still reports green. That is strictly worse than the substring guard
# it replaced. Balance must therefore be checked BEFORE any strip is trusted.
markers_balanced() {
  local starts ends
  starts=$(grep -c 'documented-as-broken:start' "$1" || true)
  ends=$(grep -c 'documented-as-broken:end' "$1" || true)
  [ "$starts" = "$ends" ]
}

# Precondition on a.4: an unbalanced marker set makes the stripped text
# meaningless, so refuse to draw any conclusion from it rather than reporting a
# green that means nothing.
if markers_balanced "$ORCH_MD"; then
  ok "a.3b documented-as-broken markers are balanced in the rendered doc"
else
  bad "a.3b documented-as-broken markers are balanced in the rendered doc" \
      "start/end counts differ -- the strip would delete to end of file"
fi

ORCH_UNMARKED="$OUT/orchestrator-unmarked.md"
strip_documented_as_broken "$ORCH_MD" > "$ORCH_UNMARKED"

hasnt "a.4 no broken 'validate --change' outside a documented-as-broken block" "validate --change" "$ORCH_UNMARKED"

# The marker must not become a blanket amnesty. a.5 proves the stripped region
# was real (the doc does still carry the warning), and a.6 proves an unmarked
# occurrence is still caught -- without which the marker would silently disable
# the guard entirely.
has "a.5 the documented-as-broken warning is still present in the rendered doc" "validate --change" "$ORCH_MD"

# a.7 proves a.3b is failable, and proves the specific hazard: an unclosed start
# marker followed by a genuinely broken usage. Without the balance check this
# case reports 8/8 green with the guard entirely disabled.
UNBALANCED="$OUT/orchestrator-unbalanced.md"
{ cat "$ORCH_MD"
  printf '\n<!-- documented-as-broken:start -->\n'
  printf 'Run `openspec validate --change "<NAME>"` to check.\n'
} > "$UNBALANCED"
if markers_balanced "$UNBALANCED"; then
  bad "a.7 an unclosed start marker is detected (strip cannot silently swallow the rest)" \
      "markers_balanced accepted a file with an unmatched start marker"
else
  ok "a.7 an unclosed start marker is detected (strip cannot silently swallow the rest)"
fi

MUTANT="$OUT/orchestrator-mutant.md"
{ cat "$ORCH_UNMARKED"; printf '\nRun `openspec validate --change "<NAME>"` to check.\n'; } > "$MUTANT"
if strip_documented_as_broken "$MUTANT" | grep -qF "validate --change"; then
  ok "a.6 an UNMARKED broken usage is still caught (guard is failable)"
else
  bad "a.6 an UNMARKED broken usage is still caught (guard is failable)" "the marker made the guard vacuous"
fi

rm -rf "$OUT"

# ===========================================================================
# (b) lib/cli/init.js scaffolds the corrected form for new projects
# ===========================================================================
has "b.1 init.js scaffolds the corrected validateCmd" 'validateCmd: '"'"'openspec validate "<CHANGE_NAME>" --type change'"'"'' "$ROOT/lib/cli/init.js"
hasnt "b.2 init.js does not scaffold the broken --change form" "validateCmd: 'openspec validate --change" "$ROOT/lib/cli/init.js"

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
