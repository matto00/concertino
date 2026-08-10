## Context

The fleet view (`lib/ui/screens/fleet/`) already renders a bounded set of
sections (NEEDS YOU, FAILED, RUNNING, QUICK START, QUEUED, DONE) built from
`S.runs` via `buildSections`/`bucketRuns`, capped per-section by
`MAX_FINISHED` (5) purely for on-screen rendering — FAILED/DONE beyond that
cap show as "`… and N more`" rather than being dropped from `S.runs` itself.
`S.runs` is populated every poll (`lib/ui/watch.js`) by:

```
S.runs = reduce(store.readAll(root, eventsCache), sampleWindows(now), now)
```

`store.readAll` (`lib/ui/store.js`) already reads every ticket directory
under `.concertino/runs/` — the full retained set, bounded only by
`dashboard.retentionDays`/`concertino prune` (`event-log-retention`), not by
any fleet-rendering cap. So `S.runs`, at any moment, already **is** "every
retained run" this ticket asks for a screen to browse. No new read path,
cache, or config is needed — only a new screen that lists/filters this
already-in-memory array differently than the fleet view's own sectioned
rendering does, and a way to open the existing drill-down from it.

CON-110 (`fleet-search`) added a similar-looking `/` search prompt to the
fleet view itself, but it is scoped, by design, to exactly the rows the
current frame's `buildSections` walk assembles (live fleet state: `runs[]`,
`queueState`, the QUICK START eligible list) — it explicitly never reaches a
run that isn't part of this frame's section build (`fleet-search` spec,
"Query does not reach beyond this frame's assembled rows"). This is a
narrower universe than `S.runs` itself (which already holds every retained
run, sections or no) — CON-110's own scope decision, not a bug to route
around. This change's archive screen is a second, independent screen with
its own filter state and its own (wider) target list, not a reinterpretation
of the fleet view's `/` prompt.

## Goals / Non-Goals

**Goals:**
- List every run in `S.runs` (i.e. every retained run under
  `.concertino/runs/`), independent of live status, in a dedicated screen.
- Filter that list live, as-you-type, by ticket id/title substring, by
  harness, and by a date range (against `startedAt`).
- Selecting a run opens the identical drill-down a live/recent run's `l` key
  already opens — same panels, same data shape, no parallel implementation.
- Document the new key and screen in `docs/dashboard.md`.

**Non-Goals:**
- No new on-disk read path, cache, or config field — reuses `S.runs` as
  already populated by the existing per-poll `reduce(store.readAll(...))`.
- No change to `dashboard.retentionDays`/pruning semantics
  (`event-log-retention`) — a run pruned off disk is, as today, simply
  absent from `S.runs` and therefore absent from the archive list too.
- No change to CON-110's fleet-wide `/` search — its own narrower,
  live-fleet-only scope is unchanged; this screen does not extend it or
  fold it in (see Decision 2 below).
- No navigation stack. Consistent with every existing top-level screen
  (sessions, settings, launch pad, drill-down), `esc` from the archive
  screen — and `esc` from a drill-down opened from the archive screen —
  both return straight to the fleet, not to whichever screen was open
  immediately before.
- No sort/column customization, no pagination UI beyond ordinary
  scroll — out of scope for this slice; the acceptance criteria only ask
  for listing, filtering, and opening the drill-down.

## Decisions

### Decision 1: New top-level key is `A` (capital)

Escalated to the human (Planning) given `keys.js`'s already-dense claimed
letters (`a c d f h H j k l L m n N p P q r s S t y`) plus `/` (CON-110).
**Resolved: `A`** ("Archive"), unbound today, mirrors the existing
`n`/`N` (lowercase/uppercase sibling-action) precedent. Bound in
`lib/ui/screens/fleet/keys.js#handleKey` at the same unconditional
top-level site as `s`/`v`/`N` (reachable regardless of `focus`, after every
confirmation gate/prompt/search has already had first refusal, exactly like
those three) — no special-casing needed since `A` claims a genuinely free
slot.

### Decision 2: Filter implementation — share the match predicate, not the target list

Escalated to the human (Planning) given the surface-level similarity to
CON-110's `/` search. **Resolved: share `matchesQuery`/`rowMatches` from
`lib/ui/screens/fleet/search.js` only** (the one place "ticket id or title
substring, case-insensitive" is defined) — the archive screen's own
ticket/title filter calls these two functions, exactly as
`fleet-section-jump`'s digit-jump and CON-110's own `/` prompt already each
have their own separate target-list logic despite walking overlapping data.
The archive screen's target list (every entry in `S.runs`, harness- and
date-filterable) and CON-110's target list (this frame's rendered fleet
sections only) stay genuinely separate implementations — building a shared
target-listing abstraction now, for two call sites with different universes
and (for harness/date) different filter dimensions entirely, would be
speculative generality the ticket doesn't ask for. `search.js` itself is
unmodified by this change (no new export, no signature change) — the
archive screen `require`s it exactly as any other consumer would.

**Correction (skeptic gate round 1, change request 1):** `matchesQuery`
(`lib/ui/screens/fleet/search.js:17-21`) returns `false` on a null,
undefined, or whitespace-only query — so `rowMatches` called unmodified with
an empty `archiveQuery` matches **nothing**, not everything (this is also
the existing, deliberate `fleet-search` capability behavior: "An empty
query SHALL match nothing," `openspec/specs/fleet-search/spec.md`). The
archive screen's own Goal — "empty filter shows everything" — is therefore
an explicit bypass the archive screen's *own* filter code must implement,
not a property `rowMatches` already provides:

```
function passesSubstringFilter(run, query) {
  if (!query || !String(query).trim()) return true;   // empty = show all
  return rowMatches(run.ticket, run.changeName, query); // reused, unmodified
}
```

`rowMatches`/`matchesQuery` are still reused exactly as before for a
*non-empty* query — only the empty-query short-circuit is the archive
screen's own addition, living in `lib/ui/screens/archive.js`, never inside
`search.js` itself (which stays unmodified, per Decision 2's own point
about not widening `fleet-search`'s scope).

### Decision 3: Archive screen state and reuse of the existing drill-down

New `S.archive*` state fields. `sessions.js`'s single flat `S.sessions*`
shape (`lib/ui/controllers/sessions.js`) is the wrong precedent here
(skeptic gate round 1, change request 3) — it has exactly one interactive
element (a single list, one cursor), while this screen has five: the
substring input, the harness selector, the date-from field, the date-to
field, and the results list. `settings.js`'s multi-pane state (its own
local `focus` field distinguishing SECTIONS vs. FIELDS, per its header
comment) is the closer precedent, adapted to this screen's five zones
instead of two:

- `S.archiveQuery` (string, ticket id/title substring filter)
- `S.archiveHarnessFilter` (string | null — one of the harness values seen
  in `S.runs`, or null for "any")
- `S.archiveDateFrom` / `S.archiveDateTo` (ms epoch | null — inclusive
  bounds against `run.startedAt`; a run with no `startedAt` — never reached
  `run.start` — is excluded whenever either bound is set, included
  otherwise)
- `S.archiveSelected` (cursor index into the currently filtered list)
- `S.archiveFocus` (one of `'query' | 'harness' | 'dateFrom' | 'dateTo' |
  'list'` — which of the five zones currently receives keystrokes; defaults
  to `'query'` on `open-archive`). `Tab` cycles forward through this fixed
  order, `Shift-Tab` cycles backward, wrapping at both ends — these are the
  ONLY focus-cycling keys (skeptic gate round 2 non-blocking note: an
  earlier draft of this decision also proposed `h`/`l` as a backward/forward
  alias, mirroring `settings.js`'s own SECTIONS↔FIELDS `h`/`l` binding; this
  is dropped — the query zone is a live text field where `h`/`l` are
  ordinary characters an operator types as part of a search string, so
  binding them to focus movement anywhere in this screen would be a
  usability regression, and neither tasks.md nor spec.md ever adopted it).
- `S.archiveDatePrompt` (`{ bound: 'dateFrom' | 'dateTo', value: string,
  error: string | null } | null` — the in-progress, uncommitted text of an
  open date-field prompt; see Decision 6 below). `null` whenever no date
  prompt is open.

`open-archive` (bound to `A`, dispatched the same way `open-sessions`/
`open-settings` already are) snapshots nothing new — it reads `S.runs`
directly at render time, every frame, exactly like the fleet view itself
does, so the archive list is never stale relative to the dashboard's own
per-second poll.

Selecting a row (`↵`) dispatches the **existing** `open-drilldown` action
unchanged (`lib/ui/controllers/drilldown.js`) — `S.drillTicket =
action.ticket`, `S.mode = 'drilldown'`. The drill-down's own render/lookup
(`S.runs.find((r) => r.ticket === S.drillTicket)`) already works for any
ticket present in `S.runs`, live or not, so an archived (currently
off-fleet-section) run opens the identical panels a live one does — this is
the acceptance criteria's "reusing existing panels rather than a parallel
read path" satisfied directly, not approximated.

### Decision 4: `esc` behavior — no navigation stack

Per the Non-Goals above, `esc` from the archive screen dispatches the
existing generic `{ type: 'back' }` action, exactly like sessions/settings/
launch pad/drill-down already do — `watch.js`'s `applyAction` already
special-cases `'back'` to `backToFleet()` unconditionally, so no new
watch.js branching is needed. A drill-down opened from the archive screen
is, once open, indistinguishable from one opened from the fleet view
(`S.drillTicket` is the only linkage) — its own `esc` therefore also goes
straight to the fleet, matching the existing app-wide precedent (there is
no "return to archive" today for any screen, and adding one only for this
screen would be an inconsistent, one-off exception).

### Decision 5: Harness filter values

Populated dynamically from the distinct, non-null `run.harness` values
actually present in `S.runs` at render time (not a hardcoded list) — a
future harness (already anticipated by `harness-identity`) needs no change
here. A run with `harness: null` (predates per-ticket harness identity, or
never reached `run.start`) is excluded from the harness dropdown's own
option list but still matches when the harness filter is unset ("any").

### Decision 6: Harness selector and date-range field interaction (skeptic gate round 1, change request 4)

Left unspecified in round 1 — resolved here rather than left for the
implementer to invent, since two different implementations could
plausibly disagree:

- **Harness selector** (`S.archiveFocus === 'harness'`): behaves like an
  enum field in `settings.js`'s own FIELDS pane ("a boolean toggles
  immediately, an enum cycles through its allowed values" —
  `docs/dashboard.md`'s settings-screen keys table). `↵`/`space` cycles to
  the next distinct, non-null `run.harness` value present in `S.runs` at
  that moment (computed fresh each cycle, per Decision 5), wrapping from
  the last value back to `null` ("any" — the unset default) rather than
  stopping at the end of the list. No free-text entry — the value space is
  closed and small, so a prompt would be strictly worse than cycling.
- **Date-from / date-to fields** (`S.archiveFocus === 'dateFrom'` /
  `'dateTo'`): `↵` opens a prompt by setting `S.archiveDatePrompt = {
  bound: 'dateFrom' | 'dateTo', value: <current bound formatted
  YYYY-MM-DD, or '' if unset>, error: null }`. **Correction (skeptic gate
  round 2, change request 1):** there is no pre-existing shared free-text
  prompt widget to "open" — `lib/ui/widgets/textinput.js` is explicitly
  render-only ("cursor/backspace key handling stays with each caller's own
  `handleKey`," per its own header comment); every existing prompt
  (fleet's `n` prompt via `S.prompt`, settings' field-edit prompt via
  `settings.prompt = { path, value, error }`) owns its own state slot and
  its own `handleKey` branch. `S.archiveDatePrompt` (Decision 3) is that
  slot for this screen, and it is checked — exactly like
  `settings.js:355-360` checks `settings.prompt` — **before** any
  `archiveFocus`-based routing:
  - While `state.archiveDatePrompt` is set: a bare `esc` clears
    `archiveDatePrompt` back to `null` and does nothing else — it cancels
    only the prompt, leaving `archiveFocus` and every committed filter
    untouched (it does NOT dispatch `{ type: 'back' }`, unlike every other
    `esc` case in this screen). Backspace trims the last character of
    `archiveDatePrompt.value`; any other printable character appends to
    it. `↵` runs task 3.4's `YYYY-MM-DD` parser against
    `archiveDatePrompt.value`: on success, sets `archiveDateFrom`/
    `archiveDateTo` (start-of-day / end-of-day local time, per the format
    rule below) and clears `archiveDatePrompt` back to `null`; on an empty
    string, clears that bound to `null` and clears `archiveDatePrompt`;
    on any other unparseable value, leaves the committed bound unchanged
    and sets `archiveDatePrompt.error` (rendered as the one-line notice),
    leaving the prompt open for another attempt.
  - Only once `state.archiveDatePrompt` is `null` does ordinary
    `archiveFocus`-gated routing apply — so `esc` while the prompt is
    closed still falls through to the screen-wide `{ type: 'back' }`
    dispatch (Decision 4), exactly as every other zone's `esc` does.
  - Accepted format is strictly `YYYY-MM-DD`, parsed as that day's
    `00:00:00` local time for `dateFrom` and that day's `23:59:59.999`
    local time for `dateTo` (so a same-day from/to pair is inclusive of
    the whole day, not empty).
  - The validation error lives entirely on `archiveDatePrompt.error`,
    scoped to the open prompt itself and cleared the moment the prompt
    closes (success or cancel) — there is no separate screen-level error
    field for this slice; nothing else on this screen surfaces a one-line
    notice, so no such field is needed.
- These three fields' `↵` behavior is deliberately different from the list
  zone's own `↵` (which opens the drill-down, Decision 3 above) and from
  the substring field's `↵` (which does nothing special — substring
  filtering is already live-as-you-type, per the Goals — Tab is how the
  operator moves on). `handleKey` dispatches on `state.archiveDatePrompt`
  first, then `S.archiveFocus`, so there is a single, ordered place each
  zone's own key semantics are defined, mirroring `settings.js`'s own
  prompt-then-`settings.focus`-gated key routing exactly.

## Risks / Trade-offs

- **[Risk]** The archive screen's list could grow large (every retained run
  up to `retentionDays`, e.g. 30 days of history) with no pagination beyond
  scroll. → Mitigation: this mirrors how DONE/FAILED already scroll past
  `MAX_FINISHED`; the live substring/harness/date filters are the intended
  way to narrow a large list, not a paged UI, consistent with this ticket's
  acceptance criteria.
- **[Risk]** A run whose `events.jsonl` was pruned mid-session (retention
  window crossed while the dashboard is open) silently disappears from the
  archive list on the next poll. → Mitigation: identical, pre-existing
  behavior for the fleet view's own DONE section — not a new risk this
  change introduces.
- **[Trade-off]** Sharing only the match predicate (Decision 2), not a full
  target-listing abstraction, means a future third filterable-list screen
  would face the same choice again. → Accepted: two data points
  (fleet `/` search, this archive screen) is not enough to safely generalize
  from without guessing at a third screen's actual needs.
