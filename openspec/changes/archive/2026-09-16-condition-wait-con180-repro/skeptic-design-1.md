## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

1. **Marker placement (Decision 1) — sound.** Read `core/scripts/emit-event.sh` lines 624-680:
   the poll body's `result="$(node -e ...)"` is a synchronous command substitution — the parent
   bash blocks until the whole node subprocess (readFileSync, JSON.parse, the malformed()
   branch) exits before bash resumes at `case "$result" in`. The MALFORMED case only fires when
   the node subprocess actually parsed a `complete:true` payload — i.e. it has already fully
   consumed A's content, by construction, before `reason=` is assigned. The proposed marker line
   sits immediately after `reason="${result#MALFORMED:}"` and before the injected
   `CON180_RACE_WINDOW_SEC` sleep, matching the quoted diff in design.md's Decision 1
   (`test/scripts/escalation-loop.test.sh:233-237`, the `bash_old`/`bash_new` python
   substitution). There is no path by which the marker fires before A is read: the node call
   that produces "MALFORMED:..." cannot return without having parsed the file.

2. **Sibling-wait assessment (Decision 3) — verified line-by-line, all citations accurate.**
   - `escalation-loop.test.sh:149` (`sleep 2`): confirmed it backs the negative assertion "an
     incomplete multi-part answer.json does not resolve the wait" (lines 125-153) — a longer wait
     only strengthens this, matches design's claim.
   - `escalation-loop.test.sh:320` (`sleep 1`, fix-side sibling): confirmed the guarded assertion
     at lines 328-338 accepts *either* A or B (`isA`/`isB` branches, each checked against its own
     hash) — genuinely race-tolerant by construction, not fragile the same way.
   - `escalation-loop.test.sh:767` (`sleep 2.5`): read the full CON-156 comment (lines 740-761) —
     it explicitly documents a prior "adaptive" version of this exact wait that short-circuited
     on one 0.2s sample and could pass on a transient reading; the fixed >=2 full-poll-interval
     wait is a deliberate anti-regression guard, not an oversight. Design's characterization is
     accurate.
   - The `sleep 3`s at 281/323/404/522/587/624 sit after the interleaving has already been
     decided (post-race settle/kill sequencing), and the `sleep 0.1`s are all inside bounded
     poll-for-condition loops (grepped every `sleep` occurrence in the file: 66, 96, 136, 149,
     266, 278, 281, 313, 320, 323, 366, 398, 404, 435, 456, 510, 522, 582, 587, 619, 624, 657,
     661, 686, 690, 711, 725, 751(comment), 765, 767, 790 — all accounted for by design's
     categories).

3. **Mutation tasks (4.1-4.3) — real, not theatre.** Task 4.1 defeats the wait itself (B wins
   the mutant's first read) and requires the guarded stale-content assertion to go RED. Task 4.2
   defeats the *evidence mechanism* (marker never written) and requires the *new* bounded-wait
   check to go RED, distinct from 4.1. Task 4.3 confirms the uninstrumented mutant is
   byte-identical in shape (grep for the marker line absent). These three mutations cover the
   three ways a condition-wait "fix" typically goes wrong (waits for nothing, never resolves,
   changes unrelated behavior) — this is a real falsifiability check, not a renamed pass-through.

4. **`openspec validate condition-wait-con180-repro --type change`** — passes cleanly (per the
   corrected invocation syntax noted in the task).

### Verdict: REFUTE

### Change Requests

1. **Design.md never weighs `--skip-specs`, and the stated premise that "no change in this
   repo uses skip_specs" is false — real, directly-analogous precedent exists and isn't
   addressed.** `openspec/changes/archive/2026-08-01-fix-cleanup-sh-comment-drift/workflow-state.md`
   (lines 28-32) documents exactly this situation: a narrow, single-file, no-shipped-behavior
   fix that used `openspec archive --skip-specs` at Delivery rather than inventing a new
   capability, citing `core/roles/orchestrator.md`'s own documented path for "infra/doc-only
   changes" and a further precedent (`2026-07-30-codex-worker-dispatch-caution`). A `grep` for
   `--skip-specs` across `openspec/changes/archive/` returns 16 matches — this is an established,
   repeatedly-used pattern in this repo, not a hypothetical.

   CON-200 is a strong candidate for the same treatment: it touches exactly one test file, ships
   no runtime/production behavior change (proposal.md's own Impact section says so), and the
   "requirement" it proposes to enshrine (`test-interleaving-condition-wait`) currently has
   exactly one consumer — this same test file, in this same change. Nothing in proposal.md or
   design.md explains why this crosses the line from "implementation detail of one test's wait
   logic" (skip-specs territory, per precedent) into "durable, cross-cutting capability other
   future tickets must be checked against" (new-capability territory). The closest the docs come
   is proposal.md's throwaway parenthetical "no existing capability describes this test's wait
   discipline" — which argues only that no *existing* capability fits, not that a *new* one is
   warranted over skipping specs entirely.

   **Required revision:** design.md must add a Decision addressing the `--skip-specs` alternative
   explicitly, either:
   (a) adopt it — drop the new capability, update proposal.md's Capabilities section to `(none)`,
       and note the archive step will use `--skip-specs`, consistent with the
       `fix-cleanup-sh-comment-drift` precedent; or
   (b) justify keeping the new capability with a concrete reason it should bind future test
       authors elsewhere in the suite (e.g. an explicit intent that any new interleaving-sensitive
       test elsewhere must be checked against this requirement, and how that check would ever
       be exercised) rather than the current unexamined default.

   Either is defensible; leaving the choice unexamined against a premise ("no change uses
   skip_specs") that a two-minute grep disproves is not.

### Non-blocking notes

- The `bimodal 5/6 vs 0/4` failure-rate figures in design.md/tasks.md are stated as measured in
  this planning run; I did not independently re-run the pinned/spin-loop repro (that belongs to
  execution-phase task 1.1/1.2, not design soundness), but the underlying mechanism claim (fixed
  wait racing an equal-length poll period, unsafe for any constant <= the period) is internally
  consistent with the `emit-event.sh` poll code and is not something I can refute on inspection
  alone.
- Task 5.1's `git diff --stat` scope check is a fine mechanical gate; nothing in the current
  plan risks scope creep beyond the one file plus openspec artifacts.
