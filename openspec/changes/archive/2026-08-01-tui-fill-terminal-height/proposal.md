## Why

The dashboard doesn't fill the terminal's full height on every screen: `escalation.js`, `launchplan.js` (confirm-launch), and the `docview`-based full-screen readers (`ticketview.js`, the evidence reader) render their content's natural height and stop, leaving unused rows below the box on a terminal taller than the content. `fleet.js`, `drilldown.js`, and `launchpad.js` already grow their bottom panel to fill the available `screenRows` budget (an established "lazygit-layout" pattern from the CON-12/39/40/41 work) — the remaining screens never received that same treatment, so the gap is screen-dependent rather than universal.

## What Changes

- `escalation.js`'s single content box grows (`Math.max(naturalHeight, budget - used)`, mirroring `fleet.js`/`drilldown.js`) to fill the terminal's available rows, instead of rendering at its natural content height only.
- `launchplan.js`'s (confirm-launch) content box receives the same grow-to-fill treatment.
- `docview.js`'s `bodyBox`/`renderDocView` grow to fill the caller-supplied viewport when used as a full-screen composition (evidence reader, `ticketview.js`), while still windowing (not overflowing) when content exceeds the viewport — the existing scroll/windowing behavior for over-height content is unchanged.
- No change to `fleet.js`, `drilldown.js`, or `launchpad.js` — they already grow correctly.
- The grow step in every case reserves the same last-row convention (`rows - 1`) the existing grow-to-fill screens already use, so a frame never reaches exactly the terminal's full row count and re-triggers the CON-17/CON-26 trailing-newline auto-scroll/flicker class of regression.

## Capabilities

### New Capabilities
- `dashboard-full-height-layout`: Defines the grow-to-fill contract for screens with no existing capability governing their box layout — the escalation screen and the launch-plan (confirm-launch) screen — so their content box grows to consume the terminal's available rows rather than rendering short of it.

### Modified Capabilities
- `docview`: `bodyBox`/`renderDocView`, when used as a full-screen composition (not an embedded pane with its own caller-provided height contract), grow to fill the caller's viewport row budget rather than always sizing to natural content height.

## Impact

- `lib/ui/screens/escalation.js` — box height computation.
- `lib/ui/screens/launchplan.js` — box height computation.
- `lib/ui/screens/docview.js` — `bodyBox`/`renderDocView` height computation; `lib/ui/screens/ticketview.js` (consumer, no change to its own logic beyond the shared function's new behavior).
- No change to `lib/ui/watch.js` (screenRows/bannerLines computation already correct), `lib/ui/screens/fleet.js`, `lib/ui/screens/drilldown.js`, or `lib/ui/screens/launchpad.js`.
