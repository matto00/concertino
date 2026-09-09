# CON-166: A commit landing after the evaluator's PASS is never reviewed — no verdict is bound to a SHA

## Description

An evaluator verdict is recorded against a run, not against a commit. A commit that lands after the evaluator's PASS carries that PASS forward without ever having been reviewed, and nothing in the pipeline notices. The whole agent-merge chain rests on "this run's gates passed"; that claim is currently unfalsifiable in the direction that matters. Late fixes made after review are exactly the commits most in need of review.

Live instance: helio HEL-469. Same class as CON-162 (a gate approving one artifact while a different artifact proceeds).

## Corrected incident shape (premise validation, this run)

The ticket's own narrative is materially wrong in one place and understated in another. Re-derived from `.concertino/runs/HEL-469/events.jsonl`, the persisted reports, and helio's git objects:

- evaluator PASS @ `40078e75`
- skeptic-final-1 REFUTE @ `91e66a18` — and this report explicitly states it gave `git diff 40078e75..91e66a18` ("never reviewed by anyone") a first review, not a spot check. So `91e66a18`, the commit the ticket names as reviewed by nobody, WAS reviewed.
- skeptic-final-2 CONFIRM @ `154e6ed3`
- auditor merged headRefOid `c42bada4`

Four distinct SHAs; three post-date the evaluator's PASS. `git diff --stat 154e6ed3 c42bada4` touches ONLY `openspec/**`. HEL-469 therefore shipped correct code — the defect is the absence of the mechanism, not a bad outcome in that instance.

## Hard constraint the ticket's literal instruction violates

Phase 3 squashes the entire branch and then adds a separate archive commit BEFORE `check-merge-readiness.sh` ever runs. At merge-readiness time HEAD therefore never equals any reviewed SHA, on every healthy run, by construction. The ticket's step 2 as written ("compare the branch head against the SHA in the verdicts, refuse when they differ") would refuse 100% of deliveries. The comparison must be over reviewed CONTENT, not commit identity.

## Acceptance criteria

1. `emit-event.sh verdict` records a `head_sha` for evaluator and skeptic verdicts, capturing the SHA the role actually reviewed.
2. `check-merge-readiness.sh` condition 3 refuses when source content has moved since the latest evaluator PASS or the latest skeptic CONFIRM, naming both SHAs and the changed paths.
3. The refusal is a distinct, machine-readable outcome the orchestrator knows how to act on, in the CON-159 PENDING/exit-3 precedent's shape.
4. A mismatch resolves by re-review, not by permanent block or human escalation.
5. Guarded by mutation: record a verdict, add a commit, assert merge-readiness now REFUSES. Every new assertion is proven RED against the pre-fix script.
6. The `scripts/concertino/**` renders of every changed `core/scripts/**` file are updated in this same delivery (CON-173: the drift exemption table is empty by design). Updated by direct `cp`, never `concertino sync`.
7. The CON-171 auditor-lease acquire/release symmetry is preserved.
