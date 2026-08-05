#!/usr/bin/env bash
# CON-73: `concertino doctor` must catch, locally and cheaply, what today only
# surfaces at launch inside a spawned tmux window — a configured
# `providers.ollama.models.<role>` that isn't actually pulled, or that lacks
# a capability the harness that will run it requires (Codex's `--oss` route
# rejects any model missing `thinking`). A sibling to doctor-base-branch.test.sh
# and doctor-artifacts.test.sh: same throwaway-project setup, exercising the
# `Providers` section's new per-model checks instead.
#
# `curl` is stubbed with a minimal fake on PATH so these tests never touch a
# real Ollama endpoint — see mock_curl() below. Doctor's own exit code is not
# asserted (it also checks the Codex/OpenCode CLIs and gh auth, unrelated to
# this test, and those legitimately fail on a machine without them installed).
set -uo pipefail

export NO_COLOR=1
unset FORCE_COLOR

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PASS=0; FAIL=0
ok()    { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()   { FAIL=$((FAIL+1)); echo "  FAIL $1"; echo "       $2"; }
has()   { grep -qF "$2" "$3" 2>/dev/null && ok "$1" || bad "$1" "expected to find [$2] in $3"; }
hasnt() { grep -qF "$2" "$3" 2>/dev/null && bad "$1" "unexpectedly found [$2] in $3" || ok "$1"; }

echo "concertino doctor (Ollama per-role model validation)"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# --- a minimal fake curl -----------------------------------------------------
# Serves $MOCK_CURL_DIR/tags.json for GET .../api/tags, and
# $MOCK_CURL_DIR/show-<sanitized model>.json for POST .../api/show (model read
# from the -d JSON body), or fails outright per MOCK_CURL_UNREACHABLE /
# MOCK_CURL_TAGS_FAIL / MOCK_CURL_SHOW_FAIL, to simulate each failure mode
# doctor.js must degrade cleanly from.
MOCKBIN="$(mktemp -d)"
cat > "$MOCKBIN/curl" <<'EOF'
#!/usr/bin/env bash
URL=""
BODY=""
prev=""
for a in "$@"; do
  case "$a" in http*) URL="$a" ;; esac
  if [ "$prev" = "-d" ]; then BODY="$a"; fi
  prev="$a"
done

case "$URL" in
  */api/tags)
    [ -n "${MOCK_CURL_TAGS_FAIL:-}" ] && exit 1
    cat "$MOCK_CURL_DIR/tags.json"
    exit 0
    ;;
  */api/show)
    [ -n "${MOCK_CURL_SHOW_FAIL:-}" ] && exit 1
    MODEL="$(node -e 'console.log(JSON.parse(process.argv[1]).model)' "$BODY")"
    SAFE="$(printf '%s' "$MODEL" | tr ':/' '__')"
    FILE="$MOCK_CURL_DIR/show-$SAFE.json"
    [ -f "$FILE" ] && cat "$FILE" || echo '{}'
    exit 0
    ;;
  *)
    # bare reachability probe (`-o /dev/null`)
    [ -n "${MOCK_CURL_UNREACHABLE:-}" ] && exit 1
    exit 0
    ;;
esac
EOF
chmod +x "$MOCKBIN/curl"
export PATH="$MOCKBIN:$PATH"

MOCK_CURL_DIR="$(mktemp -d)"
export MOCK_CURL_DIR
write_show() {
  # $1 = model id, $2 = JSON to write as its /api/show response
  local safe; safe="$(printf '%s' "$1" | tr ':/' '__')"
  printf '%s' "$2" > "$MOCK_CURL_DIR/show-$safe.json"
}

# opencode-ollama.json already has providers.ollama.baseUrl set and
# harnesses: ["codex", "opencode"] with codex Ollama-routed out of the box —
# same base every codex-ollama-render.test.sh scenario builds from.
write_config() {
  # $1 = target config path, $2 = JSON to replace providers.ollama with
  node -e '
    const fs = require("fs");
    const base = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    base.providers.ollama = JSON.parse(process.argv[3]);
    fs.writeFileSync(process.argv[2], JSON.stringify(base, null, 2));
  ' "$ROOT/config/examples/opencode-ollama.json" "$1" "$2"
}

sync_project() {
  # $1 = target dir (already has concertino.config.json written into it)
  node "$ROOT/bin/concertino" sync --out="$1" --config="$1/concertino.config.json" > "$1/sync.txt" 2>&1
  if [ $? -ne 0 ]; then
    echo "  FAIL sync into throwaway project $1"
    tail -5 "$1/sync.txt"
    exit 1
  fi
}

# =============================================================================
# Scenario 1: mixed models — not pulled, missing tools, missing thinking
# (codex Ollama-routed), and a fully-capable model, all in one config so each
# warning's specificity (role + model + capability) can be checked at once.
# =============================================================================
PRIMARY="$WORK/primary"
mkdir -p "$PRIMARY"
write_config "$PRIMARY/concertino.config.json" '{
  "baseUrl": "http://localhost:11434",
  "apiKeyEnv": "OLLAMA_API_KEY",
  "harnesses": ["codex", "opencode"],
  "models": {
    "orchestrator": "missing-model:1b",
    "executor": "no-tools-model:8b",
    "evaluator": "no-thinking-model:14b",
    "auditor": "full-model:30b"
  }
}'
sync_project "$PRIMARY"

cat > "$MOCK_CURL_DIR/tags.json" <<'EOF'
{"models":[{"name":"no-tools-model:8b"},{"name":"no-thinking-model:14b"},{"name":"full-model:30b"}]}
EOF
write_show "missing-model:1b"     '{"capabilities":["completion","tools","thinking"]}'
write_show "no-tools-model:8b"    '{"capabilities":["completion"]}'
write_show "no-thinking-model:14b" '{"capabilities":["completion","tools"]}'
write_show "full-model:30b"       '{"capabilities":["completion","tools","thinking"]}'

OUT="$WORK/doctor.txt"
node "$ROOT/bin/concertino" doctor --out="$PRIMARY" > "$OUT" 2>&1
has "warns about an unpulled model, naming the role" "orchestrator" "$OUT"
has "warns about an unpulled model, naming the model id" "missing-model:1b" "$OUT"
has "names it as not pulled locally" "not pulled locally" "$OUT"

has "warns about a model missing tools, naming the role" "executor" "$OUT"
has "warns about a model missing tools, naming the model id" "no-tools-model:8b" "$OUT"
has "names tools as the missing capability" "\"tools\" capability" "$OUT"

has "warns about a model missing thinking, naming the role" "evaluator" "$OUT"
has "warns about a model missing thinking, naming the model id" "no-thinking-model:14b" "$OUT"
has "names thinking as the missing capability" "\"thinking\" capability" "$OUT"
has "names Codex as the requirement" "Codex" "$OUT"

hasnt "the fully-capable auditor model is not warned about" "full-model:30b" "$OUT"

# =============================================================================
# Scenario 2: same missing-thinking model, but codex is NOT Ollama-routed —
# no thinking warning should appear (tools is still required regardless).
# =============================================================================
PRIMARY2="$WORK/primary2"
mkdir -p "$PRIMARY2"
write_config "$PRIMARY2/concertino.config.json" '{
  "baseUrl": "http://localhost:11434",
  "harnesses": ["opencode"],
  "models": {
    "evaluator": "no-thinking-model:14b"
  }
}'
sync_project "$PRIMARY2"

OUT2="$WORK/doctor2.txt"
node "$ROOT/bin/concertino" doctor --out="$PRIMARY2" > "$OUT2" 2>&1
hasnt "no thinking warning when codex is not Ollama-routed" "\"thinking\" capability" "$OUT2"

# =============================================================================
# Scenario 3: unreachable endpoint — per-model checks skip cleanly (no crash,
# no warning about them), and doctor still runs its other sections.
# =============================================================================
PRIMARY3="$WORK/primary3"
mkdir -p "$PRIMARY3"
write_config "$PRIMARY3/concertino.config.json" '{
  "baseUrl": "http://localhost:11434",
  "harnesses": ["opencode"],
  "models": {
    "executor": "no-tools-model:8b"
  }
}'
sync_project "$PRIMARY3"

OUT3="$WORK/doctor3.txt"
MOCK_CURL_UNREACHABLE=1 node "$ROOT/bin/concertino" doctor --out="$PRIMARY3" > "$OUT3" 2>&1
has   "reports the base reachability warning" "unreachable at" "$OUT3"
hasnt "skips the per-model capability warning when unreachable" "\"tools\" capability" "$OUT3"
hasnt "skips the per-model pulled warning when unreachable" "not pulled locally" "$OUT3"
has   "doctor still runs its other sections when Ollama is unreachable" "Rendered artifacts" "$OUT3"

# =============================================================================
# Scenario 4: fully-capable configuration — every model pulled, with tools
# and thinking — produces no new noise.
# =============================================================================
PRIMARY4="$WORK/primary4"
mkdir -p "$PRIMARY4"
write_config "$PRIMARY4/concertino.config.json" '{
  "baseUrl": "http://localhost:11434",
  "harnesses": ["codex", "opencode"],
  "models": {
    "orchestrator": "full-model:30b",
    "executor": "full-model:30b",
    "evaluator": "full-model:30b",
    "auditor": "full-model:30b"
  }
}'
sync_project "$PRIMARY4"

cat > "$MOCK_CURL_DIR/tags.json" <<'EOF'
{"models":[{"name":"full-model:30b"}]}
EOF

OUT4="$WORK/doctor4.txt"
node "$ROOT/bin/concertino" doctor --out="$PRIMARY4" > "$OUT4" 2>&1
hasnt "no pulled warning for a fully-capable config" "not pulled locally" "$OUT4"
hasnt "no tools warning for a fully-capable config" "\"tools\" capability" "$OUT4"
hasnt "no thinking warning for a fully-capable config" "\"thinking\" capability" "$OUT4"

# =============================================================================
# Scenario 5 (CON-75): claude-code on the DIRECT route (no gateway) — doctor
# reports providers.ollama.route: direct.
# =============================================================================
PRIMARY5="$WORK/primary5"
mkdir -p "$PRIMARY5"
write_config "$PRIMARY5/concertino.config.json" '{
  "baseUrl": "http://localhost:11434",
  "harnesses": ["claude-code"]
}'
node -e '
  const fs = require("fs");
  const p = process.argv[1];
  const c = JSON.parse(fs.readFileSync(p, "utf8"));
  c.harnesses = ["claude-code"];
  fs.writeFileSync(p, JSON.stringify(c));
' "$PRIMARY5/concertino.config.json"
sync_project "$PRIMARY5"

OUT5="$WORK/doctor5.txt"
node "$ROOT/bin/concertino" doctor --out="$PRIMARY5" > "$OUT5" 2>&1
has   "reports the direct route for claude-code" "providers.ollama.route" "$OUT5"
has   "direct route value is \"direct\"" "direct" "$OUT5"
hasnt "does not report a gateway route" "gateway" "$OUT5"

# =============================================================================
# Scenario 6 (CON-75): claude-code on the GATEWAY route — doctor reports
# providers.ollama.route: gateway (unchanged reachability check alongside it).
# =============================================================================
PRIMARY6="$WORK/primary6"
mkdir -p "$PRIMARY6"
write_config "$PRIMARY6/concertino.config.json" '{
  "baseUrl": "http://localhost:11434",
  "harnesses": ["claude-code"],
  "gateway": { "baseUrl": "http://localhost:4000" }
}'
node -e '
  const fs = require("fs");
  const p = process.argv[1];
  const c = JSON.parse(fs.readFileSync(p, "utf8"));
  c.harnesses = ["claude-code"];
  fs.writeFileSync(p, JSON.stringify(c));
' "$PRIMARY6/concertino.config.json"
sync_project "$PRIMARY6"

OUT6="$WORK/doctor6.txt"
node "$ROOT/bin/concertino" doctor --out="$PRIMARY6" > "$OUT6" 2>&1
has "reports the gateway route for claude-code" "providers.ollama.route" "$OUT6"
has "gateway route value is \"gateway\"" "gateway" "$OUT6"

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
