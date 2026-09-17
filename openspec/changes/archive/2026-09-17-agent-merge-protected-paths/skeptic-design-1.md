## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/agent-merge-protected-paths/spec.md` in full, and diffed the two
  MODIFIED requirement blocks against the pre-change `openspec/specs/agent-merge/spec.md`.
- Reproduced Decision 1's glob-semantics table on a throwaway repo
  (`/tmp/probe-glob`): `record/**` matched `record/nested/deep/c.md`;
  `scripts/check-*.sh` matched `scripts/check-foo.sh` but **not**
  `scripts/nested/check-bar.sh`; `CHARTER.md` matched the root file but
  **not** `docs/CHARTER.md`. Matches the design's claimed table exactly.
- Reproduced Decision 3's fail-closed claims on the same repo:
  `:(glob)record/[unclosed` → exit 0, empty output (silent no-match, would
  disarm the guard if untreated); `:(glob)` with an empty pattern → exit 0,
  matches every tracked path. Both match the design's claims.
- Verified Decision 2/5's precedent: `core/scripts/check-merge-readiness.sh`
  already has a standalone `main_checkout()` (line 212,
  `git rev-parse --git-common-dir`), explicitly commented as "copied from
  emit-event.sh's main_checkout() rather than sourced — every procedure
  script stays standalone" (line 209). This is a real, existing pattern, not
  an invented one.
- Verified Decision 4's exit-code claim: grepped `core/scripts/check-merge-readiness.sh`
  for every `exit N` — only 1, 3, 4 are used today; exit 5 is free. No
  collision.
- Checked the spec-delta shape against the CON-166 precedent
  (`openspec/changes/archive/2026-09-09-bind-verdicts-to-reviewed-sha`): that
  change added a **sibling capability** (`verdict-sha-binding`) rather than
  touching `agent-merge`'s requirement titles at all, even though it added a
  fourth outcome (exit 4) to the same script. This change's proposal
  explicitly diverges from that precedent by choosing to modify
  `agent-merge`'s two requirements directly — which is defensible (a new
  gating *condition* is a different kind of change than a retry-outcome),
  but it commits the change to actually re-anchoring the counts, which it
  then does not do (see Change Request 1).

### Verdict: REFUTE

### Change Requests

1. **The two MODIFIED requirement titles no longer match their own bodies,
   and this contradicts the proposal's own stated intent.**
   `proposal.md` (lines 75–80) says explicitly: '`agent-merge`: its
   requirement "check-merge-readiness.sh deterministically evaluates the
   three machine-verifiable merge conditions" becomes four, and "The auditor
   merges only when all four conditions hold" is re-anchored so the count
   stays coherent.' The actual delta in
   `specs/agent-merge-protected-paths/spec.md` does not do this:
   - First MODIFIED requirement's title (spec.md:96) still reads "...evaluates
     the three machine-verifiable merge conditions", but the body now
     enumerates four (1)(2)(3)(4) and the "All four conditions pass" scenario
     (line 99) already says "four". Title and body disagree.
   - Second MODIFIED requirement's title (spec.md:131) still reads "...merges
     only when all four conditions hold", but the body (line 132) now lists
     four *deterministic* conditions ("CI, mergeability, this run's own
     gates, and protected paths") plus a fifth, separately-named "judgment
     condition" (AC tracing) — five conditions total, not four. The first
     scenario under it (line 134, "All conditions hold") drops the number
     entirely, which reads as if it was edited around the inconsistency
     rather than resolving it.
   Required fix: retitle both requirements to correctly state the new counts
   (e.g. "...evaluates the four machine-verifiable merge conditions" and
   "...merges only when all deterministic conditions hold and the
   acceptance-criteria trace succeeds", or equivalent wording that is
   internally consistent with every scenario under it). This is not cosmetic
   — a requirement title is the anchor OpenSpec's archive tooling and future
   readers match against, and proposal.md promised exactly this re-anchoring
   as a condition of choosing to modify `agent-merge` in place rather than
   following the CON-166 sibling-capability precedent.

### Non-blocking notes

- Design and tasks are otherwise unusually well probed: the glob-semantics
  table, the malformed-glob fail-closed behavior, and the main-checkout
  precedent were all independently reproduced here and match exactly what
  `design.md` claims — none of the "measurement traps" flagged in my brief
  (case-quoting bugs, zero-hit-grep-as-evidence, pipeline exit-status
  masking) turned up a discrepancy.
- Decision 5 (reusing condition 3's fetched base) is sound; both conditions
  compare against the same `merge-base(origin/<base>, HEAD)`, so there is no
  path for the two to disagree within one invocation.
- `tasks.md` 1.4/3.3/3.4 name the specific mutation arms (delete each
  validation arm; remove the condition-4 block; invert the match test; force
  exit 0 on match; remove the empty-list guard) and require a transcript
  naming which assertion caught which mutation — this is concrete enough to
  actually catch a vacuous guard, not just "add tests" hand-waving.
- Once Change Request 1 is fixed, this design is sound enough to implement.
