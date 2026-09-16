## Context

See proposal.md — Why. Three facts about the current emitter shape constrain
every decision below, all verified against the live tree rather than assumed:

1. **The verdict path has no validation at all.** `head_sha` gets an extra
   captured copy (to drive the `head_sha_source` stated/inferred decision) but
   is otherwise folded into the line by the generic `*)` passthrough, which
   accepts any key and any value. Measured pre-fix baseline:
   `category=totally-bogus` exits 0, a missing category exits 0, and
   `head_sha=deadbeef` exits 0.
2. **`emit-event.sh`'s header states "ALWAYS exits 0 in normal mode …
   Telemetry must never fail a delivery run."** CON-188 already broke that
   absolute for `resolution_channel` (an illegal value exits 1 before any
   write), so a validated-field exception exists — but on
   `escalation.answered`, never on `verdict`.
3. **CON-171 guarantees an auditor verdict releases the Phase-4 teardown
   lease "on RECOGNITION of the call shape, regardless of whether the event
   write itself succeeds, is truncated, or is skipped by an early-exit /
   validation path below."** That release sits BELOW the `k=v` argument loop,
   where `resolution_channel`'s `exit 1` lives. `resolution_channel` never
   appears on an auditor verdict, so its placement precedent does not
   transfer.

`role=` is asserted by the caller. The emitter has no access to the identity
of the invoking process, which rules out the first fix option CON-194 lists.

## Goals / Non-Goals

**Goals:**
- Refuse a `verdict` whose `category` is missing or outside the four-value
  enum, and whose stated `head_sha` is not a full 40-character hex SHA.
- Make a duplicate verdict record for one review mechanically detectable.
- Keep the existing ~2,300-event corpus readable, unmigrated, and still
  sufficient for the gate checks that read it.
- Prove by mutation that each new refusal can actually fail.

**Non-Goals:**
- Verifying that a verdict was authored by the role it names. Not possible
  here (Decision 4) and explicitly not claimed.
- Backfilling, rewriting, or reordering any historical event.
- Running `concertino sync`, or changing helio's rendered copies. Forbidden
  for this batch by owner instruction.
- Surfacing `category` in the dashboard UI. No ticket asks for it; the field
  is for corpus analysis. Additive and available to a later ticket.
- Requiring `gate` on evaluator or auditor verdicts (Decision 5).
- Tightening `read_raised_field()` (Decision 7).

## Decisions

### Decision 1: Refuse with a non-zero exit, and do not soften to a warning

A missing or illegal `category`, and a malformed stated `head_sha`, each
refuse the whole invocation: non-zero exit, message naming the legal form, no
event appended.

*Why over the alternative.* The alternative is to warn and record anyway
(possibly with a `category:"unspecified"` placeholder). Rejected on the
tickets' own terms: CON-189's acceptance criterion says "rejects a `verdict`
with a missing or unknown category", and CON-187 states that "a verdict
recorded against a malformed SHA is worse than one recorded against none,
because it looks verified." A placeholder category would also be a value
outside the enum, defeating the point of a closed enum. CON-188's
`resolution_channel` is the in-repo precedent for refusing a validated field
before any write.

*The cost, stated plainly.* A refused verdict means NO verdict is recorded,
which is the CON-185 "PR opened with zero gate verdicts" hazard. This is
accepted deliberately, because the alternative is a chain that reads as
verified and is not — and because a refusal is loud (non-zero exit, message)
where a bad record is silent. Decision 2 is what keeps that cost from landing
on unrelated runs.

### Decision 2: The blast radius is bounded to this repo, and the cross-repo render is atomic

Refusing a category-less verdict would break any caller that does not yet
pass `category=`. It does not, because:

- **helio is unaffected until its next sync.** helio has its own tracked
  rendered `scripts/concertino/emit-event.sh`. A change to concertino's
  `core/` reaches helio only when someone runs `concertino sync` there — the
  one deliberate post-batch sync the owner reserved. At that sync the emitter
  and the role definitions render together from the same `core/`, so helio's
  roles learn to pass `category=` in the same operation that starts requiring
  it. There is no window in which helio has the strict emitter and permissive
  roles.
- **This repo's own roles are updated in this change.** `evaluator.md`,
  `skeptic.md`, and `auditor.md` gain the enum and the `category=` argument
  alongside the validation.

*The one real window, and its mitigation.* Within THIS delivery run, the
sub-agents are spawned from `.claude/agents/concertino-*.md` rendered at the
LAST sync, so they do not yet know to pass `category=` — while the worktree's
emitter, once the executor commits, will require it. That would silently cost
this very run its own gate chain. Mitigation: the orchestrator carries the
`category=` (and full-40-char `head_sha`, and `gate=` for the skeptic)
instruction explicitly in every evaluator/skeptic spawn prompt for this run.
This is recorded as a standing constraint in `tasks.md` and
`workflow-state.md`, not left to memory.

### Decision 3: Every verdict-field refusal is placed AFTER the auditor lease release

The `category`/`gate`/`head_sha` refusals must not sit in the `k=v` argument
loop, where `resolution_channel`'s refusal sits. The loop runs above the
CON-171 lease release, so refusing there would strand an auditor's Phase-4
teardown lease behind a `--force-teardown`, violating the guarantee quoted in
Context. Therefore: the `k=v` loop only CAPTURES these values (as it already
captures `head_sha`, `context`, and `sub_questions`); the refusals happen in
the verdict block, below the lease release, so a refused auditor verdict still
releases.

*Why not release the lease earlier instead.* Moving the release above the loop
would put it before `TICKET` is validated and canonicalised, which is exactly
the ordering CON-171's own design note rejected.

### Decision 4: Authorship is enforced by instruction plus detectability, never by an identity check

CON-194's first option — "make `verdict` events writable only by the reviewing
role and reject an orchestrator-authored one" — is not implementable in the
emitter, and the ticket's own evidence shows why: on HEL-1109 the orchestrator
emitted `role=skeptic`. It impersonated the reviewing role, so a
role-based rejection would have passed it. `role=` is caller-asserted and the
emitter cannot see caller identity.

So enforcement is the two things that do work: the widened role-definition
prohibition (Decision 6), and required `gate` on skeptic verdicts (Decision 5)
making a same-review duplicate detectable. The spec states this limitation
explicitly rather than implying a guarantee the code cannot provide.

### Decision 5: Require `gate` on skeptic verdicts only

`gate` becomes required, with enum `design|final`, on `role=skeptic` verdicts.
Evaluator and auditor verdicts are unchanged.

*Why.* This is CON-194's own second option ("have the skeptic always populate
`gate` so a same-gate duplicate is detectable"). The skeptic is the role with
two genuinely distinct gates and the role where the observed duplicate
occurred. Scoping it there keeps the change focused and keeps the number of
newly-breaking required fields to the minimum that satisfies the criterion.

*Why not all roles.* Requiring `gate` everywhere would add two more refusal
surfaces for no criterion, and the evaluator has only one gate, so its `gate`
value would carry no information.

*Note on a historical inference this does NOT support.* 23 helio and 3
concertino skeptic verdicts already carry a populated `gate`, nearly all from
before SHAs were recorded. Populated `gate` therefore CANNOT be used to
identify historical orchestrator-authored entries retroactively, and nothing
here should be read as enabling that.

### Decision 6: Widen the orchestrator prohibition rather than write a new one

`core/roles/orchestrator.md:900` already says "Never emit a `verdict
role=skeptic` event yourself", but scoped to representing a CON-152 override.
It is widened to the general rule (never, for any role/gate/outcome) in place,
keeping the override-specific reasoning as the motivating example.

### Decision 7: This change is NOT `read_raised_field()`'s fourth field

CON-188's evaluator flagged that `read_raised_field()` dispatches on a field
name and falls through to `sub_questions` for anything unrecognised, and
suggested tightening it when a fourth field is added. This change adds no
fourth field: `category`, `gate`, and `head_sha` are fields of the `verdict`
event, while `read_raised_field()` reads fields of the last
`escalation.raised` event. The two do not intersect. Tightening it here would
be unrelated scope in a change about verdicts; it is flagged as a spinoff
instead, per CONTRIBUTING's rule that a structural fix not belonging to the
change is filed rather than folded in.

### Decision 8: Both emitter copies are updated by direct byte-identical copy

`test/scripts/rendered-scripts-drift.test.sh` runs in the `npm test` chain and
byte-compares `core/scripts/**` against `scripts/concertino/**`, so editing
`core/` alone turns CI red. `concertino sync` is forbidden for this batch
(it would also rewrite `AGENTS.md`, `.claude/agents/`, `.codex/`,
`.opencode/`). Since `core/scripts/*.sh` are copied verbatim with no
templating, the render is reproduced exactly by copying the one changed file
and preserving its executable bit. The drift gate is then the mechanical proof
the two agree.

### Decision 9: Historical tolerance is verified, not assumed

No consumer reads `category`, so tolerance is true by construction today —
but "true by construction" is the kind of claim that rots. `lib/ui/reducer.js`
folds only `role`/`verdict`/`ref` from a verdict event,
`lib/ui/screens/fleet/metrics.js` counts by `role` and `verdict`, and
`check-merge-readiness.sh` selects the latest verdict per role and reads
`verdict`/`head_sha`. A test asserts an uncategorized historical event still
renders and still satisfies the readiness check, so a later change that starts
requiring `category` on the read path fails loudly.

## Risks / Trade-offs

- **A refused verdict records nothing, reproducing the CON-185 hazard** →
  Accepted per Decision 1 on the tickets' explicit terms; bounded by Decision
  2; loud rather than silent (non-zero exit plus message).
- **This run could lose its own gate chain** (strict emitter, pre-change
  spawn definitions) → Decision 2's mitigation: explicit `category=`/`gate=`/
  40-char-`head_sha` instructions in every review-agent spawn prompt, recorded
  as a standing constraint rather than remembered.
- **A refused auditor verdict could strand the Phase-4 lease** → Decision 3
  places every refusal below the release; asserted by a test per capability.
- **An existing test fixture breaks** (`emit-event.test.sh:692` passes
  `head_sha=deadbeef`) → Corrected as part of the change. The fixture is
  wrong, not the validation; it is not weakened to accommodate it.
- **A validation that cannot fail is worse than none** (CON-197 precedent) →
  Every new refusal is proven RED against the pre-change script before being
  shown green, with the pre-fix baseline already recorded in ticket.md.
- **Three new required fields is three new ways to break an emission** →
  Held to the minimum the criteria demand: `category` on every verdict
  (CON-189 AC), `gate` on skeptic verdicts only (Decision 5), `head_sha`
  format only when stated (CON-187, and forced by the auditor passing none).

## Migration Plan

None. No event log is rewritten, reordered, or backfilled; every new field is
additive and required only of new emissions. Rollback is reverting the commit:
the strict emitter disappears, and events already written remain valid under
the permissive shape because the new fields are additive.

Deployment ordering across repos is Decision 2: this repo is self-consistent
at commit time, and helio changes only at the deliberate post-batch
`concertino sync`, which renders emitter and roles together.

## Gate-Chain Implications Checklist

Not applicable — and stated rather than omitted, so a reader need not infer
it. This repo has no `.husky/` and no pre-commit hook framework
(`CONTRIBUTING.md`: "`npm test` is the whole verification gate"), and this
change touches no commit-gate chain. `core/scripts/emit-event.sh` is invoked
by agent roles and sibling procedure scripts, never by a commit hook.

## Open Questions

None. The two questions that could have changed the specs or the task
breakdown — whether a refusal may exit non-zero given the emitter's exit-0
contract, and what becomes of historical uncategorized verdicts — are
resolved in Decisions 1/2 and 9 rather than deferred.
