## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

**Ground truth re-established, not trusted from prior reports.** Read
`ticket.md`, `design.md` (all 7 decisions + both design-gate revision notes),
`tasks.md`, both spec deltas, `proposal.md`, `files-modified.md`, and
`evaluation-1.md` as claims, then verified each against the actual diff
(`git diff main...HEAD`, all 31 files) and by reading full file contents for
every touched production file.

- **AC1 (a FAILED run has an action beyond the generic set).** Traced
  `lib/ui/screens/fleet/keys.js:320-325` directly: `a`/`d` resolve to
  `{ type: 'address-failure', ... }` / `{ type: 'open-mark-done-confirm', ... }`
  only when `key === 'a'/'d' && focus === 'runs' && runs[selected] &&
  runs[selected].status === 'failed'` — exactly design.md's round-2-corrected
  Decision 1, including the load-bearing `focus === 'runs'` guard. Confirmed
  the guard actually closes the leak it claims to: read the full `handleKey`
  body and confirmed the `focus === 'queue'`/`focus === 'quickstart'` blocks
  above neither claim nor suppress `a`/`d` the way they do `\r`/`l`/`n`/`N`,
  so without the guard a FAILED row selected-but-off-screen would fire. Ran
  `test/fleet.test.js`'s new scenarios myself (see Verification below) — all
  four spec scenarios (address-failure/open-mark-done-confirm on FAILED+runs
  focus; no-op on non-FAILED; no-op while queue/quickstart focused even with
  an off-screen FAILED `selected`) pass against the real `handleKey`.
- **AC2 (mechanism documented + footer-advertised, "only advertise a key
  that currently does something").** `docs/dashboard.md` gained a key-table
  entry for `a`/`d` plus a full "Addressing a FAILED run" subsection
  (verified via `git diff`). `sections.js:393-399`: the FAILED footer hint
  (`a address`/`d done`) is pushed only `if (runs.some((r) => r.status ===
  'failed'))` — mirrors QUEUED's own `f force-start`/`C clear queue` gating
  immediately below it. Render-level tests (`fleet.test.js`) assert the hint
  text is absent with no FAILED runs and present with one — I re-ran these.
- **AC3 (every escalated decision resolved or escalated-and-answered).**
  All 7 decisions from `ticket.md`'s "Design decisions to escalate" have a
  matching numbered Decision in `design.md` and a matching bullet in
  `proposal.md`'s "Why" section. Decision 7 (design-ticket-type idea) — I
  independently queried Linear for CON-100 and confirmed it exists, is
  correctly titled/described, and links back to CON-98 exactly as claimed —
  not just asserted in the planning docs.
- **Decision 1 (no new focus mode, `focus === 'runs'` guard).** Full code
  read of `keys.js` confirms the binding site, the guard, and the resolution-
  at-keypress-time behavior (`ticket` resolved off `runs[selected]` directly,
  same as `t`/`l`) match design.md verbatim.
- **Decision 2 (`run.override` + highest-precedence `deriveStatus` branch +
  real on-screen `markDoneConfirm` banner).** Read `reducer.js` in full:
  `emptyRun.override`, `applyEvent`'s `case 'run.override':`, and
  `deriveStatus`'s new first branch (`if (run.override) return
  run.override.status;`, ahead of the live-escalation branch) all present
  exactly as designed. Confirmed the confirm banner is not just keypress-
  interception: `sections.js`'s `buildHeadTail` has a real `else if
  (markDoneConfirm)` branch printing "mark TICKET as done... proceed?",
  threaded through `render.js`'s `render()`, `watch.js`'s `draw()`
  `heightOpts`, and `controllers/fleet.js`'s `scrollToShow` `winOpts` — all
  four wiring points design.md's Decision 2 calls out by name are present.
  `test/fleet.test.js` has a dedicated render-level test
  (`plain(renderFleet(...))` asserting the banner text is on screen) — this
  is the exact class of check that would have caught the round-1 skeptic
  finding if it had regressed; I re-ran it and it passes.
- **Decision 3 (retry-visibility refinement).** `reducer.js:247-259` matches
  design.md's code sample field-for-field (`run.window.alive &&
  run.spawnedAt != null && (run.endedAt == null || run.spawnedAt >
  run.endedAt)` → `'running'`). `test/reducer.test.js` has five dedicated
  cases covering this exact branch, including the one edge case the design's
  own risk section flags (`spawnedAt` before `endedAt` — the original spawn,
  not a retry — must NOT trigger the refinement); I re-ran these and all
  pass.
- **Decision 4 (`/concertino-address-failure` + orchestrator entry point).**
  Read `adapters/claude-code/address-failure-command.md` in full — a real,
  followable command (frontmatter, argument extraction, a concrete `Agent`
  call spawning `concertino-orchestrator` with `ADDRESS_FAILURE=true`, and an
  explicit "When the orchestrator returns" section deferring to
  `command.md`'s own handling), not a stub. Read the new "Address-Failure
  entry point" section added to `core/roles/orchestrator.md` — a genuine
  5-step procedure (audit the full event log before any write → restore the
  worktree via `setup-worktree.sh`, never hand-rolled → resume from
  `workflow-state.md` or reconstruct from persisted evidence or fall back to
  a fresh run, stated plainly → persist the audit via `persist-evidence.sh`
  → resume the ordinary Execution/Evaluation/Delivery/Cleanup loop, passing
  audit findings to the first resumed executor). Every scenario in
  `specs/address-failure-skill/spec.md` traces to specific prose in this
  section (audit-before-write, idempotent restore, three-way resume
  fallback, evidence persistence, loop reuse, claude-code-only scoping).
- **Deviation sanity-check (tasks.md 5.2 — `ctx.deps.submitTicket` instead
  of `ctx.launcher.launch`).** Independently traced `lib/ui/launcher.js`'s
  `launch()` → `specFor()` → `harness.js`'s `launchSpecForTicket`/
  `commandForTicket`: confirmed `specFor` re-derives the command per-ticket
  from cached Linear labels (a `harness:<value>` label), which — for a
  mislabeled ticket — really would replace the `/concertino-address-failure`
  command with a different harness's ordinary `/concertino-deliver`
  template. Confirmed `submitTicket` (imported from `./prompt` in both
  `launcher.js` and `controllers/fleet.js`, via `watch.js`'s `ctx.deps`) is
  literally the same function `launcher.launch()` calls one layer down — the
  deviation is behavior-neutral for the common case and closes a real risk
  for the mislabeled case. The reasoning holds up against the actual code,
  not just the stated rationale. Confirmed via `test/controllers-fleet.test.js`
  that the controller calls `submitTicket` with the fixed
  `/concertino-address-failure {{TICKET}}` template and never routes through
  `ctx.launcher`.
- **Escalated decisions 5-7 reflected in final state, not just asserted.**
  Decision 5 (dashboard-only, no ticket-provider write-back): confirmed
  `writeOverrideEvent`/`session.js` never touches `set-ticket-state.sh` or
  any provider call — grepped the diff, no such reference exists anywhere in
  the new code. Decision 6 (FAILED-only scope): confirmed no new action was
  added to NEEDS YOU/RUNNING/DONE anywhere in `keys.js`/`sections.js`, and
  `docs/dashboard.md`'s new subsection documents the audit outcome for all
  three. Decision 7: independently verified via `mcp__linear__get_issue`
  that CON-100 exists, standalone, linked back to CON-98.

### Verification gates re-run myself

```
npm test
```
Full suite: `node --test` → `# tests 1721 / # pass 1721 / # fail 0`, followed
by all `test/scripts/*.test.sh` shell suites (set-ticket-state, local
provider rendering, standalone triage rendering, etc.) — every one reported
`N passed, 0 failed`. Overall exit code `0`.

```
openspec validate failed-run-remediation-controls --strict
```
→ `Change 'failed-run-remediation-controls' is valid`.

(Note: `npx openspec` failed with "could not determine executable to run" —
this repo has no local `openspec` devDependency; the globally-installed
`/usr/bin/openspec` binary is what `npm run` scripts and the evaluator's own
report actually invoke. Re-ran with that binary directly and got a clean
result, matching evaluation-1.md's claim.)

### UI / design judgment

N/A per task framing — this is a TUI change to concertino's own dashboard,
not a web app with a Playwright-reviewable dev server, and no design
standard is configured for this project. Verified the on-screen rendering
(confirm banner, footer hint, inline notice) via the render-level unit tests
that assert on actual rendered terminal output (`plain(renderFleet(...))`),
which I re-ran myself rather than trusting the evaluator's description of
them.

### Verdict: CONFIRM

Every acceptance criterion traces to real, tested code. The design's three
non-trivial decisions (the `focus === 'runs'` leak-closing guard, the
render-not-just-intercept confirm banner, and the retry-visibility
`deriveStatus` refinement) — each one flagged by a prior design-gate skeptic
finding — are present in the actual diff exactly as corrected, not just
described in prose, and each has dedicated tests that would catch a
regression. The one deliberate deviation from tasks.md is sound and verified
against the real launcher/harness code, not just the executor's stated
rationale. All 7 escalated decisions are recorded and, where a standalone
follow-up was the answer (decision 7), independently confirmed to exist in
the ticket tracker. Full test suite and `openspec validate --strict` both
pass on a fresh re-run.

### Non-blocking notes

1. `proposal.md:32` ("Document the new focus mode, keys, and
   `/concertino-address-failure` in `docs/dashboard.md`") is a stale
   leftover from before the round-1 design-gate revision — it directly
   contradicts `proposal.md`'s own Decision 1 bullet three lines above it
   ("not a new FAILED-local focus mode") and `design.md`'s final Decision 1.
   `docs/dashboard.md` itself was written correctly (no focus mode
   documented), so this is a planning-doc-only inconsistency with no
   functional effect — worth a one-line cleanup if this proposal is ever
   revisited, not worth reopening the cycle for.
2. Same trade-off the evaluator already flagged: `address-failure`'s spawn
   bypasses `launcher.js`'s `specFor()` session-naming decoration (correctly,
   per the deviation's own reasoning), so a spawned
   `/concertino-address-failure` window won't get a friendly name for
   Claude Code's Remote Control feature the way an ordinary launch does. Not
   required by the ticket or either spec delta; worth a follow-up only if
   that visibility turns out to matter in practice.
