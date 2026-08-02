## 1. Schema

- [x] 1.1 Add `"opencode"` to `harnesses.items.enum` in `config/concertino.schema.json` (default array stays `["claude-code", "codex"]`).
- [x] 1.2 Add `opencode` properties to `models` and `modelTiers` (`$ref: "#/$defs/roleModelMap"` / `#/$defs/tierMap`) in `config/concertino.schema.json`.
- [x] 1.3 Add a new top-level `providers` object to `config/concertino.schema.json` (`additionalProperties: false`) with an `ollama` key: `baseUrl` (string, default `http://localhost:11434`), `apiKeyEnv` (string, optional), `harnesses` (array of strings, optional), `models` (`$ref: "#/$defs/roleModelMap"`, optional), `gateway` (object: `baseUrl` string, `apiKeyEnv` string optional).

## 2. `lib/config.js` — defaults, resolution, validation

- [x] 2.1 Add `opencode` to `DEFAULT_MODEL_TIERS` with concrete cheap/standard/capable model-id defaults.
- [x] 2.2 Add `'opencode'` to `withModelDefaults`'s harness loop and `c.models.opencode` initialization.
- [x] 2.3 Add `c.providers = c.providers || {}` (and sensible nested defaulting, e.g. `c.providers.ollama` left undefined when absent — do not synthesize a fake `ollama` block) to `withDefaults`.
- [x] 2.4 Extend `resolveModel` with the provider-fallback tier from design.md Decision 2 (explicit override → provider model map when harness is Ollama-routed → existing tier lookup → per-harness fallback, restructured off a `FALLBACK_MODEL` map keyed by harness so a fourth harness never silently returns `'sonnet'`).
- [x] 2.5 Add `'opencode'` to `collectConfigIssues`'s `VALID_HARNESSES`.
- [x] 2.6 Add an opencode block to the Models section of `collectConfigIssues` (parallel to the existing conditional codex block) reporting resolved per-role model ids when `opencode` is configured.
- [x] 2.7 Add a new `sec('Providers')` section to `collectConfigIssues`: validate `providers.ollama.baseUrl` is a non-empty string when `providers.ollama` is present; validate `providers.ollama.harnesses` (if set) only names harnesses actually present in `cfg.harnesses`; implement the claude-code-without-gateway failure from design.md Decision 4 with the exact error text from the spec scenario.
- [x] 2.8 Export any new helper(s) added (e.g. a `FALLBACK_MODEL` map, if extracted) from `module.exports` if `lib/ui/screens/settings.js` or tests need them.

## 3. Codex adapter — Ollama provider rendering

- [x] 3.1 Add a `{{model_provider}}` placeholder to `adapters/codex/agent.toml.tmpl`, rendered as `model_provider = "ollama"` only for a role that is **Ollama-routed** per design.md Decision 2/3's precise definition — `"codex"` is in `providers.ollama.harnesses` AND no explicit `models.codex.<role>` override is set for that role — else omitted (that role keeps today's default provider and its explicit/hosted model id).
- [x] 3.2 In `emitCodex`, when `"codex"` is in `providers.ollama.harnesses`, render a `[model_providers.ollama]` block (`name`, `base_url`, `wire_api`, `env_key` when `apiKeyEnv` set) into a new `.codex/config.toml` write, using the same `<!-- CONCERTINO:BEGIN/END -->` merge-marker convention `AGENTS.md` already uses so hand-authored content outside the markers survives. This block renders once per project regardless of which individual roles end up Ollama-routed per 3.1.
- [x] 3.3 Mirror 3.1's per-role Ollama-routed check (harness in `providers.ollama.harnesses` AND no explicit `models.codex.<role>` override) and 3.2's config.toml rendering in `cmdDiff`'s inlined per-role Codex diff logic and in `cmdEject`'s codex branch (`toml` rendering).
- [x] 3.4 Add `.codex/config.toml` to `checkArtifacts`'s doctor drift check when codex is configured and Ollama-routed.

## 4. OpenCode adapter — new harness

- [x] 4.1 Research OpenCode's actual native project-config file name/shape, agent-definition format, and delivery-command/prompt mechanism (resolving design.md Open Questions 1–3); record findings as a short comment at the top of the new adapter files.
- [x] 4.2 Create `adapters/opencode/` with a header/role-section template (parallel to `adapters/codex/header.md`) and a delivery command/prompt file (parallel to `adapters/codex/prompt.md`), reusing `adapters/claude-code/agents.json` for shared per-role metadata where compatible.
- [x] 4.3 Implement `emitOpencode(c, out, core, dry)` in `bin/concertino`, sibling to `emitClaude`/`emitCodex`: render OpenCode's native project config (including a `provider.ollama` entry when `"opencode"` is in `providers.ollama.harnesses`, using `providers.ollama.baseUrl`/`apiKeyEnv`/`models`), per-role agent files for orchestrator/executor/evaluator/skeptic/auditor, and the delivery command/prompt file.
- [x] 4.4 Add the third arm to `block('harnessResume', c, harness)` in `bin/concertino` for `harness === 'opencode'`, per design.md Decision 5's conservative (sequential, Codex-like) default pending 4.1's findings.
- [x] 4.5 Extend `core/roles/orchestrator.md`'s hardcoded two-harness prose sections (identified in planning research: the "Per-spawn model overrides" section and any other place naming exactly two harnesses) with an OpenCode-aware third case.
- [x] 4.6 Wire `cmdSync`: `if (harnesses.includes('opencode')) emitOpencode(c, out, core, dry);`.
- [x] 4.7 Wire `cmdEject`'s harness dispatch for `opencode` (decide and implement which roles OpenCode eject supports, update the "unknown harness" error message's valid-list).
- [x] 4.8 Wire `checkArtifacts` (doctor) with an `opencode`-specific rendered-file existence check.
- [x] 4.9 Wire `cmdDoctor` with a conditional OpenCode CLI-presence check (`harnesses.includes('opencode')`), and fix the currently-unconditional Claude Code CLI check to be gated the same way (`harnesses.includes('claude-code')`).
- [x] 4.10 Wire `cmdDiff`'s inline per-role diff loop with an OpenCode branch parallel to Codex's.
- [x] 4.11 Wire `cmdUpgrade`'s stale-marker scan directory list with OpenCode's rendered directory.
- [x] 4.12 Wire `cmdCompletion`'s zsh and bash `--harness=` completion value lists with `opencode`.
- [x] 4.13 Update `promptConfig`'s interactive harness picker (`bin/concertino`) to allow selecting `opencode` (extend beyond the current `['claude-code', 'codex', 'both']` three-way enum to a proper multi-select or expanded combination set).
- [x] 4.14 Add the OpenCode runtime-identity detection arm to `core/scripts/setup-worktree.sh`'s `detect_harness()` and the duplicated inline detection in `core/scripts/resolve-speed.sh`, in lockstep, per design.md Decision 6.

## 5. Claude Code gateway support

- [x] 5.1 Extend `renderEnv(c)` in `bin/concertino` to write gateway connection env vars into `.concertino.env` when `providers.ollama.gateway` is configured and `"claude-code"` is in `providers.ollama.harnesses` (base URL + credential env var name, never the credential value).
- [x] 5.2 Confirm (via docs check) which environment variable(s) Claude Code's Anthropic-compatible client actually honors for a gateway override, and use the correct variable name(s).

## 6. Doctor — Ollama/gateway prerequisites

- [x] 6.1 Add a best-effort, non-fatal Ollama reachability check to `cmdDoctor` (mirroring `checkBaseBranch`'s best-effort fetch pattern) when any harness is in `providers.ollama.harnesses`.
- [x] 6.2 Add a gateway reachability check when `claude-code` is Ollama-routed and `providers.ollama.gateway` is configured.
- [x] 6.3 Ensure both checks report whether `apiKeyEnv` (and the gateway's `apiKeyEnv`) is set (non-empty) without ever printing the value.

## 7. Examples

- [x] 7.1 Add `config/examples/opencode-ollama.json` demonstrating `harnesses` including `opencode`, a populated `providers.ollama` block (baseUrl, apiKeyEnv, harnesses, models), and per-role `modelTiers.opencode`/`models.opencode` entries.
- [x] 7.2 Add `opencode-ollama` to `cmdCompletion`'s bash `--example` completion list.

## 8. Documentation

- [x] 8.1 Update `docs/harness-capabilities.md`'s capability matrix and prose to cover three harnesses, adding an OpenCode section per 4.1/4.4's findings.
- [x] 8.2 Update `docs/config-reference.md` with a `providers` section documenting the new schema block, and a `harnesses` update mentioning `opencode`.
- [x] 8.3 Update `docs/quickstart.md` and `docs/adapting-to-your-project.md`'s harness-file lists and `--harness=` examples for the third harness.
- [x] 8.4 Update `README.md` and `package.json`'s `description`/`keywords` to mention OpenCode/Ollama.
- [x] 8.5 Correct `CONTRIBUTING.md`'s existing overstatement that `concertino sync` already renders `.opencode/`/`.cursor/` mirrors — make the OpenCode half true, keep the Cursor half flagged as not-yet-built (per `ROADMAP.md`).
- [x] 8.6 Update `ROADMAP.md`'s "Codex model id... config-driven" item (superseded by this change) and note OpenCode landing ahead of the Cursor adapter item.

## 9. Tests

- [x] 9.1 Add `test/config.test.js` cases: `opencode` accepted as a valid harness; `providers.ollama` accepted with no errors; provider-model-map fallback in `resolveModel` (with and without an explicit override); the claude-code-without-gateway validation failure (exact error path/message); validation passes once `providers.ollama.gateway` is added.
- [x] 9.2 Add/extend `test/validate.test.js` subprocess-level case(s) for the claude-code-without-gateway error's printed output.
- [x] 9.3 Add `test/scripts/opencode-render.test.sh`: `concertino sync --harness=opencode` writes the expected native config/agent/command files; a claude-code+codex-only project renders nothing OpenCode-specific; add this file to `package.json`'s `test` script chain (not auto-discovered).
- [x] 9.4 Extend `test/scripts/harness-identity.test.sh` with scenarios for the new OpenCode runtime-detection arm (signal set → `opencode`; signal absent → existing fallback; `CLAUDECODE` still wins over the OpenCode signal).
- [x] 9.5 Add a Codex-Ollama-provider rendering test (new or extending an existing codex-focused script test) asserting the `.codex/config.toml` merge-marker behavior (initial render, and re-render preserving hand-authored content outside the markers).
- [x] 9.6 Confirm `test/settings.test.js` (or any test pinned to the current schema shape/section count) is updated for the new `providers` top-level schema key and `schemaSectionOrder` position.
- [x] 9.7 Run the full `npm test` chain locally and confirm all existing tests still pass unmodified in behavior (backward compatibility).

## 10. Final checks

- [x] 10.1 Run `concertino validate`/`concertino sync --dry-run` against `config/examples/generic.json` and `config/examples/helio.json` (existing examples) to confirm zero behavioral change for projects that don't opt in.
- [x] 10.2 Run `concertino sync --dry-run` against the new `config/examples/opencode-ollama.json` and confirm every acceptance criterion in `ticket.md` is demonstrably satisfied.
- [x] 10.3 Record modified files in `files-modified.md` per the executor's own handoff convention.
