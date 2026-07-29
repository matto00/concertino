## Context

The launch pad (`lib/ui/screens/launchpad.js`) is a pure `(state, opts) -> string` screen rendering a two-pane `hsplit` (epics left, tickets right) via the shared `lib/ui/layout.js`. Ticket data flows: `lib/ui/linear.js` (GraphQL fetch + normalise) → `lib/ui/cache.js` (on-disk `.concertino/cache/linear.json`) → `watch.js` (passes `cols`/`rows` into every screen's render) → the screen. `ticketview.js` is a separate full-screen renderer reached via `↵`, holding the only existing description/comments rendering (wrap, comment blocks, empty-description and `commentsTruncated` handling).

This change touches both ends of that pipeline: the data layer gains a `priority` field with a cache-migration hazard, and the UI layer gains a third pane that reuses `ticketview.js`'s rendering logic without duplicating it.

## Goals / Non-Goals

**Goals:**
- `priority` flows from Linear through the normaliser to the tickets pane and is sortable.
- A pre-existing on-disk cache is never misread as `priority: 0`/None.
- The selected ticket's description/comments are visible without leaving the launch pad.
- `ticketview.js`'s rendering logic has exactly one implementation, called from two places.
- The three-pane layout degrades gracefully on a short terminal — the list never gets squeezed to nothing.

**Non-Goals:**
- Changing what `ticketview.js` shows or how it's reached (still `↵`, still full-screen).
- Editing priority from Concertino (read-only, same as every other Linear field here).
- A general schema-migration framework for the cache — this only needs to detect "predates `priority`" vs. "current".

## Decisions

### Decision 1 — Cache schema version invalidates rather than infers

Add a `CACHE_SCHEMA_VERSION` constant (starting at `2`, since the current unversioned shape is implicitly `1`) to `lib/ui/cache.js`. `write()` stamps every payload with `schemaVersion: CACHE_SCHEMA_VERSION`. `read()` treats a missing or mismatched `schemaVersion` exactly like a malformed file: `return empty()`.

This means a pre-upgrade cache is cold on first read after upgrading — the launch pad opens with "no tickets cached yet — press r to fetch" instead of a partially-priority-less list. Rationale: `cache.js`'s own stated contract is "anything that is not a well-formed cache is an empty one... every caller would handle the error by showing the empty state, so the empty state is what they get" (see the file's header comment). A pre-`priority` cache is exactly that kind of not-well-formed — extending the existing idiom is simpler and strictly safer than the alternative below, and "press r" is a single keystroke.

Alternative considered: keep the stale cache readable and render per-ticket priority as an explicit "unknown" glyph when the `priority` key is absent from a cached ticket object (distinguishing `undefined` — key never existed — from `null` — normaliser's defensive fallback for a malformed API response — from `0..4` — a real value). Rejected as the default path because it adds a second, permanent code path (three-way priority state through the whole rendering chain, forever) to solve a one-time migration problem; the invalidate-on-mismatch approach solves it in one place and the extra states collapse back to just "number or null" everywhere else. The `typeof node.priority === 'number' ? node.priority : null` per-ticket defensive check stays regardless (a single malformed node in an otherwise-current-schema response must not crash the fetch), and `null`/missing priority still renders as an explicit "?" — Decision 3 covers that rendering, it's just no longer reachable via a stale cache once Decision 1 lands.

### Decision 2 — Shared detail renderer, not a shared screen

Extract `ticketview.js`'s body-building logic (`wrap`, `commentBlock`, `metaLine`, `fmtDate`, and the description/comments content-line assembly currently inlined in `renderTicketView`) into a new pure module, `lib/ui/ticketDetail.js`, exporting a single `buildDetailLines(ticket, innerWidth)` that returns the content-line array `ticketview.js` currently builds inline (title/meta/url stay screen-specific — they render differently full-screen vs. inline). Both `ticketview.js` and `launchpad.js` call this and wrap the result in their own `layout.box()`/`layout.degrade()` call with their own dimensions. `ticketview.js`'s public API and behavior are unchanged; only its internals delegate.

Alternative considered: give the inline pane its own trimmed-down renderer (e.g., description only, no comments). Rejected — the proposal is explicit that duplicating `ticketview.js`'s logic is the failure mode to avoid, and a trimmed renderer would silently diverge from the full view over time (e.g., a future fix to `commentsTruncated` wording landing in only one place).

### Decision 3 — Priority rendering and rank

Render priority as a fixed-width label immediately after the checkbox and before the identifier/title (mirroring Linear's own left-of-title placement): `Urg`, `High`, `Med`, `Low`, `None` for values `1..4,0`, and `f.dim('?')` for `null`/`undefined` (never blank, never treated as `0`). `PRIORITY_WIDTH = 4` (longest label `High`/`None`). `TICKET_ROW_FIXED` grows from `8` to `8 + 1 + PRIORITY_WIDTH` (one separating space plus the column); `bodyWidth` (the identifier+title's budget) absorbs the loss, exactly as the proposal specifies.

Sort: a new `P` (capital) key toggles the tickets pane between the existing identifier order and priority order. Priority order is not a plain numeric sort on Linear's own integer encoding (`0` None, `1` Urgent) — that would put "None" ahead of "Urgent". Rank map for sorting: `Urgent(1) < High(2) < Medium(3) < Low(4) < None(0) < unknown(null/undefined)`, i.e. urgency descending with unknown last. `lp.ticketSort` (`'identifier' | 'priority'`) is new launch-pad state, defaulting to `'identifier'` so existing behavior/tests are unaffected until a user opts in.

Unlike the detail pane (Decision 4), this requires reducer wiring: `launchpad.js`'s `handleKey` only returns an action object — `lib/ui/watch.js`'s `applyAction` is what actually mutates state, and it currently has an explicit `case` for every existing launch-pad action with a `default:` that silently drops anything unrecognised. So this decision is incomplete without also touching `watch.js`: `openLaunchPad()`'s initializer seeds `ticketSort: 'identifier'` alongside its other fields, and `applyAction` gains a `case` (sibling to `case 'set-mode':`) that sets `launchPad.ticketSort` from the `P`-key action. Both are in scope for this change (see tasks.md section 4) precisely because a UI-only change here would compile and render correctly in isolated tests while doing nothing when a user actually presses the key.

`applyAction`/`openLaunchPad` are private closures inside `watch(opts)` and are not exported from `lib/ui/watch.js` — this is a deliberate, already-documented architectural choice (see the comment above that file's `module.exports`), not an oversight to work around. The end-to-end proof that the real `P` keypress reaches `applyAction` and flips `launchPad.ticketSort` therefore belongs in `test/scripts/watch-smoke.test.sh` (the project's existing mechanism for exactly this class of behavior — real keys piped into a real `watch` process, asserted against rendered output), not in a `test/watch.test.js` unit test, which has no access to `applyAction` by any name.

### Decision 4 — Three-pane vertical budget

The detail pane is a third `layout.box()`/degrade call spanning the full render width, placed after the existing `hsplit` block and before the `selected/mode` summary line. Its available height is `rows - (lines already used above it) - (lines reserved below it: blank + summary + hints)`, using the same `opts.rows` (`0` = unbounded, matching `fleet.js`'s convention) already plumbed through `watch.js`. When the remaining height is below `layout.MIN_BOX_HEIGHT` (3), the detail pane is omitted entirely (not drawn degraded-but-squeezed) — a 1-2 row fragment of a description is worse than no description. `MAX_EPICS_VISIBLE`/`MAX_TICKETS_VISIBLE` are left at their current values (10/12); the detail pane only claims space left over after the epics/tickets pane, which already has its own bounded window — it does not shrink the list to make room. On an unbounded render (`rows` absent — tests, pipes, `--once` output), the detail pane always renders at a fixed content height (matching `ticketview.js`'s own unbounded behavior).

Alternative considered: give the detail pane a fixed height and let it shrink the epics/tickets pane instead. Rejected — the proposal calls out that `MAX_EPICS_VISIBLE`/`MAX_TICKETS_VISIBLE` were sized against a two-pane layout and must not be silently squeezed; leaving the list's budget untouched and letting the detail pane be the one that degrades keeps the list's existing behavior/tests stable.

## Risks / Trade-offs

- **[Risk]** Invalidating the whole cache on a schema bump (Decision 1) means every user's first post-upgrade launch-pad open is a cold cache, not just missing-priority. → **Mitigation**: this is a one-time cost per upgrade (not per session), the existing cold-cache UX (`no tickets cached yet — press r to fetch`) already exists and is well-tested, and the alternative (silent partial staleness) is the exact defect class this project treats as a wall.
- **[Risk]** A very short terminal now has three panes competing for space instead of two. → **Mitigation**: Decision 4's "omit rather than squeeze" rule, plus the detail pane being the one that yields (not the ticket list, which is where selection actually happens).
- **[Trade-off]** `lp.ticketSort` adds new launch-pad state (beyond `pane`/`epicIndex`/`ticketIndex`/`selected`/`mode`) that `watch.js`'s reducer must initialize and persist across polls. → accepted; it is one field with a two-value domain and a safe default.

## Migration Plan

No deploy/rollback machinery beyond the schema-version bump itself: shipping this change is the migration. Any running Concertino instance picks up `CACHE_SCHEMA_VERSION = 2` on next process start; the first `read()` against an old-shape file returns `empty()`, and the next `r` (or the existing auto-refresh-on-cold-cache path, if any) repopulates it with `priority` included. No action needed from users beyond a normal upgrade.

## Open Questions

None outstanding — the design gate is the place to raise any.
