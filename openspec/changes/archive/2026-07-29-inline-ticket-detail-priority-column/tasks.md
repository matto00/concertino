## 1. Data layer — priority fetch and normalisation

- [x] 1.1 Add `priority` to the `QUERY` in `lib/ui/linear.js`'s `issues.nodes` selection set.
- [x] 1.2 Add `priority: typeof node.priority === 'number' ? node.priority : null` to `normaliseTicket`, matching the neighbouring fields' defensive-typing style (no `||` fallback — `0` is a real value).
- [x] 1.3 Update/add `test/linear.test.js` cases: priority `0` round-trips as `0`; missing/non-numeric priority normalises to `null`; the query text includes `priority`.

## 2. Cache schema versioning

- [x] 2.1 Add a `CACHE_SCHEMA_VERSION` constant to `lib/ui/cache.js` (e.g. `2`).
- [x] 2.2 `write()` stamps every payload with `schemaVersion: CACHE_SCHEMA_VERSION`.
- [x] 2.3 `read()` returns `empty()` when `parsed.schemaVersion` is missing or does not equal `CACHE_SCHEMA_VERSION`, before any other field is read from `parsed`.
- [x] 2.4 Update/add `test/cache.test.js` cases: a fresh write/read round-trip preserves `priority`; a cache file with no `schemaVersion` field reads as `empty()`; a cache file with an older `schemaVersion` reads as `empty()`.
- [x] 2.5 Add `"schemaVersion":2` (or whatever `CACHE_SCHEMA_VERSION` resolves to) to the three existing hand-written cache fixtures in `test/scripts/watch-smoke.test.sh` that predate this field, so task 2.3's invalidate-on-mismatch check does not silently empty out the launch pad these already-passing regression cases depend on: the `LP2_WORK` fixture (Critical-1 regression, `▲ running`/refuses-to-select, around line 163), the `Q_WORK` fixture (Critical-2 regression, active-queue warning on quit, around line 189), and the `H_WORK` fixture (Minor-1 regression, `h` harness cycling not advertised when pinned, around line 223). Re-run `test/scripts/watch-smoke.test.sh` after this task to confirm all three still pass.

## 3. Shared ticket-detail renderer

- [x] 3.1 Create `lib/ui/ticketDetail.js` exporting a pure `buildDetailLines(ticket, innerWidth)` (or equivalent signature) that produces the description/comments content lines currently inlined in `ticketview.js`'s `renderTicketView` — including the empty-description message and the `commentsTruncated` line — plus the `wrap`/`commentBlock`/helper functions it depends on.
- [x] 3.2 Update `ticketview.js` to call `lib/ui/ticketDetail.js` for its body content instead of building it inline; keep `renderTicketView`'s title/meta/url header and overall screen behavior unchanged.
- [x] 3.3 Update/add `test/ticketview.test.js` coverage to confirm `ticketview.js`'s rendered output is unchanged after the extraction (empty description, truncated comments, normal description/comments cases). (Already-existing cases in test/ticketview.test.js exercise exactly this and pass unmodified against the extracted renderer.)
- [x] 3.4 Add `test/ticketDetail.test.js` covering `buildDetailLines` directly: empty description, no comments, normal comments, truncated comments.

## 4. Launch pad — priority column

- [x] 4.1 Define priority label/width constants in `launchpad.js` (or a shared location) — `PRIORITY_WIDTH`, and a label map for `0..4` plus the unknown (`null`/`undefined`) case.
- [x] 4.2 Update `TICKET_ROW_FIXED` to account for the new column (space + `PRIORITY_WIDTH`) and re-derive `bodyWidth` accordingly.
- [x] 4.3 Update `ticketRow` to render the priority column (placed after the checkbox, before identifier+title per design.md Decision 3), with unknown priority rendered as a visibly distinct label from None.
- [x] 4.4 Add a priority-urgency rank helper (Urgent < High < Medium < Low < None < unknown) and a `P` key binding in `handleKey` that returns a `toggle-ticket-sort`-style action (do not mutate `lp` directly — `handleKey` only returns actions; see task 4.7 for where it is actually applied).
- [x] 4.5 Apply `lp.ticketSort` when building the tickets pane's row order in `renderLaunchPad`/`ticketsForEpic` (or a new sort step), defaulting to `'identifier'` when `lp.ticketSort` is unset.
- [x] 4.6 Update/add `test/launchpad.test.js` cases: priority column renders distinct labels for each value and for unknown; status column is not truncated by the new fixed-width budget; `handleKey('P', ...)` returns the expected action; `renderLaunchPad` sorts priority-`1` ahead of priority-`0` when `lp.ticketSort === 'priority'`.
- [x] 4.7 Wire the sort toggle into `lib/ui/watch.js`: seed `ticketSort: 'identifier'` in `openLaunchPad()`'s `launchPad` initializer, and add a `case` to `applyAction`'s `switch (action.type)` block (sibling to `case 'set-mode':`) that sets `launchPad.ticketSort` from the action task 4.4 returns. Without this, the `P` key is silently dropped by the existing `default:` branch and the feature does not function.
- [x] 4.8 Add a case to `test/scripts/watch-smoke.test.sh` (not `test/watch.test.js` — `applyAction`/`openLaunchPad` are private closures inside `watch(opts)`, not exported; the project's established mechanism for testing the real keypress → `applyAction` → state path is this end-to-end shell smoke test, per `lib/ui/watch.js`'s own header comment above `module.exports`). Follow the file's existing launch-pad cases (the `N`-open and select/select-all cases): seed a fixture cache with at least two tickets of different priority under the same epic (the existing two-tickets-one-epic cache-seeding pattern, e.g. the `Q_WORK` block, should cover this without new scaffolding), pipe a key sequence that opens the launch pad and presses `P`, and assert via `grep -q`/output ordering that the rendered ticket order actually changes — proving the real dispatch path works, not just that `handleKey` returns the right action shape or `renderLaunchPad` sorts correctly against a hand-built fixture. **This new fixture's hand-written cache JSON must itself include `"schemaVersion":2`** (matching task 2.1's `CACHE_SCHEMA_VERSION`) — the `Q_WORK` block it's modeled on predates that field and does not have it (see task 2.5), so copying that pattern verbatim would produce a cache that task 2.3 invalidates on read, silently emptying the launch pad this new case depends on.

## 5. Launch pad — inline detail pane

- [x] 5.1 Add a `lp`-selection-derived "current ticket" lookup (mirroring `ticketview.js`'s `findTicket`) usable from `launchpad.js`.
- [x] 5.2 Render a third pane below the existing `hsplit` block using `lib/ui/ticketDetail.js`'s shared renderer, sized from `opts.rows` per design.md Decision 4 (omit entirely below `layout.MIN_BOX_HEIGHT`; full content height when `rows` is unbounded/absent).
- [x] 5.3 Render an explicit "no ticket selected" state when the tickets pane for the current epic is empty.
- [x] 5.4 Update/add `test/launchpad.test.js` cases: detail pane content changes when `lp.ticketIndex` moves; detail pane is omitted on a short `opts.rows`; detail pane renders at full height when `opts.rows` is unbounded; empty description and truncated-comments states render as in `ticketview.js`.

## 6. Verification

- [x] 6.1 Run the full test suite and confirm no regressions in unrelated screens (`fleet`, `drilldown`, etc.) that also exercise `layout.js`/`opts.rows`.
- [x] 6.2 Manually sanity-check (or add a targeted test for) a real terminal width/height combination to confirm the three-pane layout renders without truncation artifacts.
