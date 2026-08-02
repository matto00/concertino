#!/usr/bin/env bash
# CON-63: `concertino sync --harness=opencode` renders OpenCode's native
# project config, per-role agent definitions, and a delivery command file —
# and a project that never configures opencode gets none of it. Run:
#   bash test/scripts/opencode-render.test.sh
set -uo pipefail

export NO_COLOR=1
unset FORCE_COLOR

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PASS=0; FAIL=0
ok()    { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()   { FAIL=$((FAIL+1)); echo "  FAIL $1"; echo "       $2"; }
has()   { grep -qF "$2" "$3" 2>/dev/null && ok "$1" || bad "$1" "expected to find [$2] in $3"; }
exists(){ [ -e "$2" ] && ok "$1" || bad "$1" "expected $2 to exist"; }
absent(){ [ -e "$2" ] && bad "$1" "expected $2 to NOT exist" || ok "$1"; }

echo "opencode adapter rendering (CON-63)"

write_config() {
  # $1 = target config path, $2 = JSON to merge over config/examples/opencode-ollama.json
  node -e '
    const fs = require("fs");
    const base = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    Object.assign(base, JSON.parse(process.argv[3]));
    fs.writeFileSync(process.argv[2], JSON.stringify(base, null, 2));
  ' "$ROOT/config/examples/opencode-ollama.json" "$1" "$2"
}

# --- opencode configured: every expected file is written --------------------
OUT="$(mktemp -d)"
CFG="$OUT/concertino.config.json"
write_config "$CFG" '{}'
node "$ROOT/bin/concertino" sync --out="$OUT" --config="$CFG" > "$OUT/sync.txt" 2>&1
RC=$?
[ "$RC" -eq 0 ] && ok "sync exits zero" || bad "sync exits zero" "exit $RC:\n$(cat "$OUT/sync.txt")"

for role in orchestrator executor evaluator skeptic auditor; do
  exists "renders .opencode/agents/concertino-$role.md" "$OUT/.opencode/agents/concertino-$role.md"
done
exists "renders .opencode/commands/concertino-deliver.md" "$OUT/.opencode/commands/concertino-deliver.md"
exists "renders opencode.json" "$OUT/opencode.json"

has "orchestrator agent has mode: primary" "mode: primary" "$OUT/.opencode/agents/concertino-orchestrator.md"
has "executor agent has mode: subagent" "mode: subagent" "$OUT/.opencode/agents/concertino-executor.md"
has "delivery command selects concertino-orchestrator" "agent: concertino-orchestrator" "$OUT/.opencode/commands/concertino-deliver.md"

# opencode-ollama.json (the example this test starts from) has "opencode" in
# providers.ollama.harnesses — so opencode.json's provider.ollama entry
# should be populated.
has "opencode.json includes a provider.ollama entry" '"ollama"' "$OUT/opencode.json"
has "opencode.json's ollama provider is OpenAI-compatible" "@ai-sdk/openai-compatible" "$OUT/opencode.json"
has "opencode.json's baseURL carries the /v1 suffix" "http://localhost:11434/v1" "$OUT/opencode.json"

# Every non-opencode file this run's harnesses also touch must still exist —
# opencode-ollama.json's harnesses is ["opencode", "codex"].
exists "codex AGENTS.md still renders" "$OUT/AGENTS.md"

rm -rf "$OUT"

# --- claude-code + codex only: no OpenCode-specific file appears ------------
OUT="$(mktemp -d)"
CFG="$OUT/concertino.config.json"
write_config "$CFG" '{"harnesses": ["claude-code", "codex"], "providers": {}}'
node "$ROOT/bin/concertino" sync --out="$OUT" --config="$CFG" > "$OUT/sync.txt" 2>&1
RC=$?
[ "$RC" -eq 0 ] && ok "claude-code+codex-only sync exits zero" || bad "claude-code+codex-only sync exits zero" "exit $RC:\n$(cat "$OUT/sync.txt")"

absent "no .opencode/ directory written" "$OUT/.opencode"
absent "no opencode.json written" "$OUT/opencode.json"
exists "claude-code files still render" "$OUT/.claude/agents/concertino-executor.md"
exists "codex files still render" "$OUT/AGENTS.md"

rm -rf "$OUT"

# --- opencode eject supports all five roles ----------------------------------
OUT="$(mktemp -d)"
CFG="$OUT/concertino.config.json"
write_config "$CFG" '{}'
node "$ROOT/bin/concertino" sync --out="$OUT" --config="$CFG" > /dev/null 2>&1
for role in orchestrator executor evaluator skeptic auditor; do
  # Written to a file rather than piped into `grep -q` directly: `grep -q`
  # exits as soon as it finds its match (early, for the very first line
  # here), which can SIGPIPE a still-writing left-hand side of a live pipe —
  # under this script's own `set -o pipefail`, that spurious SIGPIPE exit
  # code (not grep's own result) becomes the pipeline's reported status,
  # exactly the kind of flaky, content-length-dependent failure a plain file
  # write + grep avoids entirely.
  EJECTED_FILE="$OUT/ejected-$role.txt"
  node "$ROOT/bin/concertino" eject --role="$role" --harness=opencode --out="$OUT" --config="$CFG" > "$EJECTED_FILE" 2>&1
  # "# concertino:sync", not "---" — grep -F mis-parses a leading "---" as an
  # option rather than a literal pattern (it would need an explicit "--"
  # separator); every rendered frontmatter carries this marker line too, so
  # it's an equally good "this is a real rendered file" signal.
  has "eject --harness=opencode --role=$role prints a rendered agent file" "# concertino:sync" "$EJECTED_FILE"
done
rm -rf "$OUT"

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
