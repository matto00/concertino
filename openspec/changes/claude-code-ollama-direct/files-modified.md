## Files modified

- `lib/config.js` — `isOllamaRouted`'s claude-code exclusion made route-conditional (gateway only, was unconditional); `collectConfigIssues`'s Providers section: the `claude-code` + no-`gateway` hard `fail()` is replaced with an incomplete-`gateway` (`gateway` present but no `baseUrl`) check that applies regardless of harness; Models section's "unrecognized alias" check now skips the alias/`claude-`-prefix validation for a claude-code role that resolved through `providers.ollama.models` on the direct route (a real Ollama model id is not a hosted alias) — a gap the plan didn't anticipate, found and fixed during end-to-end verification (task 7.1).
- `lib/cli/render.js` — `renderEnv` emits `ANTHROPIC_BASE_URL` from `providers.ollama.baseUrl` (direct route) plus a placeholder `ANTHROPIC_AUTH_TOKEN` (or `CONCERTINO_OLLAMA_API_KEY_ENV`'s name only, when `apiKeyEnv` is set), alongside the unchanged gateway-route emission; `renderSpeedsJson` adds `providers.ollama.gatewayConfigured` to the `speeds.json` snapshot.
- `lib/ui/harness.js` — `resolveTicketProvider`/`providerChoices` relaxed per design.md Decision 3 (claude-code no longer requires a gateway; only an incomplete gateway still refuses); `providerSpawnEnv` sets `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN` for the direct route, mirroring the gateway route's existing shape.
- `lib/ui/controllers/launchpad.js` — comment-only: the four doc comments asserting "claude-code needs a gateway" updated to describe the gateway-conditional route (no logic change; these delegate to `harnessCmd.providerChoices`/`resolveTicketProvider`).
- `lib/cli/doctor.js` — `checkOllamaProvider` reports `providers.ollama.route: direct|gateway` whenever `claude-code` is in `providers.ollama.harnesses`.
- `core/scripts/resolve-speed.sh` — the `[ "$HARNESS" != "claude-code" ]` guard replaced with a `providers.ollama.gatewayConfigured`-based route check (direct route participates in provider-model substitution; gateway route stays excluded, unchanged).
- `scripts/concertino/resolve-speed.sh` — byte-for-byte copy of `core/scripts/resolve-speed.sh` (this repo dogfoods itself; rendered artifacts must stay byte-identical to `core/`, verified via `concertino doctor`'s own drift check).
- `config/concertino.schema.json` — `providers.ollama.gateway`'s description changed from "required for claude-code" to "optional proxy override".
- `docs/config-reference.md` — `ollama.gateway` table row and the "Per harness: Claude Code" prose rewritten to describe both routes; per-ticket provider routing section updated to drop the "claude-code requires a gateway" claim.
- `test/config.test.js` — `isOllamaRouted`/`collectConfigIssues`/`resolveModel` test coverage for the direct route, the gateway route, and the incomplete-gateway failure case; a regression test for the Models-section alias-check fix above.
- `test/harness.test.js` — `resolveTicketProvider`/`providerChoices`/`providerSpawnEnv` test coverage for the direct route alongside the existing gateway-route cases.
- `test/validate.test.js` — updated the pre-CON-75 "claude-code without a gateway fails validation" test to reflect the new pass-on-direct-route/fail-only-on-incomplete-gateway behavior.
- `test/scripts/resolve-speed.test.sh` — new cases for claude-code direct-route model resolution (provider map used) vs. gateway-route (unchanged, provider map NOT used).
- `test/scripts/doctor-ollama-models.test.sh` — new scenarios covering `doctor`'s `providers.ollama.route: direct|gateway` reporting.

## Design doc updates

- `openspec/changes/claude-code-ollama-direct/design.md` — Decision 4 / Open Questions updated with the task 1 verification finding (a non-empty placeholder `ANTHROPIC_AUTH_TOKEN` is strictly required by the Claude Code CLI itself against a self-hosted `ANTHROPIC_BASE_URL`, confirmed by direct probe — see below). No re-design; the working assumption was confirmed, not contradicted.

## Verification evidence (task 1, wire-format)

Root cause / probe (systematic-debugging.md): not a bug fix, but a required design-verification step per the ticket's Decision 4. Probe: `claude --bare -p "..." --model qwen3:8b` against `ANTHROPIC_BASE_URL=http://127.0.0.1:11434` (real local Ollama 0.32.1), with and without `ANTHROPIC_AUTH_TOKEN`.

- No token: hangs past a 20-30s timeout (normal mode, prints only `Execution error`) or fails fast with `Not logged in · Please run /login` (`--bare` mode, exit 1) — does not reach Ollama.
- Placeholder token (`ollama-local`): exits 0 immediately; plain completion round-trips (`Reply with exactly: OK` → `OK`); a `Read` tool-use turn round-trips correctly end-to-end (Anthropic `tool_use` block emitted, Ollama replied, Claude Code executed `Read`, sent back `tool_result`, final answer accurately reported file contents).

This confirms design.md's working assumption without qualification — recorded in design.md Decision 4/Open Questions.
