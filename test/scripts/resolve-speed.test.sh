#!/usr/bin/env bash
# Shell tests for CON-22's resolve-speed.sh — the runtime half of
# delivery-speed-presets. Run:
#   bash test/scripts/resolve-speed.test.sh
#
# Fixtures a rendered speeds.json (the shape `concertino sync` actually
# writes — see renderSpeedsJson() in bin/concertino) and asserts resolution
# for fast/default/slow x claude-code/codex, with and without an explicit
# $2 harness override, including the explicit-model-override-beats-tier case
# and the unrecognized-speed / unknown-harness failure cases (design.md
# Decision 3 / tasks.md 2.6).
#
# SAFETY: everything runs against a throwaway scratch dir's own copy of
# resolve-speed.sh + speeds.json + .concertino.env — never this checkout's
# own scripts/concertino/ (which is this repo's own, real, git-tracked one).
set -uo pipefail

export NO_COLOR=1
unset FORCE_COLOR

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL $1"; echo "       $2"; }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected [$3] got [$2]"; fi; }
has()  { if printf '%s' "$2" | grep -qF "$3"; then ok "$1"; else bad "$1" "expected to find [$3] in [$2]"; fi; }

echo "resolve-speed.sh (CON-22)"

if ! command -v jq >/dev/null 2>&1; then
  echo "  SKIP jq not found on PATH — resolve-speed.sh requires it"
  exit 0
fi

# A throwaway copy of resolve-speed.sh plus a fixtured speeds.json/
# .concertino.env next to it, mirroring exactly what `concertino sync`
# renders into a project's scripts/concertino/.
new_scripts() {
  local d; d="$(mktemp -d)"
  cp "$ROOT/core/scripts/resolve-speed.sh" "$d/"
  chmod +x "$d/resolve-speed.sh"
  cat > "$d/speeds.json" <<'JSON'
{
  "budgets": { "executionCycles": 3, "skepticDesignRounds": 3, "skepticFinalRounds": 2, "debugAttempts": 2 },
  "speeds": {
    "fast": {
      "budgets": { "executionCycles": 2, "skepticDesignRounds": 1 },
      "roleTiers": { "orchestrator": "standard", "executor": "cheap", "evaluator": "cheap", "skeptic": "capable", "auditor": "standard" }
    },
    "default": {
      "budgets": {},
      "roleTiers": { "orchestrator": "standard", "executor": "standard", "evaluator": "standard", "skeptic": "standard", "auditor": "standard" }
    },
    "slow": {
      "budgets": { "executionCycles": 5, "skepticDesignRounds": 5, "skepticFinalRounds": 3, "debugAttempts": 3 },
      "roleTiers": { "orchestrator": "capable", "executor": "capable", "evaluator": "capable", "skeptic": "capable", "auditor": "capable" },
      "secondFinalGateSkeptic": true,
      "evaluatorCleanWorktree": true
    }
  },
  "modelTiers": {
    "claude-code": { "cheap": "haiku", "standard": "sonnet", "capable": "opus" },
    "codex": { "cheap": "codex-mini-latest", "standard": "codex-mini-latest", "capable": "gpt-5.1-codex" }
  },
  "models": {
    "claude-code": { "skeptic": "opus" },
    "codex": {}
  }
}
JSON
  printf "CONCERTINO_HARNESS=''\n" > "$d/.concertino.env"
  printf '%s' "$d"
}

field() {
  # $1 = json, $2 = jq filter
  printf '%s' "$1" | jq -r "$2"
}

# --- fast x claude-code: cheaper execution/evaluation, capable skeptic ------
SCRIPTS="$(new_scripts)"
OUT="$("$SCRIPTS/resolve-speed.sh" fast claude-code)"; RC=$?
check "a.1 exits zero"                    "$RC" "0"
check "a.1 speed"                         "$(field "$OUT" .speed)" "fast"
check "a.1 harness"                       "$(field "$OUT" .harness)" "claude-code"
check "a.1 budgets.executionCycles"       "$(field "$OUT" .budgets.executionCycles)" "2"
check "a.1 unmentioned budget falls back" "$(field "$OUT" .budgets.skepticFinalRounds)" "2"
check "a.1 executor -> cheap tier"        "$(field "$OUT" .models.executor)" "haiku"
check "a.1 skeptic -> EXPLICIT override, not capable tier (both happen to be opus, but via the override path)" \
                                           "$(field "$OUT" .models.skeptic)" "opus"
check "a.1 orchestrator -> standard tier" "$(field "$OUT" .models.orchestrator)" "sonnet"
check "a.1 secondFinalGateSkeptic false"  "$(field "$OUT" .secondFinalGateSkeptic)" "false"
rm -rf "$SCRIPTS"

# --- explicit override beats tier, proven with a DIFFERING value -----------
# a.1's skeptic=opus is ambiguous (capable tier is also opus) — this fixture
# sets models.claude-code.evaluator to something the cheap tier would never
# produce, so a pass here can only mean the override path actually won.
SCRIPTS="$(new_scripts)"
node -e '
  const fs = require("fs");
  const p = process.argv[1];
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  j.models["claude-code"].evaluator = "sonnet";
  fs.writeFileSync(p, JSON.stringify(j));
' "$SCRIPTS/speeds.json"
OUT="$("$SCRIPTS/resolve-speed.sh" fast claude-code)"
check "a.2 explicit models.claude-code.evaluator beats fast's cheap tier" "$(field "$OUT" .models.evaluator)" "sonnet"
rm -rf "$SCRIPTS"

# --- default x codex: standard tier everywhere, no explicit codex overrides -
SCRIPTS="$(new_scripts)"
OUT="$("$SCRIPTS/resolve-speed.sh" default codex)"; RC=$?
check "b.1 exits zero"              "$RC" "0"
check "b.1 harness"                 "$(field "$OUT" .harness)" "codex"
check "b.1 evaluator -> standard"   "$(field "$OUT" .models.evaluator)" "codex-mini-latest"
check "b.1 budgets unchanged from top-level default" "$(field "$OUT" .budgets.executionCycles)" "3"
rm -rf "$SCRIPTS"

# --- slow x claude-code: every role capable, both slow-only flags true -----
SCRIPTS="$(new_scripts)"
OUT="$("$SCRIPTS/resolve-speed.sh" slow claude-code)"
check "c.1 executor -> capable"              "$(field "$OUT" .models.executor)" "opus"
check "c.1 budgets.executionCycles raised"   "$(field "$OUT" .budgets.executionCycles)" "5"
check "c.1 secondFinalGateSkeptic true"      "$(field "$OUT" .secondFinalGateSkeptic)" "true"
check "c.1 evaluatorCleanWorktree true"      "$(field "$OUT" .evaluatorCleanWorktree)" "true"
rm -rf "$SCRIPTS"

# --- no speed argument -> "default" ----------------------------------------
SCRIPTS="$(new_scripts)"
OUT="$("$SCRIPTS/resolve-speed.sh" '' claude-code)"
check "d.1 empty speed arg resolves default" "$(field "$OUT" .speed)" "default"
# A genuinely empty static default (no $2, no runtime signal, no
# .concertino.env override) resolves HARNESS to the literal "unknown",
# which resolve-speed.sh correctly treats as fatal (see g.2) — so this
# assertion can only be exercised with a static default actually in place,
# same fixture e.3 below uses to check .harness. Bare CLAUDECODE/etc.
# stripping alone still resolved harness "for free" via whatever ambient
# signal happened to be set in the shell running the suite, never actually
# reaching this fallback path — invisible until a CI runner with none of
# those signals set exercises it for real.
sed -i "s/CONCERTINO_HARNESS=''/CONCERTINO_HARNESS='claude-code'/" "$SCRIPTS/.concertino.env"
OUT2="$(env -u CLAUDECODE -u CODEX_SANDBOX -u CODEX_SANDBOX_NETWORK_DISABLED -u OPENCODE "$SCRIPTS/resolve-speed.sh")"
check "d.2 no args at all resolves default (harness from empty static default)" "$(field "$OUT2" .speed)" "default"
rm -rf "$SCRIPTS"

# --- $2 omitted -> auto-detect, same order as setup-worktree.sh ------------
SCRIPTS="$(new_scripts)"
OUT="$(env -u CLAUDECODE -u CODEX_SANDBOX -u CODEX_SANDBOX_NETWORK_DISABLED CLAUDECODE=1 "$SCRIPTS/resolve-speed.sh" fast)"
check "e.1 CLAUDECODE set, no \$2 -> claude-code" "$(field "$OUT" .harness)" "claude-code"
rm -rf "$SCRIPTS"

SCRIPTS="$(new_scripts)"
OUT="$(env -u CLAUDECODE -u CODEX_SANDBOX -u CODEX_SANDBOX_NETWORK_DISABLED CODEX_SANDBOX=1 "$SCRIPTS/resolve-speed.sh" fast)"
check "e.2 CODEX_SANDBOX set, no \$2 -> codex" "$(field "$OUT" .harness)" "codex"
rm -rf "$SCRIPTS"

SCRIPTS="$(new_scripts)"
sed -i "s/CONCERTINO_HARNESS=''/CONCERTINO_HARNESS='codex'/" "$SCRIPTS/.concertino.env"
OUT="$(env -u CLAUDECODE -u CODEX_SANDBOX -u CODEX_SANDBOX_NETWORK_DISABLED "$SCRIPTS/resolve-speed.sh" fast)"
check "e.3 no runtime signal, \$2 omitted -> falls back to static .concertino.env default" "$(field "$OUT" .harness)" "codex"
rm -rf "$SCRIPTS"

# --- explicit $2 always wins, even over a conflicting runtime signal -------
SCRIPTS="$(new_scripts)"
OUT="$(env -u CODEX_SANDBOX -u CODEX_SANDBOX_NETWORK_DISABLED CLAUDECODE=1 "$SCRIPTS/resolve-speed.sh" fast codex)"
check "f.1 explicit \$2 used verbatim, even though CLAUDECODE is set" "$(field "$OUT" .harness)" "codex"
rm -rf "$SCRIPTS"

# --- unrecognized speed -----------------------------------------------------
SCRIPTS="$(new_scripts)"
ERR="$("$SCRIPTS/resolve-speed.sh" turbo claude-code 2>&1 1>/dev/null)"; RC=$?
check "g.1 unknown speed exits non-zero" "$RC" "1"
has   "g.1 unknown speed message names it" "$ERR" "unknown speed"
has   "g.1 unknown speed message names the bad value" "$ERR" "turbo"
rm -rf "$SCRIPTS"

# --- harness with no modelTiers data ----------------------------------------
SCRIPTS="$(new_scripts)"
ERR="$("$SCRIPTS/resolve-speed.sh" fast bogus-harness 2>&1 1>/dev/null)"; RC=$?
check "g.2 unknown harness exits non-zero" "$RC" "1"
has   "g.2 unknown harness message names it" "$ERR" "bogus-harness"
rm -rf "$SCRIPTS"

# --- missing speeds.json altogether -----------------------------------------
SCRIPTS="$(mktemp -d)"
cp "$ROOT/core/scripts/resolve-speed.sh" "$SCRIPTS/"
chmod +x "$SCRIPTS/resolve-speed.sh"
ERR="$("$SCRIPTS/resolve-speed.sh" fast claude-code 2>&1 1>/dev/null)"; RC=$?
check "h.1 missing speeds.json exits non-zero" "$RC" "1"
has   "h.1 missing speeds.json message says so" "$ERR" "speeds.json"
rm -rf "$SCRIPTS"

# --- CON-75: claude-code direct route (no gateway) vs. gateway route -------
# A fixture with providers.ollama.harnesses including claude-code, a
# provider model map, and gatewayConfigured set either way — mirrors exactly
# what renderSpeedsJson (lib/cli/render.js) now writes into speeds.json.
new_scripts_ollama_claude_code() {
  # $1 = "true" | "false" for providers.ollama.gatewayConfigured
  local d; d="$(mktemp -d)"
  cp "$ROOT/core/scripts/resolve-speed.sh" "$d/"
  chmod +x "$d/resolve-speed.sh"
  cat > "$d/speeds.json" <<JSON
{
  "budgets": { "executionCycles": 3, "skepticDesignRounds": 3, "skepticFinalRounds": 2, "debugAttempts": 2 },
  "speeds": {
    "default": {
      "budgets": {},
      "roleTiers": { "orchestrator": "standard", "executor": "standard", "evaluator": "standard", "skeptic": "standard", "auditor": "standard" }
    }
  },
  "modelTiers": {
    "claude-code": { "cheap": "haiku", "standard": "sonnet", "capable": "opus" }
  },
  "models": { "claude-code": {} },
  "providers": {
    "ollama": {
      "harnesses": ["claude-code"],
      "models": { "executor": "qwen3:8b" },
      "gatewayConfigured": $1
    }
  }
}
JSON
  printf "CONCERTINO_HARNESS=''\n" > "$d/.concertino.env"
  printf '%s' "$d"
}

# gatewayConfigured=false (direct route): claude-code IS provider-substituted,
# same as any other Ollama-routed harness.
SCRIPTS="$(new_scripts_ollama_claude_code false)"
OUT="$("$SCRIPTS/resolve-speed.sh" default claude-code)"
check "i.1 direct route: claude-code executor resolves the provider model" "$(field "$OUT" .models.executor)" "qwen3:8b"
check "i.1 direct route: provider reported as ollama"                     "$(field "$OUT" .provider)" "ollama"
rm -rf "$SCRIPTS"

# gatewayConfigured=true (gateway route): claude-code is NOT provider-
# substituted — unchanged pre-CON-75 behavior — the tier model wins instead.
SCRIPTS="$(new_scripts_ollama_claude_code true)"
OUT="$("$SCRIPTS/resolve-speed.sh" default claude-code)"
check "i.2 gateway route: claude-code executor is NOT provider-substituted" "$(field "$OUT" .models.executor)" "sonnet"
check "i.2 gateway route: provider reported as default"                    "$(field "$OUT" .provider)" "default"
rm -rf "$SCRIPTS"

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
