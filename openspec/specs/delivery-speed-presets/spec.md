# delivery-speed-presets Specification

## Purpose
Defines the per-invocation `speed` dial (`fast`/`default`/`slow`) that trades verification rigour against turnaround — named `speeds` presets in `concertino.config.json` resolving to a budgets override plus per-harness, per-role model tiers, always with the final skeptic gate unconditional, auditable via `run.start` and the dashboard drill-down, and selectable from the `n` prompt and launch plan before a run starts.
## Requirements
### Requirement: A speed is accepted on invocation and defaults to `default`
`/concertino-deliver <TICKET> [fast|slow]` SHALL accept an optional trailing speed token immediately after the ticket id. Only the exact strings `fast` and `slow` are recognized; any other trailing token SHALL be rejected the same way an unrecognized ticket id is rejected today, rather than silently coerced. When no speed token is present, the run SHALL resolve `SPEED` to `default`.

#### Scenario: No speed given
- **WHEN** `/concertino-deliver CON-17` is invoked with no trailing token
- **THEN** the orchestrator resolves `SPEED` to `default`

#### Scenario: fast is given
- **WHEN** `/concertino-deliver CON-17 fast` is invoked
- **THEN** the orchestrator resolves `SPEED` to `fast`

#### Scenario: slow is given
- **WHEN** `/concertino-deliver CON-17 slow` is invoked
- **THEN** the orchestrator resolves `SPEED` to `slow`

#### Scenario: An unrecognized trailing token is rejected
- **WHEN** `/concertino-deliver CON-17 turbo` is invoked
- **THEN** the invocation is rejected rather than silently treated as `default` or as part of the ticket id

### Requirement: Speeds are named presets in project config over budgets and model tiers
`concertino.config.json` SHALL support a `speeds` object naming presets (at minimum `fast`, `default`, `slow`), each resolving to a partial `budgets` override (merged over the project's top-level `budgets` defaults) and a `roleTiers` map (role name → `cheap`/`standard`/`capable`). A project SHALL be able to retune any speed's budgets or tiers by editing config alone, without editing any role-doc prose.

#### Scenario: A speed's budgets override is a partial merge
- **WHEN** `speeds.fast.budgets` sets only `executionCycles` and `skepticDesignRounds`
- **THEN** a `fast` run's resolved `skepticFinalRounds` and `debugAttempts` come from the project's top-level `budgets` defaults, unchanged

#### Scenario: Editing a preset in config changes a run's rigour with no code or prose change
- **WHEN** a project lowers `speeds.slow.budgets.executionCycles` in `concertino.config.json` and re-runs `concertino sync`
- **THEN** the next `slow` run resolves the new, lower value with no change to any `core/roles/*.md` file

#### Scenario: A project with no speeds block behaves exactly as before this change
- **WHEN** a project's `concertino.config.json` has no `speeds` key at all
- **THEN** every run resolves identically to `default` using the project's existing top-level `budgets`, with no behavioral change from before this feature shipped

### Requirement: Model configuration is per harness and per role
`concertino.config.json`'s `models` object SHALL be keyed first by harness (`claude-code`, `codex`), then by role, replacing the previous flat-per-role/flat-`codex` shape. A `modelTiers` object SHALL map each harness to its `cheap`/`standard`/`capable` model strings. A speed's `roleTiers` entry for a role SHALL resolve to a concrete model by looking up that role's tier in `modelTiers[<harness>]`.

#### Scenario: Two harnesses resolve the same tier to different models
- **WHEN** `speeds.fast.roleTiers.executor` is `cheap`, `modelTiers.claude-code.cheap` is `haiku`, and `modelTiers.codex.cheap` is `codex-mini-latest`
- **THEN** a `fast` run under Claude Code resolves the executor's model to `haiku`, and the same speed under Codex resolves it to `codex-mini-latest`

#### Scenario: A project pins a role's model regardless of speed
- **WHEN** `models.claude-code.skeptic` is explicitly set to `opus`
- **THEN** every speed's skeptic resolves to `opus` on Claude Code, ignoring whatever tier that speed's `roleTiers.skeptic` names

### Requirement: Explicit model overrides beat preset tier resolution
For a given harness and role, an explicit entry in `models.<harness>.<role>` SHALL always be used in preference to the tier resolved from the active speed's `roleTiers` and `modelTiers`.

#### Scenario: Explicit override wins over a fast run's cheap tier
- **WHEN** `speeds.fast.roleTiers.evaluator` is `cheap` and `models.claude-code.evaluator` is explicitly `sonnet`
- **THEN** a `fast` run's evaluator resolves to `sonnet`, not the `cheap` tier's model

### Requirement: The Codex model path is fully config-driven per role
`adapters/codex/agent.toml.tmpl` rendering SHALL resolve each Codex role's (`executor`, `evaluator`, `auditor`) model independently from `models.codex.<role>` or the resolved tier, rather than substituting one flat model shared by every role. No hardcoded model constant SHALL remain in the Codex rendering path as a value used when config is absent — the fallback SHALL itself come from `modelTiers.codex`'s default-populated `standard` entry.

#### Scenario: Two Codex roles render different models
- **WHEN** `models.codex.evaluator` is explicitly `gpt-5.1-codex-mini` and `models.codex.auditor` is unset (resolving to the `standard` tier's `gpt-5.1-codex`)
- **THEN** `concertino sync` renders `.codex/agents/concertino-evaluator.toml` with `model = "gpt-5.1-codex-mini"` and `concertino-auditor.toml` with `model = "gpt-5.1-codex"`

### Requirement: The final skeptic gate runs at every speed
No speed preset SHALL be able to skip, weaken to a non-cold spawn, or omit the final skeptic gate. `secondFinalGateSkeptic` and any other speed-specific flag MAY only *add* verification (a second independent final-gate skeptic under `slow`), never remove the baseline cold final gate any speed already requires.

#### Scenario: fast still runs the final skeptic gate
- **WHEN** a `fast`-speed run's evaluator returns `PASS`
- **THEN** the orchestrator spawns the cold final-gate skeptic exactly as it would for `default` or `slow`

#### Scenario: No config can disable the final gate
- **WHEN** a project's `speeds.fast` config is edited in any way
- **THEN** there is no field the schema accepts that removes the final skeptic gate's invocation

### Requirement: Resolved speed and models are auditable after the fact
The orchestrator SHALL emit the resolved `speed` and the resolved per-role `models` on the run's `run.start` telemetry event, and the dashboard's drill-down screen SHALL render both for any run that has them.

#### Scenario: run.start carries speed and models
- **WHEN** a run starts with `SPEED=fast`
- **THEN** the emitted `run.start` event includes `speed=fast` and the resolved per-role model values

#### Scenario: Drill-down shows the resolved rigour
- **WHEN** a human opens the drill-down for a run that emitted `speed`/`models` on `run.start`
- **THEN** the screen displays the run's speed and its resolved per-role models

#### Scenario: A run predating this feature has no speed to show
- **WHEN** a human opens the drill-down for a run whose `run.start` event has no `speed`/`models` fields
- **THEN** the screen renders their absence the same way it already renders any other missing optional field, without treating the run as malformed

### Requirement: The `n` prompt and launch plan let a human choose and preview the resolved speed
The dashboard's `n` prompt SHALL accept an optional trailing speed token (`fast`/`slow`) the same way it already accepts `--agent-merge`/`--no-agent-merge`, and the launch plan screen SHALL display the resolved speed and per-role models before launch, with a key to cycle the speed for the batch.

#### Scenario: Typed speed on the n prompt
- **WHEN** `CON-17 fast` is typed into the `n` prompt
- **THEN** the launched run resolves `SPEED` to `fast`, the same as if it had been passed to `/concertino-deliver` directly

#### Scenario: Launch plan shows the resolved speed pre-flight
- **WHEN** the launch plan screen is showing a batch of tickets to launch
- **THEN** it displays the batch's resolved speed and per-role models before any run starts, and a key exists to cycle the speed

#### Scenario: A batch carries one speed for all its tickets
- **WHEN** a batch of multiple tickets is launched from the launch pad
- **THEN** every ticket in that batch launches with the same resolved speed — there is no per-ticket speed within one batch

### Requirement: Escalation behavior is unchanged at every speed
An exhausted budget (execution cycles, skeptic design rounds, skeptic final rounds, debug attempts) SHALL always reach a human via the existing escalation mechanism, regardless of speed. No speed SHALL cause a run to silently proceed past an exhausted budget.

#### Scenario: fast's lower cycle cap still escalates on exhaustion
- **WHEN** a `fast` run's execution↔evaluation loop reaches its resolved (lower) `executionCycles` bound still at `FAIL`
- **THEN** the orchestrator surfaces the same escalation to a human it would for `default` or `slow` reaching their own (higher) bound, with the evaluator's Critical Path report

#### Scenario: slow's higher cycle cap still escalates on exhaustion
- **WHEN** a `slow` run's execution↔evaluation loop reaches its resolved (higher) `executionCycles` bound still at `FAIL`
- **THEN** the orchestrator surfaces the same escalation to a human, unchanged in shape from `default`

