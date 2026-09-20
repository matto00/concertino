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

# CON-181: scope every mktemp/mktemp -d call in this file to a scratch
# TMPDIR removed on exit -- see test/scripts/lib/tmp-scratch.sh.
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp-scratch.sh"
trap con181_cleanup_scratch EXIT

export NO_COLOR=1
unset FORCE_COLOR

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PASS=0; FAIL=0
ok()    { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()   { FAIL=$((FAIL+1)); echo "  FAIL $1"; echo "       $2"; }
check() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected [$3] got [$2]"; fi; }

echo "standalone triage rendering (CON-91 / CON-190)"

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
if printf '%s' "$BULLET" | grep -qF 'mcp__linear__save_issue'; then
  ok "linear: still names the Linear MCP call"
else
  bad "linear: still names the Linear MCP call" "not found in: $BULLET"
fi
if printf '%s' "$BULLET" | grep -qF 'origin_kind: followup'; then
  ok "linear: ticket description carries origin_kind: followup (CON-190)"
else
  bad "linear: ticket description carries origin_kind: followup (CON-190)" "not found in: $BULLET"
fi
if printf '%s' "$BULLET" | grep -qF 'ticket.filed'; then
  ok "linear: emits ticket.filed (CON-190)"
else
  bad "linear: emits ticket.filed (CON-190)" "not found in: $BULLET"
fi
if printf '%s' "$BULLET" | grep -qF 'origin_repo="$ORIGIN_REPO"'; then
  ok "linear: ticket.filed records origin_repo derived from the running repository, not the ticket prefix"
else
  bad "linear: ticket.filed records origin_repo derived from the running repository, not the ticket prefix" "not found in: $BULLET"
fi
rm -rf "$OUT"

# --- github fixture -----------------------------------------------------------
OUT="$(mktemp -d)"
node "$ROOT/bin/concertino" sync --config="$ROOT/config/examples/generic.json" --out="$OUT" > "$OUT/sync.txt" 2>&1
RC=$?
check "github: sync exits zero" "$RC" "0"
ORCH="$OUT/.claude/agents/concertino-orchestrator.md"
BULLET="$(extract_standalone_bullet "$ORCH")"
if printf '%s' "$BULLET" | grep -qF 'mcp__linear__save_issue'; then
  ok "github: still names the Linear MCP call (github wording is identical to linear's)"
else
  bad "github: still names the Linear MCP call (github wording is identical to linear's)" "not found in: $BULLET"
fi
if printf '%s' "$BULLET" | grep -qF 'ticket.filed'; then
  ok "github: emits ticket.filed (CON-190)"
else
  bad "github: emits ticket.filed (CON-190)" "not found in: $BULLET"
fi
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
if printf '%s' "$BULLET" | grep -qF 'origin_kind: followup'; then
  ok "local: frontmatter carries origin_kind: followup (CON-190)"
else
  bad "local: frontmatter carries origin_kind: followup (CON-190)" "not found in: $BULLET"
fi
if printf '%s' "$BULLET" | grep -qF 'ticket.filed'; then
  ok "local: emits ticket.filed (CON-190)"
else
  bad "local: emits ticket.filed (CON-190)" "not found in: $BULLET"
fi
rm -rf "$OUT"

# --- ticketProvider.followUpLabel ---------------------------------------------
# A filed follow-up must be distinguishable from original scope on the board
# itself, not only by scanning description text for `origin_kind:`. When the
# project configures `ticketProvider.followUpLabel`, the standalone bullet tells
# the orchestrator to apply it at filing time. When unset, the wording is
# unchanged (asserted here by the absence of any label instruction, on top of
# the existing per-provider assertions above).

render_with_label() {
  # $1 = provider kind, $2 = label ("" for none) -> prints the standalone bullet
  local out cfg
  out="$(mktemp -d)"
  cfg="$out/concertino.config.json"
  node -e '
    const fs = require("fs");
    const [kind, label, dest] = process.argv.slice(2);
    const tp = { kind, idExample: "CON-1", teamKey: "CON" };
    if (label) tp.followUpLabel = label;
    fs.writeFileSync(dest, JSON.stringify({
      harnesses: ["claude-code"],
      project: { name: "fixture-project", baseBranch: "main" },
      ticketProvider: tp,
      specProvider: { kind: "none" },
      worktree: { ports: { frontendBase: 5173, backendBase: 8080 } },
      gates: [{ name: "test", when: "always", command: "true" }],
    }, null, 2));
  ' _ "$1" "$2" "$cfg"
  node "$ROOT/bin/concertino" sync --out="$out" --config="$cfg" > "$out/sync.txt" 2>&1 || { echo "SYNC-FAILED: $(cat "$out/sync.txt")"; rm -rf "$out"; return; }
  extract_standalone_bullet "$out/.claude/agents/concertino-orchestrator.md"
  rm -rf "$out"
}

BULLET="$(render_with_label linear 'Follow-up')"
if printf '%s' "$BULLET" | grep -qF 'addLabels: ["Follow-up"]'; then
  ok "label: linear names addLabels with the configured label"
else
  bad "label: linear names addLabels with the configured label" "not found in: $BULLET"
fi
if printf '%s' "$BULLET" | grep -qF 'origin_kind: followup'; then
  ok "label: linear still carries the origin_kind description fallback"
else
  bad "label: linear still carries the origin_kind description fallback" "not found in: $BULLET"
fi

if printf '%s' "$BULLET" | grep -qF 'relatedTo: ["$TICKET_ID"]'; then
  ok "label: linear links the filed follow-up to its origin via relatedTo"
else
  bad "label: linear links the filed follow-up to its origin via relatedTo" "not found in: $BULLET"
fi

BULLET="$(render_with_label linear '')"
if printf '%s' "$BULLET" | grep -qF 'addLabels'; then
  bad "label: linear with no followUpLabel emits no label instruction" "unexpectedly found addLabels in: $BULLET"
else
  ok "label: linear with no followUpLabel emits no label instruction"
fi
if printf '%s' "$BULLET" | grep -qF 'relatedTo'; then
  bad "label: linear with no followUpLabel emits no relatedTo instruction" "unexpectedly found relatedTo in: $BULLET"
else
  ok "label: linear with no followUpLabel emits no relatedTo instruction"
fi

BULLET="$(render_with_label local 'Follow-up')"
if printf '%s' "$BULLET" | grep -qF 'labels: ["Follow-up"]'; then
  ok "label: local names frontmatter labels with the configured label"
else
  bad "label: local names frontmatter labels with the configured label" "not found in: $BULLET"
fi

BULLET="$(render_with_label local '')"
if printf '%s' "$BULLET" | grep -qF 'labels:'; then
  bad "label: local with no followUpLabel emits no label instruction" "unexpectedly found labels: in: $BULLET"
else
  ok "label: local with no followUpLabel emits no label instruction"
fi

echo "  ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ]
