#!/usr/bin/env bash
# CON-63: Codex's Ollama provider wiring — `[model_providers.ollama]` in
# `.codex/config.toml` and `model_provider = "ollama"` on Ollama-routed
# per-role `.codex/agents/*.toml` files. Covers the merge-marker behavior on
# .codex/config.toml specifically: initial render, and a re-render that
# preserves hand-authored content outside the marked region. Run:
#   bash test/scripts/codex-ollama-render.test.sh
set -uo pipefail

export NO_COLOR=1
unset FORCE_COLOR

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PASS=0; FAIL=0
ok()    { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()   { FAIL=$((FAIL+1)); echo "  FAIL $1"; echo "       $2"; }
has()   { grep -qF "$2" "$3" 2>/dev/null && ok "$1" || bad "$1" "expected to find [$2] in $3"; }
hasnt() { grep -qF "$2" "$3" 2>/dev/null && bad "$1" "unexpectedly found [$2] in $3" || ok "$1"; }

echo "codex Ollama provider rendering (CON-63)"

write_config() {
  # $1 = target config path, $2 = JSON to merge over config/examples/opencode-ollama.json
  node -e '
    const fs = require("fs");
    const base = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    Object.assign(base, JSON.parse(process.argv[3]));
    fs.writeFileSync(process.argv[2], JSON.stringify(base, null, 2));
  ' "$ROOT/config/examples/opencode-ollama.json" "$1" "$2"
}

OUT="$(mktemp -d)"
CFG="$OUT/concertino.config.json"
# opencode-ollama.json already has harnesses: ["opencode", "codex"] and
# providers.ollama.harnesses: ["codex", "opencode"] — codex is Ollama-routed
# out of the box.
write_config "$CFG" '{}'

# --- initial render ----------------------------------------------------------
node "$ROOT/bin/concertino" sync --out="$OUT" --config="$CFG" > "$OUT/sync1.txt" 2>&1
RC=$?
[ "$RC" -eq 0 ] && ok "initial sync exits zero" || bad "initial sync exits zero" "exit $RC:\n$(cat "$OUT/sync1.txt")"

TOML="$OUT/.codex/config.toml"
[ -f "$TOML" ] && ok "renders .codex/config.toml" || bad "renders .codex/config.toml" "not found"
has "config.toml has the model_providers.ollama block" "[model_providers.ollama]" "$TOML"
has "config.toml carries base_url from providers.ollama.baseUrl" 'base_url = "http://localhost:11434"' "$TOML"
has "config.toml carries env_key from providers.ollama.apiKeyEnv" 'env_key = "OLLAMA_API_KEY"' "$TOML"
has "config.toml uses the BEGIN merge marker" "# CONCERTINO:BEGIN" "$TOML"
has "config.toml uses the END merge marker" "# CONCERTINO:END" "$TOML"

# Roles with no explicit models.codex.<role> override are Ollama-routed —
# opencode-ollama.json sets no models.codex overrides at all.
has "executor .toml gets model_provider = \"ollama\"" 'model_provider = "ollama"' "$OUT/.codex/agents/concertino-executor.toml"

# --- hand-authored content outside the marked region survives a re-sync ----
printf '\n# hand-authored: keep this comment\n[my_custom_section]\nfoo = "bar"\n' >> "$TOML"
ORIGINAL_HAND_AUTHORED_LINE_COUNT="$(grep -c 'hand-authored' "$TOML")"

node "$ROOT/bin/concertino" sync --out="$OUT" --config="$CFG" > "$OUT/sync2.txt" 2>&1
RC=$?
[ "$RC" -eq 0 ] && ok "re-sync exits zero" || bad "re-sync exits zero" "exit $RC:\n$(cat "$OUT/sync2.txt")"

has "re-sync preserves the hand-authored comment" "hand-authored: keep this comment" "$TOML"
has "re-sync preserves the hand-authored section" "[my_custom_section]" "$TOML"
has "re-sync preserves the hand-authored value" 'foo = "bar"' "$TOML"
has "re-sync still has the managed block" "[model_providers.ollama]" "$TOML"
NEW_HAND_AUTHORED_LINE_COUNT="$(grep -c 'hand-authored' "$TOML")"
if [ "$ORIGINAL_HAND_AUTHORED_LINE_COUNT" = "$NEW_HAND_AUTHORED_LINE_COUNT" ]; then
  ok "hand-authored content is not duplicated across re-syncs"
else
  bad "hand-authored content is not duplicated across re-syncs" "was $ORIGINAL_HAND_AUTHORED_LINE_COUNT, now $NEW_HAND_AUTHORED_LINE_COUNT"
fi

rm -rf "$OUT"

# --- codex NOT Ollama-routed: no .codex/config.toml, unaffected agent files -
OUT="$(mktemp -d)"
CFG="$OUT/concertino.config.json"
write_config "$CFG" '{"harnesses": ["codex"], "providers": {}}'
node "$ROOT/bin/concertino" sync --out="$OUT" --config="$CFG" > "$OUT/sync.txt" 2>&1
RC=$?
[ "$RC" -eq 0 ] && ok "codex-only, no providers: sync exits zero" || bad "codex-only, no providers: sync exits zero" "exit $RC"
[ -f "$OUT/.codex/config.toml" ] && bad "no .codex/config.toml when codex is not Ollama-routed" "found one" || ok "no .codex/config.toml when codex is not Ollama-routed"
hasnt "executor .toml has no model_provider line when not opted in" "model_provider" "$OUT/.codex/agents/concertino-executor.toml"

rm -rf "$OUT"

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
