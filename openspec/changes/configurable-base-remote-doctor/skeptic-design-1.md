## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
  `specs/main-fast-forward/spec.md` in full.
- Confirmed the described current-state facts against ground truth in
  `bin/concertino`:
  - `checkBaseBranch()` at line 1015 hardcodes `const remote = 'origin';` (as
    the ticket/proposal claim).
  - `withDefaults()` line 333 already normalizes `c.project.baseBranch =
    c.project.baseBranch || 'main';` — the pattern the design proposes to
    mirror for `baseRemote` at the same site.
  - `renderEnv()` line 550 currently only emits `CONCERTINO_BASE_BRANCH`, not
    `CONCERTINO_BASE_REMOTE` — confirms the gap the design closes.
  - `cmdValidate` line 1428 has the exact `ok('baseBranch', p.baseBranch ||
    dim(...))` line the design says to mirror for `baseRemote` at 2.4.
- Confirmed `scripts/concertino/cleanup.sh:55`, `assert-phase.sh:138-139`, and
  `setup-worktree.sh:119-120` already read `CONCERTINO_BASE_REMOTE` with an
  `origin` fallback, exactly as claimed — so the "no changes needed to those
  scripts" claim in proposal.md's Impact section is correct for their
  functional code.
- Confirmed `config/concertino.schema.json`'s `project` object has
  `"additionalProperties": false` (line 19-20) — task 1.1's addition of a
  `baseRemote` schema property is therefore load-bearing, not cosmetic, for
  anyone who runs schema validation against it (even though `bin/concertino`
  itself doesn't currently enforce the schema at runtime — grep for
  `ajv`/`schema.json` usage came back doc-comment-only).
- Confirmed `docs/config-reference.md`'s `project` table/example (lines
  47-56) matches the `baseBranch` pattern task 1.2 says to mirror.
- Read `openspec/specs/main-fast-forward/spec.md` (baseline) and confirmed the
  delta's MODIFIED requirement preserves all three original scenarios
  verbatim and adds two new ones (non-default remote, absent-config), which
  is the correct OpenSpec convention for a MODIFIED requirement.
- Checked `openspec/specs/delivery-stale-base-warning/spec.md` — it already
  refers to the base remote generically (`CONCERTINO_BASE_REMOTE`/`origin`
  default), so no additional spec delta is needed there; consistent with the
  design's claim that `assert-phase.sh` needs no changes.
- Confirmed `test/scripts/doctor-base-branch.test.sh` exists as the
  established, existing automated regression test for exactly this
  behavior (`Git` section / `checkBaseBranch()`), and that `package.json`'s
  `test` script (which is the project's sole configured gate — `gates: [{
  name: "test", when: "always", command: "npm test" }]` in
  `concertino.config.json`) runs it.
- Read `scripts/concertino/cleanup.sh:51-54` and found a comment that
  explicitly documents today's gap ("`concertino sync`'s `renderEnv` only
  ever writes `CONCERTINO_BASE_BRANCH` today ... `CONCERTINO_BASE_REMOTE` is
  not currently rendered") — this comment becomes factually false the moment
  this change ships.

### Verdict: REFUTE

The core mechanism (single `project.baseRemote` field, `withDefaults()` +
`renderEnv()` + `checkBaseBranch()` + `cmdValidate` all reading it the same
way `baseBranch` already is) is sound, well-grounded in the actual code, and
correctly scoped — no placeholders, no internal contradictions between
proposal/design/tasks, and the spec delta correctly preserves existing
scenarios. It does not yet clear the bar to implement as written, for two
specific, fixable reasons:

### Change Requests

1. **No automated regression coverage planned for the new spec scenario.**
   `specs/main-fast-forward/spec.md`'s new scenario "doctor resolves a
   configured non-default base remote" and the ticket's second acceptance
   criterion ("doctor and cleanup.sh --phase4 resolve the base remote through
   the same path") have no task producing CI-enforced evidence that they
   hold. `tasks.md` §3 covers this only with manual steps (3.2, 3.3 — "manually
   verify"), never an addition to `test/scripts/doctor-base-branch.test.sh`,
   which is the established automated home for precisely this behavior (it
   already tests the sibling scenarios: current, behind, ahead, offline) and
   already runs inside `npm test`, this project's only configured gate. Per
   this repo's own verification standard, a manually-verified-once claim is
   materially weaker than an automated test that will keep catching a
   regression on every future change. Add a task instructing the executor to
   extend `doctor-base-branch.test.sh` (or add a new sibling test) with a
   case that: sets `project.baseRemote` to a non-`origin` name matching an
   actually-configured remote, re-runs `concertino sync`, and asserts
   `doctor`'s `Git` check reports against that remote (not `origin`) —
   mirroring the file's existing style (`has`/`hasnt` against captured
   output).

2. **A stale comment this change will introduce is left unaddressed.**
   `scripts/concertino/cleanup.sh:51-52` currently reads: `` `concertino
   sync`'s renderEnv only ever writes CONCERTINO_BASE_BRANCH today ...
   CONCERTINO_BASE_REMOTE is not currently rendered.`` `` This comment is the
   exact gap this ticket closes — once `renderEnv()` emits
   `CONCERTINO_BASE_REMOTE`, the comment becomes factually wrong and will
   mislead the next reader into thinking the variable is still never
   rendered. `proposal.md`'s Impact section states flatly "No changes to
   `scripts/concertino/cleanup.sh`" — that claim needs to be narrowed (no
   *functional* changes) and `tasks.md` needs a task to update or remove this
   now-inaccurate comment as part of this change, since leaving intentionally
   stale documentation in a file this ticket is directly about is the kind of
   thing this exact review is supposed to catch before it ships twice.

### Non-blocking notes

- `proposal.md`'s Impact section lists `config/examples/*.json` as affected
  ("new optional `project.baseRemote` field"), but `tasks.md` has no
  corresponding task, and since the field is optional with a default of
  `'origin'` there's a reasonable argument examples don't need updating (they
  don't need to demonstrate every optional field). Worth a one-line
  reconciliation either way (drop the claim from proposal.md's Impact list,
  or add a trivial task) so the two artifacts agree, but not blocking.
