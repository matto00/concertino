## Why

Concertino only renders Claude Code and Codex, and its model configuration
assumes hosted Claude/OpenAI model identifiers. Teams that want to run some or
all roles against a locally-hosted Ollama model — for cost, privacy, or
offline development — have no supported path today, and OpenCode (a third
harness with native multi-provider support, including Ollama's
OpenAI-compatible API) isn't rendered at all. This change adds OpenCode as a
first-class harness and adds provider-aware model configuration so a project
can point configured roles at Ollama through whichever of the three harnesses
it uses, without hand-editing any generated file.

## What Changes

- Add `opencode` as a third valid harness id throughout the config/render
  pipeline (schema `harnesses` enum, `lib/config.js` `VALID_HARNESSES` and
  `DEFAULT_MODEL_TIERS`, and every `bin/concertino` call site that iterates
  configured harnesses: `promptConfig`'s harness picker, `cmdEject`,
  `cmdDoctor`'s CLI-presence checks, `cmdDiff`, `cmdUpgrade`'s stale-marker
  scan, `cmdCompletion`'s zsh/bash `--harness=` value lists, and `cmdSync`).
- Add a new `emitOpencode(c, out, core, dry)` renderer (sibling to
  `emitClaude`/`emitCodex`) that writes OpenCode's native project
  configuration, per-role agent definitions, and a `concertino-deliver`
  command/prompt equivalent — following the same `adapters/<harness>/*`
  template convention the other two harnesses already use.
- Add a new `providers` config block (schema + `lib/config.js` defaults),
  scoped today to a single named provider, `providers.ollama`: `baseUrl`,
  optional `apiKeyEnv` (names an environment variable holding a credential —
  never the credential itself, mirroring `worktree.envFiles`'s existing
  path-not-secret convention), `harnesses` (the subset of this project's
  configured harnesses that should route through Ollama), `models` (a
  per-role fallback model-id map used when a harness is Ollama-routed and a
  role has no explicit `models.<harness>.<role>` override), and an optional
  `gateway` block (`baseUrl`, `apiKeyEnv`) for the Anthropic-compatible proxy
  (e.g. LiteLLM) Claude Code requires to reach Ollama.
- Make `resolveModel` provider-aware: when a harness is listed in
  `providers.ollama.harnesses`, an unset `models.<harness>.<role>` falls back
  to `providers.ollama.models.<role>` before the existing tier/hardcoded
  fallback — provider and harness stay independent dimensions, never
  conflated.
- Extend the Codex adapter to render the Ollama `model_provider` wiring
  Codex's own config format requires (a `[model_providers.ollama]`-style
  block plus a per-role `model_provider` reference), gated on `codex`
  appearing in `providers.ollama.harnesses`.
- Render OpenCode's own Ollama provider entry (its OpenAI-compatible
  provider config, pointed at `providers.ollama.baseUrl`) and explicit local
  model entries, gated on `opencode` appearing in `providers.ollama.harnesses`.
- Render the Claude Code gateway wiring (env vars pointing Claude Code's
  Anthropic-compatible client at `providers.ollama.gateway.baseUrl` /
  credential env var) into `.concertino.env`, gated on `claude-code`
  appearing in `providers.ollama.harnesses`.
- **Validation (new, clear error):** if `providers.ollama.harnesses` includes
  `claude-code` but `providers.ollama.gateway` is not configured,
  `concertino validate` fails with an explicit message — Claude Code cannot
  reach Ollama directly and requires a configured Anthropic-compatible
  gateway. This is the one behavioral validation rule this change adds; every
  other new `providers`/`opencode` field is additive and optional.
- Extend `concertino doctor` to check the CLIs of only the harnesses actually
  selected (fixing today's latent gap where the Claude Code CLI check runs
  unconditionally regardless of configured harnesses, and adding a
  conditional OpenCode CLI check), plus a best-effort, non-fatal
  Ollama/gateway reachability check that never prints a credential value.
- Update `docs/harness-capabilities.md`, `docs/config-reference.md`,
  `docs/quickstart.md`, `docs/adapting-to-your-project.md`, `README.md`, and
  `package.json`'s description/keywords for the third harness and the new
  provider config; correct `CONTRIBUTING.md`'s pre-existing overstatement
  that `concertino sync` already renders `.opencode/`/`.cursor/` mirrors.
- Add a new `config/examples/opencode-ollama.json` example demonstrating a
  populated `providers.ollama` block and `harnesses: ["opencode"]` (or a
  mixed set), wired into `cmdCompletion`'s `--example` completion list.
- Add focused unit/script tests: `lib/config.js` provider defaulting +
  validation (including the claude-code-without-gateway error), schema shape,
  `emitOpencode` rendering via a new `test/scripts/opencode-render.test.sh`
  (added to `package.json`'s `test` chain, which is not auto-discovered), and
  `resolveModel` provider-fallback behavior.
- Preserve full backward compatibility: an unconfigured project's default
  `harnesses` stays `["claude-code", "codex"]`; `opencode` and `providers`
  are opt-in only; every existing test, example, and rendered artifact for
  claude-code/codex-only projects is unaffected.

## Capabilities

### New Capabilities
- `opencode-harness`: OpenCode as a third supported harness — native project
  config, per-role agent rendering, delivery command, doctor/eject/diff/
  upgrade/completion support, and its own runtime-identity detection signal.
- `model-providers`: provider-aware model configuration (`providers.ollama`),
  provider-aware model resolution, Codex/OpenCode Ollama provider rendering,
  the Claude Code gateway requirement and its validation error, and doctor's
  Ollama/gateway prerequisite checks.

### Modified Capabilities
- `harness-identity`: `concertino sync`'s static `CONCERTINO_HARNESS` default
  and `concertino validate`'s telemetry-resolution reporting already
  generalize to any harness count with no code change (Requirement 1 and
  Requirement 3 need no text change). `setup-worktree.sh`/`resolve-speed.sh`'s
  runtime detection (Requirement 2) gains a third, best-effort resolution arm
  for an OpenCode-set process signal, ahead of the existing static-default
  fallback — kept as a best-effort addition (matching the existing two
  signals' own "not a documented public contract" caveat), never a hard
  requirement, so an absent or wrong signal degrades to today's existing
  fallback rather than breaking detection.

## Impact

- **Code:** `bin/concertino` (many call sites, enumerated above), `lib/config.js`
  (`DEFAULT_MODEL_TIERS`, `withModelDefaults`, `withDefaults`, `resolveModel`,
  `collectConfigIssues`), `config/concertino.schema.json`, a new
  `adapters/opencode/` directory, `core/scripts/setup-worktree.sh` and
  `core/scripts/resolve-speed.sh` (new runtime-detection arm, kept in lockstep
  per their own existing comment), `core/roles/orchestrator.md` (the
  `{{block:harnessResume}}` extension point plus any hardcoded two-harness
  prose sections need a third case/paragraph).
- **Config:** every project's `concertino.config.json` remains valid
  unchanged; `harnesses`/`providers` are additive, opt-in fields.
- **Docs/examples:** the files listed above, plus a new example config.
- **Tests:** `test/config.test.js` additions, a new
  `test/scripts/opencode-render.test.sh`, and `test/scripts/harness-identity.test.sh`
  additions for the new runtime-detection arm.
- **No breaking changes.** Nothing removes or changes behavior for a project
  that does not configure `opencode` or `providers.ollama`.
