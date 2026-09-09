## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

Fresh adversarial read of `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
`specs/delivery-squash-guard/spec.md`, plus the actual script at the actual base.

- **Base is as claimed.** `git log --oneline -2` → `2101a78 CON-162 ...`,
  `fc88cd0 CON-163 ...`; working tree clean apart from the untracked change dir.
- **Cited line numbers are real.** `grep -n` on `core/scripts/squash-branch.sh`
  (295 lines): `284` `git_wt reset --soft "$MERGE_BASE"`, `285` its FAIL echo,
  `289` `git_wt commit -q -m "$SUBJECT"`, `290` `FAIL git commit failed after
  guard passed`. The two ranges design.md now names (284–287, 289–292) are
  exactly the two non-zero exits below the mutation point. Read 240–295 in full:
  the guard block (249–280) and the unconditional staged count/list print
  (240–246) are above the reset, so the single insertion point tasks 1.2
  specifies is correct and reachable.
- **CR1 — partially done.** §Context now carries the corrected, narrower claim and
  names both line ranges, and explicitly records that the "identical on every
  path" phrasing is false so a later reader does not re-derive it (design.md:20–24).
  D2's third bullet is likewise rewritten: "Both exit 0" is gone, replaced by the
  correct conditional statement pointing at D6. **But the false claim survives
  verbatim five lines below the correction**, in §Goals (design.md:29). See CR1 below.
  `grep -n -i "every path|both exit 0|identical code"` across all artifacts shows
  design.md:29 is the only remaining instance (design.md:54's "every refusal path"
  is true — every refusal genuinely is above the insertion point).
- **CR2 — done, and the carve-out is not too loose.** I specifically tried to read
  the new spec text as licensing an implementation that skips validations, and it
  does not: the requirement still opens with "SHALL perform every validation it
  performs otherwise", enumerates all seven by name, and closes with "SHALL NOT
  weaken, skip, or soften any refusal: every condition that refuses today SHALL
  still refuse, with the same non-zero status." The carve-out is syntactically
  bounded to "failure of those git operations themselves" and to a wet invocation
  "whose guard passes but whose reset or commit subsequently fails" — it cannot be
  stretched to cover a skipped check, because a skipped check is a guard-verdict
  divergence, which the SHALL still covers. New scenario 3 states the empty-staged-set
  instance concretely rather than abstractly, which further narrows it.
- **CR3 — done, and I judge D6 honest rather than rationalising.** I checked its
  premise against the file, not the prose: with `UNEXPECTED` empty, the `249`
  branch requires `DECLARED_COUNT -eq 0 && -n "$UNEXPECTED"` (false), and the
  `269` refusal requires `-n "$UNEXPECTED"` (false), so control does reach `284`
  — the case is reachable exactly as D6 says. Its three reasons hold on
  inspection: (1) the dry run's answer is truthful about the guard, which is the
  question asked; (2) the divergence is visible today with `DRY_RUN` unset, so
  this change neither introduces nor worsens it; (3) both candidate fixes are
  real wet-path behaviour changes — `--allow-empty` changes commit semantics, and
  an emptiness refusal is a *new refusal*, which AC8 forbids. That is a
  substantive argument, not an excuse: it names a cost, assigns the case an owner
  (CON-170), and accepts an honesty obligation in exchange. `tasks.md` 4.3a
  enforces it concretely by forbidding both named fixes by name.
- **CR4 — done.** `proposal.md:8` carries the same qualification, states plainly
  that this is where the change knowingly falls short of AC3 as literally worded,
  and points at D6. The final gate is therefore not asked to certify an
  unachievable criterion — except for the stale §Goals line (CR1).
- **All three round-1 non-blocking notes taken up.** tasks 2.5 now says "Build this
  its own fresh fixture — do NOT reuse the 2.1 fixture"; 2.6 forbids citing 2.4 as
  evidence dry-run mode exists; 3.1a anchors the mutation on `READY dry run:` plus
  its `exit 0` and requires asserting the mutation actually changed the file,
  naming the exact wrong-reason pass it prevents.
- **Mutation-proof targeting still correct.** 2.1–2.3 build a passing fixture and
  assert HEAD / `write-tree` / `status --porcelain` / commit count unchanged; 3.1
  deletes the early return and asserts HEAD moved. AC6/AC7 satisfied.
- **Guard judgment structurally protected.** Task 1.3 forbids any second `DRY_RUN`
  conditional and any touch of a refusal path; no task alters allowlist,
  declaration grammar, or refusal conditions. AC8 holds.
- **Render-target discipline intact.** 1.5 and 4.3 keep `scripts/concertino/squash-branch.sh`
  out of the diff; design §Risks still records that this run's own delivery is
  guarded by the stale rendered copy and is not evidence about `core/`.

### Verdict: REFUTE

One blocking defect, and it is small and documentation-only: the exact false claim
round 1 refuted still stands, unqualified, in design.md §Goals — five lines after
§Context declares that same claim false. A design document that states as a Goal
something it elsewhere proves unachievable is internally contradictory, and the
harm is concrete: the final gate traces AC3, reads "on every path" in Goals, and
either certifies against a criterion the design knowingly cannot meet or REFUTEs
at the far more expensive gate. This requires no re-planning and no rework of any
other artifact — it is a one-line edit.

### Change Requests

1. **Fix the stale unqualified claim in `design.md:29` (§Goals, second bullet).**
   It currently reads "Preserve exit-code and diagnostic identity between dry and
   wet invocations on every path." That directly contradicts design.md:24 ("The
   claim 'identical on every path' is false") and D6. Restate it at the width the
   rest of the document now uses — identity **for every validation outcome** /
   for every guard verdict — matching the phrasing already adopted in §Context,
   D2, `proposal.md:8`, and the spec delta. Do not weaken any other Goal while
   editing.

### Non-blocking notes

- D3 keeps the `READY` prefix for the dry-run success line. Worth a moment's care
  at implementation: any caller matching `^READY` alone (rather than `READY squash
  commit created`) would treat a dry run as a completed squash. D5 asserts no
  caller changes are needed, and the marker text is unambiguous to a human reader,
  so this is a note, not an objection — but a grep for `READY` matching in the
  orchestrator's Delivery step during task 4.3 would cheaply close it.
- The gate-chain analysis (not pre-commit-referenced → no Gate-Chain Implications
  Checklist) matches how `check-gate-chain-change.sh` is described, and the
  instruction to investigate rather than work around a firing check is the right
  posture. Unchanged from round 1.
