## Skeptic Report — design gate (round 3)

### What I verified (with evidence)

- Read round 2's report (`skeptic-design-2.md`) in full as a claims list, not fact.
- Fresh, full read of the current `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/delivery-speed-presets/spec.md`.
- Re-read `lib/ui/watch.js`'s `open-launchplan` case (908–990), `cycle-harness`
  (1000–1013), `cycle-agent-merge` (1015–1021), and the `applyAction` switch's
  `default: return false;` (1076–1078) in full.
- Re-read `lib/ui/screens/launchplan.js` in full (194 lines) — confirms it is
  still, as of this round, unmodified/pure (no `resolve-speed.sh` wiring exists
  yet — expected, since this is the design gate, not execution).
- Confirmed round 1 finding #1's TUI-wiring half (round 2's Change Requests 1
  and 2) is now correctly fixed: `design.md` Decision 3's TUI-wiring
  subsection and the new `tasks.md` task 5.4a now place the
  `resolve-speed.sh` `execFileSync` calls inside `watch.js`'s
  `open-launchplan`/`cycle-harness` cases and a new `cycle-speed` case,
  mirroring the `commitSha` precedent exactly (same `stdio` discipline, same
  "compute once, screen only renders" shape); `launchplan.js`'s `render()`
  only reads `plan.speed`/`plan.resolvedModels`, task 5.4 explicitly states
  "This file never invokes `resolve-speed.sh` or any other child process
  itself"; `handleKey` gains `s` unconditionally, matching the `h`/`m`
  precedent's shape. Round 2's Change Requests 1 and 2 are resolved.
- Confirmed round 2's non-blocking note (unspecified shape of
  `plan.resolvedModels` on error) is now resolved: `design.md` line 99 and
  `tasks.md` 5.4a both explicitly state `null` on any error.
- **New issue found this round** (not previously raised): traced the
  harness-label vocabulary actually used for `plan.harness`/`plan.harnesses`
  against the vocabulary `resolve-speed.sh`'s `$2` argument and
  `models`/`modelTiers` config keys use, and found a mismatch:
  - `watch.js:930` (`open-launchplan`): `opts.config.harnesses.map((h) => (h
    === 'claude-code' ? 'claude' : h))` — deliberately translates the
    canonical harness identifier `'claude-code'` (used everywhere else in
    this codebase: `core/scripts/setup-worktree.sh`'s `detect_harness()`
    lines 61–62, `.concertino.env`'s `CONCERTINO_HARNESS`,
    `config/examples/*.json`'s `harnesses` arrays, and — per this very
    change's own Decision 1 — `models.<harness>`/`modelTiers.<harness>` keys,
    e.g. `"models": {"claude-code": {...}, "codex": {...}}`) down to
    `'claude'`, the CLI binary name, for building the shell launch command
    (`harnesses[0] + ' "/concertino-deliver {{TICKET}}"'`, line 985).
    `plan.harness`/`plan.harnesses` therefore hold `'claude'`/`'codex'`, not
    `'claude-code'`/`'codex'` — confirmed pervasive in this exact form across
    `test/launchplan.test.js`, `test/drilldown.test.js`, `test/reducer.test.js`,
    `test/router.test.js`, and `watch.js:126`.
  - `design.md`'s Decision 3 TUI-wiring subsection (lines 99–101) and
    `tasks.md` task 5.4a both instruct calling `resolve-speed.sh` with "the
    plan's current `harness`" / "`harnesses[0]`" / "the newly-cycled
    harness" as the literal `$2` value.
  - But Decision 3 point 1 (line 91) and `resolve-speed.sh`'s own contract
    (task 2.1) state `$2` is `claude-code`/`codex`, used **verbatim, no
    detection** — and Decision 1's `modelTiers`/`models` keys are
    `claude-code`/`codex`, never `claude`.
  - Net effect: for the `codex` harness the labels happen to coincide
    (`'codex'` both places), masking the bug in that one case — but for the
    Claude Code harness, calling `resolve-speed.sh '<speed>' 'claude'` would
    look up a harness key (`'claude'`) that does not exist in `speeds.json`'s
    `modelTiers`/`models` blocks, which are keyed `'claude-code'`. Per
    Decision 3 point 4, this is exactly "a harness with no tier data" — a
    non-zero exit, rendered by the launch plan as "models unknown." This
    silently breaks the models-preview acceptance criterion for every
    Claude-Code launch plan, including the common single-harness case
    (`config/examples/generic.json`: `"harnesses": ["claude-code"]`), which is
    the harness this repo's own test suite treats as the default/primary one.
    No task item or design decision anywhere mentions translating
    `plan.harness`'s `'claude'` label back to `'claude-code'` before passing
    it to `resolve-speed.sh`.

### Verdict: REFUTE

Round 2's two change requests are now solidly fixed (re-verified against
ground truth above, not just re-read as prose): the `resolve-speed.sh`
child-process calls correctly live in `watch.js`, not the pure
`launchplan.js`, and a `cycle-speed` case now exists. However, that same
revision introduces a new, concrete gap: it instructs passing `plan.harness`
(which this codebase already translates to the CLI-binary label `'claude'`
for Claude Code) directly as `resolve-speed.sh`'s `$2`, which expects the
canonical harness identifier `'claude-code'`. As specified, every Claude-Code
launch-plan preview would fail to resolve models (falling to "models
unknown"), defeating the "launch plan shows resolved per-role models
pre-flight" acceptance criterion for the harness most projects use.

### Change Requests

1. **`design.md` Decision 3's TUI-wiring subsection and `tasks.md` task 5.4a
   must specify translating `plan.harness`'s CLI-binary label
   (`'claude'`/`'codex'`) back to the canonical harness identifier
   (`'claude-code'`/`'codex'`) before it is passed as `resolve-speed.sh`'s
   `$2`.** Ground truth: `watch.js:930` builds `configuredHarnesses` by
   mapping `'claude-code' → 'claude'` (verbatim in the file); `plan.harness`/
   `plan.harnesses` hold that translated label (`watch.js:972-973`,
   confirmed by every test fixture that sets `harness: 'claude'`), not the
   `'claude-code'`/`'codex'` vocabulary `models.<harness>`/`modelTiers.<harness>`
   (Decision 1) and `resolve-speed.sh`'s `$2` contract (Decision 3 point 1,
   "used verbatim — no detection") use. As written, the `open-launchplan`
   seed call, the new `cycle-speed` case, and `cycle-harness`'s new refresh
   call would all pass `'claude'` where `'claude-code'` is required, and
   `resolve-speed.sh` would report "harness with no tier data" (Decision 3
   point 4) for the Claude Code harness on every launch plan — the primary
   supported harness and the only one in `config/examples/generic.json`.
   **Required fix**: add an explicit reverse-mapping step (e.g. `plan.harness
   === 'claude' ? 'claude-code' : plan.harness`, or equivalently keep a
   second, untranslated harness identifier alongside `plan.harness` for this
   one purpose) in `design.md`'s Decision 3 and in `tasks.md` 5.4a's three
   call sites (`open-launchplan` seed, `cycle-speed`, `cycle-harness`'s
   refresh), so `resolve-speed.sh` always receives `claude-code`/`codex`,
   never the CLI-binary label.

### Non-blocking notes

- None outstanding — round 2's non-blocking note (unspecified
  `plan.resolvedModels` error shape) is now addressed (`null`, stated in both
  `design.md` and `tasks.md`).
