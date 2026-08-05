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
# CON-73: Codex IGNORES `model_providers` in a project-local config.toml
# (verified against codex-cli 0.146.0, which warns on every launch), so the
# managed region must NOT define one — pairing it with `-c
# model_provider=ollama` killed runs with `unknown input item type:
# "additional_tools"`. Local routing goes through `--oss` flags instead.
lacks() { if grep -qF "$2" "$3"; then bad "$1" "did NOT expect [$2] in $3"; else ok "$1"; fi; }
lacks "config.toml does NOT define model_providers (codex ignores it project-local)" "[model_providers.ollama]" "$TOML"
has "config.toml documents the endpoint for a human reading it" "http://localhost:11434" "$TOML"
has "config.toml points at the supported --oss route" "codex --oss --local-provider ollama" "$TOML"
has "config.toml uses the BEGIN merge marker" "# CONCERTINO:BEGIN" "$TOML"
has "config.toml uses the END merge marker" "# CONCERTINO:END" "$TOML"

# Roles with no explicit models.codex.<role> override are Ollama-routed —
# opencode-ollama.json sets no models.codex overrides at all.
has "executor .toml gets model_provider = \"ollama\"" 'model_provider = "ollama"' "$OUT/.codex/agents/concertino-executor.toml"

# --- speeds.json carries the Ollama-resolved models -------------------------
# renderSpeedsJson folds providers.ollama.models into the models map for every
# Ollama-routed (harness, role) — resolve-speed.sh's runtime lookup is only
# `explicit // tier`, so without the fold an Ollama-routed role's READY
# models= would report the HOSTED tier model while the rendered agent files
# say the local one.
SPEEDS="$OUT/scripts/concertino/speeds.json"
speeds_field() { node -e '
  const s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const v = process.argv[2].split(".").reduce((o, k) => (o == null ? o : o[k]), s.models);
  console.log(v === undefined ? "<absent>" : v);
' "$SPEEDS" "$1"; }
check_eq() { [ "$2" = "$3" ] && ok "$1" || bad "$1" "expected [$3], got [$2]"; }
# CON-65: the Ollama provider map is no longer folded into the explicit
# model slots at render time — it rides along as speeds.json's own
# `providers.ollama` block, and resolve-speed.sh applies the precedence at
# lookup time (which is what makes a per-run CONCERTINO_PROVIDER flip
# possible at all). The render-side contract is therefore: models stays
# verbatim, providers block carries the map.
check_eq "speeds.json codex.executor stays un-folded (absent)"   "$(speeds_field codex.executor)"      "<absent>"
check_eq "speeds.json keeps the explicit opencode.skeptic"       "$(speeds_field opencode.skeptic)"    "anthropic/claude-opus-4-1"
check_eq "speeds.json claude-code.executor stays absent"         "$(speeds_field claude-code.executor)" "<absent>"
providers_field() { node -e '
  const s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const v = process.argv[2].split(".").reduce((o, k) => (o == null ? o : o[k]), s.providers);
  console.log(v === undefined ? "<absent>" : (Array.isArray(v) ? v.join(",") : v));
' "$SPEEDS" "$1"; }
check_eq "speeds.json providers.ollama.models.executor carries the map" "$(providers_field ollama.models.executor)" "llama3.1:70b"
check_eq "speeds.json providers.ollama.harnesses carries the routing"   "$(providers_field ollama.harnesses)"       "codex,opencode"

# --- resolve-speed.sh applies the provider routing at lookup time ----------
RESOLVE="$OUT/scripts/concertino/resolve-speed.sh"
resolve_model() { # $1=harness $2=CONCERTINO_PROVIDER (empty = project default)
  CONCERTINO_PROVIDER="$2" "$RESOLVE" default "$1" 2>/dev/null | node -e '
    let d = ""; process.stdin.on("data", (c) => d += c);
    process.stdin.on("end", () => { const j = JSON.parse(d); console.log(j.models.executor + " " + j.provider); });
  '; }
check_eq "resolve-speed: routed codex executor is the Ollama model"     "$(resolve_model codex '')"        "llama3.1:70b ollama"
check_eq "resolve-speed: routed opencode executor is the Ollama model"  "$(resolve_model opencode '')"     "llama3.1:70b ollama"
check_eq "resolve-speed: CONCERTINO_PROVIDER=default flips codex back"  "$(resolve_model codex default)"   "codex-mini-latest default"
check_eq "resolve-speed: claude-code models never provider-substituted" "$(resolve_model claude-code '')"  "sonnet default"
check_eq "resolve-speed: CONCERTINO_PROVIDER=ollama is explicit ollama" "$(resolve_model codex ollama)"    "llama3.1:70b ollama"

# --- hand-authored content outside the marked region survives a re-sync ----
printf '\n# hand-authored: keep this comment\n[my_custom_section]\nfoo = "bar"\n' >> "$TOML"
ORIGINAL_HAND_AUTHORED_LINE_COUNT="$(grep -c 'hand-authored' "$TOML")"

node "$ROOT/bin/concertino" sync --out="$OUT" --config="$CFG" > "$OUT/sync2.txt" 2>&1
RC=$?
[ "$RC" -eq 0 ] && ok "re-sync exits zero" || bad "re-sync exits zero" "exit $RC:\n$(cat "$OUT/sync2.txt")"

has "re-sync preserves the hand-authored comment" "hand-authored: keep this comment" "$TOML"
has "re-sync preserves the hand-authored section" "[my_custom_section]" "$TOML"
has "re-sync preserves the hand-authored value" 'foo = "bar"' "$TOML"
has "re-sync still has the managed block" "CONCERTINO:BEGIN" "$TOML"
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
