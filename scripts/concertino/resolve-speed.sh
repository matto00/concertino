#!/usr/bin/env bash
set -uo pipefail

# ===========================================================================
# resolve-speed.sh — (speed, harness) -> resolved budgets + per-role models
# + the two slow-only behavioral flags, as one JSON object on stdout.
#
# The runtime half of delivery-speed-presets (CON-22). `concertino sync`
# does the merge/defaulting work once, at sync time, in Node (see
# `withDefaults()` in bin/concertino) and bakes the result into a rendered
# `speeds.json` next to this script — this script does ONLY the final
# (speed, harness) lookup against that already-defaulted data. It never
# re-implements defaulting itself, so it can never drift from what
# `concertino sync` actually rendered (see design.md's "Risks" section).
#
# Usage:   resolve-speed.sh [SPEED] [HARNESS]
# Example: resolve-speed.sh fast claude-code
#
#   SPEED    optional; one of the names under speeds.json's "speeds" key
#            (fast/default/slow, or whatever a project has renamed/added).
#            Defaults to "default" when omitted or empty.
#   HARNESS  optional; claude-code|codex|opencode, used VERBATIM when given —
#            no detection. When omitted, resolved in the same order
#            setup-worktree.sh's own detect_harness() uses:
#              1. Runtime signal from the process environment (CLAUDECODE,
#                 else CODEX_SANDBOX/CODEX_SANDBOX_NETWORK_DISABLED, else
#                 OPENCODE)
#              2. The static CONCERTINO_HARNESS default from .concertino.env
#              3. The literal string "unknown"
#            (This is the same order for the same reason: two independent
#            callers need two different resolution strategies — see
#            design.md Decision 3. The orchestrator, running INSIDE the live
#            harness process, passes $2 explicitly (it already resolved
#            HARNESS itself in setup-worktree.sh) rather than relying on
#            this script's own auto-detection redundantly. The launch plan
#            preview, with no live run to detect from, also passes $2
#            explicitly — the human-selected harness on screen.)
#
# Reads scripts/concertino/speeds.json (rendered by `concertino sync`
# alongside this script and .concertino.env — see copyAssets()/renderEnv()
# in bin/concertino):
#   {
#     "budgets":    { executionCycles, skepticDesignRounds, skepticFinalRounds, debugAttempts },
#     "speeds":     { "<name>": { budgets: {...partial...}, roleTiers: {...}, secondFinalGateSkeptic?, evaluatorCleanWorktree? } },
#     "modelTiers": { "<harness>": { cheap, standard, capable } },
#     "models":     { "<harness>": { <role>: "<explicit model>", ... } }   // sparse
#   }
#
# Prints one JSON object to stdout on success:
#   {"speed":"<name>","harness":"<h>","budgets":{...},"models":{...},
#    "secondFinalGateSkeptic":bool,"evaluatorCleanWorktree":bool}
#
# Exits non-zero with "FAIL <reason>" on stderr for an unrecognized speed
# name or a harness with no modelTiers data — the orchestrator treats this
# as a BLOCKER (environmental), matching the existing "Server start"
# circuit-breaker shape; the launch plan screen treats it as "models
# unknown for this harness" (rendered, not fatal).
# ===========================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SPEEDS_JSON="${SCRIPT_DIR}/speeds.json"

if [ ! -f "$SPEEDS_JSON" ]; then
  echo "FAIL ${SPEEDS_JSON} not found — run \`concertino sync\` in this project" >&2
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "FAIL jq is required but not found on PATH" >&2
  exit 1
fi

SPEED="${1:-}"
[ -z "$SPEED" ] && SPEED="default"

HARNESS="${2:-}"
if [ -z "$HARNESS" ]; then
  # shellcheck disable=SC1091
  [ -f "${SCRIPT_DIR}/.concertino.env" ] && source "${SCRIPT_DIR}/.concertino.env"
  # Identical detection order to setup-worktree.sh's own detect_harness() —
  # kept in sync deliberately (see that script's own comment) so the two
  # never disagree about what "no explicit override" resolves to.
  if [ -n "${CLAUDECODE:-}" ]; then
    HARNESS="claude-code"
  elif [ -n "${CODEX_SANDBOX:-}" ] || [ -n "${CODEX_SANDBOX_NETWORK_DISABLED:-}" ]; then
    HARNESS="codex"
  elif [ -n "${OPENCODE:-}" ]; then
    HARNESS="opencode"
  else
    HARNESS="${CONCERTINO_HARNESS:-unknown}"
  fi
fi

# CON-65: per-run provider routing. CONCERTINO_PROVIDER (injected per tmux
# window by the dashboard's spawn layer when a ticket carries a
# `provider:<value>` label — see lib/ui/harness.js) is the explicit
# override; empty falls back to the project-level default rendered into
# speeds.json's own `providers.ollama.harnesses` list. CON-75: claude-code is
# excluded from provider-MODEL substitution only on the **gateway** route —
# its model ids stay hosted-looking aliases that the Anthropic-compatible
# gateway remaps (see isOllamaRouted's comment in lib/config.js) and the flip
# is carried entirely by the per-window ANTHROPIC_BASE_URL env the same spawn
# layer injects. On the **direct** route (no gateway — Ollama now serves a
# native Anthropic-compatible endpoint) claude-code participates in
# provider-model substitution exactly like any other harness. This script has
# no access to raw config (only the already-defaulted speeds.json snapshot —
# see the file header), so it reads the route from
# `providers.ollama.gatewayConfigured`, which `concertino sync`'s
# renderSpeedsJson renders alongside the rest of the provider block (design.md
# Decision 5) rather than re-deriving "does this project have a gateway"
# against data it does not have.
PROVIDER_OVERRIDE="${CONCERTINO_PROVIDER:-}"
OLLAMA_ROUTED="false"
CLAUDE_CODE_GATEWAY_ROUTE="false"
if [ "$HARNESS" = "claude-code" ]; then
  GATEWAY_CONFIGURED="$(jq -e '.providers.ollama.gatewayConfigured // false' "$SPEEDS_JSON" 2>/dev/null)"
  [ "$GATEWAY_CONFIGURED" = "true" ] && CLAUDE_CODE_GATEWAY_ROUTE="true"
fi
if [ "$CLAUDE_CODE_GATEWAY_ROUTE" != "true" ]; then
  case "$PROVIDER_OVERRIDE" in
    ollama) OLLAMA_ROUTED="true" ;;
    default) OLLAMA_ROUTED="false" ;;
    *)
      PROJECT_ROUTED="$(jq -e --arg h "$HARNESS" '(.providers.ollama.harnesses // []) | index($h) != null' "$SPEEDS_JSON" 2>/dev/null)"
      [ "$PROJECT_ROUTED" = "true" ] && OLLAMA_ROUTED="true"
      ;;
  esac
fi

SPEED_EXISTS="$(jq -e --arg s "$SPEED" '.speeds[$s] != null' "$SPEEDS_JSON" 2>/dev/null)"
if [ "$SPEED_EXISTS" != "true" ]; then
  KNOWN="$(jq -r '.speeds | keys | join(", ")' "$SPEEDS_JSON" 2>/dev/null)"
  echo "FAIL unknown speed \"${SPEED}\" — known speeds: ${KNOWN}" >&2
  exit 1
fi

TIERS_EXIST="$(jq -e --arg h "$HARNESS" '.modelTiers[$h] != null' "$SPEEDS_JSON" 2>/dev/null)"
if [ "$TIERS_EXIST" != "true" ]; then
  KNOWN="$(jq -r '.modelTiers | keys | join(", ")' "$SPEEDS_JSON" 2>/dev/null)"
  echo "FAIL harness \"${HARNESS}\" has no modelTiers data — known harnesses: ${KNOWN}" >&2
  exit 1
fi

jq -c --arg speed "$SPEED" --arg harness "$HARNESS" --arg routed "$OLLAMA_ROUTED" '
  .speeds[$speed] as $sp
  | .modelTiers[$harness] as $tiers
  | (.models[$harness] // {}) as $explicit
  | (if $routed == "true" then (.providers.ollama.models // {}) else {} end) as $provider
  | (.budgets // {}) as $baseBudgets
  | ($sp.budgets // {}) as $override
  | {
      speed: $speed,
      harness: $harness,
      provider: (if $routed == "true" then "ollama" else "default" end),
      # Partial merge: any field the speed does not mention falls back to
      # the project'"'"'s top-level default, never a hardcoded number
      # (design.md Decision 2).
      budgets: ($baseBudgets + $override),
      # Explicit models.<harness>.<role> always wins; then, when this run is
      # Ollama-routed (CON-65 — see the routing block above), the provider
      # model map; otherwise resolve the speed'"'"'s roleTiers entry
      # (defaulting to "standard" if the speed somehow omits a role) through
      # modelTiers.<harness>. This is resolveModel()'"'"'s exact precedence
      # (lib/config.js), applied at lookup time instead of baked in at
      # render time.
      models: (reduce ("orchestrator", "executor", "evaluator", "skeptic", "auditor") as $role
        ({}; . + { ($role): ($explicit[$role] // $provider[$role] // $tiers[($sp.roleTiers[$role] // "standard")]) })),
      secondFinalGateSkeptic: ($sp.secondFinalGateSkeptic // false),
      evaluatorCleanWorktree: ($sp.evaluatorCleanWorktree // false)
    }
' "$SPEEDS_JSON"
