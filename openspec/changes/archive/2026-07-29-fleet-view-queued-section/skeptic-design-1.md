## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
  `specs/fleet-queue-visibility/spec.md` in full.
- Read the actual source the design describes, rather than trusting its
  paraphrase: `lib/ui/screens/fleet.js` (full file), `lib/ui/watch.js` (full
  file), `lib/ui/queue.js` (full file), `lib/ui/cache.js` (full file),
  `lib/ui/format.js` (full file), and the relevant sections of
  `test/fleet.test.js` (the queueState tests and the height-budget tests,
  lines ~86-260).
- Confirmed the row-index invariant the ticket describes is real: `fleet.js`
  maintains one shared `index` across `sections.forEach` (lines 222-271),
  incremented once per rendered-or-hidden row, and `watch.js` resolves
  `selected` straight against `runs[selected]` (`handleKey`'s `\r`/`l`
  branches, lines 341-356; `draw()`'s bounds check, line 386).
- Confirmed `sections` today is exactly the four entries the ticket quotes
  (`fleet.js:186-191`), each with `cap`/`statusKey`/optional `pinned`, and
  that `sectionHeight`/`height`/the trim loop (lines 201-220) and the render
  loop (224-271) are the only two places that logic lives — matching
  design.md's description of "one shared loop."
- Confirmed `queue.js`'s `createQueue`/`tick` shape: `queueState.pending` is
  an array of ticket-id strings with no run object (line 29), and
  `queueState.maxConcurrent` is already carried on the object (line 34) that
  `watch.js` already threads through to `renderFleet` via `queueState`
  (fleet.js render(), line 369) — so design.md's claim that no new plumbing
  is needed for `maxConcurrent` (Decision 4, body) is grounded in real code.
- Confirmed `cache.read(root)` is a cheap, already-used, sync
  read-file+JSON.parse with a documented "cold cache is not an error"
  contract (`cache.js:39-65`), and that `openLaunchPad()` already calls it
  identically (`watch.js:296`) — Decision 3's performance/degradation claims
  check out.
- Ran `npx openspec validate --changes fleet-view-queued-section --strict`
  from the worktree root: `✓ change/fleet-view-queued-section`, 1 passed / 0
  failed. The new capability spec's requirement/scenario format matches this
  project's convention (compared against
  `openspec/changes/archive/2026-07-29-idle-time-tmux-activity/specs/...`).
- Re-read `test/fleet.test.js`'s `'the total-height cap holds with all four
  sections populated'` test (lines 227-247) and its own header comment,
  which documents a *previous real bug*: a section trimmed to zero used to
  still cost a title/blank/more-line floor, and with all four sections
  populated that floor exceeded a short terminal and silently stopped
  capping, scrolling the header and NEEDS YOU off the top. This is exactly
  the class of invariant this change's height-budget plumbing risks
  reintroducing (see Change Request 2 below) — the codebase's own test
  suite proves this project treats that class of bug as a correctness
  issue, not a nitpick.

### Verdict: REFUTE

### Change Requests

1. **`design.md` Decision 4 contradicts itself, and contradicts
   `proposal.md`'s own Impact section, on where `maxConcurrent` comes from.**
   Decision 4's *title* (design.md:114) reads "`maxConcurrent` is read from
   config, not from `queueState`" — but its *body* (design.md:116-122) says
   the exact opposite: "the title formatter reads `queueState.maxConcurrent`
   directly rather than `cfg.maxConcurrent`." `tasks.md` task 2.1
   (tasks.md:17-18) agrees with the body (`using queueState.maxConcurrent`),
   but `proposal.md`'s Impact section (proposal.md:62-64) says the opposite
   again: "`lib/ui/watch.js`: pass `maxConcurrent` (from `cfg.maxConcurrent`)
   ... into the fleet screen's render opts alongside the existing
   `queueState`" — implying new plumbing is needed, which the design's own
   body explicitly says is unnecessary because `queueState.maxConcurrent` is
   already available. A competent implementer reading these three documents
   together cannot tell whether new `cfg.maxConcurrent` plumbing through
   `watch.js` is required at all. Fix: pick one (the design's body and
   tasks.md agree it should be `queueState.maxConcurrent`, requiring no new
   plumbing — this also matches `queue.js`'s own contract, where a queue can
   be created with a concurrency different from `cfg.maxConcurrent` via the
   launch plan's concurrency picker, so `queueState.maxConcurrent` is the
   only value that's actually correct to display), correct Decision 4's
   title to match its body, and correct `proposal.md`'s Impact section to
   drop the false claim that `cfg.maxConcurrent` needs to be threaded in.

2. **The height-budget math (`sectionHeight`) hardcodes 2 lines per row,
   which is false for QUEUED's 1-line rows, and the design/tasks incorrectly
   claim no change is needed there.** `fleet.js`'s `sectionHeight(s, i)`
   (lines 201-205) computes `2 + 2 * shown[i] + (overflow ? 1 : 0)` — the
   `2 * shown[i]` term assumes every section's rows cost exactly 2 output
   lines each, which holds today only because `renderRun` (lines 79-100)
   always returns exactly 2 lines per run. Design.md's own Decision 2
   mandates that `renderQueuedRow` "produces exactly one line" — half of
   what `sectionHeight` assumes. `tasks.md` task 2.2 explicitly claims: "Wire
   the section through the existing `sectionHeight`/`height`/trim loop ... —
   no changes needed to those functions beyond what 1.2 already made." That
   claim is false: `sectionHeight`, `height()`, and the trim loop (lines
   206-220) all need to know that QUEUED's per-row cost is 1 line, not 2, or
   the computed `height()` will systematically overestimate the actual
   rendered output for any frame containing a non-empty QUEUED section,
   causing the trim loop to over-trim QUEUED rows relative to what the
   terminal could actually hold (and, more importantly, breaking the
   "`sectionHeight()` and the render loop's actual output must stay in
   lockstep" invariant the file's own comment at line 231 calls out as
   load-bearing for the collapsed-section case). This is precisely the class
   of bug `test/fleet.test.js`'s `'the total-height cap holds with all four
   sections populated'` test (and its header comment describing the prior
   real incident) exists to catch — the design needs to specify how a
   section's line-height is generalized (e.g. a `linesPerRow` field on the
   section entry, defaulting to `2`, read by both `sectionHeight` and the
   render loop's row-generation code, set to `1` for QUEUED), and `tasks.md`
   needs a task for it plus a regression test analogous to the existing
   multi-section height test but with a populated QUEUED section, asserting
   the total line count never exceeds `rows` and NEEDS YOU/the header never
   scroll off.

3. **`tasks.md` task 2.1 omits wiring the QUEUED section's `statusKey` to the
   `queued` colour entry task 1.1 adds.** `task 1.1` adds `queued: dim` to
   `f.STATUS_COLOUR` specifically so the QUEUED title renders with the same
   understated treatment as RUNNING/DONE (per proposal.md's own stated
   intent). But `task 2.1`'s description of the QUEUED section entry (title,
   cap, `unselectable`, position) never mentions setting `statusKey:
   'queued'`. Every existing section entry sets `statusKey` explicitly
   (`fleet.js:186-190`), and `colourTitle = f.STATUS_COLOUR[s.statusKey] ||
   ((x) => x)` (line 250) silently falls back to no colour at all if
   `statusKey` is omitted or wrong — making task 1.1's addition dead code.
   Add `statusKey: 'queued'` explicitly to task 2.1's description.

4. **Tasks.md under-specifies how the shared per-row render loop
   distinguishes a QUEUED row from a run row.** The loop at `fleet.js:242-246`
   unconditionally calls `renderRun(s.group[k], ...)` for every section's
   items. For QUEUED, `s.group` (built from `queueState.pending`, per task
   2.1) is an array of ticket-id strings, not `Run` objects, and needs a
   different render call (`renderQueuedRow`) that also needs the item's
   1-based queue position and a title looked up from `queuedTitles` (built
   in task 3.1). Neither `design.md` nor `tasks.md` states the mechanism by
   which the shared loop picks `renderRun` vs `renderQueuedRow` per section,
   or how `queuedTitles` (an `opts`-level value) reaches that per-row call.
   This is plausibly inferable by a competent implementer (branch on
   `s.unselectable`, thread `queuedTitles` into the closure alongside
   `queueState`), but given how granular the rest of `tasks.md` is (down to
   exact field names and constants), this gap should be closed explicitly
   before implementation — at minimum, name the branching condition and
   confirm it is the same `unselectable` flag or a distinct one.

### Non-blocking notes

- Decision 1's rejection of Option 2 (id-based selection) is genuinely
  specific to this codebase's current state (cites `watch.js`'s single
  `let selected`, the one bounds-check site in `draw()`, and why
  `launchPad.selected`'s existing `Set<identifier>` precedent doesn't
  transfer to this screen's two-row-kinds problem) rather than generic
  caution — this satisfies the ticket's explicit ask that Option 2 be
  weighed seriously. The `unselectable` mechanism, confined to the one
  `sections.forEach` loop that already owns the index invariant, is
  genuinely structural rather than "remember not to increment index here."
  No objection to Decision 1 itself.
- Task 4.4's row-index regression test description is well-specified and
  directly answers the ticket's explicit test requirement.
