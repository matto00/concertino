## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

Fresh read of `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
`specs/delivery-squash-guard/spec.md`, both prior skeptic reports, and the actual
script/callers at the actual base.

- **Base unchanged.** `git log --oneline -2` → `2101a78 CON-162 ...`,
  `fc88cd0 CON-163 ...`, exactly what the design claims.
- **Script structure matches the design's cited facts.** `sed -n '280,295p'
  core/scripts/squash-branch.sh` shows the reset (`284–287`) and commit
  (`289–292`) blocks with their two `exit 1`s, then `READY squash commit created
  on ...` / `exit 0`. The guard block ends above the reset, so the single
  insertion point in task 1.2 is real and reachable. `ALLOW_EMPTY_DECLARATION` is
  normalized at lines 76–78, so the 1.1 normalization site exists as described;
  no `DRY_RUN` occurrence exists yet.
- **Round-2 CR1 is fixed.** `design.md:29` now reads "…identity between dry and
  wet invocations **for every validation outcome** — that is, for every guard
  verdict. Not for every path: see §Context and D6…". It no longer contradicts
  `design.md:24`.
- **No unqualified "every path" / "both exit 0" claim survives anywhere.**
  `grep -rnE "every path|both exit 0|same code|identical|same exit"` across
  `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `specs/` returns only:
  design.md:24 (the explicit correction), :29 (now qualified), :54 ("every
  refusal path" — true by structure, all refusals are above the insertion point),
  :56/:70/:79/:80 (correct local statements), spec.md:12 (carries the "for every
  validation outcome" qualifier plus the explicit scoping sentence and Scenario
  3), proposal.md:8 (qualified), tasks 1.4/2.3, and ticket.md:17/33 (the ticket's
  own unedited wording, addressed below).
- **AC3 is handled honestly, not papered over.** Ticket AC3 as literally worded
  ("identical … on both the passing and every refusing path") is falsified by the
  empty-prospective-staged-set input. `proposal.md:8` names this in plain terms —
  "the one place this change knowingly falls short of the ticket's AC3 as
  literally worded" — states why no implementation can close it, and points at
  D6. D6 in turn argues the case on its merits (the dry run's answer about the
  guard is truthful; the divergence is pre-existing and visible today with
  `DRY_RUN` unset; both candidate fixes are wet-path behaviour changes, one of
  which would be a *new refusal* that AC8 forbids), assigns it to CON-170, and
  `tasks.md` 4.3a forbids both named fixes by name during implementation. The
  spec delta scopes the requirement to the guard's verdict and states the
  divergence as its own scenario rather than hiding it. The final gate is
  therefore not asked to certify an unachievable criterion.
- **I checked D6's premise against the file, not the prose.** With `UNEXPECTED`
  empty, neither refusal condition fires and control reaches line 284; the wet
  commit with nothing staged fails and exits 1 from 289–292. Reachable exactly as
  D6 states.
- **Round-2 non-blocking `READY`-prefix note taken up as tasks.md 4.3b**, worded
  correctly: grep callers, and *report* rather than silently change the marker.
  I ran the equivalent grep myself — the only non-test, non-archive caller is
  `core/roles/orchestrator.md:990`, which invokes the script and keys off a
  non-zero exit in prose; there is no mechanical `^READY` match anywhere. So 4.3b
  will confirm rather than find a defect, which is the expected outcome.
- **Mutation-proof targeting intact.** 2.1–2.3 (passing fixture; HEAD /
  `write-tree` / `status --porcelain` / commit-count unchanged), 2.5 (own fresh
  fixture, `DRY_RUN=true` must commit), 2.6 (2.4 is vacuous as existence
  evidence), 3.1/3.1a (mutation anchored on `READY dry run:` + `exit 0`, with an
  assertion the sed actually changed the file). AC6/AC7 satisfied and failable.
- **Guard judgment structurally protected.** 1.3 forbids any second `DRY_RUN`
  conditional and any touch of a refusal path; no task alters allowlist,
  declaration grammar, or refusal conditions. AC8 holds.
- **Render-target discipline intact.** 1.5 and 4.3 keep
  `scripts/concertino/squash-branch.sh` out of the diff; §Risks records that this
  run's own delivery is guarded by the stale rendered copy and is not evidence
  about `core/`.
- **Gate-chain classification** matches how `check-gate-chain-change.sh` is
  described, with the correct instruction to investigate rather than work around
  a firing check.

### Verdict: CONFIRM

The one round-2 blocker is fixed and the fix is at the right width. I looked
specifically for the failure mode round 2 caught — a second section of the same
document still carrying the refuted claim — and found none. The plan is
implementable as written: one insertion point, one conditional, one marker, three
test scenarios plus a failability proof, and explicit prohibitions on the two
tempting scope expansions.

### Non-blocking notes

- `proposal.md:22` (Modified Capabilities) summarises the change as "producing
  the same exit code and diagnostics while mutating nothing" without the
  qualifier that bullet 8 spells out fourteen lines above. It is a summary line,
  not a re-assertion of the refuted "every path" phrasing, and the qualified
  statement governs — but adding "for every validation outcome" there would make
  the document self-consistent at every read depth.
- `tasks.md` 1.4 instructs the usage/header comment block to say the dry run
  "returns the same exit code" unqualified. That wording would ship into the
  script's own interface documentation, which is the one place a future reader is
  most likely to trust literally. Suggest the block say "returns the same exit
  code for every guard verdict" instead. Cheap to get right at implementation
  time; worth a glance at the final gate.
- Task ordering: `4.3b` is listed before `4.3a`. Cosmetic only.
