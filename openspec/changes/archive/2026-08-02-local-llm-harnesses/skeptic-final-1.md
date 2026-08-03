## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

**Ground truth re-established**
- Read `ticket.md` (9 ACs), `proposal.md`, `design.md` (Decisions 1–7), `tasks.md`
  (81 items, all checked), `files-modified.md`, `evaluation-1.md`, and the three
  spec deltas (`opencode-harness`, `model-providers`, `harness-identity`)
  directly from disk — not from any agent's narrative.
- `git diff main...HEAD --stat` (35 files, +2404/-138) and full-file reads of
  `lib/config.js`, `bin/concertino` (entire diff, ~800 lines across two reads),
  `config/concertino.schema.json`, `adapters/codex/agent.toml.tmpl`,
  `adapters/opencode/{header,prompt}.md`, `core/scripts/{setup-worktree,resolve-speed}.sh`,
  `core/roles/orchestrator.md`, `docs/harness-capabilities.md`,
  `docs/config-reference.md`, `docs/quickstart.md`,
  `docs/adapting-to-your-project.md`, `README.md`, `ROADMAP.md`,
  `CONTRIBUTING.md`, `package.json`, `test/config.test.js`,
  `test/scripts/harness-identity.test.sh`, `config/examples/opencode-ollama.json`.
- `git diff main...HEAD --name-only` (excluding the change dir) matches exactly
  design.md's Impact section and `files-modified.md` — no scope creep.
- `git log -1`: HEAD is `7200fa4`, on `feature/local-llm-harnesses`; `main` is an
  ancestor of HEAD (clean base, no pending rebase).

**Fresh gate re-runs (this session, in `WORKTREE_PATH`)**
- `node --test` → `tests 1271, pass 1271, fail 0` (read the summary myself, not
  the evaluator's pasted claim).
- `bash test/scripts/opencode-render.test.sh` → `25 passed, 0 failed`, exit 0.
- `bash test/scripts/codex-ollama-render.test.sh` → `17 passed, 0 failed`, exit 0.
- `bash test/scripts/harness-identity.test.sh` → `24 passed, 0 failed` (includes
  the new b.5–b.7 OpenCode-signal cases).
- `node --test test/config.test.js test/validate.test.js` → `35/35 pass`,
  including the exact-error-path claude-code-without-gateway test.
- Full `npm test` chain: exit 0, all 19 script suites read individually, all
  "N passed, 0 failed".

**AC-by-AC trace (own commands, own eyes, not the evaluator's report)**
1. *codex/claude-code/opencode selectable, validate accepts* — ran
   `concertino validate --config=config/examples/opencode-ollama.json`: all
   three sections (`harnesses: opencode, codex`, `Models`, `Providers`) print
   `✓ valid  1 warning` (the one warning is an unrelated missing `.env` file).
2. *sync renders valid native config for every selected harness* — ran
   `concertino sync` against the same example into a scratch `--out`: wrote
   `AGENTS.md`, `.codex/agents/*.toml`, `.codex/config.toml`,
   `.opencode/agents/*.md` (all 5 roles), `.opencode/commands/concertino-deliver.md`,
   `opencode.json` — read every one of these files directly.
3. *per-role Ollama model without hand-editing* — `providers.ollama.models`
   resolves through `resolveModel`; verified via
   `concertino validate`'s Models section showing `opencode.executor
   llama3.1:70b` (from `providers.ollama.models`) vs.
   `opencode.skeptic anthropic/claude-opus-4-1` (the explicit
   `models.opencode.skeptic` override winning), matching Decision 2 exactly.
4. *Codex connects to Ollama* — read the rendered `.codex/config.toml`:
   `[model_providers.ollama]` block with `base_url`, `wire_api = "chat"`,
   `env_key`; and the executor's rendered `.toml` carries
   `model_provider = "ollama"`.
5. *OpenCode connects to Ollama* — read the rendered `opencode.json`:
   `provider.ollama` with `@ai-sdk/openai-compatible`, `options.baseURL`
   carrying the `/v1` suffix, `options.apiKey: "{env:OLLAMA_API_KEY}"`
   (credential name, never value), and a populated `models` map.
6. *Claude Code gateway + validation error* — built a scratch config
   (`generic.json` + `providers.ollama.harnesses: ["claude-code"]`, no
   `gateway`) and ran `concertino validate`: exit code **1**, printed error
   names exactly `providers.ollama.gateway` and explains Claude Code cannot
   connect directly — matches the spec scenario's exact-error-path
   requirement and the evaluator's claim, independently reproduced.
7. *doctor checks selected CLIs + Ollama/gateway without leaking secrets* — ran
   `OLLAMA_API_KEY=supersecretvalue123 concertino doctor
   --config=config/examples/opencode-ollama.json`: output shows
   `✓ ollama.apiKeyEnv   OLLAMA_API_KEY (set)`; grepped the full doctor output
   for the literal secret string — zero matches. Also confirmed on
   `generic.json` (claude-code-only) that doctor shows only a `Claude Code CLI`
   section, no `Codex CLI`/`OpenCode CLI`/`Providers` section — the
   per-harness gating (tasks.md 4.9) works both ways.
8. *backward compatibility* — ran `concertino sync`/`validate`/`doctor`
   against the pre-existing `generic.json` (claude-code-only, no `providers`):
   zero new sections, zero new warnings, identical output shape to what a
   pre-CON-63 doctor/validate would print for that config.
9. *tests cover config validation, rendering, model resolution, drift* —
   verified directly: `test/config.test.js`'s new cases assert
   `resolveModel`/`isOllamaRouted` fallback-vs-override-vs-claude-code-exclusion
   behavior with real assertions (not "exists" checks); the two new script
   tests assert real rendered content (TOML block fields, JSON provider shape,
   merge-marker re-sync preservation) and I re-ran them myself, fresh.

**Design-decision fidelity spot-checks**
- `isOllamaRouted` correctly excludes `claude-code` unconditionally
  (`lib/config.js`) — matches Decision 2's "gateway remaps the model id,
  Concertino does not" rule; confirmed by the
  `resolveModel: claude-code is never routed...` test and by reading the
  function body.
- `FALLBACK_MODEL` map replaces the bare ternary — a fourth/unknown harness
  falls back to `FALLBACK_MODEL['claude-code']` rather than silently
  returning `'sonnet'` from a hardcoded string; test present and passing.
- Merge-marker convention (`mergeMarkedRegion`) is shared between
  `AGENTS.md` and the new `.codex/config.toml` write, adapted to TOML's `#`
  comment syntax — read the shared helper and both call sites; the
  `codex-ollama-render.test.sh` re-sync test proves hand-authored content
  outside the markers survives (`re-sync preserves the hand-authored
  comment/section/value`, all passing).
- The two root-cause/probe bugs `files-modified.md` records are real and
  fixed: (1) `adapters/opencode/prompt.md`'s frontmatter `---` is the literal
  first byte of the file — the research-notes comment lives in
  `bin/concertino`'s source instead, confirmed by reading the file; (2)
  `opencode-render.test.sh`'s eject loop writes to a file before grepping
  (`EJECTED_FILE`) rather than piping into `grep -q`, confirmed by reading
  the script — this is a genuine probe-confirmed fix per
  `systematic-debugging.md`, not a superficial patch.
- Doc updates (`harness-capabilities.md`, `config-reference.md`,
  `quickstart.md`, `adapting-to-your-project.md`, `README.md`, `ROADMAP.md`,
  `CONTRIBUTING.md`) are accurate against the actual rendered behavior I
  reproduced above, not just internally consistent with each other.

**Non-blocking issue independently confirmed**
- `README.md:85`'s CLI-reference line still reads
  `concertino init [--out=DIR] [--example=helio|generic] [--yes]`, not
  updated to include `opencode-ollama`, unlike the prose two lines above it
  (`README.md:78`) and `docs/quickstart.md`, which were updated. Purely
  cosmetic — `concertino init --example=opencode-ollama` itself works
  (verified: ran it, produced a full opencode+codex render). Same issue the
  evaluator already flagged; I reproduced it independently rather than
  trusting the claim.

### Verdict: CONFIRM

### Non-blocking notes
- `README.md:85` — update
  `[--example=helio|generic]` to `[--example=helio|generic|opencode-ollama]`
  for consistency with the prose immediately above it and with
  `bin/concertino`'s own help text / `docs/quickstart.md`. Does not affect
  any acceptance criterion or functionality; safe to fold into a future
  touch of this file rather than blocking delivery.
