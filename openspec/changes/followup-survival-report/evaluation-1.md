## Evaluation Report — Cycle 1 (evaluation-1.md)

### Scope note

CON-192's ticket was amended by the owner after the design gate CONFIRMED, adding a
second deliverable (a "verification machinery that reports success while measuring
nothing" analysis). That added scope is deliberately not built, is unreviewed, and is
the subject of an open escalation to the owner. Per orchestrator instruction, this is
not treated as an executor defect or FAIL reason. This evaluation covers only the
delivered survival-report scope against ticket.md (pre-amendment text), proposal.md,
design.md, spec.md, and tasks.md (37/37 checked).

### Phase 1: Spec Review — PASS

- All stated acceptance criteria addressed: a runnable report giving follow-up
  survival overall and segmented by originating role (`lib/cli/report.js`
  `renderSegments`), survival over time by ISO week (`bucketByWeek`).
- The three "known acceptance-criterion defects" from ticket.md are not silently
  reinterpreted — they are implemented exactly as the ticket demands: the
  `origin_role` axis is implemented but explicitly labelled `SINGLE-VALUED` when
  observed rows warrant it (verified live: it correctly stops being single-valued
  once a real non-`orchestrator` row, CON-213/`skeptic`, exists — confirmed by
  running the report against live Linear data, see Phase 2); the empty-provenance
  case renders a well-formed explicit-empty result, never a fabricated 0%; the
  Linear client is extended with `createdAt`/`completedAt` and `stateTypes`
  reaches `completed` (task 3.1/4.4).
- Tasks.md: all 37 items checked, and each verified checkbox is empirically true
  (see Phase 2 for reproduction of the load-bearing ones).
- No scope creep: the diff touches exactly the files listed in
  `files-modified.md`, which itself matches the actual diff file list.
- No regressions: `OPEN_STATE_TYPES` and the launch-pad's default fetch behavior
  are unchanged (`test/linear.test.js` new assertion, and grep-confirmed in
  `lib/ui/linear.js`); the Linear client's changes are additive-only.
- API/schema: `lib/ui/linear.js`'s `QUERY` and `normaliseTicket` gain
  `createdAt`/`completedAt` additively, consistent with proposal.md's stated
  impact; no `schema.change` event was warranted or emitted (correct — this
  change consumes CON-190's instrumentation and adds none of its own).
- Planning artifacts reflect the final implemented behavior: design.md's
  decisions (two tiers never summed, dedupe by ticket id, small-n suppression,
  singleValued annotation, migration caveat, escalation-boundary-only-as-context)
  are all present and working in the rendered output (verified live).
- Standing CONSTRAINTS (C1-C4) all honored in the diff:
  - C1 (positive control for text-matching needles): `test/cli-report.test.js`
    4.3a asserts the formatting-tolerant needle matches the real backticked
    rendering AND the strict form does not — a genuine positive control, not
    just a negative one.
  - C2 (never `fetchOneTicket`/`ISSUE_QUERY` for description/state): grep-backed
    test (4.4) plus code review confirms `report.js` never references
    `fetchOneTicket` and uses `fetchTickets` with explicit `stateTypes`.
  - C3 (small-n suppression, not just zero-n, per segment/period): verified in
    `computeSurvival`, applied uniformly through `segmentBy`/`bucketByWeek`, and
    observed live (e.g. `marker=convention: 0/1 (small-n (n=1))`,
    `2026-W38: filed=1 survival=small-n (n=1)`).
  - C4 (recovered tier excludes provenance overlap, discloses count): verified
    both by test (4.4a/4.4b/4.4c, mutation-provable — see Phase 2) and live run,
    where the one ticket with both a `ticket.filed` event and matching
    description text (CON-213) was counted once, in provenance, with "1
    recovered row(s) excluded" disclosed.

### Phase 2: Code Review — PASS

Gates run fresh, in `WORKTREE_PATH` (no `CLEAN_WORKTREE` flag was set):

- `npm test`: exit 0. Captured `# tests 2362`, `# pass 2362`, `# fail 0`,
  `# cancelled 0` — matches the executor's claim and exceeds the stated baseline
  of 2322 (2362 > 2322, +40 new assertions/tests as expected from two new test
  files plus additive assertions to `test/linear.test.js`).
- `openspec validate "followup-survival-report" --type change` (via the real
  `openspec` binary, not `bin/concertino openspec`, which is a different,
  unrelated dispatch surface unique to this repo) exits 0: "Change
  'followup-survival-report' is valid".
- `CONTRIBUTING.md` review: zero-runtime-dependency constraint holds
  (`package.json` `dependencies` empty); no lint/format tooling exists in this
  repo — `npm test` is the stated whole gate, already run above; no rendered
  script under `scripts/concertino/`/`core/` was touched; file organization
  conventions followed (`lib/followup-survival.js` pure module,
  `lib/cli/report.js` I/O+render, mirrored `test/` files). `DESIGN.md` does not
  apply — no `frontend/**` changes (this is a Node CLI repo, not helio).
- Falsifiability controls independently re-verified by mutation, not merely
  read:
  - Mutated `computeSurvival`'s suppression logic (`suppressed = total < min`
    forced to `false`) in `lib/followup-survival.js` — the small-n suppression
    tests (1.6a) correctly turned red (2 failures), proving those are real,
    failable controls.
  - Mutated `buildRecoveredRows` in `lib/cli/report.js` to remove the dedupe
    check (`if (provenanceIds.has(...))`) — tests 4.4a, 4.4b, 4.4c all
    correctly turned red (3 failures), proving the dedupe control described in
    the ticket as "the most important thing to check" is genuinely
    mutation-provable, not a presence check.
  - Restored both files after mutation testing (no residual changes).
- DRY/readable/modular: computation cleanly separated from I/O per design.md
  Decision 2 (`lib/followup-survival.js` has no `fs`/`https`/`lib/ui` requires,
  verified by both grep and a dedicated test). Naming is clear; no magic
  numbers un-named (`DEFAULT_MIN_N`, `CON188_BOUNDARY_MS`,
  `CONVENTION_NEEDLE`/`PROSE_NEEDLE` all named constants).
- Type safety: plain JS, no `any`-equivalent issues; input shapes documented in
  a header comment in `lib/followup-survival.js`.
- Error handling: missing `LINEAR_API_KEY` and missing team key both fail
  loudly with `process.exit(1)` and an explicit message (verified by test and
  live); malformed `triage` JSON is caught and routed to `unknown` rather than
  throwing (`parseOverlap`).
- No dead code / no leftover TODO/FIXME found in the diff.
- No over-engineering: a single `report` subcommand namespace per design.md
  Decision 1, not a bespoke verb.
- Task 6.4a (CON-213 provenance emission) independently verified by reading
  the raw event log directly (not the executor's report): the
  `ticket.filed` event for CON-213 is present with `origin_role=skeptic`,
  `origin_kind=followup`, `suggested_by=agent`, and a real `triage` payload
  (`{"ac_relevant":"no","effort":"small","overlap":"none","recommendation":"standalone"}`).
  Also independently confirmed via the Linear MCP that CON-213 is a real,
  filed ticket whose description matches the provenance-correction narrative
  in design.md Decision 11.
- Task 6.5 independently verified by actually running the report against the
  live corpus (not trusting the executor's claim): captured the event-log
  line count before (25) and after (25, unchanged) and confirmed
  `git status --short` in the main checkout showed no new files attributable
  to this run. The live run itself demonstrates the reported behavior working
  correctly against real data: the provenance tier now has exactly 1 row
  (CON-213), the recovered tier correctly excludes CON-213 and discloses "1
  recovered row(s) excluded", and small-n suppression is applied throughout.
  The `origin_role` axis remains single-valued in this live run (n=1,
  `skeptic`) — correctly so, since `singleValued` is computed from observed
  rows per Decision 6, not assumed. One minor imprecision noted below.

### Phase 3: UI Review — N/A

CLI-only change with no `frontend/**`, `ApiRoutes.scala`, `schemas/**`, or
`openspec/specs/**` (helio) touches — this is the Concertino repo itself, and
the change is a CLI subcommand with no UI surface. No dev servers started, per
instruction.

### Overall: PASS

### Non-blocking Suggestions

- `lib/cli/report.js:170-175`: the `SINGLE-VALUED` explanation text for the
  provenance-tier `origin_role` axis states "the emitting path... hardcodes
  origin_role=orchestrator" unconditionally whenever `singleValued` is true —
  even in the case observed live today, where the axis is single-valued only
  because there is exactly one provenance row (`skeptic`), not because the
  template forced `orchestrator`. The explanation is accurate for the general
  case CON-213 will fix, but is slightly imprecise for an n=1 single-role
  sample that happens not to be `orchestrator`. Not a defect — the annotation
  is still true (the row could not resolve five roles regardless) and the
  ticket explicitly asks for this label — but a future iteration could
  distinguish "single-valued because n=1" from "single-valued because the
  emitter forces one value."
- `lib/cli/report.js:274`: `fmtSurvivalLine('', survival.computeSurvival(rows, minN), '')` renders marker lines
  with a leading colon-space artifact (`marker=prose: : 8/14 (57%)`, observed
  in the live run's real output) — cosmetic only, does not affect any
  reported number.
