# CON-92: `concertino watch` never normalises its config — cmdWatch bypasses withDefaults

## Description

Found by the Task 5 review of the CON-44 first slice (PR #78, finding T5.5). The symptom was fixed; the structural hazard was not.

`lib/cli/watch.js:10-13`:

```js
  let config = {};
  if (exists(cfgPath)) {
    try { config = JSON.parse(read(cfgPath)); } catch (e) { /* watch works without config */ }
  }
```

`cmdWatch` JSON-parses the raw file and calls `watch({ root: out, config })` directly. `loadConfig` / `withDefaults` are never invoked on the dashboard path, so **every config reaching** `watch()` **is unnormalised** — no defaults applied, no alias resolution.

This was not a theoretical concern. It directly caused a Critical regression during the first slice: the new provider resolver threw on an unrecognised `ticketProvider.kind`, the throw escaped `ensureLaunchPad` through the stdin `'data'` listener uncaught, `quit()` never ran, and the terminal was left in raw mode inside the alternate screen. Reachable via `N` and via `t` on a RUNNING/DONE/QUICK START row.

Two narrow fixes landed in the slice — a try/catch at the `watch.js` UI boundary, and alias resolution inside `lib/ui/ticket-provider.js`'s `moduleFor` / `canonicalConfig`. Both address the symptom at the seam that happened to be affected. The underlying situation is unchanged: any future config-derived behaviour added to the TUI inherits the same hazard with no protection.

## Acceptance Criteria

* `watch()` receives a normalised config, or the reason it deliberately does not is documented at the call site.
* Whatever "watch works without config" was protecting (`cmdWatch`'s own comment) still works — a missing or malformed `concertino.config.json` must not become fatal.

## Metadata

- Ticket URL: https://linear.app/helioapp/issue/CON-92/concertino-watch-never-normalises-its-config-cmdwatch-bypasses
- Parent: CON-44
- Priority: Medium
