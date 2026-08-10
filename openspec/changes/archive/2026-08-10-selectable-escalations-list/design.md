## Context

METRICS' "recent escalations" block (`metricsColumnLines()`, expanded tier
only) renders `m.recentEscalations` — built by `metricsFor()` as one entry
per `escalation.raised` event across every run's `events` array, newest
first, uncapped in the data but capped at display time to whatever
`rowsForList` leftover vertical space allows. It is flat text: no cursor, no
`↵` binding, nothing to select. EVIDENCE (`lib/ui/screens/drilldown.js`)
already solves the adjacent problem — a potentially-long list inside a
height-constrained box — via `evidenceWindow()` (a thin wrapper over
`layout.selectionWindow`) plus a `focused`/`selectedIndex` pair threaded
through from `watch.js`'s per-poll re-clamp. `QUICK START`'s
`focus === 'quickstart'` block in `lib/ui/screens/fleet/keys.js` /
`lib/ui/controllers/fleet.js` is the direct precedent for a *fleet-view-local*
focus mode with its own cursor, entered via digit-jump and exited via
Escape — METRICS currently opts out of that (`case 'metrics': return null;
// nothing to focus`).

The escalation screen itself (`lib/ui/screens/escalation.js`) renders a
LIVE `run.escalation` (question/options/context, answerable via option keys
or a typed reply). It has no notion of a resolved, historical escalation —
`run.escalation` is set to `null` the moment `escalation.answered`/
`escalation.timeout` lands (`reducer.js`), which is exactly why today's flat
METRICS text is the only place a resolved escalation's data is even visible.

## Goals / Non-Goals

**Goals:**
- Every row METRICS shows in "recent escalations" is selectable.
- Selecting a row and pressing `↵` opens a detail view with the full
  question, full option list, and the eventual decision (or "no answer
  recorded" for a timeout).
- The list is not bounded to whatever fits under the box's own height —
  `j`/`k` scrolls/paginates through the full history (this change's
  resolved design question).
- A still-live escalation opened this way is the *same* answerable screen
  `g`/`↵` already open elsewhere (mode `'escalation'`, unmodified render/
  handleKey path) — never a second rendering of a live, answerable question.
- Documented in `docs/dashboard.md`.

**Non-Goals:**
- No change to how escalations are raised, answered, or timed out
  (`emit-event.sh`, `reducer.js`'s `escalation.raised`/`escalation.answered`/
  `escalation.timeout` handling) — this is read-only surfacing of data
  that's already durably in the event log.
- No change to the *unfocused* glance rendering of METRICS' "recent
  escalations" block — same rows, same truncation, same "no escalations
  yet" fallback, when `focus !== 'metrics'`.
- No new persistence — the paired history is recomputed from `run.events`
  on every draw, exactly like every other `metricsFor()` field.

## Decisions

### Decision 1: pair `escalation.raised` with its resolution inside `metricsFor()`, by event order, not a shared id

Neither `escalation.raised` nor `escalation.answered`/`escalation.timeout`
carries a correlation id — there is nothing to join on but position in a
single run's own `events` array, which is already time-ordered (the reducer
folds events in log order, and each run can only ever have one escalation
open at a time — `applyEvent`'s `escalation.raised` case clobbers
`run.escalation` unconditionally, and no script raises a second one before
the first resolves). So: walk each run's `events` once, and for every
`escalation.raised` open a new history entry; the next
`escalation.answered`/`escalation.timeout` seen for that same run closes the
most recently opened, still-open entry for it. An entry with no matching
resolution yet (the run's current live escalation, if any) is left
`resolved: false`.

```
{
  ticket, role, question, options, subQuestions, raisedAt,
  resolved: bool,
  decision: string | null,   // answer text, or joined sub_answers, or null
  resolvedAt: number | null,
  timedOut: bool,            // true only for an escalation.timeout resolution
}
```

Deliberately excluded: `context` (the raw `escalation.raised` event's
`context`/`context_ref` fields, shown on the LIVE screen between the
question and the options). A historical detail view therefore never shows
the context that was captured when the escalation was originally raised.
This is an intentional scope cut, not an oversight — none of the ticket's
three acceptance criteria require it (they ask for "the full question,
options, and the eventual decision," not the original supporting context),
and it is left as a candidate follow-up rather than expanding this change's
surface.

`sub_answers` (multi-part) is joined into one `decision` string
(`sub_questions[i].question + ': ' + sub_answers[i]`, `'; '`-joined) — the
detail view (Decision 3) needs one place to show "the decision", not a
second wizard step-through UI for history it can no longer be answered
against.

The raw `ev.options`/`ev.sub_questions` fields on an `escalation.raised`
event are shell-emitted strings (a comma-joined `options`, a JSON-string
`sub_questions`), not the render-ready shape the detail view needs —
`reducer.js`'s own live-escalation fold already normalizes exactly this
(`toOptions()`, a defensive `JSON.parse` of `sub_questions` — see
`reducer.js:183-214`). The pairing walk in `metricsFor()` SHALL reuse those
same two normalization helpers (exporting `toOptions()` from `reducer.js`,
or lifting it to a small shared module both files require) rather than
hand-rolling a second, subtly different parser for the same raw fields.

**Alternative considered:** keep `recentEscalations` (raised-only) and do the
raised/resolved pairing lazily inside `metricsColumnLines()` or the new
detail-view code. Rejected — `metricsFor()` already owns every other
event-log-derived computation (`verdictRates`, `gateRates`, `harnessBreakdown`,
...); splitting escalation pairing across two files for one feature adds a
second place that has to know the pairing rule.

### Decision 2: a `focus === 'metrics'` mode, closely mirroring `focus === 'quickstart'`

`lib/ui/screens/fleet/keys.js` gains a new block, positioned alongside the
existing `focus === 'queue'`/`focus === 'quickstart'` blocks:

- `j`/`k` → `{ type: 'move-metrics-focus', delta }`
- `↵` → `{ type: 'open-historical-escalation', index: metricsEscalationFocus }`
  (index arrives unresolved, exactly like `quickstart-add`'s `index` — the
  handler re-derives the live list fresh, per `quickStartEligible()`'s own
  "never trust a value from a previous draw()" precedent)
- Escape → `{ type: 'exit-metrics-focus' }`
- `l`/`\x1b[C`/`n`/`N` suppressed, same as the `quickstart` block

The digit-jump switch in `sectionJumpTargets`'s caller (same file) changes
`case 'metrics': return null;` to
`case 'metrics': return { type: 'focus-metrics', index: 0 };` — METRICS
becomes a genuine jump target instead of the one section digit-jump
silently no-ops on.

`lib/ui/controllers/fleet.js` gains `focus-metrics` (`applyJumpAction`,
mirroring `focus-quickstart`), `move-metrics-focus` (clamped against a
freshly-recomputed history length, mirroring `move-quickstart-focus`), and
`exit-metrics-focus` (mirroring `exit-quickstart-focus`).

`lib/ui/app-state.js`/`watch.js` gain `S.metricsEscalationFocus`, re-clamped
every `draw()` the same way `S.quickStartFocus` already is (recompute the
history length fresh, clamp to `[0, len)`, reset to `0` if `focus ===
'metrics'` and the cursor is out of range).

**Alternative considered:** a brand-new top-level screen mode (like
`docview`/`ticketview`) for the scrollable list, entered from METRICS.
Rejected — EVIDENCE already proves a *windowed, in-box* list (Decision 3)
satisfies "scrollable past what's currently visible" without a whole extra
screen to route through; reusing the fleet view's existing focus-mode
machinery (`quickstart`/`queue`) is the smaller, more consistent change.

### Decision 3: window the history through `layout.selectionWindow`, exactly like EVIDENCE

`metricsColumnLines()` takes two new opts: `focused` (bool) and
`selectedIndex`. Unfocused (today's behavior, unchanged): the leading
`rowsForList` entries, `'… N more'` if truncated — byte-for-byte what
`metricsColumnLines()` already does. Focused: the window follows
`selectedIndex` via `layout.selectionWindow(total, selectedIndex,
rowsForList, selectedIndex)` (same call `evidenceWindow()` makes, with
`rowsForList` standing in for `EVIDENCE_MAX_VISIBLE`), and the selected row
renders `f.bold()` with a `▸ ` marker — matching `evidenceLines()`'s own
`isSelected` convention exactly.

**Alternative considered:** a fixed page size distinct from `rowsForList`
(e.g. always show a full terminal's worth once focused, regardless of the
METRICS box's own height budget). Rejected — the box's height is already
grid-computed per draw (`fleet/grid.js`/`fleet/render.js`); a second, focus-
dependent height calc would fight that layout rather than reuse it, for no
benefit `selectionWindow`'s scrolling doesn't already provide.

### Decision 4: the detail view is `escalation.js`'s existing `renderEscalation`, extended with a `historical` opt — not a new module

`renderEscalation(run, opts)` gains `opts.historical` (the paired-history
entry from Decision 1). When present, it takes precedence over deriving
`esc` from `run.escalation` and skips the live-run existence checks
entirely (a historical entry needs no live `run` at all — `render()`'s
router wrapper passes `run: null` safely in this case, same shape a vanished
run already renders through the `!run` branch, just with `opts.historical`
now checked FIRST). It renders the exact same box (`sectionHeader`,
`textwrap.wrap(currentQuestion, ...)`, options list) using the historical
entry's `question`/`options`. A historical multi-part entry is not
re-entered step by step — Decision 1 already flattened its answers into one
`decision` string — so the box shows exactly
`subQuestions[subQuestions.length - 1]` (**the LAST/most-recently-answered
sub-question — not `subQuestions[0]`**; this is the one unambiguous index
this design specifies, chosen because it's the step the escalation was
actually resolved on) alongside a "N sub-questions, see decision below" note
when `subQuestions.length > 1`. Details:
- no option-key bindings are rendered or bound (mirrors the existing `stale`
  branch's suppression, but with new text: `decision: <answer>` or
  `f.dim('no answer recorded (timed out)')` in place of "nobody is waiting
  on this")
- the footer is `esc back` only — no `t`/reply, no `↵ attach`
- `meta` shows `raised by <role>` and `resolvedAt`-relative time (`answered
  <dur> ago` / `timed out <dur> ago`) instead of `raisedAt`-relative

`handleKey` needs no new branch: its existing `!run` early-return (line
279-282 today) already produces exactly "only Escape handled" once `run` is
`null` for a historical view — the only change `handleKey` needs is none;
this was previously over-described as "gains a matching early branch,"
which it does not need.

**This directly satisfies the ticket's AC 2 requirement "not a second,
divergent code path":** a STILL-LIVE selection (Decision 1's `resolved:
false`) never sets `opts.historical` at all — `open-historical-escalation`'s
handler (`lib/ui/controllers/fleet.js`) checks the resolved entry's
`resolved` flag and, when `false`, dispatches the exact existing
`'open-escalation'` action (`S.mode = 'escalation'`, `S.escalationTicket =
ticket`, the same wizard-resume logic `open-escalation`'s handler already
runs) — byte-for-byte the same handler `g`/`↵` already invoke elsewhere, not
a copy of it. Only a `resolved: true` entry sets `S.mode = 'escalation'` +
`S.escalationHistoryItem = entry` (a new, separate state field — never
reusing `S.escalationTicket` for this).

**Skeptic round 2 correction — `S.escalationHistoryItem` lifecycle.** A field
that is only ever SET and never explicitly CLEARED goes stale the moment the
operator opens a resolved entry, backs out, then opens a still-live one — all
reachable within this feature's own new flow, no pre-existing path needed.
`lib/ui/app-state.js`'s `backToFleet()` already resets every other
escalation-screen-local field (`escalationTicket`, `escalationReply`,
`escalationNotice`, `escalationContextScroll`, `escalationSubIndex`) as a
documented house discipline ("cleared here too means it can never leak into
a later, unrelated screen") — `S.escalationHistoryItem = null` SHALL be
added to that same reset list. Separately, `lib/ui/controllers/escalation.js`'s
`'open-escalation'` handler (the exact handler the STILL-LIVE branch above
reuses) already resets `escalationReply`/`escalationNotice`/
`escalationContextScroll`/`escalationSubIndex` on open — it SHALL also set
`S.escalationHistoryItem = null`, so opening a live escalation always starts
from a clean slate regardless of what was on screen before. Without both
resets, a stale `escalationHistoryItem` would make `render()` pass the OLD
historical entry to `renderEscalation` even after a genuinely live
escalation was just opened (Decision 4's `opts.historical` takes precedence
over `run.escalation` unconditionally), and would permanently disable the
corrected poll-loop check below for that screen (since it treats a non-null
`escalationHistoryItem` as "this is a historical view, no liveness to
check").

**Skeptic round 1 correction:** the poll-loop check this relies on
(`lib/ui/watch.js:749-752`) is actually keyed off `S.mode === 'escalation'`
alone, not off `S.escalationTicket` — it looks the run up by
`S.escalationTicket` (`null` for a historical view, since Decision 5 never
sets it) and, finding no match, calls `backToFleet()` on the very next poll
(~1s cadence). Left as originally written, this bounces every resolved/
timed-out detail view back to the fleet almost immediately. The check must
change alongside this feature:

```js
if (S.mode === 'escalation' && !S.escalationHistoryItem) {
  const run = S.runs.find((r) => r.ticket === S.escalationTicket);
  if (!run || !run.escalation) backToFleet();
}
```

A historical view carries nothing that can change out from under it (it's a
static snapshot of an already-resolved entry), so it is simply exempted from
this "walk back if the live thing disappeared" check rather than given a
second, parallel liveness check of its own — there is no liveness to poll
for.

Same root cause, same fix batch: `lib/ui/banner.js`'s
`suppressedOnOwnScreen(mode, escalationTicket, liveEscalations)` also
compares `escalationTicket === liveEscalations[0].ticket`, which is
likewise always false when `escalationTicket` is `null` — so if some OTHER
run has a live escalation while a historical view is open, the global
escalation banner would incorrectly render on top of it.
**Skeptic round 2 correction:** `suppressedOnOwnScreen` is called from
**two** identical-argument sites in `lib/ui/watch.js` — `computeScreenRows()`
(also feeding the fleet grid's own row-budget math) and `draw()` — both must
be updated, not just the more visible one next to the poll-loop fix.
The fix SHALL change `suppressedOnOwnScreen`'s own signature to
`suppressedOnOwnScreen(mode, escalationTicket, liveEscalations,
historicalItem)`, returning `true` when `mode === 'escalation' &&
!!historicalItem` in addition to its existing condition, and BOTH `watch.js`
call sites SHALL be updated to pass `S.escalationHistoryItem` as the new
fourth argument — a signature change forces both call sites to be touched
(a stale, unpatched 3-argument call becomes a bug at the call site, not a
silent behavioral gap), rather than relying on each call site
independently remembering to add an inline `||` condition.

**Alternative considered:** a wholly separate `lib/ui/screens/escalation-
history.js` module with its own render/handleKey. Rejected — the ticket's
own "Proposed" section calls for reusing the live screen's rendering; a
second module would duplicate `pane()`/`textwrap.wrap()`/`sectionHeader()`/
box-sizing math that already lives in `escalation.js`, and would be exactly
the "second, divergent code path" AC 2 explicitly rules out for the live
case — better to hold that same discipline for the historical case too.

### Decision 5: `router.render`/`routeHandleKey` thread `escalationHistoryItem` alongside the existing `escalationTicket`

`lib/ui/screens/escalation.js`'s `render(state, opts)`/`routeHandleKey(key,
state)` already look up `run` by `state.escalationTicket`. Both gain one
more field read straight off `state`: `historical: state.escalationHistoryItem
|| null`, passed through to `renderEscalation`/`handleKey` as `opts.historical`
/ `state.historical` respectively — no change to the router's own dispatch
(`lib/ui/router.js` still just routes `mode: 'escalation'` to this module
unchanged).

## Risks / Trade-offs

- **[Risk]** A run whose `events` array was truncated by
  `event-log-retention` (old events pruned) could show an
  `escalation.answered` with no matching `escalation.raised` still in
  memory, or vice versa. → **Mitigation:** Decision 1's pairing walk only
  ever emits an entry when it has seen the `escalation.raised` itself; an
  orphaned `escalation.answered`/`.timeout` (no currently-open entry to
  close) is simply ignored — never invented as a bare "decision" with no
  question. This matches `metricsFor()`'s existing "derive only from what's
  actually in `run.events`" discipline elsewhere (e.g. `gateRates`).
- **[Risk]** `metricsEscalationFocus` growing stale when the underlying
  history array's length changes between polls (an escalation newly raised
  shifts every existing index by one, since the list is newest-first). →
  **Mitigation:** identical to `quickStartFocus`'s own existing risk/
  mitigation — re-clamped every `draw()` to `[0, len)`; a shift-by-one from
  a brand new escalation landing mid-focus simply moves the cursor onto a
  different, adjacent row rather than crashing or pointing out of range,
  which is the same trade-off `quickStartFocus` already accepts.
- **[Trade-off]** The historical detail view flattens a multi-part
  escalation's answers into one joined string rather than replaying the
  original wizard step-through. Accepted per Decision 4 — there is nothing
  left to page through interactively (every step is already answered), and
  building a read-only wizard replay for this one case would be
  meaningfully more code for a presentation-only difference.

## Migration Plan

No migration — purely additive UI. No schema, no persisted-state format
change (the paired history is recomputed from the existing event log on
every draw, same as every other `metricsFor()` field). No feature flag: the
new focus mode is reachable the moment this ships, same as any other fleet-
view interaction.
