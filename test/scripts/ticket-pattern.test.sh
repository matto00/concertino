#!/usr/bin/env bash
# The ticket-shape pattern is carried in six places that must never drift
# apart: lib/ui/ticket.js's TICKET_RE, and the looks_like_ticket regex
# inlined into core/scripts/assert-phase.sh, start-servers.sh, cleanup.sh,
# emit-event.sh and persist-evidence.sh (see ticket.js's header comment for
# why there is one definition, not two).
#
# This test extracts the literal bracket-expression body each script actually
# ships, confirms the five shell copies are byte-identical, and exercises it
# against ordinary ticket shapes plus the dotted shape that used to be
# accepted and broke tmux target addressing (session:window.pane) — orphaning
# a window. Run: bash test/scripts/ticket-pattern.test.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  ok   $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL $1"; }

echo "ticket-id pattern (assert-phase.sh / start-servers.sh / cleanup.sh / emit-event.sh / persist-evidence.sh)"

extract() {
  # Pull the ^...$ bracket-expression body out of the script's [[ =~ ]] test.
  grep -oE '\^\[A-Za-z#\]\[A-Za-z0-9_-\]\*\[0-9\]\$' "$1" | head -1
}

P_ASSERT="$(extract "$ROOT/core/scripts/assert-phase.sh")"
P_SERVERS="$(extract "$ROOT/core/scripts/start-servers.sh")"
P_CLEANUP="$(extract "$ROOT/core/scripts/cleanup.sh")"
P_EMIT="$(extract "$ROOT/core/scripts/emit-event.sh")"
P_PERSIST="$(extract "$ROOT/core/scripts/persist-evidence.sh")"

if [ -n "$P_ASSERT" ]; then ok "assert-phase.sh carries the pattern"; else bad "assert-phase.sh: pattern not found"; fi
if [ -n "$P_SERVERS" ]; then ok "start-servers.sh carries the pattern"; else bad "start-servers.sh: pattern not found"; fi
if [ -n "$P_CLEANUP" ]; then ok "cleanup.sh carries the pattern"; else bad "cleanup.sh: pattern not found"; fi
if [ -n "$P_EMIT" ]; then ok "emit-event.sh carries the pattern"; else bad "emit-event.sh: pattern not found"; fi
if [ -n "$P_PERSIST" ]; then ok "persist-evidence.sh carries the pattern"; else bad "persist-evidence.sh: pattern not found"; fi

if [ "$P_ASSERT" = "$P_SERVERS" ] && [ "$P_SERVERS" = "$P_CLEANUP" ] \
    && [ "$P_CLEANUP" = "$P_EMIT" ] && [ "$P_EMIT" = "$P_PERSIST" ]; then
  ok "all five scripts carry the identical pattern"
else
  bad "scripts have drifted: [$P_ASSERT] vs [$P_SERVERS] vs [$P_CLEANUP] vs [$P_EMIT] vs [$P_PERSIST]"
fi

# Exercise the pattern itself (bash's =~ against the same bracket expression
# the scripts use) rather than trusting the extraction alone.
check_accept() {
  if [[ "$1" =~ ^[A-Za-z#][A-Za-z0-9_-]*[0-9]$ ]]; then ok "accepts $1"; else bad "should accept $1"; fi
}
check_reject() {
  if [[ "$1" =~ ^[A-Za-z#][A-Za-z0-9_-]*[0-9]$ ]]; then bad "should reject $1"; else ok "rejects $1"; fi
}

for t in HEL-334 '#123' TICKET-1 CON-777 a_b_c-9; do check_accept "$t"; done
for t in 'a.b_c-9' 'CON-1.2' '.CON-1' 'CON-1.'; do check_reject "$t"; done

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
