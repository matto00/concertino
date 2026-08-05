#!/usr/bin/env bash
# CON-74: Codex renders role bodies as SEPARATE files referenced from
# AGENTS.md, instead of concatenating all five into it.
#
# AGENTS.md is part of Codex's standing instructions — re-sent on every
# request for the whole run — so inlining the bodies cost ~23k tokens per
# turn against ~1.9k for the equivalent Claude Code turn. On a local model
# capped at a 32k window that consumed 71% of the context before the agent
# read anything, and runs died mid-stream. These assertions pin the shape
# that fixed it; the token budget is the reason they exist.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PASS=0; FAIL=0
ok()  { echo "  ok   $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL $1"; echo "       $2"; FAIL=$((FAIL+1)); }
has()   { if grep -qF "$2" "$3"; then ok "$1"; else bad "$1" "expected [$2] in $3"; fi; }
lacks() { if grep -qF "$2" "$3"; then bad "$1" "did NOT expect [$2] in $3"; else ok "$1"; fi; }

echo "codex per-role render (CON-74)"
OUT="$(mktemp -d)"
CFG="$OUT/concertino.config.json"
node -e '
  const fs=require("fs");
  const c=JSON.parse(fs.readFileSync(process.argv[1]+"/config/examples/generic.json","utf8"));
  c.harnesses=["codex"];
  fs.writeFileSync(process.argv[2], JSON.stringify(c,null,2));
' "$ROOT" "$CFG"
node "$ROOT/bin/concertino" sync --out="$OUT" --config="$CFG" > "$OUT/sync.txt" 2>&1
RC=$?
[ "$RC" -eq 0 ] && ok "sync exits zero" || bad "sync exits zero" "exit $RC: $(cat "$OUT/sync.txt")"

AG="$OUT/AGENTS.md"
for role in orchestrator executor evaluator skeptic auditor; do
  F="$OUT/.codex/roles/concertino-$role.md"
  [ -f "$F" ] && ok "$role body is its own file" || bad "$role body is its own file" "missing $F"
  has "AGENTS.md indexes $role by path" ".codex/roles/concertino-$role.md" "$AG"
done

# The bodies must NOT also be inlined — that would defeat the whole change.
lacks "AGENTS.md does not inline role bodies" "## Role: Orchestrator" "$AG"
lacks "AGENTS.md does not inline the auditor body" "## Role: Auditor" "$AG"
has   "AGENTS.md keeps the Iron Laws (they bind every role)" "Iron Laws" "$AG"
has   "AGENTS.md tells the model to read a role when entering its phase" "read the one whose phase you are entering" "$AG"

# The delivery prompt must name the file at the step that needs it, or the
# index is advice the model never acts on.
PR="$OUT/.codex/prompts/concertino-deliver.md"
has "the prompt points step 1 at the orchestrator file" ".codex/roles/concertino-orchestrator.md" "$PR"
has "the prompt points step 3 at the executor file"     ".codex/roles/concertino-executor.md" "$PR"

# The budget itself. AGENTS.md was ~96000 chars inlined; the index form must
# stay an order of magnitude under that, or the regression is silent.
CH=$(wc -c < "$AG")
if [ "$CH" -lt 12000 ]; then
  ok "AGENTS.md stays small ($CH chars, was ~96000 inlined)"
else
  bad "AGENTS.md stays small" "grew to $CH chars — role bodies may have been re-inlined"
fi

# A re-sync must not duplicate or re-inline anything.
node "$ROOT/bin/concertino" sync --out="$OUT" --config="$CFG" > "$OUT/sync2.txt" 2>&1
CH2=$(wc -c < "$AG")
[ "$CH" -eq "$CH2" ] && ok "re-sync leaves AGENTS.md byte-identical" \
  || bad "re-sync leaves AGENTS.md byte-identical" "$CH -> $CH2"

rm -rf "$OUT"
echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
