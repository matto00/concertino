#!/usr/bin/env bash
# CON-44: `ticketProvider.kind: "local"` renders orchestrator prose that points
# at tickets/<ID>.md and set-ticket-state.sh, and grants no Linear MCP tools.
# Run: bash test/scripts/local-provider-render.test.sh
set -uo pipefail

export NO_COLOR=1
unset FORCE_COLOR

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PASS=0; FAIL=0
ok()     { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()    { FAIL=$((FAIL+1)); echo "  FAIL $1"; echo "       $2"; }
has()    { grep -qF "$2" "$3" 2>/dev/null && ok "$1" || bad "$1" "expected to find [$2] in $3"; }
hasnt()  { grep -qF "$2" "$3" 2>/dev/null && bad "$1" "expected NOT to find [$2] in $3" || ok "$1"; }

echo "local ticket provider rendering (CON-44)"

OUT="$(mktemp -d)"
CFG="$OUT/concertino.config.json"
node -e '
  const fs = require("fs");
  fs.writeFileSync(process.argv[2], JSON.stringify({
    harnesses: ["claude-code"],
    project: { name: "fixture-project", baseBranch: "main" },
    ticketProvider: { kind: "local", idExample: "CON-1", teamKey: "CON" },
    specProvider: { kind: "none" },
    worktree: { ports: { frontendBase: 5173, backendBase: 8080 } },
    gates: [{ name: "test", when: "always", command: "true" }],
  }, null, 2));
' _ "$CFG"

node "$ROOT/bin/concertino" sync --out="$OUT" --config="$CFG" > "$OUT/sync.txt" 2>&1
RC=$?
[ "$RC" -eq 0 ] && ok "sync exits zero" || bad "sync exits zero" "exit $RC:
$(cat "$OUT/sync.txt")"

ORCH="$OUT/.claude/agents/concertino-orchestrator.md"
[ -f "$ORCH" ] && ok "renders the orchestrator agent" || bad "renders the orchestrator agent" "missing $ORCH"

has   "names the ticket file"        'tickets/$TICKET_ID.md'   "$ORCH"
has   "names the write-back script"  'set-ticket-state.sh'     "$ORCH"
# CON-94: the design doc's Decision 3 documents the tickets-dir argument as
# a test-only exception — pin the only production call site to the literal
# "tickets" it always passes, so a future edit that made the directory
# genuinely configurable would break this test rather than silently
# reopening the surface Decision 3 excludes.
has   "pins the write-back call to the literal tickets-dir argument" \
      'set-ticket-state.sh tickets "$TICKET_ID"' "$ORCH"
has   "keeps the no-store fallback"  'provided inline'         "$ORCH"

# "Grants" means the frontmatter `tools:` list specifically — not a blanket
# grep of the whole rendered file. core/roles/orchestrator.md still has one
# remaining spot (the CON-62 harness-override note) that names
# `mcp__linear__*` in illustrative prose unconditionally, regardless of
# ticketProvider.kind — pre-existing under `github` too, and judged cosmetic
# and out of scope (CON-91). The escalation "standalone" triage option is no
# longer one of these: CON-91 made it provider-conditional (see below), so
# under `local` it no longer names any Linear MCP tool. Only the tool grant
# itself is provider-gated.
FRONTMATTER="$OUT/frontmatter.txt"
awk 'NR==1{next} /^---$/{exit} {print}' "$ORCH" > "$FRONTMATTER"
hasnt "grants no Linear MCP tools"   'mcp__linear__'           "$FRONTMATTER"

# CON-91: under `local`, the `standalone` triage branch must name an action
# the orchestrator can actually perform (write tickets/<ID>.md via the new
# id-allocator script), not the unexecutable `mcp__linear__save_issue` call.
has   "standalone: names the id-allocator script" \
      'next-ticket-id.sh' "$ORCH"
has   "standalone: names the tickets/ directory" \
      'tickets' "$ORCH"
hasnt "standalone: does not name the Linear MCP save tool" \
      'mcp__linear__save_issue' "$ORCH"

# The degenerate case must survive: a local project with no tickets/ directory
# behaves exactly as the old `manual` kind did.
has   "tells the agent to skip status updates when the file is absent" \
      'skip status updates' "$ORCH"

rm -rf "$OUT"

echo "  ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ]
