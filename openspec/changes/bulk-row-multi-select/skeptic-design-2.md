## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Read the revised `proposal.md`, `design.md`, `tasks.md`, and all three
  spec deltas (`specs/fleet-bulk-select/spec.md`,
  `specs/fleet-failed-remediation/spec.md`,
  `specs/fleet-queue-force-start/spec.md`) in full, plus `workflow-state.md`.
- Re-read round 1's report (`skeptic-design-1.md`) to get the exact three
  change requests and two non-blocking notes verbatim, then checked each
  against the current artifacts and the live source, not against the prior
  report's prose.
- Re-read the actual source this change touches, fresh: `lib/ui/app-state.js`
  (`createAppState()` around line 216, `currentState(S)` at line 311-338),
  `lib/ui/screens/fleet/render.js` (`mergeRenderOpts`, lines 349-390),
  `lib/ui/controllers/fleet.js` (`scrollToShow`'s `winOpts`, lines 27-58),
  `lib/ui/watch.js` (`heightOpts` at lines 661-680, `onKey` at lines
  1166-1217, confirming `router.handleKey(key, currentState())` sits at
  line 1214 exactly as design.md/tasks.md now cite), and
  `lib/ui/screens/fleet/sections.js`'s `buildHeadTail` gate-precedence chain
  (lines 206-370: `clearQueueConfirm` → `forceStartConfirm` →
  `markDoneConfirm` → `quitConfirm`, with `addressFailureNotice` pushed
  unconditionally before that chain, exactly the pattern Decision 4 claims
  `bulkResult` will mirror).
- Confirmed `focus-queue`/`focus-quickstart`/`exit-queue-focus` are real,
  existing action cases in `controllers/fleet.js` (grep, lines 78/130/183),
  matching tasks 7.1/7.2's clearing sites.

**Change request 1 (currentState()/render.js opts-threading missing from
tasks.md) — genuinely fixed.** Task 1.2 now explicitly adds `multiSelect`,
`bulkConfirm`, `bulkResult` to `currentState(S)`, citing the exact
`markDoneConfirm`/`addressFailureNotice` line it sits alongside — this is
the real line (332) in the real function, and the task correctly explains
*why* (only `currentState()`, never raw `S`, reaches `handleKey`/`render`).
Task 1.3 separately adds the same three fields to `mergeRenderOpts`, citing
the real existing `markDoneConfirm`/`forceStartConfirm`/`clearQueueConfirm`/
`addressFailureNotice` fields it sits beside, and correctly uses the real
path `lib/ui/screens/fleet/render.js` (the round-1 path-typo note is also
fixed throughout proposal.md/design.md/tasks.md — I found no remaining
`lib/ui/render.js` references).

**Change request 2 (scrollToShow winOpts / watch.js heightOpts missing
bulkConfirm/bulkResult) — genuinely fixed.** Task 1.4 adds `bulkConfirm`/
`bulkResult` (correctly *not* `multiSelect`, which doesn't lengthen
`buildHeadTail`'s tail) to both `scrollToShow`'s `winOpts` (real line range
27-58, confirmed) and `watch.js`'s separate `heightOpts` (real line range
661-680, confirmed) — the same two sites round 1 named, with the same
citation of the `fleet-metrics-grid final-fix 2` / CON-98 comments actually
present in the code today. Task 9.4 adds a regression test asserting all
three sites' height budget accounts for `bulkConfirm`/`bulkResult`, which
is the right shape of test to actually pin this (an assertion against
`mergeRenderOpts`, `winOpts`, and `heightOpts` independently, rather than
one that could pass by only exercising one call site).

**Change request 3 (no concrete mechanism for clearing S.bulkResult without
swallowing the triggering key) — genuinely fixed.** Design.md Decision 4 and
task 5.6 now name the exact mechanism: clear `S.bulkResult` in `watch.js`'s
`onKey`, immediately before its `router.handleKey(key, currentState())`
call — I confirmed that call is at line 1214 in the live file, exactly as
cited — and explicitly rule out the wrong alternative (a fourth
confirm-style intercept in `fleet/keys.js`'s `handleKey`, which would
swallow the key). This is implementable literally as written and produces
the correct behavior (the key that dismisses a stale `bulkResult` still
performs its ordinary action).

**One residual observation, not rising to a blocking change request:**
`onKey` (lines 1166-1214) has three early-return branches *before* line
1214 — the SGR mouse-click handler (1182-1189), the open
`globalEscalationReply` reply-box owner (1196-1201), and the reserved `g`
banner-reply key when `liveEscalations.length` (1208-1211). None of these
reach the `router.handleKey` call line where task 5.6 places the
`S.bulkResult` clear, so a mouse click on a row, or pressing `g` to open the
global escalation reply box, while a `bulkResult` banner is visible would
leave it stale (rendered) until the next key that actually reaches line
1214. This is a minor visual-staleness edge case, not a crash and not a
violation of any acceptance criterion (space/a/d/f/j/k — the keys an
operator would actually use while reviewing a bulk result — all reach line
1214 normally), so I am not blocking on it. Worth a one-line addition to
task 5.6 or a non-blocking follow-up ("also clear `S.bulkResult` in the
mouse-click and reserved-key early-return branches, or accept the
staleness") so the executor makes the call deliberately rather than by
accident, but this is a note, not a required revision.

**Non-blocking notes from round 1 also resolved:** the `lib/ui/render.js` →
`lib/ui/screens/fleet/render.js` path fix is applied everywhere I checked;
design.md's Context section now correctly explains `DESIGN_QUESTIONS`
stays `null` for an ordinary `feature` ticket (escalation resolved via
`escalation.raised`/`escalation.answered` telemetry instead), consistent
with `workflow-state.md`'s current `DESIGN_QUESTIONS: null` — no
inconsistency remains; and task 5.7 now makes the shared-helper-vs-duplicate
question an explicit, deferred-but-tracked decision point rather than
silent ambiguity.

### Verdict: CONFIRM

All three round-1 change requests are substantively addressed with correct,
verified file/line grounding against the current source (not merely
acknowledged in prose), and the spec deltas
(`fleet-bulk-select`/`fleet-failed-remediation`/`fleet-queue-force-start`)
are internally consistent with design.md's decisions and with each other.

### Non-blocking notes

- Consider clearing `S.bulkResult` in `onKey`'s mouse-click and
  reserved-`g`-key early-return branches too (or explicitly accept the
  staleness), per the residual observation above.
