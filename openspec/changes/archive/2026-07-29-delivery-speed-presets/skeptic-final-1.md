## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

**Ground truth re-established** — read ticket.md, design.md, tasks.md, spec.md,
files-modified.md, evaluation-1.md as claims only; independently read the full
current text of every file design.md's Decisions/tasks.md name (not the diff
alone): `core/roles/orchestrator.md`, `core/roles/evaluator.md`,
`core/roles/executor.md`, `core/scripts/resolve-speed.sh`,
`core/scripts/setup-worktree.sh`, `config/concertino.schema.json`,
`concertino.config.json`, `bin/concertino` (all 5 `resolveModel()` call
sites), `lib/ui/watch.js`, `lib/ui/screens/launchplan.js`, `lib/ui/prompt.js`,
`lib/ui/reducer.js`, `lib/ui/screens/drilldown.js`, `lib/ui/queue.js`,
`adapters/claude-code/command.md`, `adapters/codex/prompt.md`.

**The non-negotiable constraint — final skeptic gate at every speed:**
- `config/concertino.schema.json`'s `$defs.speed` has exactly three
  behavioral fields (`budgets`, `roleTiers`, `secondFinalGateSkeptic`,
  `evaluatorCleanWorktree`) — none of which can disable the gate's spawn;
  `secondFinalGateSkeptic`/`evaluatorCleanWorktree` are additive-only by
  construction (they gate an *extra* re-run, never the baseline spawn).
- `core/roles/orchestrator.md`'s "Final gate (Skeptic)" section (lines
  280–344) spawns the skeptic unconditionally on evaluator PASS, states
  "This gate runs at every speed, unconditionally — no config field, at any
  speed, can skip or weaken it," and the Guardrails section repeats this.
  Traced the control flow directly: nothing upstream of the spawn call reads
  a config field that branches around it.
- Ran `resolve-speed.sh` myself (see Reproduction below) for `fast`/`default`/
  `slow` against `claude-code` and `codex` using this repo's own rendered
  `speeds.json` — in every case `secondFinalGateSkeptic` only ever adds a
  second skeptic (`slow`), never removes the first; `fast`'s skeptic tier
  resolves to `opus` (capable), never cheapened.

**Reproduction — traced (speed, harness) → resolution end to end, myself,
against a freshly rendered `speeds.json` (not trusting the executor's or
evaluator's transcript of this):**
```
$ node bin/concertino sync --out=/tmp/con22-sync --config=concertino.config.json
$ bash /tmp/con22-sync/scripts/concertino/resolve-speed.sh fast claude-code
{"speed":"fast","harness":"claude-code","budgets":{"executionCycles":2,"skepticDesignRounds":1,"skepticFinalRounds":2,"debugAttempts":2},"models":{"orchestrator":"sonnet","executor":"haiku","evaluator":"haiku","skeptic":"opus","auditor":"sonnet"},"secondFinalGateSkeptic":false,"evaluatorCleanWorktree":false}
$ bash /tmp/con22-sync/scripts/concertino/resolve-speed.sh slow claude-code
{"speed":"slow", ... "skeptic":"opus", ..., "secondFinalGateSkeptic":true,"evaluatorCleanWorktree":true}
$ bash /tmp/con22-sync/scripts/concertino/resolve-speed.sh default codex
{"speed":"default","harness":"codex", ... "models":{...all "codex-mini-latest"...} ...}
$ bash /tmp/con22-sync/scripts/concertino/resolve-speed.sh turbo claude-code
FAIL unknown speed "turbo" — known speeds: default, fast, slow   (exit 1)
```
Confirms: `fast` cheapens executor/evaluator to `haiku` but keeps skeptic at
`opus`; budgets partial-merge correctly (fast's `skepticFinalRounds`/
`debugAttempts` fall through to the top-level default, unmentioned in
`speeds.fast.budgets`); an unrecognized speed fails loudly rather than
silently defaulting.

**Harness-label translation (claude-code vs claude), all callers:**
Read `lib/ui/watch.js` in full around `canonicalHarness()` (line 60) and its
three call sites: `open-launchplan` (line 1011,
`canonicalHarness(harnesses[0])`), `cycle-harness` (line 1066,
`canonicalHarness(plan.harness)`), `cycle-speed` (line 1091,
`canonicalHarness(plan.harness)`). All three apply the translation
immediately before the value reaches `resolveModelsForPlan`'s `harness`
param, which is a thin wrapper that never itself translates (confirmed by
its own header comment and body — no substitution logic inside it). No
fourth call site exists (grepped `resolve-speed.sh` and `resolveModelsForPlan`
across `lib/ui/`). `test/watch.test.js` additionally proves this with a fake
script that echoes its own argv back (`canonicalHarness('claude')` →
`claude-code`, verified not `claude`).

**Escalation / circuit-breaker shape unchanged at every speed:**
Read `core/roles/orchestrator.md`'s "Escalation & Circuit Breakers" section
in full (lines 457–579): every bound (`EXECUTION_CYCLES`,
`SKEPTIC_DESIGN_ROUNDS`, `SKEPTIC_FINAL_ROUNDS`, `DEBUG_ATTEMPTS`) is now a
`workflow-state.md` lookup rather than a template constant, but the *shape* —
what resolves in-loop vs. reaches the human — is byte-for-byte the same
table as before, plus one new row ("Speed resolution ... 1 attempt ...
BLOCKER → human"). `core/roles/evaluator.md`'s Final-cycle behavior and
`core/roles/executor.md`'s debug-attempts circuit breaker were rewritten the
same way (read both diffs in full). The `slow`-only second-skeptic
disagreement path explicitly routes to a human `BLOCKER`, never auto-resolves
(orchestrator.md lines 328–338) — this is new escalation surface, not a
weakening of existing surface.

**Shared model-resolution helper, all 5 call sites, no drift:**
Grepped `bin/concertino` for any remaining direct `c.models[...]` access
outside `withModelDefaults`/`resolveModel` — none found. Read `emitClaude`,
`emitCodex`, `cmdEject` (both branches), `cmdDiff` (both branches), and
`cmdValidate`'s Models section directly — all five call `resolveModel(c,
harness, role)`, none re-implement the flat lookup.

**Verification gates — re-run myself, not trusted from either prior report:**
- `npm test` → exit 0. `node --test`: `tests 586, pass 586, fail 0`.
  `resolve-speed.test.sh`: 31 passed, 0 failed. `harness-identity.test.sh`'s
  new (c) section and rewritten b.6 (unknown-harness now FAILs before any
  worktree/telemetry) both pass.
- `npm run test:selftest` → exit 0, renders `speeds.json`/`resolve-speed.sh`,
  `validate` reports 3 pre-existing warnings (canonicalDocs, unrelated), 0
  errors.
- `openspec validate delivery-speed-presets --strict` → "Change
  'delivery-speed-presets' is valid".
- `node bin/concertino validate` (this repo's own config) → all checks
  passed; `Models` section shows `claude-code.{orchestrator,executor,
  evaluator,skeptic,auditor}` all `sonnet` — matches the pre-change flat
  config's `skeptic: sonnet` exactly (the migration did not silently pin
  skeptic to `opus`; the old config never had it there either — traced
  `git diff main...HEAD -- concertino.config.json` to confirm the old
  `models.skeptic` value really was `sonnet`, not `opus`, before asserting
  "no regression").

**Acceptance criteria traced to real code (ticket.md):**
- Trailing `[fast|slow]` token, default: `adapters/claude-code/command.md`,
  `adapters/codex/prompt.md`, `lib/ui/prompt.js`'s `SPEED_FLAGS` (code-
  enforced rejection of an unrecognized token, verified via
  `test/prompt.test.js`'s `parseTicketInput('CON-17 turbo') === null`),
  `core/roles/orchestrator.md`'s `SPEED` input. Met.
- Speeds as config presets over budgets/tiers: `concertino.config.json` +
  both `config/examples/*.json` all carry a `speeds` block; schema enforces
  shape. Met.
- Per-harness/per-role models, Codex config-driven: schema + `resolveModel()`
  + `ROADMAP.md`'s "Codex model id" item removed (diff confirmed). Met.
- Tiers resolve through harness, not hardcoded models: reproduced directly
  above (`fast`/codex → `codex-mini-latest`, `fast`/claude-code → `haiku`,
  same speed name, different concrete model). Met.
- Explicit override beats preset: schema, `resolveModel()`, and
  `resolve-speed.sh`'s jq (`$explicit[$role] // $tiers[...]`) all agree; this
  repo's own config sets no explicit override today, but
  `test/scripts/resolve-speed.test.sh`'s a.2 exercises it with a
  deliberately-non-ambiguous fixture. Met.
- Final skeptic gate at every speed: verified above, independently
  reproduced. Met.
- Speed + models on `run.start`, rendered on drill-down: `setup-worktree.sh`
  folds `speed=`/`models=` into its one `run.start` emission (read the
  script in full — this is the actual, only emission site, matching design.md
  Decision 3a); `lib/ui/reducer.js` parses `ev.models` defensively (`try/catch`
  around `JSON.parse`, confirmed the value really is a JSON-*string* per
  `emit-event.sh`'s `json_value()`, not a nested object, and the parse
  accounts for that); `lib/ui/screens/drilldown.js` renders a new header row,
  degrading to `(speed unknown)` for a run predating the feature (own test
  proves `assert.doesNotMatch(out, /undefined/)`). Met.
- `n` prompt + launch plan preview: `lib/ui/prompt.js`, `lib/ui/screens/
  launchplan.js` (`withSpeedFlag`, verified it composes correctly with
  `withAgentMergeFlag` in both orders via `test/launchplan.test.js`'s
  composition test — cycling one flag never drops the other), `lib/ui/
  watch.js` (`resolveModelsForPlan`, wired at all 3 sites). Met.
- Escalation unchanged at every speed: verified above. Met.

### Non-blocking notes

1. `openspec/specs/agent-merge/spec.md` (the archived, "living" spec from
   CON-24, not touched by this change's own spec delta) still has a scenario
   reading "its own `model:` resolved from `models.auditor`" — a config path
   that no longer exists under the new `models.<harness>.<role>` shape (it's
   now `models["claude-code"].auditor` / `models.codex.auditor`, or a tier
   fallback). This is now stale documentation of current system behavior;
   worth a follow-up spec delta for the `agent-merge` capability, but it does
   not affect any runtime behavior, this ticket's own acceptance criteria, or
   anything `openspec validate` checks for this change.
2. `core/scripts/README.md`'s new `resolve-speed.sh` entry points to
   `docs/config-reference.md` "for the config shape," but that doc documents
   neither the old nor the new `models`/`modelTiers`/`speeds` shape
   (pre-existing gap, not a regression this change introduced — already
   flagged by the evaluator; confirmed independently by grepping
   `docs/config-reference.md`).
3. The ticket's `spec.md` scenario "an unrecognized trailing token is
   rejected" is fully code-enforced on the `n` prompt / launch-plan / queue
   path (`SPEED_FLAGS`, tested), but on the raw Claude Code `/concertino-
   deliver CON-17 turbo` slash-command path, rejection depends on the LLM's
   own reading of `adapters/claude-code/command.md`'s prose (which doesn't
   explicitly instruct "reject anything that isn't `fast`/`slow`/absent").
   This is the identical architecture the pre-existing `--agent-merge` flag
   already has (prose-only enforcement on that one entry point), not a new
   gap this change introduces — noted for completeness, not a regression.

### Verdict: CONFIRM
