## Context

`concertino.config.json` currently has two independent-looking but actually-coupled dimensions of rigour:

- `budgets` (`executionCycles`, `skepticDesignRounds`, `skepticFinalRounds`, `debugAttempts`) — a single flat set of numbers, baked at `concertino sync` time into role-doc prose via `{{var:budgets.X}}` templating (see `getVar()` / `renderBody()` in `bin/concertino`). Every rendered `.claude/agents/concertino-*.md` and every `core/roles/*.md` reference is a **static string** by the time a run starts.
- `models` — flat per-role for Claude Code (`orchestrator`/`executor`/`evaluator`/`skeptic`/`auditor`), plus one flat `models.codex` shared by every Codex role. Also baked at sync time: `concertino sync` writes a fixed `model:` frontmatter field into each `.claude/agents/concertino-<role>.md` and substitutes one `{{model}}` per Codex `.toml`.

Both are **sync-time constants**. A "speed" chosen at `/concertino-deliver <TICKET> fast` is a **run-time** choice. This is the structural problem the proposal names: today's shape has nothing for a run-time speed to vary, because the values it would vary are already frozen into rendered files before any run starts.

Two different fixes are available depending on whether the harness can vary a *spawn's* model at call time:

- **Claude Code**: the `Agent` tool this repo's own orchestrator uses accepts a `model` parameter that "takes precedence over the agent definition's model frontmatter" — i.e. Claude Code already has a per-spawn override mechanism, unused today. Budgets have no equivalent "override at call time" concept for prose the orchestrator reads, but the orchestrator itself is a `Read`/`Bash`-capable process — it can look a number up in a file at run time instead of finding it already substituted into its own role prose.
- **Codex**: per `AGENTS.md`, orchestration on Codex runs sequentially in a single process (no subagent spawn with a call-time model override). Its model resolution is necessarily sync-time / best-effort — the header comment on `adapters/codex/agent.toml.tmpl` already says as much for today's flat model. This proposal makes that per-role and config-driven, but does not claim Codex gets true run-time speed-to-model resolution; that is out of scope (see Non-Goals).

## Goals / Non-Goals

**Goals:**
- A named `speed` (`fast`/`default`/`slow`) resolves, per run, to: a `budgets` override, a per-role model, and (for `slow` only) two behavioral flags — `secondFinalGateSkeptic`, `evaluatorCleanWorktree`.
- Resolution is harness-aware: the same speed name resolves to different concrete models on Claude Code vs. Codex, via a tier indirection (`cheap`/`standard`/`capable`) rather than a hardcoded model string per speed.
- Explicit `models.<harness>.<role>` config always wins over a tier resolution — a project that has pinned a role keeps it regardless of speed.
- The resolved speed and models are computed once per run, persisted in `workflow-state.md`, emitted on `run.start`, and rendered on the drill-down — auditable after the fact.
- The `n` prompt and the launch plan let a human pick the speed and see the resolved models before launching, following the exact precedent `--agent-merge`/`--no-agent-merge` already set (same "typed flag on the prompt" + "pre-flight display + cycle key on the launch plan" shape).
- The final skeptic gate runs, cold, at every speed — no config path can disable it.
- Escalation behavior (what reaches a human vs. resolves in-loop) is structurally unchanged; only the numeric bound and the model a role runs on move.

**Non-Goals:**
- True run-time model switching for Codex. Its agent `.toml` files are rendered once at sync time; this design makes that rendering per-role and config-driven (closing the ROADMAP item) but does not attempt to make Codex's model vary by the speed of an individual `/concertino-deliver` invocation. This is called out explicitly in the rendered Codex header/prompt so it is a documented limit, not a silent gap.
- A design-gate-driven "escalate my own speed" mechanism (the ticket's closing note floats this as something to *consider*, not a stated acceptance criterion). Left as a `## Open Questions` item / follow-on, not built here.
- Migrating a project's *existing* run history — `run.start` events already emitted under the old shape simply have no `speed`/`models` fields; the dashboard renders their absence the same way it already renders any other optional-field absence (e.g. `harness: null` before harness-identity shipped).
- A `speeds`-driven change to which gates run — the proposal (and CON-22 itself) is explicit that speed tunes budgets/depth/model, never which gates exist.

## Decisions

### Decision 1 — `models` becomes `models.<harness>.<role>`; `modelTiers.<harness>.<tier>` is new

Replaces:
```json
"models": { "orchestrator": "sonnet", "executor": "sonnet", "evaluator": "sonnet", "skeptic": "sonnet", "auditor": "sonnet", "codex": "codex-mini-latest" }
```
with:
```json
"models": {
  "claude-code": { "skeptic": "opus" },
  "codex": { "skeptic": "gpt-5.1-codex" }
},
"modelTiers": {
  "claude-code": { "cheap": "haiku", "standard": "sonnet", "capable": "opus" },
  "codex": { "cheap": "codex-mini-latest", "standard": "gpt-5.1-codex", "capable": "gpt-5.1-codex" }
}
```
`models.<harness>` is now **sparse by design** — only roles a project has deliberately pinned appear. `withDefaults()` in `bin/concertino` fills `modelTiers` with the two harnesses' current defaults (so an unconfigured project resolves identically to today's `sonnet`-everywhere / `codex-mini-latest` behavior once tiers are applied at `standard`), but does **not** invent a default `models.<harness>` entry per role — presence in `models` means "explicit override," and an empty/absent role there is exactly what lets a tier resolution apply.

**Alternative considered**: keep `models` flat and add a second flat `modelsCodex` block. Rejected — the proposal's acceptance criteria state model config must be "per harness and per role," and a project adding a third harness later (Cursor, per ROADMAP) would need a third flat block instead of one already-shaped-for-N-harnesses object.

**Breaking change**: yes. Existing `concertino.config.json` files (the repo's own, plus `config/examples/*.json`) are migrated as part of this change (see Migration Plan). `concertino validate` should flag the old flat shape with a clear "moved to models.<harness>.<role>, see CHANGELOG" message rather than a generic schema-validation dump — a project upgrading past this version hits one clear error, not a wall of `additionalProperties` failures.

**Every flat-`models` call site in `bin/concertino` moves together, not just the two sync emitters.** The design-gate skeptic (round 1) found that `emitClaude()`/`emitCodex()` are not the only readers of `c.models`: `cmdEject()` (the single-file eject path) and `cmdDiff()` (the drift-preview path) both independently re-run the exact same flat lookup (`(c.models && c.models[role]) || r.model` and `(c.models && c.models.codex) || CODEX_MODEL_FALLBACK`) to render their own preview output, and `cmdValidate()`'s "Models" section independently re-implements a flat `modelDefaults`/`models[role]` read to sanity-check aliases. Under the new per-harness shape, `c.models.codex` is an *object*, not a string — left untouched, `cmdEject`/`cmdDiff`'s Codex branch would render the literal text `[object Object]` into a `.toml`'s `model = "..."` line, and `cmdValidate` would report every role as an unrecognized-alias `undefined` on a *correctly migrated* project (the opposite of what task 1.3 wants: flagging the *old* shape, not the new one). All four call sites (`emitClaude`, `emitCodex`, `cmdEject`, `cmdDiff`) and `cmdValidate`'s Models section are updated together against one shared per-harness resolution helper (see task 1.5) — not patched independently, which is exactly how this gap was introduced in the first place (`cmdEject`/`cmdDiff` grew as copies of the sync emitters and were never revisited together).

### Decision 2 — `speeds` presets: budgets override + role→tier map + two `slow`-only flags

```json
"speeds": {
  "fast": {
    "budgets": { "executionCycles": 2, "skepticDesignRounds": 1 },
    "roleTiers": { "orchestrator": "standard", "executor": "cheap", "evaluator": "cheap", "skeptic": "capable", "auditor": "standard" }
  },
  "default": {
    "budgets": {},
    "roleTiers": { "orchestrator": "standard", "executor": "standard", "evaluator": "standard", "skeptic": "standard", "auditor": "standard" }
  },
  "slow": {
    "budgets": { "executionCycles": 5, "skepticDesignRounds": 5, "skepticFinalRounds": 3, "debugAttempts": 3 },
    "roleTiers": { "orchestrator": "capable", "executor": "capable", "evaluator": "capable", "skeptic": "capable", "auditor": "capable" },
    "secondFinalGateSkeptic": true,
    "evaluatorCleanWorktree": true
  }
}
```
`budgets` in a speed is a **partial override** merged over the top-level `budgets` block (itself unchanged in shape — it remains the fallback for any field a speed doesn't mention, and is exactly today's config for a project that never adds `speeds` at all: `withDefaults()` synthesizes a `default` speed with an empty `budgets` override and `roleTiers` all `"standard"` when a project's config has no `speeds` block, so an unmigrated project's runs resolve byte-for-byte identically to today).

`secondFinalGateSkeptic` and `evaluatorCleanWorktree` default to `false` and are meaningful only for `slow` (the schema permits them on any speed for forward-compatibility, but `fast`/`default` never set them `true` in the shipped default config). Per the ticket's own framing, **`fast` never sets `secondFinalGateSkeptic: false` as a way to weaken the final gate** — the final gate's cold-skeptic invocation is unconditional in the orchestrator role regardless of speed; only `slow` can *add* a second one.

**Alternative considered**: a single `tier` string per speed (`fast: "cheap"`) applied uniformly to every role. Rejected — the ticket is explicit that `fast` keeps the final skeptic gate "at full strength and on a capable model" while cheapening executor/evaluator; a single scalar can't express that asymmetry, `roleTiers` can.

### Decision 3 — Resolution is a rendered script (`resolve-speed.sh`), not a runtime Node dependency

A rendered project has no guarantee `concertino`'s own Node CLI is on `PATH` at run time — only `scripts/concertino/*.sh` (copied by `copyAssets`) and `.concertino.env` (rendered by `concertino sync`) are guaranteed present, and these are committed into the project's git history by `sync`, so they exist in **every** checkout of the branch — the main checkout the dashboard process runs from, and every worktree cut from it — with no run required to materialize them. So the merge/tier-resolution logic must run at `concertino sync` time (in Node, testable, single source of truth) and be **baked into a data file**, with a thin runtime script doing only the final per-(speed, harness) lookup:

- `concertino sync` renders `scripts/concertino/speeds.json`: the project's `speeds`, `modelTiers`, and `models` blocks, defaults already applied by `withDefaults()` — i.e. exactly the config, not yet resolved to one speed.
- `concertino sync` also copies a new `core/scripts/resolve-speed.sh` into `scripts/concertino/resolve-speed.sh` (same `copyAssets` loop as every other script), which:
  1. Takes `$1` = speed name (`fast`/`default`/`slow`; defaults to `default` if empty/unset), and an **optional `$2` = harness override** (`claude-code`/`codex`). When `$2` is given, it is used verbatim — no detection. When `$2` is omitted, harness is resolved the same way `setup-worktree.sh` already does: runtime env signal (`CLAUDECODE`/`CODEX_SANDBOX`) first, else the static `CONCERTINO_HARNESS` from `.concertino.env`, else `unknown`. The explicit-override parameter exists specifically because two different callers need two different resolution strategies (see below) — this was a gap in round 1 of this design, caught by the design-gate skeptic: a single auto-detecting signature cannot serve a caller that isn't running *inside* the harness process it wants to preview.
  2. Merges `budgets` (top-level defaults ← `speeds.<speed>.budgets`) and resolves each role's model (`models.<harness>.<role>` if present, else `modelTiers.<harness>.<speeds.<speed>.roleTiers.<role>>`) using `jq`, from `speeds.json`.
  3. Prints one JSON object to stdout: `{"speed":"<name>","harness":"<h>","budgets":{...},"models":{...},"secondFinalGateSkeptic":bool,"evaluatorCleanWorktree":bool}`.
  4. Exits non-zero with a clear message for an unknown speed name or a harness with no tier data.

**Two callers, two harness-resolution needs — both served by the one script:**
- **The orchestrator**, running inside the actual harness process during a live run, needs auto-detection — it calls `resolve-speed.sh "$SPEED"` (no `$2`) from *inside* `setup-worktree.sh` itself (see Decision 3a below), which already resolves `HARNESS` at that point and can pass it as `$2` explicitly rather than relying on resolve-speed.sh's own auto-detection redundantly — either works, but passing it explicitly avoids computing it twice.
- **The launch plan** needs to preview the resolved models for whichever harness the human has explicitly cycled to with `h` — which may differ from whatever harness the dashboard itself happens to run under, and there is no live run to auto-detect from. Per this codebase's own established architecture (verified against `lib/ui/watch.js` and `lib/ui/screens/launchplan.js`, both read in full during the design gate), `launchplan.js` is declared **pure** in its own header comment ("Pure: (state, opts) -> string") and does no I/O anywhere — `render()`/`handleKey()` never shell out, and `draw()` in `watch.js` calls the router's `render()` unconditionally on every 1-second poll tick *and* after every keypress, so any child-process call placed inside `launchplan.js`'s render path would re-fork `resolve-speed.sh` once a second for as long as the screen is open. The one-time, plan-creation-time child-process precedent already exists in `watch.js` itself: `open-launchplan`'s `case` computes `commitSha` via a single synchronous `execFileSync('git', ...)` call and stores the result on `plan` for the (still-pure) screen to render. Speed/model preview follows the identical shape:
  - **Harness-label translation (round 3's fix):** `watch.js`'s `open-launchplan` case already translates the canonical harness id `claude-code` down to the CLI-binary label `claude` for `configuredHarnesses`/`plan.harness`/`plan.harnesses` (`opts.config.harnesses.map((h) => (h === 'claude-code' ? 'claude' : h))`), because that label is what actually appears in the shell launch command (`claude "/concertino-deliver ..."`). `resolve-speed.sh`'s `$2` and the `models.<harness>`/`modelTiers.<harness>` config keys (Decision 1) use the *canonical* id (`claude-code`/`codex`), never the CLI-binary label. So every call site below that passes a harness to `resolve-speed.sh` **must reverse-translate first**: `const canonicalHarness = (h) => (h === 'claude' ? 'claude-code' : h);` — applied to `plan.harness` (or `harnesses[0]`) immediately before it becomes `resolve-speed.sh`'s `$2`, at all three call sites listed below. This one helper is the single place the translation happens, so it can't drift between the three sites the way copy-pasting the ternary three times would risk.
  - `watch.js`'s `open-launchplan` case seeds `plan.speed = 'default'` and calls `scripts/concertino/resolve-speed.sh 'default' <canonicalHarness(harnesses[0])>` synchronously (same `execFileSync`, same `stdio: ['ignore','pipe','ignore']` discipline as `commitSha`), storing the parsed JSON as `plan.resolvedModels` (or `null` on any error — a project predating this feature, a missing script, a bad harness/tier — never thrown up to the human as a crash; `launchplan.js` renders `null` as "models unknown").
  - A new `case 'cycle-speed':` in the same `applyAction` switch mutates `plan.speed` through `default → fast → slow → default` and re-invokes `resolve-speed.sh` with the new speed and `canonicalHarness(plan.harness)`, refreshing `plan.resolvedModels`, plus re-applying `withSpeedFlag` to `plan.launchCommand` exactly as `cycle-agent-merge` re-applies `withAgentMergeFlag`.
  - The existing `cycle-harness` case additionally re-invokes `resolve-speed.sh` with the plan's *current* `speed` and `canonicalHarness(<the newly-cycled plan.harness>)`, refreshing `plan.resolvedModels` — today it only refreshes `plan.launchCommand`, but once a models preview exists it is per-`(speed, harness)`, so a harness cycle must invalidate the previous harness's stale preview the same way it already refreshes the launch command.
  - `launchplan.js`'s `handleKey` gains an `s` → `{ type: 'cycle-speed' }` case (always available, unlike `h`'s `harnesses.length > 1` guard — every project has at least the one `default` speed to cycle away from) and `render()` reads `plan.speed`/`plan.resolvedModels` only — it never invokes a child process itself, and never needs the canonical/CLI-label distinction since it never talks to `resolve-speed.sh` directly.
  - This is why `resolve-speed.sh`'s `$2` argument exists: without it, `watch.js` (or the orchestrator) would have no way to request a specific harness's resolution independent of whatever the calling process's own ambient environment happens to be, and — per the "Alternative considered" below — reimplementing the resolution merge a second time in JS was rejected as exactly the drift risk this decision otherwise avoids.

The orchestrator (or a circuit breaker reacting to its failure) treats a non-zero exit from `resolve-speed.sh` as a `BLOCKER` (environmental), not a code-fixable failure, matching the existing "Server start" circuit-breaker shape (1 attempt, `BLOCKER` → human). The launch plan screen treats it as "models unknown for this harness" (rendered, not fatal — the human can still launch; the preview is best-effort, the orchestrator's own resolution at Setup is authoritative).

**Alternative considered**: have the orchestrator role read `concertino.config.json` directly with `jq` and reimplement the tier-resolution merge inline in role prose, and have `launchplan.js` reimplement the same merge a second time in JS. Rejected — the merge (partial-budgets-override, explicit-model-vs-tier-fallback) is exactly the kind of logic this repo already keeps in one place in `bin/concertino` (see `withDefaults()`) rather than duplicated across bash-in-prose and JS; duplicating it a second or third time risks the copies drifting, and there is no test seam for prose or for `launchplan.js`-embedded logic the way there is for one shared `resolve-speed.sh` (see Migration Plan / tasks.md for its test).

### Decision 3a — `run.start` gains `speed`/`models` at its actual emission site: `setup-worktree.sh`, not the orchestrator

Ground truth (confirmed by the design-gate skeptic against `core/scripts/setup-worktree.sh`): `run.start` is emitted exactly **once**, by `setup-worktree.sh` itself (`CONCERTINO_ROLE=script "${SCRIPT_DIR}/emit-event.sh" run.start ...`), as the very last telemetry the script does before printing its `READY` lines — deliberately emitted by the script rather than the agent, so a run can never appear on the dashboard without a truthful identity. The orchestrator never calls `emit-event.sh run.start` anywhere; round 1 of this design incorrectly assumed it did.

This means `resolve-speed.sh` must run **inside `setup-worktree.sh`**, not as a separate step the orchestrator takes afterward:

- `setup-worktree.sh`'s usage becomes `setup-worktree.sh <TICKET_ID> <BRANCH> [SPEED]` — a new, optional third positional argument, defaulting to `default` exactly like `resolve-speed.sh` itself does when omitted (the orchestrator role's Setup section is updated to pass whatever `SPEED` it parsed from the invocation, per Decision 6, as this third argument).
- After `setup-worktree.sh` resolves `HARNESS` (its existing `detect_harness`/`.concertino.env` logic, unchanged), it calls `scripts/concertino/resolve-speed.sh "$SPEED" "$HARNESS"` itself — passing the harness it already computed, so the resolution is never done twice or drifts between the two scripts' independent detection.
- The resulting `budgets`/`models`/flags JSON is folded into the same `run.start` call `setup-worktree.sh` already makes: `speed=` and a `models=` field (the per-role JSON, serialized compactly — `emit-event.sh` already accepts arbitrary `key=value` pairs and handles JSON-valued fields elsewhere, e.g. escalation `context=`).
- `setup-worktree.sh` also appends the resolved data to its own `READY` contract — `READY speed=<name>`, `READY budgets=<json>`, `READY models=<json>` — alongside the existing `READY worktree=`/`branch=`/`dev_port=`/`backend_port=` lines. The orchestrator parses these exactly like it already parses the port lines, and writes them straight into `workflow-state.md` — **no second `resolve-speed.sh` invocation by the orchestrator itself**, since `setup-worktree.sh` already did the one authoritative resolution and reported it back.

This keeps the orchestrator's Setup section a single call to `setup-worktree.sh` (as today, just with one more argument and a few more `READY` lines to parse) rather than adding a second script invocation whose result would have to somehow agree with what `run.start` already recorded.

**Alternative considered**: keep `resolve-speed.sh` a step the orchestrator runs independently after `setup-worktree.sh`, and add a *second* telemetry event (e.g. `speed.resolved`) carrying the fields instead of extending `run.start`. Rejected — the ticket's acceptance criterion is specifically that speed/models are "emitted on `run.start`," and a run's identity/config should be recorded in one event a dashboard already renders as the run's header, not split across two events that could theoretically disagree if the second one were ever skipped or reordered.

### Decision 4 — Budgets move from sync-time-baked prose to a runtime lookup against `workflow-state.md`

Today `core/roles/orchestrator.md` (and `evaluator.md`, `executor.md`) reference `{{var:budgets.executionCycles}}` etc., substituted to a literal number by `renderBody()` at sync time. Once budgets vary per invocation, that template can no longer carry the authoritative number — it would always say whatever the *default* speed resolves to, wrong for every `fast`/`slow` run.

Fix: at Setup, immediately after harness/ports are known, the orchestrator runs `resolve-speed.sh "$SPEED" > `(captured, not a temp file — same "capture stdout" pattern already used for `setup-worktree.sh`'s `READY` lines), parses the four budget fields, `SPEED` itself, and the two `slow` flags, and writes them into `workflow-state.md` (new fields — see `core/workflow-state.template.md` changes in tasks.md). Every subsequent role-doc reference to a budget number is rewritten from a template-baked constant to an instruction to **read the current value from `workflow-state.md`** (the same place `CYCLE`/`SKEPTIC_CYCLE` counters already live and are read back on resume) — the counters were already runtime state; the bounds they're compared against become runtime state too, for exactly the same resume-safety reason.

`{{var:budgets.X}}` templating itself is **not removed** from `bin/concertino` — it still renders the *default* speed's numbers into role-doc prose as a human-readable illustrative example (e.g. "Execution ↔ Evaluation | 3 (default speed's budget; the live run reads its resolved value from workflow-state.md) |"), so a project maintainer reading the rendered role doc still sees a concrete number, but the doc text itself now says explicitly that the authoritative source at run time is `workflow-state.md`.

**Alternative considered**: keep budgets sync-time-only and only let *models* vary by speed at runtime (dropping "tune budgets" from the runtime mechanism, keeping it sync-time only e.g. via three project configs). Rejected outright — the ticket's acceptance criteria and worked example (`fast`: execution cycles capped at 2) require budgets to vary **by invocation**, not by which config a project happens to maintain.

### Decision 5 — Per-spawn model override on Claude Code; Codex stays sync-time

After resolving models in Setup, the orchestrator's every `Agent(...)` spawn (executor, evaluator, skeptic) passes the resolved role's model as the call's `model` parameter — overriding whatever `concertino sync` baked into that role's `.claude/agents/concertino-<role>.md` frontmatter. `concertino sync` itself keeps writing a `model:` frontmatter field (using `default` speed's resolution, i.e. today's behavior) so the static agent file is never invalid/malformed on its own — the per-spawn override is additive, not a replacement for the rendered default.

This relies on an external harness contract — the Claude Code `Agent` tool accepting a `model` parameter that takes precedence over a spawned subagent's own frontmatter — that this repo's own docs don't currently state anywhere independent of this design (the design-gate skeptic checked `docs/`, `core/workflow-state.template.md`, and every `adapters/` file and found no prior citation). `core/roles/orchestrator.md`'s updated per-spawn instruction (tasks.md 3.5) states this contract explicitly at its point of use, and the executor implementing it MUST re-verify the parameter's exact name/behavior against the live harness rather than trust this doc alone — if the parameter turns out not to exist or not to override frontmatter as expected, the fallback is simply today's behavior (sync-time model only, no per-spawn override), which is a silent-but-safe degradation to resolve rather than a hard blocker: budgets and the final-gate/second-skeptic behavior are unaffected either way, only the model-tuning half of a speed would fail to take effect on that harness.

For Codex, there is no equivalent per-spawn call in the orchestrator's own role prose (orchestration is sequential per `AGENTS.md`); `models.codex.<role>` / `modelTiers.codex.<tier>` only affect what `concertino sync` bakes into `.codex/agents/concertino-<role>.toml`, which reflects the **default speed only**. `adapters/codex/prompt.md` and `core/roles/orchestrator.md`'s Codex-rendered section document this limit explicitly (a "fast"/"slow" run under Codex still gets budgets/round-count tuning — those are read by the sequential process at runtime same as Claude Code — but not a different model per role).

### Decision 6 — Speed argument parsing (mirrors the existing `--agent-merge` precedent exactly)

`/concertino-deliver <TICKET> [fast|slow]`: the trailing token, if present, must be exactly `fast` or `slow` (absent means `default`) — same allowlist-of-exact-strings discipline `AGENT_MERGE_FLAGS` already uses in `lib/ui/prompt.js`, extended with a second, independent trailing token so both can be combined in either order in the future without ambiguity today (this change ships speed-only parsing; a ticket could type `CON-17 fast` or `CON-17 --agent-merge`, not both combined yet — see Open Questions).
- `adapters/claude-code/command.md`: `$ARGUMENTS` parsing gains "extract an optional trailing `fast`/`slow` token" next to the existing agent-merge flag extraction, passed to the orchestrator as `SPEED=<fast|slow|default>`.
- `core/roles/orchestrator.md`: a new `SPEED` input (optional, `fast`/`slow`/unset→`default`), resolved once in Setup exactly like today's `AGENT_MERGE_OVERRIDE`.
- `lib/ui/prompt.js`: `parseTicketInput` gains a second allowed trailing token drawn from `{fast, slow}`, independent of the `AGENT_MERGE_FLAGS` set, so `"CON-17 fast"` parses the same way `"CON-17 --agent-merge"` does today. `submitTicket` substitutes it inside `{{TICKET}}` the same way.
- `lib/ui/screens/launchplan.js`: a `speed` field on `plan`, shown pre-flight next to `harness`/`agent-merge` (`f.padTo('speed  ' + plan.speed, 24)`), with an `s` key cycling `default → fast → slow → default` — same shape as `cycleConcurrency`/`h`/`m`, added to the hints line unconditionally (speed is always editable, unlike `h` which requires >1 configured harness and `m` which requires `agentMergeEditable`).
- `lib/ui/queue.js`: the batch's single resolved speed is threaded into `withAgentMergeFlag`-style substitution (a new `withSpeedFlag`, same insert-after-`{{TICKET}}` placement) alongside the existing agent-merge flag, applied once per batch exactly as concurrency/agent-merge already are.

## Risks / Trade-offs

- **[Risk] Breaking `models` shape invalidates every existing project config.** → Mitigation: `concertino validate` detects the old flat shape specifically (not just generic schema failure) and prints the exact migration (`models.orchestrator` → `models.claude-code.orchestrator`, etc.); `config/examples/*.json` and this repo's own config are migrated in this same change as a worked example.
- **[Risk] `resolve-speed.sh` becomes a second source of truth that drifts from `bin/concertino`'s `withDefaults()`.** → Mitigation: `resolve-speed.sh` never re-implements defaulting — `speeds.json` is rendered already-defaulted by `withDefaults()`, so the script only does the (speed, harness) → values lookup, not the merge-with-project-defaults step. A test (`test/scripts/resolve-speed.test.sh`, mirroring the shape of `test/scripts/harness-identity.test.sh`) fixtures a rendered `speeds.json` and checks resolution for `fast`/`default`/`slow` × both harnesses, including the explicit-override-beats-tier case.
- **[Risk] `fast` becomes the default in practice** (named explicitly in the ticket). → Mitigation already required by the acceptance criteria: `speed` is emitted on `run.start` and rendered on the drill-down unconditionally (not just for non-default speeds), so a fleet running mostly `fast` is visible in the dashboard rather than discoverable only by reading transcripts.
- **[Risk] Codex's model tier is sync-time-only, which could read as "speed doesn't really work on Codex."** → Mitigation: documented as an explicit Non-Goal and called out in the rendered Codex prompt/header so it's a stated limit, not a silent gap; budgets/round-counts still resolve at runtime for Codex identically to Claude Code — only the model dimension is sync-time there.
- **[Risk] `concertino migrate` cannot convert an adopting project's existing flat `models` config to the new per-harness shape.** `findAdded()` (the mechanism `concertino migrate` uses today) only ever *adds* new keys a schema version introduces — it has no path to rewrite/move an existing key. Only this repo's own `concertino.config.json` and the bundled `config/examples/*.json` are hand-migrated as part of this change (Migration Plan step 3); a real adopting project upgrading past this version hits `concertino validate`'s clear old-shape error (Decision 1) and must hand-edit its config once. → Mitigation: this is an accepted scope cut, not an oversight — stated here explicitly rather than left as a silent gap in `concertino migrate`'s coverage. A follow-on `concertino migrate --rewrite-models` is a reasonable `ROADMAP.md` candidate, not required by this ticket's acceptance criteria.
- **[Trade-off] `slow`'s `evaluatorCleanWorktree` and `secondFinalGateSkeptic` are the two most invasive behavioral changes in this design** (a second independent skeptic whose verdict must agree; the evaluator re-running gates from a clean worktree rather than the executor's). Both are gated behind the `slow` speed only, off by default, so a project that never opts into `slow` sees zero behavioral change beyond the config-shape migration. Full mechanics for both (how a "clean worktree" is materialized for the evaluator, how two skeptic verdicts are reconciled when they disagree) are left to `tasks.md`/the executor to design against the `core/roles/evaluator.md` and `core/roles/orchestrator.md` sections this change touches, using the same escalation shape as every other disagreement in this workflow (a genuine two-skeptic split is a `BLOCKER`, not a coin flip).

## Migration Plan

1. Schema: add `modelTiers`, `speeds`; restructure `models` to per-harness. Bump `withDefaults()` to synthesize `modelTiers` defaults + an implicit `default` speed for any config missing `speeds`.
2. `concertino validate`: detect + clearly message the old flat `models` shape.
3. Migrate `concertino.config.json` (this repo) and `config/examples/*.json` to the new shape, preserving today's effective resolution (`sonnet` everywhere at `standard`, `opus` for skeptic as an explicit `models.claude-code.skeptic` override where a project already set it).
4. Render `scripts/concertino/speeds.json` + `scripts/concertino/resolve-speed.sh` from `concertino sync`; add its test.
5. Update `core/workflow-state.template.md` with `SPEED` + resolved-budget + resolved-model fields.
6. Rewrite budget references across `core/roles/orchestrator.md`, `evaluator.md`, `executor.md` to read from `workflow-state.md` at runtime, keeping `{{var:budgets.X}}` only as illustrative default-speed prose.
7. Wire per-spawn `model` overrides into the orchestrator's `Agent` calls (Claude Code); document the Codex sync-time-only limit inline.
8. TUI: `prompt.js`, `launchplan.js`, `queue.js`, `reducer.js`, `screens/drilldown.js`.
9. Update `adapters/claude-code/command.md`, `adapters/codex/prompt.md`, `adapters/codex/agent.toml.tmpl`.

No data migration is needed for already-emitted `run.start` events — they simply lack `speed`/`models`, rendered as absent exactly like any other optional field predating its own introduction.

## Open Questions

- Should the design gate be able to escalate its own speed upward (ticket's closing note)? Not required by the acceptance criteria; left as a follow-on candidate for `ROADMAP.md` rather than built here.
- Should `fast`/`slow` and `--agent-merge`/`--no-agent-merge` be combinable in one invocation (e.g. `CON-17 fast --agent-merge`)? Not required by this ticket's acceptance criteria (which only specify the speed token); the parsing in Decision 6 is written so adding that combination later is additive, not a rework.
