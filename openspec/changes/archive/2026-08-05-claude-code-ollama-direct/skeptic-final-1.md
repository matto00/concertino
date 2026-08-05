## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

**Ground truth re-established independently** (not from evaluation-1.md's narrative):
- `git diff -a main...HEAD --stat` (25 files, 1349+/99-) and full `git diff -a` reads
  of `lib/config.js`, `lib/cli/render.js`, `lib/ui/harness.js`, `lib/cli/doctor.js`,
  `core/scripts/resolve-speed.sh`/`scripts/concertino/resolve-speed.sh` (byte-identical,
  confirmed), `lib/ui/controllers/launchpad.js`, `config/concertino.schema.json`,
  `docs/config-reference.md`, `test/config.test.js`, `test/harness.test.js`,
  `test/validate.test.js`. All match design.md's Decisions 1-6 exactly — no drift
  between what design.md/tasks.md/files-modified.md claim and what the diff actually
  does.
- `git status --porcelain`: only the evaluator's own untracked `evaluation-1.md`
  (expected). Clean otherwise.

**Full test suite, run fresh myself** (not trusting evaluation-1.md's pasted numbers):
`npm test` → exit 0, `# tests 1470 / # pass 1470 / # fail 0`. Matches the evaluator's
claim exactly.

**AC 1 — "no gateway → claude-code offers `local` via P/p, `provider:ollama` routes it":**
Reproduced directly against the built library, not tests:
```
providerChoices(DIRECT_CFG, 'claude-code')      -> [null, 'ollama', 'default']
resolveTicketProvider(['provider:ollama'], DIRECT_CFG, 'claude-code') -> 'ollama'
providerChoices(INCOMPLETE_GATEWAY_CFG, ...)    -> [null, 'default']   (correctly refuses)
```
Also verified end-to-end via a real scratch project (`concertino sync`/`validate`
against `providers.ollama.baseUrl` + no gateway): `validate` exits 0, `.concertino.env`
gets `ANTHROPIC_BASE_URL='http://127.0.0.1:11434'` + `ANTHROPIC_AUTH_TOKEN='ollama-local'`.

**AC 2 — "per-role models resolve to Ollama ids direct, hosted aliases via gateway":**
```
resolveModel(direct-config, 'claude-code', 'executor')  -> 'qwen3:8b'
resolveModel(gateway-config, 'claude-code', 'executor') -> 'sonnet'
```
Confirmed in the rendered artifact too: scratch project's
`.claude/agents/concertino-executor.md` frontmatter reads `model: qwen3:8b` (a real
Ollama id), not a hosted alias.

**AC 3 — "doctor reports which route":** ran `concertino doctor` against the same
scratch project: `✓ providers.ollama.route direct`. Confirmed the shell test
(`test/scripts/doctor-ollama-models.test.sh` scenarios 5-6) exercises both route
values non-vacuously (`has`/`hasnt` on both `direct` and `gateway`).

**AC 4 — "measure a real run before declaring it usable" (CON-74 precedent):**
Independently reproduced the executor's wire-format claims against the real local
Ollama server (v0.32.1, models present including `qwen3:8b`) and Claude Code CLI
2.1.222, using the exact `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN` values
`renderEnv` actually produced:
- No token, `--bare -p`: `Not logged in · Please run /login`, exit 1 — reproduces
  design.md Decision 4's claim exactly.
- Placeholder token (`ollama-local`), `--bare -p "Reply with exactly: OK"`: `OK`,
  exit 0.
- Placeholder token, `--bare -p` with `Read` tool allowed, asked to read a probe
  file I wrote myself (`hello concertino skeptic test file`): Claude Code correctly
  issued a `Read` tool call against Ollama and reported the file's real contents
  back accurately — a genuine tool-use round trip, independently confirmed, not
  taken on the executor's word.
- (Side note, not a defect: running `claude -p` **without** `--bare` against
  `qwen3:8b` produced garbled/hallucinated output, because non-bare mode loads
  this environment's full MCP tool-schema set — including Linear tools — into a
  small local model's context, which it doesn't follow reliably. The executor's
  own verification protocol used `--bare` throughout (files-modified.md line 24),
  matching what I reproduced; this is a pre-existing small-model/MCP-schema
  interaction, not something this change introduces or should be blocked on.)

**Code quality / no scope creep:**
- `isOllamaRouted` remains the single source of truth; every downstream consumer
  (`resolveModel`, `renderEnv`, `renderSpeedsJson`→`resolve-speed.sh`, `doctor`,
  `harness.js`) reads it or its rendered `gatewayConfigured` signal — verified by
  reading each call site's diff, not assumed.
- The one item not literally in proposal.md's Impact list — the Models-section
  alias-check fix in `collectConfigIssues` (`lib/config.js`) — is a real,
  necessary fix (without it, a legitimate direct-route Ollama model id like
  `qwen3:8b` would be wrongly flagged as an "unrecognized alias"); confirmed via
  a direct call: `collectConfigIssues` produces zero `models.claude-code.*`
  warnings for the direct-route scratch config. Correctly scoped as a
  same-mechanism gap, not scope creep.
- `lib/ui/controllers/launchpad.js`: re-grepped for `gateway` after the diff (per
  tasks.md 3.8's own instruction) — all 4 remaining mentions correctly describe
  the route-conditional behavior; no stale "claude-code needs a gateway" claim
  survives, no logic change (confirmed by diff, only comments changed).
- The pre-existing NUL byte in `lib/ui/harness.js` (making `git diff --stat` show
  it as binary) was independently confirmed to exist on `main` too — not
  introduced by this change, as evaluation-1.md claims.
- No regressions: gateway-route claude-code, Codex, and OpenCode Ollama paths
  unchanged — confirmed by reading the diff (all changed conditionals are
  strictly *more* permissive additions to pre-existing gateway-present branches)
  and by the full green test run including untouched Codex/OpenCode suites.

### Verdict: CONFIRM

Every acceptance criterion traces to real, independently-reproduced evidence —
not just the executor's/evaluator's narrative. The design's six decisions are
implemented faithfully and consistently across all seven touched runtime files
plus schema/docs/tests. The wire-format verification (the ticket's explicit,
CON-74-precedent-driven requirement) was reproduced firsthand against a real
local Ollama server and Claude Code CLI, including the tool-use round trip —
the single riskiest, least-mechanically-checkable claim in this change. No
contradictions, no placeholders, no scope creep of consequence, full test suite
green (1470/1470, reproduced). This ships.

### Non-blocking notes

- Same one the evaluator flagged: `docs/config-reference.md`'s per-ticket-provider
  paragraph edit incidentally corrects a stale Codex CLI-flag description
  (`-c model_provider=…` → `--oss --local-provider ollama`) in the same paragraph
  being rewritten for claude-code's two routes. Harmless, but worth calling out
  in the PR description so it isn't mistaken for an intentional Codex-behavior
  change (Codex/OpenCode routing is an explicit Non-Goal here).
