#!/usr/bin/env bash
# CON-94: the five-state vocabulary is carried in two places that must never
# drift apart: lib/ui/tickets/local.js's `STATES` array and
# core/scripts/set-ticket-state.sh's `STATES` shell string. Nothing in the
# language couples a JS array to a shell string, so — following the
# precedent test/scripts/ticket-pattern.test.sh already set for the
# canonical ticket-id pattern — this test extracts both, normalises them to
# the same ordered, space-separated form, and byte-compares them.
#
# Run: bash test/scripts/ticket-state-vocabulary.test.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  ok   $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL $1"; }

echo "ticket-state vocabulary (lib/ui/tickets/local.js STATES / core/scripts/set-ticket-state.sh STATES)"

# lib/ui/tickets/local.js's STATES array, in array order, space-separated.
JS_STATES="$(node -e "console.log(require('$ROOT/lib/ui/tickets/local.js').STATES.join(' '))")"

# core/scripts/set-ticket-state.sh's STATES="..." line, extracted the same
# way ticket-pattern.test.sh already pulls a shell literal out of a script.
SH_STATES="$(grep -oE '^STATES="[^"]*"' "$ROOT/core/scripts/set-ticket-state.sh" | sed -E 's/^STATES="(.*)"$/\1/')"

if [ -n "$JS_STATES" ]; then ok "lib/ui/tickets/local.js carries STATES ($JS_STATES)"; else bad "lib/ui/tickets/local.js: STATES not found"; fi
if [ -n "$SH_STATES" ]; then ok "set-ticket-state.sh carries STATES ($SH_STATES)"; else bad "set-ticket-state.sh: STATES not found"; fi

if [ "$JS_STATES" = "$SH_STATES" ]; then
  ok "both copies carry the identical ordered vocabulary"
else
  bad "STATES have drifted: [$JS_STATES] (local.js) vs [$SH_STATES] (set-ticket-state.sh)"
fi

# Pin the exact, ordered vocabulary — Linear's own state.type order — so an
# accidental reorder (not just an add/remove) also fails loudly.
EXPECTED="backlog unstarted started completed canceled"
if [ "$JS_STATES" = "$EXPECTED" ]; then
  ok "local.js's STATES match the expected order ($EXPECTED)"
else
  bad "local.js's STATES do not match the expected order: [$JS_STATES] vs [$EXPECTED]"
fi

# Self-verify the comparison logic actually catches drift, rather than
# trusting it never fails — mirroring how other suites in test/scripts/
# self-verify their own comparison logic (see e.g.
# ticket-pattern.test.sh's dot-accepting-variant guard).
MISMATCHED_A="backlog unstarted started completed canceled"
MISMATCHED_B="backlog unstarted started completed"
if [ "$MISMATCHED_A" = "$MISMATCHED_B" ]; then
  bad "comparison logic failed to detect a deliberately mismatched fixture pair"
else
  ok "comparison logic detects a deliberately mismatched fixture pair (a value removed)"
fi

REORDERED_A="backlog unstarted started completed canceled"
REORDERED_B="unstarted backlog started completed canceled"
if [ "$REORDERED_A" = "$REORDERED_B" ]; then
  bad "comparison logic failed to detect a deliberately reordered fixture pair"
else
  ok "comparison logic detects a deliberately reordered fixture pair"
fi

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
