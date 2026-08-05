## 1. Verify the wire format end-to-end (do this first — informs Decision 4)

- [x] 1.1 With a local Ollama instance running and a `tools`-capable model pulled, launch `claude` with `ANTHROPIC_BASE_URL` pointed at Ollama's `/v1` (or root, per whatever `renderEnv` ends up emitting) and no `ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_API_KEY` set; record whether it proceeds or falls back to interactive OAuth login. **Finding:** does not proceed — hangs (normal mode) or fails fast with `Not logged in` (`--bare` mode). See design.md Decision 4.
- [x] 1.2 Repeat with a placeholder non-empty `ANTHROPIC_AUTH_TOKEN` set; confirm it proceeds and successfully round-trips a tool-use turn (a real Concertino role prompt that requires at least one tool call, e.g. a `Read` or `Bash` call). **Finding:** proceeds (exit 0); `Read` tool call round-tripped correctly end-to-end. See design.md Decision 4.
- [x] 1.3 Update design.md's Decision 4 / Open Questions with the finding, and adjust tasks 3.x below if the finding contradicts the "placeholder token" assumption. **Finding confirmed the working assumption unchanged — no adjustment to tasks 3.x needed.**

## 2. Core routing logic (`lib/config.js`)

- [x] 2.1 Change `isOllamaRouted` so the claude-code exclusion only fires when `providers.ollama.gateway` is configured (Decision 2) — direct-route claude-code (harnesses includes it, no gateway) now falls through to the same explicit-override → provider-map → tier resolution as any other harness.
- [x] 2.2 Update `isOllamaRouted`'s doc comment to describe both routes instead of the old unconditional exclusion.
- [x] 2.3 In `collectConfigIssues`'s Providers section, change the `ollamaHarnesses.includes('claude-code') && !ollama.gateway` hard `fail()` to only fire when `gateway` is present but incomplete (missing/empty `baseUrl`); absence of `gateway` entirely is no longer an error for claude-code.
- [x] 2.4 Add/update tests in `test/config.test.js` for `isOllamaRouted` covering: claude-code direct route routed, claude-code gateway route excluded, claude-code with explicit override excluded on either route, non-claude-code harnesses unaffected.
- [x] 2.5 Add/update `collectConfigIssues` tests covering: claude-code + baseUrl + no gateway passes; claude-code + incomplete gateway still fails; claude-code + complete gateway passes (unchanged).

## 3. Env/spawn wiring (`lib/cli/render.js`, `lib/ui/harness.js`)

- [x] 3.1 Update `renderEnv` to emit `ANTHROPIC_BASE_URL` from `providers.ollama.baseUrl` when claude-code is on the direct route (harnesses includes it, no gateway), in addition to the existing gateway-route emission.
- [x] 3.2 Per task 1's finding, emit `ANTHROPIC_AUTH_TOKEN`/`CONCERTINO_OLLAMA_...` env plumbing needed for the direct route (placeholder value, or an `providers.ollama.apiKeyEnv`-sourced name — never a literal secret value) — mirror the existing gateway `apiKeyEnv` pattern (name only, never contents).
- [x] 3.3 Update `resolveTicketProvider` (`lib/ui/harness.js`) per Decision 3: return `'ollama'` for a claude-code ticket when `providers.ollama.baseUrl` is set, whether or not `gateway` is configured (only "no providers.ollama at all" or "gateway configured but incomplete" still return `null`).
- [x] 3.4 Update `providerChoices` with the same relaxation so the launch plan's `P`/`p` cycle offers `ollama` for a claude-code row on the direct route.
- [x] 3.5 Update `providerSpawnEnv` to set `ANTHROPIC_BASE_URL` to `providers.ollama.baseUrl` (direct) vs. `providers.ollama.gateway.baseUrl` (gateway) depending on route, and set the auth-token env per task 3.2's finding on the direct route.
- [x] 3.6 Update the doc comments in `lib/ui/harness.js` (`resolveTicketProvider`, `providerSpawnEnv`, `providerChoices`) that currently assert "Claude Code reaches Ollama only through a gateway" — they are now wrong and must describe both routes.
- [x] 3.7 Add/update tests in `test/harness.test.js` for `resolveTicketProvider`/`providerChoices`/`providerSpawnEnv` covering the direct route (no gateway) alongside the existing gateway-route cases.
- [x] 3.8 Comment-only fix in `lib/ui/controllers/launchpad.js`: update the four doc comments asserting "claude-code needs a gateway" to describe the gateway-conditional route instead — no logic change needed, these already delegate to `harnessCmd.providerChoices`/`resolveTicketProvider`:
  - `open-launchplan` ~lines 294-296
  - `cycle-harness` ~lines 419-421
  - `cycle-provider` ~lines 441-442 (header comment)
  - `cycle-row-provider` ~lines 505-508 (header comment)
  Re-grep the file for `gateway` after editing to confirm no fifth stale mention was missed.

## 4. `resolve-speed.sh` + `speeds.json` rendering

- [x] 4.1 Add `gatewayConfigured: bool` (or equivalent) to the `providers.ollama` block `renderSpeedsJson` (`lib/cli/render.js`) writes into `speeds.json`, per Decision 5.
- [x] 4.2 Update `scripts/concertino/resolve-speed.sh`'s `[ "$HARNESS" != "claude-code" ]` guard to instead check the route (claude-code + gatewayConfigured=false → still eligible for `OLLAMA_ROUTED`/provider-model substitution; claude-code + gatewayConfigured=true → excluded, unchanged).
- [x] 4.3 Update `test/scripts/resolve-speed.test.sh` with cases for claude-code direct-route model resolution (provider map used) and claude-code gateway-route model resolution (provider map NOT used, unchanged).

## 5. `concertino doctor`

- [x] 5.1 In `checkOllamaProvider` (`lib/cli/doctor.js`), add a reported line naming the resolved route (`direct` | `gateway`) whenever `claude-code` is in `providers.ollama.harnesses`.
- [x] 5.2 Add/update `test/scripts/doctor-ollama-models.test.sh` (or a focused addition) covering both route-reporting cases.

## 6. Schema + docs

- [x] 6.1 Update `config/concertino.schema.json`'s `providers.ollama.gateway` description to describe it as optional (proxy override), not required for claude-code.
- [x] 6.2 Update `docs/config-reference.md`'s `ollama.gateway`/`ollama.gateway.apiKeyEnv` entries and any other prose describing claude-code's Ollama routing as gateway-only.

## 7. End-to-end verification

- [x] 7.1 With a real local Ollama server and `providers.ollama` configured for the direct route (baseUrl + models, no gateway), run `concertino sync`, `concertino validate`, and `concertino doctor` against a scratch project and confirm each behaves per the new specs (validate passes, doctor reports `route: direct`). **Verified**: `validate` exits 0, no warnings; `sync` renders `ANTHROPIC_BASE_URL='http://127.0.0.1:11434'` + `ANTHROPIC_AUTH_TOKEN='ollama-local'` into `.concertino.env` and `model: qwen3:8b` into the agent frontmatter; `doctor` reports `providers.ollama.route direct` and reachability against the real local Ollama server.
- [x] 7.2 Launch a claude-code session against the direct route and drive at least one tool-using turn end-to-end (per task 1's findings), capturing the result as evidence for this change. **Verified**: using the exact `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN` values `renderEnv`/`providerSpawnEnv` produce, `claude -p` against `qwen3:8b` correctly issued a `Read` tool call and reported the file's real contents.
- [x] 7.3 Run the full test suite (`npm test`) and confirm no regressions in existing gateway-route/Codex/OpenCode Ollama routing tests.
