## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and both spec deltas
  (`specs/drilldown-ticket-context/spec.md`, `specs/evidence-telemetry/spec.md`) in full.
- Cross-checked every factual claim about existing code against the actual files:
  - `lib/ui/screens/drilldown.js` — confirmed `headerLines`, the final
    `out.map((l) => f.truncate(l, cols)).join('\n')` pass, the `pane()` degrade
    helper, and that no `title`/`description` field exists on the `Run` model
    the header/panels already render from.
  - `lib/ui/reducer.js` — confirmed `emptyRun()` carries no title/description
    field and `run.start` events (per `applyEvent`) never carry ticket text —
    matches design.md's "Context" claim.
  - `lib/ui/cache.js` / `lib/ui/linear.js` — confirmed the cache's `tickets[]`
    entries carry `identifier`/`title`/`description` directly (lines 191–194 of
    `linear.js`), so Decision 4's "no parsing needed" claim is accurate.
  - `lib/ui/watch.js` — confirmed the exact `queuedTitles` seam (gated read →
    `opts.<field>` → `router.render`) the design proposes to mirror, and (line
    203 of `test/watch.test.js`) confirmed `require.cache` substitution is
    already an established mocking technique in this suite, so task 4.3's "a
    spy/fake is sufficient" claim for testing the new gated read is grounded,
    not aspirational.
  - `lib/ui/layout.js#box()` — confirmed content rows already run through
    `f.truncate` (line 88, which itself calls `stripUnsafeControls` per
    `format.js`), so Decision 6's "control-byte safety for free" claim holds.
  - `core/scripts/persist-evidence.sh` — confirmed the deterministic
    destination path (`<main checkout>/.concertino/runs/<TICKET_ID>/evidence/<basename>`)
    exactly matches Decision 1's assumed path shape.
  - `core/roles/orchestrator.md` Phase 1 — confirmed step 2 writes `ticket.md`,
    step 6's persist-evidence loop currently covers only
    `proposal.md`/`design.md`/`tasks.md`/spec deltas, and does not yet include
    `ticket.md` — the proposal's "one-line addition" claim is accurate.
  - `lib/ui/screens/ticketview.js` — confirmed the `wrap()` function proposed
    for extraction, and (`test/ticketview.test.js:141,146`) confirmed its
    wrap-specific test cases exist there today, matching task 1.3's claim.
  - `openspec/specs/evidence-telemetry/spec.md` (current, un-modified) —
    confirmed the change's MODIFIED delta correctly updates both the
    requirement text and its "three artifacts" scenario to "four artifacts"
    consistently; no stale cross-reference left behind.
- Ran the ticket-title regex from Decision 3 (`/^#\s*(?:\S+:\s*)?(.+)$/`)
  against this run's own `ticket.md` first line — it correctly extracts
  "Drill-down should show the ticket's title and description".
- Read this run's own `ticket.md` in full (the concrete artifact this design
  will parse) to check Decision 3's "everything from the second line onward is
  the description" claim against real content — see Change Request 1 below.

### Verdict: REFUTE

### Change Requests

1. **Decision 3 / task 2.2 conflates "the description" with the entire rest of
   `ticket.md`, which this run's own `ticket.md` shows is not the same thing.**
   `ticket.md` (per `orchestrator.md`'s only instruction, "write the full
   ticket content (title, description, acceptance criteria)" — there is no
   enforced section schema) routinely contains multiple `##` sections beyond
   the description proper: this very file has `## Description`, `## Where the
   text comes from`, `## Acceptance criteria`, `## Notes`, and `## Metadata`
   (with `- Priority: High` / `- URL: ...` bullets). `ticket-text.js`'s
   proposed algorithm — "treat everything from the second line onward as the
   description, verbatim" — will feed *all of that* into the TICKET panel
   indiscriminately. Combined with the 5-line cap (Decision 7), this means the
   panel's scarce budget can easily be consumed by a redundant `Description`
   heading label, blank lines, or — for a shorter description — bleed straight
   into `Acceptance criteria`/`Notes`/`Metadata` boilerplate (`Priority: High`,
   a raw URL) instead of the actual descriptive prose the AC asks the panel to
   show ("the description in a readable block"). This isn't a hypothetical
   edge case — it's the literal content of the artifact this change will ship
   against. Required: either (a) parse just the `## Description` section
   specifically, stopping at the next heading boundary, or (b) explicitly
   accept full-body inclusion as a documented trade-off in the Risks section
   with a rationale for why boilerplate mixing into a 5-line-capped panel is
   acceptable. Neither is currently done — the Risks/Trade-offs section covers
   heading-parse failure, the fixed cap, and cache staleness, but says nothing
   about this scoping problem.

2. **tasks.md task 2.3's last test-case description contradicts design.md
   Decision 3's own stated algorithm.** Task 2.3 lists: "...title parsing for
   a well-formed `# CON-1: Some Title` first line and for a first line that
   doesn't match the `#`-heading shape at all; a malformed/unreadable
   `ticket.md` degrades to the cache fallback rather than throwing." Decision
   3 is explicit that a first line not matching the `#`-heading shape still
   uses the persisted file's own content ("falling back to the whole heading
   text if the line doesn't match that shape at all — never throwing") — it
   does **not** fall back to the cache. But the task's final clause bundles
   "malformed" together with "unreadable" as both triggering the cache
   fallback, immediately after the sentence that just described the
   badly-shaped-title case. As written, an implementer could reasonably build
   either behavior (title-shape mismatch → cache fallback, or title-shape
   mismatch → raw-first-line-as-title) and cite this same task line as
   justification, and the corresponding test would then encode whichever
   reading was chosen rather than catch a regression against the other.
   Required: reword task 2.3 so "malformed" (readable file, weird first line —
   use the file anyway) and "unreadable" (read throws/file missing — cache
   fallback) are unambiguously two different scenarios, matching Decision 3.

### Non-blocking notes

- Decision 8 places the TICKET panel between the phase pipeline and
  TIMELINE/GATES/EVIDENCE, drawn "through the existing `pane()` helper (same
  border/degrade behavior as the other three panels)" — but neither design.md
  nor task 3.2 says whether the panel's `box()` call passes a `title` (e.g.
  `'TICKET'`), unlike TIMELINE/GATES/EVIDENCE, which all have box titles.
  Worth a one-line clarification for consistency with the sibling panels, but
  an implementer would likely default sensibly to matching convention.
- Neither `ticket-text.js`'s contract nor its test list (task 2.3) says what
  `resolve()` returns for a `ticket.md` that exists but is empty/whitespace-only
  (e.g. an interrupted write) — `{ title: '', description: '' }` would sail
  past the `null` check and render an empty title row / empty panel instead of
  the mandated `ticket text unavailable` honesty fallback. Low likelihood in
  practice, but worth one explicit test case given this ticket's own theme is
  honest degradation.
