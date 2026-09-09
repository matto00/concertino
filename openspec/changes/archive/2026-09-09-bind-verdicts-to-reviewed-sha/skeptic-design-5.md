## Skeptic Report — design gate (round 5, skeptic-design-5.md)

Cold read of `design.md`, `tasks.md`, `proposal.md`, `specs/verdict-sha-binding/spec.md`,
`design-gate-budget-extension.md`, `skeptic-design-4.md`, plus a repo-wide grep for every
surviving occurrence of "exclud/exclusion" in the change dir. Scope as briefed: verify
round 4's two CRs, then check only for a contradiction newly introduced by those edits.

### What I verified (with evidence)

**CR1 — archive-prefix exclusion is single-sited. CLOSED.**
- `design.md:32` (step 2): "`PATHS = union(...)` … **No exclusion is applied here.**"
- `design.md:33` (step 3): the sole `':(exclude)<prefix>/*'` term.
- `design.md:35`: names the single site explicitly and records why the two-site draft
  made the mutation unsatisfiable.
- `design.md:49` (Decision 1c): reworded — "Because the exclusion is single-sited at
  step 3 (Decision 1), `PATHS` is empty only when the branch touched literally nothing
  relative to its base". This is the reword round 4's non-blocking note asked for.
- `design.md:119` (Decision 7): mutation now reads "removing step 3's single-sited
  `':(exclude)<prefix>/*'` term".
- `tasks.md` 2.5 ("NO exclusion applied at this step"), 2.6 (empty-`PATHS` guard),
  4.7 ("drop step 3's single-sited exclude term").
- Grep confirms no other exclusion site survives anywhere in the change dir.

Concrete trace of the headline mutation against the healthy squash-shaped case:
branch touched source `w` plus archive files; `MB_R→reviewed` and `MB_H→head` both list
`w` and the archive paths, so `PATHS = {w, <prefix>/...}` (non-empty, guard does not
fire). With the term: `git diff --name-only R H -- w ':(exclude)<prefix>/*'` compares
only `w`, which is identical → empty → PASS. Without the term: the archive paths, which
the archive commit rewrote between `R` and `H`, re-enter → non-empty → refusal. The
mutation goes RED. Satisfiable, as required.

**CR2 — fixture retrofit named for real. CLOSED.** `tasks.md` 5.1 and `design.md:77`
(Decision 3a) both now state: the shared `new_repo()` helper adds no `origin` remote and
the `gh` mock serves neither `headRefOid` nor `baseRefName`; the helper must gain a bare
`origin` with the base branch present and fetchable, real commits so reviewed SHAs
resolve, a `head_sha` on each verdict, and a `gh` stub serving `headRefOid` (= fixture
local HEAD, on the condition-2 field set) plus `baseRefName`. That is the exact
measured retrofit round 4 asked for, in both sites.

**(b) New-contradiction pass on the latest edits.**
- *Decision 1c's guard.* Removing step 2's exclusion strictly shrinks the set of runs in
  which `PATHS` is empty (it can now only be empty when the branch touched nothing at
  all). Decision 1c states exactly that, and no longer claims the old trigger. No
  contradiction. The self-test it demands is still satisfiable: a branch that touched
  nothing relative to base, with the base advanced between review and head, yields empty
  `PATHS` while `git diff R H -- ':(exclude)<prefix>/*'` is non-empty — so removing the
  guard turns that fixture red.
- *Base-reconcile case.* Decision 1b's staleness argument turns on `MB_H` regressing and
  re-admitting base-derived paths into `PATHS`; the exclusion siting does not touch that
  reasoning, and the base-derived paths in question are source, not archive. Unaffected.
- *Advanced-base / must-PASS mutations.* All four in Decision 7 remain distinct and each
  bites a different mechanism (step-3 term, `PATHS` restriction, empty-`PATHS` guard,
  step-0 fetch). No overlap that would make one mask another.

### Verdict: CONFIRM

Round 4's two change requests are genuinely closed across every site they name, the
headline mutation is now demonstrably satisfiable, and the removal of step 2's exclusion
introduces no statement the design now gets wrong. The design is sound enough to
implement.

### Non-blocking notes

- `specs/verdict-sha-binding/spec.md` scenario "The branch contributed no paths outside
  the archive prefix" is still *behaviourally* true under the single-sited design (such a
  run yields non-empty `PATHS` and step 3's exclusion empties the comparison → passes,
  no whole-path fallback), but it no longer describes Decision 1c's guard, whose trigger
  is now "the branch touched nothing at all". Consider adding a sibling scenario for the
  literal-empty-contribution case so the spec and the guard line up one-to-one.
- `tasks.md` numbering gap at 4.6 from round 4 is fixed; round 4's CR text cites task
  "4.8", which is now 4.7. Cosmetic citation drift only.
- `proposal.md`'s stray `exit-3,.` typo flagged in rounds 3 and 4 is now gone; nothing
  further owed.
