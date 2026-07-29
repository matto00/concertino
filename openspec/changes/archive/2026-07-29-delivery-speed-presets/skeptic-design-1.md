## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/delivery-speed-presets/spec.md` in full.
- Read `bin/concertino` end to end (1711 lines) — `withDefaults()`, `emitClaude()`
  (the Claude-Code emitter; the task brief calls it `emitClaudeCode` but the actual
  function is `emitClaude`), `emitCodex()`, `getVar()`/`renderBody()`,
  `cmdEject()`, `cmdDiff()`, `cmdValidate()`, `cmdSync()`.
- Read `config/concertino.schema.json` (current flat `models` shape).
- Read `core/roles/orchestrator.md` (Phase 2 execution/evaluation loop, final-gate
  section, budget table) and grepped `budgets.` references across
  `orchestrator.md`/`evaluator.md`/`executor.md`.
- Read `core/workflow-state.template.md`.
- Read `lib/ui/prompt.js` (`parseTicketInput`/`submitTicket`/`AGENT_MERGE_FLAGS`),
  `lib/ui/screens/launchplan.js` (`withAgentMergeFlag`, `handleKey`, hints line),
  `lib/ui/reducer.js` (`applyEvent`'s `run.start` case, `emptyRun()`), and
  `lib/ui/screens/drilldown.js` (`harnessText()`).
- Grepped `core/scripts/setup-worktree.sh` for the actual `run.start` emission
  site and its harness-detection order (`detect_harness()`).
- Confirmed `test/scripts/harness-identity.test.sh` exists (the file
  `resolve-speed.test.sh` is designed to mirror) and inspected
  `config/examples/*.json`.

### Verdict: REFUTE

The overall shape (speed as one dial over budgets *and* model tier, tiers
resolved per-harness, explicit override beats tier, final gate always cold) is
sound and matches the ticket's intent, including the hard constraint that the
final skeptic gate is never skippable — Decision 2 and the spec's dedicated
requirement/scenarios for that are solid. But three concrete, ground-truth
gaps make this unbuildable as written, not just under-specified:

### Change Requests

1. **`resolve-speed.sh`'s signature contradicts what the launch-plan preview
   needs, and no mechanism is specified for the TUI to compute the preview at
   all.** `proposal.md` describes the script as resolving `(speed, harness) →
   ...`, but `design.md` Decision 3 and `tasks.md` 2.1 both specify it takes
   only `$1`=speed and *auto-detects* harness at runtime (env `CLAUDECODE`/
   `CODEX_SANDBOX`, else the static `.concertino.env` default) — there is no
   harness parameter. That auto-detection is correct for the orchestrator
   (which runs inside the actual harness process), but `lib/ui/screens/
   launchplan.js` (task 5.4, spec.md "Launch plan shows the resolved speed
   pre-flight") needs to preview resolved per-role models for whichever
   harness the human has explicitly cycled to via `h` on the launch plan —
   independent of, and possibly different from, whatever harness the
   `concertino watch` dashboard process itself happens to be running under.
   `launchplan.js`/`watch.js` are plain Node with no access to
   `resolve-speed.sh`'s env-based semantics, and no worktree exists yet
   pre-launch to run a script inside. Neither `design.md` nor `tasks.md`
   states how the TUI computes this preview — reimplementing the merge/tier
   logic a third time in JS (which Decision 3's own "alternative considered"
   argues against duplicating, for exactly this drift risk) is not
   acknowledged as necessary, and no task item exists for it. This blocks
   tasks.md 5.4/5.5 as written.

2. **The design never identifies the actual `run.start` emission site, so the
   headline auditability requirement (ticket AC + spec.md's dedicated
   requirement) has no concrete mechanism.** Ground truth: `run.start` is
   emitted exactly once today, by `core/scripts/setup-worktree.sh` (see its
   own header comment: "Tier-2 telemetry: the dashboard's run header, emitted
   by the script rather than the agent so a run can never appear without a
   truthful identity"), *before* any orchestrator role-prose step runs.
   `proposal.md`'s Impact section claims the touch point is "the
   `emit-event.sh` call site in the orchestrator" — no such call site exists;
   the orchestrator never calls `emit-event.sh run.start` anywhere today.
   Meanwhile Decision 4 has the *orchestrator* run `resolve-speed.sh` "at
   Setup, immediately after harness/ports are known" — i.e. as a role-prose
   step that happens after `setup-worktree.sh` has already run and already
   emitted the one `run.start` event without `speed`/`models`. Neither
   `design.md` nor `tasks.md` states whether `setup-worktree.sh` itself gets
   modified to accept `SPEED`, call `resolve-speed.sh` internally (harness is
   already resolved inside that same script) and fold `speed=`/`models=` into
   its own `run.start` call, or whether a second `run.start`-carrying event is
   introduced instead. `tasks.md` has no task item touching
   `core/scripts/setup-worktree.sh` at all. This is not a nitpick — it is the
   literal mechanism for the ticket's "emitted on `run.start`" acceptance
   criterion and the spec's dedicated requirement, and it currently has no
   home.

3. **Two other model-resolution call sites duplicate the exact flat-shape
   logic `emitClaude()`/`emitCodex()` use, and are absent from the migration
   task list, so they will silently misbehave once `models` is restructured.**
   `cmdEject()` (bin/concertino:795,810) and `cmdDiff()` (bin/concertino:
   1124,1143) both independently re-run `(c.models && c.models[role]) ||
   r.model` and `(c.models && c.models.codex) || CODEX_MODEL_FALLBACK` —
   `tasks.md` 2.3/2.4 only update `emitCodex()`/`emitClaude()`. Under
   Decision 1's new shape, `c.models.codex` becomes an *object*
   (`{executor: ..., evaluator: ...}`), not a model-id string; in `cmdEject`/
   `cmdDiff`'s untouched Codex branch, `(c.models && c.models.codex) ||
   CODEX_MODEL_FALLBACK` evaluates truthy on that object and
   `.split('{{model}}').join(<object>)` renders the literal string
   `[object Object]` into the emitted `.toml`'s `model = "..."` line — a
   silent, shippable regression in `concertino eject --harness=codex` and
   `concertino diff` for any project that migrates. Separately,
   `cmdValidate()`'s Models section (bin/concertino:1391–1404) hardcodes its
   own flat `modelDefaults` and role-key lookup (`models[role]`); against the
   new sparse per-harness shape every role read returns `undefined`, so
   `concertino validate` would print "unrecognized alias `undefined`" for
   every one of the five Claude Code roles on every project that has migrated
   to the new shape it purports to validate — the opposite of task 1.3's
   stated goal (clearly flagging *old*-shape configs, not new-shape ones).
   None of these three call sites appear in `tasks.md`'s checklist.

### Non-blocking notes

- Decision 5's claim that Claude Code's `Agent` tool accepts a `model`
  parameter overriding the spawned agent's frontmatter is plausible and
  consistent with this repo's own `harnessResume` prose ("You spawn
  sub-agents with the `Agent` tool"), but is a claim about the external
  harness contract that this repo's own docs don't independently state
  anywhere I could find (grepped `docs/harness-capabilities.md`,
  `core/workflow-state.template.md`, adapters — no hits). Worth an explicit
  citation or a fallback note in `design.md` in case it's wrong, though I'm
  not treating it as a blocking finding since I can't disprove it from this
  repo alone.
- `concertino migrate`'s `findAdded()` only adds *new* keys; it has no path to
  convert an existing flat `models.orchestrator`/`models.codex` config into
  the new per-harness shape for external projects — only this repo's own
  config and the bundled examples get hand-migrated per the Migration Plan.
  That may be an acceptable scope cut given the ticket doesn't ask for
  migration tooling, but `design.md`'s Risk section should say so explicitly
  rather than leaving `concertino migrate` silently unable to help a real
  upgrading project.
