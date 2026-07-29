## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- Read `proposal.md`, `design.md`, `tasks.md`, `ticket.md`, and both spec
  deltas (`specs/drilldown-ticket-context/spec.md`,
  `specs/evidence-telemetry/spec.md`) in full, fresh (not from round 1's
  narrative).
- Read round 1's report (`skeptic-design-1.md`) as a claim, then independently
  re-derived whether each of its two required revisions is genuinely fixed.

**Required revision 1 (Decision 3 conflated "description" with the whole
remainder of `ticket.md`):**
- `design.md` Decision 3 is rewritten: description is now scoped to the first
  `## Description` heading (case-insensitive), up to the next `##`-level
  heading or EOF, with an explicit fallback (prose between title and first
  `##` heading, or whole remainder if no `##` headings at all) for a
  `ticket.md` predating this change.
- `tasks.md` task 2.2 states the identical algorithm, including "Never include
  sections other than the description-scoped one (e.g. `## Acceptance
  Criteria`, `## Metadata`) in the returned description."
- `tasks.md` task 5.1 now requires the orchestrator role to write a
  `## Description` heading immediately following the title — I checked this
  against the actual current text of `core/roles/orchestrator.md` (step 2,
  lines 131–135): it currently says only "Write the full ticket content
  (title, description, acceptance criteria)" with no section-heading
  requirement, so this task's premise ("this convention doesn't exist yet, so
  add it") is accurate, not fabricated.
- **I hand-simulated the new algorithm against this run's own `ticket.md`**
  (the exact artifact that grounded the original change request, containing
  `## Description`, `## Where the text comes from`, `## Acceptance criteria`,
  `## Notes`, `## Metadata` with `Priority`/`URL` bullets): scoping to the
  first `## Description` heading up to the next `##` correctly yields only
  the two-paragraph description ("The drill-down identifies a run by ticket
  id..."/"Reading the timeline..."), excluding "Where the text comes from,"
  the acceptance criteria, notes, and metadata entirely. This is a genuine
  fix verified against ground truth, not a cosmetic rewording.
- The Risks section gained a new entry for the pre-change-file fallback
  (accepted, self-healing) — this was the other option round 1 offered
  ("(a) parse just `## Description`, or (b) document the trade-off"); the
  design took (a) as primary and additionally documents the narrower (b)-style
  trade-off for the legacy-file edge case. Both halves of the required fix
  are present.

**Required revision 2 (task 2.3 contradicted Decision 3 on malformed vs.
unreadable):**
- `tasks.md` task 2.3 now reads, unambiguously split into two clauses: "title
  parsing for a first line that doesn't match the `#`-heading shape at all
  (uses the raw first line as title — does NOT fall back to the cache)" and,
  separately, "an unreadable/missing `ticket.md` file falls back to the
  cache." These are two distinct, parenthetically-disambiguated test cases now
  — no implementer could read this as one behavior for both. It matches
  Decision 3 exactly (badly-shaped title line still uses the file; only a
  missing/unreadable file falls back to the cache).
- Task 2.1 states the same rule for the module contract: "on a
  missing/unreadable file, OR a readable file whose parsed title is blank
  after trimming, falls back to cache... returns `{title, description} | null`
  (null only once both sources are exhausted)."

**Both round-1 non-blocking notes also addressed** (not required, but the
orchestrator said it did this — verified):
- Decision 8 now states the TICKET panel's `pane()` call carries `title:
  'TICKET'`, matching TIMELINE/GATES/EVIDENCE explicitly.
- A new Risks entry covers an empty/whitespace-only persisted `ticket.md`,
  with `resolve()`'s blank-title-after-trim path falling to the cache
  (task 2.1) and an explicit test case (task 2.3's final clause).

- Cross-checked `evidence-telemetry`'s spec delta and `core/roles/
  orchestrator.md`'s current step 6 (lines 157–163): confirmed it currently
  lists only `proposal.md`/`design.md`/`tasks.md`/spec deltas, matching the
  proposal's "one-line addition" framing for adding `ticket.md`, and the
  modified spec requirement already reads "`ticket.md`, `proposal.md`,
  `design.md`, `tasks.md`."

### Verdict: CONFIRM

Both round-1 required revisions are genuinely resolved — not cosmetically
reworded but changed at the algorithm level, and I independently confirmed the
new algorithm produces the intended output against the concrete artifact
(this run's own `ticket.md`) that exposed the original problem. The task 2.3
wording is now unambiguous and matches Decision 3. **Neither of the two
original items needs another round.**

### Non-blocking notes

- `specs/drilldown-ticket-context/spec.md`'s "Ticket text is resolved from the
  persisted snapshot first" requirement says the cache fallback triggers
  "only if that file is absent or unreadable" — this doesn't literally cover
  the blank/whitespace-only-file case that `design.md`'s new Risk entry and
  `tasks.md` task 2.1/2.3 treat as equivalent to unreadable. An implementer
  working from the spec delta alone (rather than design.md/tasks.md) could
  miss that edge case. Low-severity gap given design.md and tasks.md are both
  unambiguous and the corresponding test case exists — worth a one-clause
  addition to the spec requirement's wording at execution time, but not
  blocking given the artifact this ticket is actually building from
  (design.md + tasks.md) is already correct.
