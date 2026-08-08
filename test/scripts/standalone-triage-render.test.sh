#!/usr/bin/env bash
# CON-91: the `standalone` triage branch of the "Triaging a suggested
# follow-up" sub-procedure (core/roles/orchestrator.md) is now rendered via a
# provider-conditional `{{block:standaloneTicket}}` seam. This asserts:
#   - `linear` and `github` rendered output is byte-identical to the wording
#     that existed before this change (unconditional, "file a new Linear
#     ticket").
#   - `local` rendered output names an action the orchestrator can actually
#     perform under that provider (allocate an id via next-ticket-id.sh and
#     write tickets/<id>.md), never the unexecutable Linear MCP call.
# Run: bash test/scripts/standalone-triage-render.test.sh
set -uo pipefail

export NO_COLOR=1
unset FORCE_COLOR

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PASS=0; FAIL=0
ok()    { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()   { FAIL=$((FAIL+1)); echo "  FAIL $1"; echo "       $2"; }
check() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected [$3] got [$2]"; fi; }

echo "standalone triage rendering (CON-91)"

# The exact pre-change wording (verbatim from core/roles/orchestrator.md
# before this change — confirmed against `git show main:core/roles/orchestrator.md`)
# that linear/github must still render byte-for-byte, indentation included.
EXPECTED_LINEAR_GITHUB='   - **`standalone`** — file a new Linear ticket (`mcp__linear__save_issue`,
     no `id`) summarizing `description` and linking back to the current
     ticket (`$TICKET_ID`); note the new ticket'"'"'s identifier in your summary
     to the human. No re-planning, no scope change to the current run.'

extract_standalone_bullet() {
  # Prints the `standalone` bullet's lines (its own line through the line
  # immediately before the next top-level `- **` bullet).
  awk '
    /- \*\*`standalone`\*\*/ { grab=1; print; next }
    grab && /^   - \*\*/ { exit }
    grab { print }
  ' "$1"
}

# --- linear fixture ----------------------------------------------------------
OUT="$(mktemp -d)"
node "$ROOT/bin/concertino" sync --config="$ROOT/config/examples/concertino.json" --out="$OUT" > "$OUT/sync.txt" 2>&1
RC=$?
check "linear: sync exits zero" "$RC" "0"
ORCH="$OUT/.claude/agents/concertino-orchestrator.md"
BULLET="$(extract_standalone_bullet "$ORCH")"
check "linear: standalone bullet is byte-identical to pre-change wording" "$BULLET" "$EXPECTED_LINEAR_GITHUB"
rm -rf "$OUT"

# --- github fixture -----------------------------------------------------------
OUT="$(mktemp -d)"
node "$ROOT/bin/concertino" sync --config="$ROOT/config/examples/generic.json" --out="$OUT" > "$OUT/sync.txt" 2>&1
RC=$?
check "github: sync exits zero" "$RC" "0"
ORCH="$OUT/.claude/agents/concertino-orchestrator.md"
BULLET="$(extract_standalone_bullet "$ORCH")"
check "github: standalone bullet is byte-identical to pre-change wording" "$BULLET" "$EXPECTED_LINEAR_GITHUB"
rm -rf "$OUT"

# --- local fixture -------------------------------------------------------------
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
check "local: sync exits zero" "$RC" "0"
ORCH="$OUT/.claude/agents/concertino-orchestrator.md"
BULLET="$(extract_standalone_bullet "$ORCH")"
[ -n "$BULLET" ] && ok "local: standalone bullet renders" || bad "local: standalone bullet renders" "empty extraction from $ORCH"
if printf '%s' "$BULLET" | grep -qF 'next-ticket-id.sh'; then
  ok "local: names the id-allocator script"
else
  bad "local: names the id-allocator script" "not found in: $BULLET"
fi
if printf '%s' "$BULLET" | grep -qF 'tickets/'; then
  ok "local: mentions the tickets/ path convention"
else
  bad "local: mentions the tickets/ path convention" "not found in: $BULLET"
fi
if printf '%s' "$BULLET" | grep -qF 'state: backlog'; then
  ok "local: names the backlog frontmatter state"
else
  bad "local: names the backlog frontmatter state" "not found in: $BULLET"
fi
if printf '%s' "$BULLET" | grep -qF 'mcp__linear__save_issue'; then
  bad "local: does not name the unexecutable Linear MCP call" "unexpectedly found mcp__linear__save_issue in: $BULLET"
else
  ok "local: does not name the unexecutable Linear MCP call"
fi
rm -rf "$OUT"

echo "  ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ]
