## Why

Ollama now serves a native Anthropic-compatible `/v1/messages` endpoint (verified against a local server running Ollama 0.32.1), so Claude Code can point straight at it via `ANTHROPIC_BASE_URL` — no LiteLLM/gateway proxy required. Concertino's routing today (CON-63/CON-65) still hard-requires `providers.ollama.gateway` for claude-code and hard-excludes claude-code from Ollama model-id substitution, so `provider:ollama` and the launch plan's `P`/`p` keys silently no-op for a claude-code row even when Ollama is running and reachable and no gateway is configured. That assumption is now obsolete and blocks a supported, first-class local-model path.

## What Changes

- Treat `providers.ollama.baseUrl` (with claude-code in `providers.ollama.harnesses`) as sufficient to route claude-code to Ollama directly — `providers.ollama.gateway` becomes optional, kept only for operators who genuinely front Ollama with an Anthropic-compatible proxy (LiteLLM or similar) that does its own model-id remapping.
- Two distinct claude-code routes, mutually exclusive per project:
  - **direct** (`providers.ollama.harnesses` includes `claude-code`, no `gateway` configured): `ANTHROPIC_BASE_URL` points straight at `providers.ollama.baseUrl`; claude-code's role models resolve through `providers.ollama.models.<role>` exactly like every other Ollama-routed harness (real Ollama model ids, e.g. `qwen3:8b`).
  - **gateway** (`gateway` configured): unchanged today's behavior — `ANTHROPIC_BASE_URL` points at the gateway, and claude-code's `model:` frontmatter stays a hosted-looking alias the gateway remaps.
- `resolveTicketProvider` (`lib/ui/harness.js`) no longer returns `null` for `provider:ollama` on claude-code when only `baseUrl` (no gateway) is configured — the direct route counts as reachable.
- `isOllamaRouted` (`lib/config.js`) drops its unconditional claude-code exclusion; the exclusion becomes conditional on whether the *gateway* route (not just any Ollama config) is in play — direct-route claude-code participates in provider-model substitution like every other harness.
- `renderEnv`/`providerSpawnEnv` emit `ANTHROPIC_BASE_URL` (and `ANTHROPIC_AUTH_TOKEN` if verification shows Claude Code requires a non-empty value against an unauthenticated endpoint) for the direct route, not only the gateway route.
- `resolve-speed.sh` stops unconditionally excluding claude-code from provider-model substitution — the exclusion is conditional on the resolved route, mirroring `isOllamaRouted`.
- `concertino doctor` reports which of the two routes (direct vs. gateway) a project resolves to for claude-code, alongside its existing reachability/model checks.
- Verify the wire format end-to-end against a real local Ollama server, including tool use (the previously-recorded probe only exercised a plain completion) — this becomes durable evidence in the change, per CON-74's precedent of measuring a real run before declaring a route usable.

## Capabilities

### New Capabilities
(none — this extends the existing provider-routing capability, it does not introduce a new one)

### Modified Capabilities
- `model-providers`: adds the direct (gatewayless) claude-code-to-Ollama route as a first-class alternative to the existing gateway route; changes `isOllamaRouted`'s claude-code exclusion from unconditional to route-conditional; changes what `resolveTicketProvider`/`providerChoices` consider "reachable" for claude-code; changes what `renderEnv`/`providerSpawnEnv` emit for claude-code.

## Impact

- `lib/ui/harness.js`: `resolveTicketProvider`, `providerSpawnEnv`, `providerChoices`, their doc comments.
- `lib/ui/controllers/launchpad.js`: doc-comment-only fixes at the four spots that currently assert "claude-code needs a gateway" — no logic change (these functions already delegate validity to `harnessCmd.providerChoices`/`resolveTicketProvider`), but the comments become factually wrong once the direct route ships:
  - `open-launchplan` ~lines 294-296 (building the initial `ticketProvider` map)
  - `cycle-harness` ~lines 419-421 (dropping a batch provider unreachable from a newly-cycled harness)
  - `cycle-provider` ~lines 441-442 (header comment, batch provider cycle)
  - `cycle-row-provider` ~lines 505-508 (header comment, per-row provider cycle)
- `lib/config.js`: `isOllamaRouted`, `resolveModel` (indirectly, via `isOllamaRouted`), `collectConfigIssues`'s Providers section (the `claude-code` + no-gateway hard `fail` becomes conditional).
- `lib/cli/render.js`: `renderEnv` (ANTHROPIC_BASE_URL/ANTHROPIC_AUTH_TOKEN emission), `renderSpeedsJson` (no structural change expected, but the `providers.ollama` block it emits is what `resolve-speed.sh` reads for the route decision).
- `scripts/concertino/resolve-speed.sh`: drops the `[ "$HARNESS" != "claude-code" ]` guard in favor of a route check.
- `lib/cli/doctor.js`: `checkOllamaProvider` reports the resolved route.
- `config/concertino.schema.json`: `providers.ollama.gateway`'s description changes from "Required when claude-code appears in providers.ollama.harnesses" to "optional override".
- Tests: `test/harness.test.js` (resolveTicketProvider/providerSpawnEnv/providerChoices), `test/config.test.js`-equivalent coverage for `isOllamaRouted`, resolve-speed.sh's own bats/shell tests if present, doctor tests.
