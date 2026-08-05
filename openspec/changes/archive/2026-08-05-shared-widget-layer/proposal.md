## Why

Six dashboard screens each hand-roll their own confirm dialogs, text-input
fields, and footer height accounting, even though prior tickets (CON-6,
CON-17, CON-26, CON-27, CON-43, dashboard-visual-design, dashboard-iconography)
already unified box-drawing (`lib/ui/layout.js`), scrolling
(`lib/ui/screens/docview.js`'s `windowBody`/`clampScroll`/`scrollDelta`,
`layout.js`'s `selectionWindow`), and part of iconography (`lib/ui/icons.js`,
used today by `drilldown.js`, `launchpad.js`, `ticketDetail.js`). The
remaining duplication is concentrated in three shapes that recur
screen-by-screen with no shared implementation:

1. **Confirm dialogs** — fleet's clear-queue, force-start, and quit gates,
   plus drilldown's kill/restart gate, each independently push the same
   `warning line (yellow) + "y confirm X   (any other key) cancel" (dim)`
   pair of lines.
2. **Text-input fields** — fleet's new-run prompt, `escalation.js`'s reply
   box, and `banner.js`'s reply box each independently render `label + ' › '
   + truncated-value + '▏'` plus an optional error line. (`ticketdraft.js`'s
   draft fields render a materially different shape — a wrapped multi-line
   textarea with an active-field marker, not a single truncated-value line —
   verified by reading the code during planning, and explicitly kept out of
   this change; see the scoping note below.)
3. **Footer height accounting** — `f.hintLines`-based footers exist on two
   screens (`drilldown.js`, `launchplan.js`), and each separately re-derives
   how many rows that output occupies (`footerRows.length` reused in
   `belowRow`/height math) rather than reading a row count off one shared
   return value — exactly the class of off-by-one bug CON-43 and CON-26 fixed
   once each, screen by screen. (`escalation.js`, `ticketview.js`,
   `docview.js`, and fleet's own height budget were checked during planning
   and do NOT exhibit this duplication — each already reads its footer's row
   count from a single place: a fixed constant, or `tail.length` read
   directly off the already-built hint array. They are explicitly out of
   scope for the footer widget; see the scoping note below.)

Icon coverage (`lib/ui/icons.js`) is also inconsistent: `fleet/sections.js`
already requires it and already icon-prefixes its three non-status-governed
section titles (QUICK START, QUEUED, METRICS) via inline `icon + ' ' +
label` composition (design-gate round 3 correction — verified fresh against
`fleet/sections.js:8,136,153,180`), but `docview.js`, `ticketview.js`,
`ticketdraft.js`, `escalation.js`, `settings.js`, and `launchplan.js` have no
icon-prefixed section headers at all. The gap this change closes is
therefore two-fold: genuinely new coverage on the latter six screens, plus
migrating fleet's three already-existing inline compositions to the same
shared widget so no screen is left inlining `icon + ' ' + label`
independently.

This change extracts a `lib/ui/widgets/` layer for the three duplicated
shapes above, applies it at every existing call site (screens shrink, no
behavior change), and closes the icon-coverage gap on section/pane headers
across the remaining screens — the load-bearing subset of CON-71's broader
"shared widget layer and visual polish" scope that is directly testable
against this ticket's stated acceptance criteria.

**Scoping note (self-approved, no external dependency/architecture change):**
CON-71's broader scope also calls out a full color/emphasis-language audit
and a complete empty/error-state rendering pass. `STATUS_COLOUR`/
`ROLE_COLOUR` already exist as the single source of semantic/role colour
(`lib/ui/format.js`) and are already used consistently everywhere a status or
role is rendered — no drift was found during planning, so no further
color-audit work is scoped here. A single `emptyState()` widget is added and
applied to the panes that currently hand-roll a "nothing here" message
(mirroring the codebase's existing dim-styled empty-state convention, e.g.
`fleet/sections.js:228`'s `f.dim('  no active runs')` and `launchpad.js:318`'s
`f.dim('no tickets cached yet — press r to fetch')` — design-gate round 4
correction: NOT `launchpad.js`'s `teamNotFoundMessage`, which actually lives
in `watch.js` and renders via `f.red` as an error, not `f.dim` as an empty
state), rather than auditing every possible empty branch across all six
screens — this keeps the
change bounded to what a single execution/evaluation cycle can verify without
regressing any of the "no behavior change to key bindings or event
semantics" acceptance criteria. Any further empty-state gaps found later are
natural follow-up tickets, not a reason to broaden this change's scope now.

**Scoping note (design-gate revision, round 1):** during planning,
`ticketdraft.js`'s draft-field rendering and four of the six originally
proposed `footer()` consumers (`escalation.js`, `ticketview.js`,
`docview.js`, fleet) were verified, by reading the actual source, NOT to
match the duplicated shape the corresponding widget targets — see the
per-shape notes in "Why" above. Both are removed from this change's scope
rather than forced through a widget whose contract they don't actually fit;
unifying `ticketdraft.js`'s wrapped-textarea shape, or converting those four
screens' fixed footers to `f.hintLines`-based ones, would each be a genuine
rendering-behavior change requiring its own reviewed decision — out of
bounds for a "no behavior change" refactor ticket.

## What Changes

- Add `lib/ui/widgets/confirm.js`: a pure `confirmLines({ warning, confirmHint
  })` function producing the shared two-line confirm-dialog shape. Applied at
  fleet's clear-queue/force-start/quit gates and drilldown's kill/restart
  gate — no wording or key-binding change, only where the lines come from.
- Add `lib/ui/widgets/textinput.js`: a pure `inputLines({ label, value, cols,
  error })` function producing the shared input-line(+ optional error line)
  shape. Applied at fleet's new-run prompt, `escalation.js`'s reply box, and
  `banner.js`'s reply box. `ticketdraft.js` is explicitly out of scope (see
  scoping note above).
- Add `lib/ui/widgets/footer.js`: a pure `footer({ hints, cols })` function
  that wraps `f.hintLines` and returns both the rendered lines AND their row
  count (`{ lines, rows }`), so a screen's height-budget math reads `rows`
  off the widget's own return value instead of re-deriving it
  (`hintLines(...).length` or equivalent) at each call site. Applied only to
  the two screens verified to actually duplicate this computation today
  (`drilldown.js`, `launchplan.js`); `escalation.js`, `ticketview.js`,
  `docview.js`, and fleet are explicitly out of scope (see scoping note
  above).
- Add `lib/ui/widgets/header.js`: a pure `sectionHeader({ icon, label, colour
  })` function that composes an icon (from `lib/ui/icons.js`) with a label
  the same "icon + ' ' + label" way `dashboard-iconography`'s existing
  requirement already mandates, for use by screens with no icon-prefixed
  headers today.
- Add `lib/ui/widgets/empty.js`: a pure `emptyState({ icon, message })`
  function mirroring `launchpad.js`'s existing `teamNotFoundMessage`
  rendering, for reuse by any pane that currently hand-rolls its own "nothing
  here" text.
- Extend `lib/ui/icons.js` usage (no new glyphs unless a screen genuinely has
  no fitting existing glyph) to `docview.js`, `ticketview.js`,
  `ticketdraft.js`, `escalation.js`, `settings.js`, and `launchplan.js`'s
  section/pane headers, via the new `header.js` widget — bringing icon
  coverage to every screen `dashboard-iconography`'s own header comment
  already claims as a consumer, plus the ones it does not yet name.
- No key binding or event-type changes anywhere in this change. No screen's
  `render(state, opts) -> string` / `handleKey` seam changes shape.
- **(Fold-in, post-delivery follow-up, added after PR #63 merged.)** Migrate
  the three remaining inline `icon + ' ' + label` compositions the first
  delivery deliberately left out of scope: `drilldown.js`'s four panel
  titles (TICKET/TIMELINE/GATES/EVIDENCE), `ticketDetail.js`'s DESCRIPTION/
  COMMENTS headers, and `controllers/drilldown.js`'s `docTitle`. See
  design.md Decision 7. Same "byte-for-byte swap, no wording/behavior
  change" contract as every other widget-migration site in this change.

## Capabilities

### New Capabilities

- `dashboard-shared-widgets`: the `lib/ui/widgets/` layer itself — confirm
  dialogs, text-input fields, footer height accounting, section headers, and
  empty-state rendering as pure, independently unit-tested functions shared
  across screens.

### Modified Capabilities

- `dashboard-iconography`: extends icon coverage from
  `drilldown.js`/`launchpad.js`/`ticketDetail.js` to every screen's
  section/pane headers, via the new `header.js` widget rather than each
  screen inlining icon-prefix composition independently. (Fold-in
  follow-up: further widened to also cover `drilldown.js`'s own four panel
  titles, `ticketDetail.js`'s two headers, and `controllers/drilldown.js`'s
  `docTitle` — the requirement's SHALL is no longer scoped away from these
  three files.)

## Impact

- Affected code: `lib/ui/widgets/*.js` (new), `lib/ui/screens/fleet/*.js`,
  `lib/ui/screens/drilldown.js`, `lib/ui/screens/escalation.js`,
  `lib/ui/banner.js`, `lib/ui/screens/ticketdraft.js`,
  `lib/ui/screens/docview.js`, `lib/ui/screens/ticketview.js`,
  `lib/ui/screens/launchplan.js`, `lib/ui/screens/settings.js`,
  `lib/ui/icons.js` (consumers only, glyph table itself likely unchanged),
  `lib/ui/ticketDetail.js`, `lib/ui/controllers/drilldown.js` (fold-in
  follow-up scope).
- No API, storage format, or CLI surface changes. No new external
  dependencies.
- Existing screen tests must keep passing unchanged (facade exports
  preserved) — this is a refactor-with-tests change, not a behavior change.
