## Schema

- `config/concertino.schema.json` — add `"opencode"` to `harnesses.items.enum`; add `opencode` to `models`/`modelTiers` properties; add the new top-level `providers.ollama` object (`baseUrl`, `apiKeyEnv`, `harnesses`, `models`, `gateway`).

## Config domain (`lib/config.js`)

- `lib/config.js` — add `opencode` to `DEFAULT_MODEL_TIERS`/`HARNESSES`; add `FALLBACK_MODEL` map (replacing the bare `harness === 'codex' ? ... : 'sonnet'` ternary); `withModelDefaults` initializes `models.opencode`/`modelTiers.opencode`; `withDefaults` defaults `providers` to `{}`; new `isOllamaRouted(c, harness, role)` helper (deliberately excludes `claude-code` — the gateway remaps the model id, Concertino does not); `resolveModel` gains the provider-model-map fallback tier; `collectConfigIssues` gains `opencode` in `VALID_HARNESSES`, an opencode block in the Models section, and a new `Providers` section (baseUrl/harnesses/gateway validation, including the claude-code-without-gateway failure); `module.exports` extended with `HARNESS`/`FALLBACK_MODEL`/`isOllamaRouted`.

## CLI (`bin/concertino`)

- `bin/concertino` — the bulk of the render/CLI wiring:
  - `block('harnessResume', ...)` gains a third `opencode` arm (conservative, Codex-like sequential default).
  - `emitCodex` gains `codexModelProviderLine`/`mergeMarkedRegion`/`codexOllamaConfigToml` helpers and a new `.codex/config.toml` write, gated on `codex` in `providers.ollama.harnesses`.
  - New `emitOpencode` (plus `OPENCODE_ROLES`, `opencodePermission`, `renderOpencodeAgentMd`, `mergeOpencodeJson`) rendering `.opencode/agents/*.md`, `.opencode/commands/concertino-deliver.md`, and `opencode.json`'s `provider.ollama` entry.
  - `cmdEject` gains an `opencode` harness branch (all five roles) and the codex branch's `model_provider` substitution; unknown-harness error lists `opencode`.
  - `checkArtifacts` gains `.codex/config.toml` and OpenCode file-existence checks (now takes `cfg` for the Ollama-routing check).
  - `cmdDoctor` gates the Claude Code CLI check on `harnesses.includes('claude-code')` (previously unconditional), adds a gated OpenCode CLI check, and calls the new `checkOllamaProvider`.
  - New `checkOllamaProvider` — best-effort, non-fatal Ollama/gateway reachability + `apiKeyEnv`-set (never-value) reporting.
  - `cmdDiff` gains the codex `.codex/config.toml` diff and an `opencode` branch.
  - `cmdUpgrade`'s stale-marker directory scan includes `.opencode/agents`/`.opencode/commands`.
  - `cmdCompletion`'s zsh/bash/fish `--harness=`/`--example=` completions include `opencode`/`opencode-ollama`.
  - `promptConfig`'s interactive harness picker uses a new `HARNESS_COMBOS` map (seven-subset single-select) instead of the old three-way `claude-code|codex|both` enum.
  - `renderEnv` writes `ANTHROPIC_BASE_URL`/`CONCERTINO_OLLAMA_GATEWAY_API_KEY_ENV` into `.concertino.env` when claude-code is Ollama-routed with a gateway configured.
  - `cmdSync` wires `emitOpencode`; help text and inline usage comments updated for the third harness.

## Codex adapter

- `adapters/codex/agent.toml.tmpl` — add the `{{model_provider}}` placeholder.

## OpenCode adapter (new)

- `adapters/opencode/header.md` — shared preamble prepended to the orchestrator's rendered agent file only.
- `adapters/opencode/prompt.md` — the `/concertino-deliver` command template (selects the `concertino-orchestrator` primary agent).

## Core (harness-neutral)

- `core/roles/orchestrator.md` — extend the two remaining "Codex [has/there is] no equivalent per-spawn call" mentions to also name OpenCode (the `{{block:harnessResume}}` extension point itself needed no change — the block already dispatches on `harness`).
- `core/scripts/setup-worktree.sh` — `detect_harness()` gains a third, lowest-precedence `OPENCODE` env-var arm (confirmed against the sst/opencode source, not guessed).
- `core/scripts/resolve-speed.sh` — mirrors `setup-worktree.sh`'s new `OPENCODE` detection arm, in lockstep.

## Examples

- `config/examples/opencode-ollama.json` — new example: `harnesses: ["opencode", "codex"]`, a populated `providers.ollama` block, and per-role `modelTiers.opencode`/`models.opencode` entries.

## Documentation

- `docs/harness-capabilities.md` — capability matrix extended to three harnesses; new "OpenCode" section; "Everything that stays identical" / orphaned-child sections updated for three harnesses.
- `docs/config-reference.md` — new `providers` section documenting the schema block; `harnesses` row updated.
- `docs/quickstart.md`, `docs/adapting-to-your-project.md` — third-harness file lists, `--harness=`/`--example=` mentions, `providers.ollama` pointers.
- `README.md` — intro paragraph, architecture tree, CLI reference, quick-start example flag.
- `package.json` — `description`/`keywords` mention OpenCode/Ollama; `test` script chain gains the two new script tests.
- `CONTRIBUTING.md` — corrects the pre-existing `.opencode/`/`.cursor/` overstatement (OpenCode half now true; Cursor half explicitly flagged as not-yet-built).
- `ROADMAP.md` — "Codex model id" item marked done (superseded); Cursor adapter item notes OpenCode landed ahead of it.

## Tests

- `test/config.test.js` — opencode-valid-harness, `providers.ollama` acceptance, `resolveModel`/`isOllamaRouted` provider-fallback (with/without override, claude-code exclusion, fourth-harness `FALLBACK_MODEL` fallback), the claude-code-without-gateway failure, `schemaSectionOrder`'s new `providers` entry.
- `test/validate.test.js` — subprocess-level claude-code-without-gateway failure/pass cases.
- `test/scripts/harness-identity.test.sh` — `OPENCODE` signal detection, `CLAUDECODE` precedence over it, and the no-signal fallback (speeds.json fixture extended with `opencode` tier data).
- `test/scripts/opencode-render.test.sh` (new) — full `emitOpencode` render coverage + the opencode-absent no-op case + `eject --harness=opencode` for all five roles.
- `test/scripts/codex-ollama-render.test.sh` (new) — `.codex/config.toml` initial render, merge-marker-preserving re-sync, and the not-opted-in no-op case.

## Root cause / probe records (per systematic-debugging.md)

Two bugs were found and fixed during implementation (not part of a pre-existing failure — caught by fresh sync/test runs during this same session, per verification-before-completion.md):

1. **Root cause:** the research-findings comment placed literally atop `adapters/opencode/prompt.md` sat *before* its YAML frontmatter's opening `---`, which breaks any YAML-frontmatter parser (OpenCode's own delivery-command loader included) — a syntax rule, not a runtime guess.
   **Probe:** rendered the file via `node bin/concertino sync` and read the actual output; the frontmatter delimiter was no longer the first bytes of the file.
   **Fix:** moved the research notes into a genuine source-only comment in `bin/concertino` (never rendered) and left the two adapter template files clean.
2. **Root cause:** `test/scripts/opencode-render.test.sh`'s eject loop piped `eject`'s stdout into `grep -q "^---$"` under the script's own `set -o pipefail`; `grep -q` exits as soon as it finds a match, which can SIGPIPE a still-writing `printf` on the other end of a live pipe, and `pipefail` reports that SIGPIPE as the pipeline's own failure — a shell-idiom bug, not a rendering bug (confirmed: the orchestrator role's rendered file is by far the longest of the five, matching exactly the one role that failed).
   **Probe:** ran the identical `printf | grep -q` pair standalone (passed every time) vs. inside the full script with `bash -x` (failed only for the orchestrator role, the longest output) — isolating the difference to output length/pipe-buffering, not content.
   **Fix:** write `eject`'s output to a file first, then `grep` the file — no live pipe, no SIGPIPE race.
