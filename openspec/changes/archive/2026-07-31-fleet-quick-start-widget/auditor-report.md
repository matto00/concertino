## Auditor Report

### Condition 1–3 (check-merge-readiness.sh)

```
scripts/concertino/check-merge-readiness.sh "$WORKTREE_PATH" "feature/fleet-quick-start-widget/CON-40" "CON-40"
```
→ `FAIL not mergeable: DIRTY` (exit 1)

Independently confirmed via `gh pr view 40 --json mergeable,mergeStateStatus`:
`{"mergeable":"CONFLICTING","mergeStateStatus":"DIRTY","state":"OPEN"}`.

This is a real, named condition-2 failure, not an environmental one — `gh`
answered immediately and authoritatively (not `UNKNOWN`/transient, not a
`could not query ... via gh` shape). Reproduced the conflict directly: a
local dry-run merge of `origin/main` into this branch (`git merge --no-commit
--no-ff origin/main`, then aborted) fails with `CONFLICT (content): Merge
conflict in test/watch.test.js`. The branch's merge-base with `origin/main`
is `4c2bea4` (CON-39, "Fleet view: lazygit-style [1]/[2]/[3] section jump,
richer QUEUED section"), which has since been merged to `main` and diverges
from this branch's own edits to `test/watch.test.js` — the delivery-phase
gate log even recorded `gate.warning gate=phase:delivery behind=1 base=main`
at push time, consistent with this.

Condition 1 (CI) and condition 3 (this run's own gates) are not implicated
by the script's single `FAIL` line — the script only fails closed
per-condition and printed exactly one reason. Independently verified condition
3 directly from `.concertino/runs/CON-40/events.jsonl`:
- `{"kind":"verdict","role":"evaluator","verdict":"PASS","ref":".../evidence/.../evaluation-1.md"}`
- `{"kind":"verdict","role":"skeptic","verdict":"CONFIRM","ref":".../evidence/.../skeptic-final-1.md"}`
  both are the latest verdicts of their role, and both ref files (read in
  full) substantiate the verdicts with fresh evidence (re-run `npm test`,
  line-by-line diff trace against design.md/spec.md).

### Condition 4 (acceptance criteria, traced cold)

Ticket CON-40 has no bullet-listed ACs; its three "design questions worth
settling explicitly" were formalized as `spec.md`'s ADDED Requirements
during the design phase (after 5 skeptic-design REFUTE rounds, human-accepted
per the event log). Traced each requirement to the actual diff
(`git diff main...HEAD -- lib/ui/queue.js lib/ui/screens/fleet.js lib/ui/watch.js`),
read in full myself:

1. **QUICK START hidden by default, toggled by `Q`** — `watch.js`: `let
   quickStartVisible = false;`; `toggle-quickstart` case sets it `true` +
   `quickStartFocus = 0` + focus `'quickstart'` on open, and `false` + focus
   `'runs'` on close. `fleet.js` `buildSections` only pushes the `QUICK
   START` entry `if (o.quickStartVisible)`.
2. **Priority list flattened across epics, excluding running/queued** —
   `watch.js`'s `quickStartEligible()` reuses `launchpadScreen.sortByPriority`/
   `isSelectable` and filters out tickets already in `queueState.pending`/
   `inFlight`; no epic scoping applied anywhere in this path.
3. **Empty/cold hint, two distinct texts** — `buildSections`'s `forceRender`/
   `emptyHint` branch: `o.quickStartCold ? 'no tickets cached yet — press N
   to fetch' : 'nothing left to quick-start'`. `quickStartCold` is computed
   in `watch.js`'s `draw()` (`quickStartVisible ? cache.isCold(cache.read(root)) : false`)
   and threaded through `router.render`'s opts — this is the specific gap
   round-5 design skeptic flagged and left for the executor; verified here
   as genuinely wired end to end, not stubbed.
4. **QUICK START rows never perturb run-index space** — section carries
   `unselectable: true`, `kind: 'quickstart'`; `renderFleet`'s per-row
   dispatch branches on `s.kind === 'quickstart'` (calling `renderQuickStartRow`
   on ticket objects) vs. the ordinary `renderRun(s.group[k], ..., rowIndex
   === selected)` path for real run rows — the QUICK START branch never
   touches `rowIndex`/`selected` at all.
5. **Own focus cursor via digit-jump / `Q`** — `sectionJumpTargets` now
   takes `quickStartVisible` as a third param and forwards it into
   `buildSections`' opts so the section is correctly counted/filtered
   (`s.group.length > 0 || s.forceRender`) for digit numbering;
   `quickStartFocus` is a separate cursor from `queueFocus`/`selected`, moved
   by `j`/`k` only while `focus === 'quickstart'`, clamped to
   `quickStartEligible().length`.
6. **`a` reuses `queue.createQueue`/`queue.enqueueOne`, no new queuing
   mechanism** — `watch.js`'s `quickstart-add` case: no active queue ->
   `queue.createQueue([ticket], 1, launchCommand)`; active queue ->
   `queue.enqueueOne(queueState, ticket) || queueState`. `queue.js`'s new
   `enqueueOne` no-ops (returns the same queue object) if the ticket is
   already `pending` or `inFlight` — matches the "no duplicate add" scenario.
   No second, parallel queue data structure introduced anywhere in the diff.

All six requirements trace to real code I read directly in the diff (not
merely asserted by the evaluator/skeptic reports, though both independently
corroborate the same trace with a fresh `npm test` run). No AC failed to
trace. Condition 4 holds.

### Verdict: ESCALATE

### Reason

Condition 2 (mergeable) fails: the PR is `CONFLICTING` /
`mergeStateStatus: DIRTY` against `main` — a real conflict in
`test/watch.test.js` introduced by CON-39 (`4c2bea4`, merged to `main` after
this branch diverged from it), not a transient/unauthenticated state. The
branch must be rebased/merged against current `main` and the conflict in
`test/watch.test.js` resolved before this can merge. Conditions 1, 3, and 4
all hold — this is purely a merge-conflict blocker, not a quality or scope
finding. No merge was performed; the PR is left open and the worktree
untouched.
