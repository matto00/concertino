## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- Read the round-1 report (`skeptic-design-1.md`) in full as claims to re-verify, not fact.
- Read the revised `design.md`, `tasks.md`, `specs/settings-screen/spec.md`, `ticket.md` in full.
- Confirmed the worktree is otherwise unmodified for the areas under review (`git status --short` shows only the untracked `openspec/changes/config-settings-screen/` dir; `git diff --stat main...HEAD` shows no changes yet to `bin/concertino` or `config/concertino.schema.json` — this is still pre-implementation, design gate only).
- Re-read `config/concertino.schema.json` in full (250 lines) and cross-checked every specific line-number/field claim design.md's revision makes:
  - `devServers.backend/frontend` → `$ref: "#/$defs/server"` at lines 74-75 (confirmed byte-for-byte).
  - `models.claude-code/codex` → `$ref: "#/$defs/roleModelMap"` at lines 153-154; `modelTiers.claude-code/codex` → `$ref: "#/$defs/tierMap"` at lines 162-163 (confirmed). `roleModelMap` has exactly 5 properties (orchestrator/executor/evaluator/skeptic/auditor); `tierMap` has exactly 3 (cheap/standard/capable) — matching design.md's claim.
  - `speeds` → `additionalProperties: {"$ref":"#/$defs/speed"}`, no static `properties` key, at line 169 (confirmed).
  - `dashboard.tmuxSession/launchCommand/maxConcurrent/escalationTimeoutMinutes/retentionDays/launchPad.{enabled,backlog}` at lines 123-133, with `maxConcurrent` minimum 1 (line 125), `escalationTimeoutMinutes` minimum 0 (line 126), `retentionDays` minimum 1 (line 127) — confirmed exactly matching design.md's Decision 2 revision and tasks 1.2/1.3.
  - `budgets.*` fields (executionCycles/skepticDesignRounds/skepticFinalRounds/debugAttempts) are `type: integer` with no `minimum` (lines 142-145) — confirmed, matching task 1.2's "integer-only, no lower bound" check.
- Re-read `bin/concertino`'s `withModelDefaults` (304-329), `withDefaults` (331-356), `deepSet`/`coerce` (383-398), `cmdValidate` in full (1400-1599), and the `IMPLICIT_DEFAULT_SPEED` constant (42-45) to verify the revision's factual claims:
  - Confirmed `withDefaults()` still never touches `dashboard` at all, and only backfills `ui` when the whole object is absent — exactly as Decision 3's revised current-value-resolver paragraph states, which is why it no longer routes through `withDefaults()` for defaults at all.
  - Confirmed `IMPLICIT_DEFAULT_SPEED` (`{ budgets: {}, roleTiers: { ...all standard } }`) matches design.md's description of the synthesized `speeds.default` entry.
  - Confirmed no `module.exports` still exists in `bin/concertino` (grep) — consistent with the design's unchanged Open Question, not a new gap.
- Read `test/validate.test.js` in full and the live `concertino.config.json`'s actual `budgets`/`dashboard` values (`python3 -c 'json.load...'`) to check whether the new Budgets/Dashboard checks (task 1.2/1.3) would break any existing fixture's expected exit code/output — none of the existing fixtures or the live config set an out-of-range or non-integer value in either section, so task 1.4's "byte-identical output for every pre-existing check" claim holds.
- Grepped for `TODO|TBD|figure out later|to be determined` across `design.md`/`tasks.md`/`specs/settings-screen/spec.md` — none found.

### Verdict: CONFIRM

All three round-1 change requests are now concretely addressed in `design.md` (Decisions 2 and 3, the Risks section) and `tasks.md` (sections 1 and 2, task 5.4), and every specific technical claim in the revision checks out against the actual schema and `bin/concertino` code I re-read directly:

1. **$ref/$defs resolution + speeds' dynamic keys** — Decision 3 / tasks 2.1-2.2 now explicitly describe resolving `$ref` nodes via `$defs[<name>].properties` substitution for `models`/`modelTiers`/`devServers`, and separately walking the config instance's `speeds` object (falling back to a synthesized `default` entry matching `IMPLICIT_DEFAULT_SPEED`) since `speeds`' keys are schema-undeclared. Grounded correctly against the schema.
2. **Current-value resolver no longer trusts `withDefaults()`** — Decision 3's revised paragraph and task 2.3 specify a uniform "raw value, else flattened-schema default" rule applied to every section including `dashboard`, which `withDefaults()` still doesn't cover (re-confirmed by direct reading). This closes the gap identified in round 1.
3. **Budgets/Dashboard validation checks added to `collectConfigIssues`** — Decision 2's revision and tasks 1.2/1.3/5.4 add exactly the missing integer/minimum/type checks, sourced from the schema's own declared `minimum`s (not invented), closing the silent-invalid-write gap the ticket's AC explicitly forbids.

The proposal/spec/design are now sound enough to implement.

### Non-blocking notes

- `specProvider.changeDir`'s schema `default` is a static string (`"openspec/changes/<CHANGE_NAME>"`), while the actual runtime default computed by `withDefaults()` is conditional on `specProvider.kind` (`"spec/changes/<CHANGE_NAME>"` when `kind !== "openspec"`). Under the new uniform "fall back to the flattened schema's own default" rule (Decision 3), an unset `changeDir` on a `kind: "none"` project would display the schema's static default rather than the kind-aware effective default `withDefaults()` would actually apply. This is a narrow, pre-existing schema/behavior mismatch (one field, not introduced by this ticket), and the spec's own AC wording literally asks for "the schema's default," so this is not a blocker — but worth a one-line callout in Decision 3 if the executor wants to avoid a subtle "the screen shows X but the CLI actually resolves Y" report later.
- The round-1 non-blocking notes (devServers categorization language, models/modelTiers static-vs-speeds-dynamic distinction) remain optional polish; the second one was in fact folded into the revised Decision 3 text already.
