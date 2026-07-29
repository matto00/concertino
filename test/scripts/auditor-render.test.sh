#!/usr/bin/env bash
# Shell tests for CON-24 (agent-merge-role): the fifth `auditor` role must be
# rendered into both harnesses, reported by doctor/diff when missing, and the
# new `models.auditor` / `agentMerge.*` config fields must validate cleanly.
#
# SAFETY: every invocation below runs against a throwaway --out directory,
# never this checkout's own scripts/concertino/ or .claude/.codex directories.
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

echo "auditor rendering (CON-24 agent-merge-role)"

# ===========================================================================
# (a) claude-code + codex: sync renders the auditor into both harnesses
# ===========================================================================
OUT="$(mktemp -d)"
node -e '
  const fs = require("fs");
  const cfg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  cfg.harnesses = ["claude-code", "codex"];
  cfg.models = Object.assign({}, cfg.models, { auditor: "opus" });
  cfg.agentMerge = { enabled: true, mergeMethod: "squash" };
  fs.writeFileSync(process.argv[2], JSON.stringify(cfg, null, 2));
' "$ROOT/config/examples/generic.json" "$OUT/concertino.config.json"

node "$ROOT/bin/concertino" sync --out="$OUT" --config="$OUT/concertino.config.json" > "$OUT/sync-out.txt" 2>&1
RC=$?
check "a.1 sync exits zero" "$RC" "0"

AUDITOR_MD="$OUT/.claude/agents/concertino-auditor.md"
[ -f "$AUDITOR_MD" ] && ok "a.2 concertino-auditor.md is written" || bad "a.2 concertino-auditor.md is written" "missing: $AUDITOR_MD"
has "a.3 auditor model resolved from models.auditor" "model: opus" "$AUDITOR_MD"
has "a.4 auditor has its own tools: frontmatter" "tools:" "$AUDITOR_MD"
hasnt "a.5 auditor is not the skeptic's UI tool grant" "mcp__playwright__browser_navigate" "$AUDITOR_MD"

has "a.6 AGENTS.md documents the auditor role" "## Role: Auditor" "$OUT/AGENTS.md"
has "a.7 AGENTS.md describes agent-merge as the seventh sequential stage" "Auditor" "$OUT/.codex/prompts/concertino-deliver.md"

AUDITOR_TOML="$OUT/.codex/agents/concertino-auditor.toml"
[ -f "$AUDITOR_TOML" ] && ok "a.8 concertino-auditor.toml (optional worker) is written" || bad "a.8 concertino-auditor.toml is written" "missing: $AUDITOR_TOML"

rm -rf "$OUT"

# ===========================================================================
# (b) doctor/diff report a missing concertino-auditor.md the same way a
#     missing concertino-skeptic.md would be
# ===========================================================================
OUT="$(mktemp -d)"
cp "$ROOT/config/examples/generic.json" "$OUT/concertino.config.json"
node "$ROOT/bin/concertino" sync --out="$OUT" > "$OUT/sync-out.txt" 2>&1
rm -f "$OUT/.claude/agents/concertino-auditor.md"

DOCTOR_OUT="$OUT/doctor-out.txt"
node "$ROOT/bin/concertino" doctor --out="$OUT" > "$DOCTOR_OUT" 2>&1
has "b.1 doctor names the missing auditor agent file" ".claude/agents/concertino-auditor.md" "$DOCTOR_OUT"
has "b.2 doctor tells the user how to fix it" "run \`concertino sync\`" "$DOCTOR_OUT"

DIFF_OUT="$OUT/diff-out.txt"
node "$ROOT/bin/concertino" diff --out="$OUT" > "$DIFF_OUT" 2>&1
has "b.3 diff reports the auditor file as new/changed" "concertino-auditor.md" "$DIFF_OUT"

rm -rf "$OUT"

# ===========================================================================
# (c) config schema / validate: agentMerge + models.auditor round-trip
# ===========================================================================
OUT="$(mktemp -d)"
node -e '
  const fs = require("fs");
  const cfg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  cfg.models = Object.assign({}, cfg.models, { auditor: "sonnet" });
  cfg.agentMerge = { enabled: true, mergeMethod: "merge" };
  fs.writeFileSync(process.argv[2], JSON.stringify(cfg, null, 2));
' "$ROOT/config/examples/generic.json" "$OUT/concertino.config.json"

VALIDATE_OUT="$OUT/validate-out.txt"
node "$ROOT/bin/concertino" validate --out="$OUT" > "$VALIDATE_OUT" 2>&1
RC=$?
check "c.1 validate exits zero with agentMerge + models.auditor set" "$RC" "0"
has "c.2 validate reports the auditor model" "auditor" "$VALIDATE_OUT"

rm -rf "$OUT"

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
