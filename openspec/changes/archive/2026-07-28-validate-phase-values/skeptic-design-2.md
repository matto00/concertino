## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- Fetched CON-3 from Linear directly (mcp__linear__get_issue) and cross-checked its four
  acceptance criteria + notes against the planning artifacts, not against the round-1 summary.
- Read proposal.md, design.md, specs/phase-telemetry/spec.md, tasks.md in full (current state,
  this round).
- Read the real code as it stands today (unmodified by this change yet): lib/ui/reducer.js,
  lib/ui/screens/fleet.js, lib/ui/screens/drilldown.js, lib/ui/store.js, and confirmed the exact
  line numbers/comment text tasks.md references actually exist:
  - store.js:35-36 "A malformed line is skipped and counted, never thrown." — matches task 2.4's
    quoted anchor exactly.
  - drilldown.js:289-295, the "A crashed emitter mid-write leaves malformed lines..." comment —
    matches task 2.4's "around line 289" anchor exactly.
  - orchestrator.md:49-50, `phase=<Phase>` placeholder — confirmed still present, matches
    proposal/task 3.2's target.
  - workflow-state.template.md:10, `PHASE: Setup | Planning | Execution | Evaluation | Delivery
    | Cleanup` — confirmed as the six-value enum task 3.1 will annotate.
- Read test/reducer.test.js and test/fleet.test.js in full to check tasks 4.1-4.3's claims about
  existing coverage: confirmed fleet.test.js:48-52 ("a partially instrumented run says so instead
  of inventing a phase") is a hand-built `run({phase: null})` fixture that never calls `reduce()`,
  and confirmed fleet.test.js already has an established pattern (lines ~269-360, `realisticLog()`
  + `reduce()`) of feeding raw events through `reduce()` end-to-end and asserting on rendered
  output — task 4.3 follows that existing pattern rather than inventing a new one, and tests a
  different thing (that the reducer's validation, not just the screen's null-phase branch, is
  what prevents the phantom-phase label from reaching the screen).
- Grepped the whole `lib/`+`test/` tree for every other consumer of `run.malformed` /
  `.malformed` to check for a hidden assumption (e.g. some invariant like
  `events.length + malformed === total lines`) that broadening the counter's meaning could break.
  Found none — every consumer just sums or displays the integer.

### 1. Does the revised design resolve the round-1 conflation concern, or just relabel it?

It resolves it. Round 1's objection was specifically that the two doc comments describing
`run.malformed` would go stale/wrong once the counter started covering a second failure mode.
The revision:
- Makes the broadened meaning an explicit design.md **Decision** (not a Risk), with a concrete
  argument for why folding the new case into the existing counter (rather than adding a second
  counter) is still correct: the two cases remain distinguishable at the raw-event level (a
  dropped line has no entry in `run.events`; a bad-phase line is sitting in the timeline with its
  literal value), so nothing is actually hidden — only the single summary integer now counts two
  related things.
- Requires (task 2.4) updating exactly the two comments round 1 named, at their real, verified
  locations, to state both cases plainly.
- Adds a new spec.md requirement + two scenarios that make the broadened meaning testable
  contract, not just prose.
This is a real fix, not a relabel — the specific defect (stale comments) is directly closed.

### 2. Is task 2.4 concrete enough for an executor?

Yes. It quotes the existing anchor text in store.js verbatim, gives a specific line number in
drilldown.js (verified accurate against the current file), and states the exact two-case content
both comments must convey afterward, using the same wording as spec.md's requirement text. An
executor doesn't have to invent the semantics — only the wording.

### 3. Does rewritten task 4.3 meaningfully differ from existing coverage?

Yes. The existing fleet.test.js test at lines 48-52 build a `run()` fixture directly with
`phase: null` — it never touches the reducer, so it cannot prove anything about reducer-side
validation. Task 4.3 explicitly requires exercising `reduce()` with a raw `phase.enter` event
carrying an unrecognised value, which follows the codebase's own established `reduce()` +
render() integration-test pattern (already used elsewhere in the same file) and is the only way
to prove the reducer's validation — not the screen's pre-existing null-phase handling — is what
keeps a phantom label off the fleet screen.

### 4. Ticket acceptance criteria, re-traced

- "Unrecognised phase value detected, not silently -1, renders visibly unknown not zero
  progress" → reducer.js's `phase.enter` case (task 2.1/2.2) leaves `run.phase` unchanged and
  increments `run.malformed`; for a run with no prior valid phase this now renders "phase
  unknown" (per spec.md scenario, existing fleet.js behavior for `run.phase == null`) instead of
  today's bug (a garbage phase string next to a 0-fill bar). Covered.
- "PHASE_ORDER and the template enum cross-reference" → tasks 1.1 + 3.1, both directions.
  Covered.
- "Orchestrator doc states exact permitted values inline" → task 3.2, verified the current
  placeholder line (`phase=<Phase>`) it targets. Covered.
- "A reducer or fleet test covers an unrecognised phase value" → tasks 4.1-4.3, more than
  covered.
All four ACs trace to concrete tasks/spec scenarios that match the real code.

### 5. New problems introduced by the revision itself

None found that rise to blocking. Two small non-blocking observations below.

### Verdict: CONFIRM

### Non-blocking notes
1. spec.md's scenario "A rejected-field event still appears in the timeline" (mixed one
   envelope-dropped line + one rejected-phase event → `run.malformed == 2`) isn't explicitly
   assigned to any task in tasks.md section 4 — tasks 4.1/4.2 only exercise the rejected-phase
   case in isolation. Low risk (the counter is a simple additive int and this is implicitly
   exercised by combining existing coverage), but the executor could easily miss asserting this
   specific mixed-cause scenario if grading strictly against spec.md scenarios.
2. `test/drilldown.test.js:70-71`'s comment ("reducer.js already counts malformed lines per run")
   describes only the narrower, original meaning and is not in task 2.4's update list (only the
   two production-code comments in store.js and drilldown.js proper are). It's a test comment,
   not part of any AC, so this is cosmetic only.
