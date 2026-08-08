## Why

`cmdWatch` (`lib/cli/watch.js`) JSON-parses `concertino.config.json` straight off disk and hands the raw object to `watch()`, never running it through `lib/config.js`'s `withDefaults` the way `sync`/`diff`/`eject`/`migrate` do. Every config-derived decision inside the dashboard (`lib/ui/watch.js` and its controllers) therefore sees an un-normalised config — no defaults applied, no alias resolution (e.g. the deprecated `ticketProvider.kind: "manual"` never becomes `"local"`). This already caused a Critical regression once (CON-44 slice, PR #78, T5.5): an unresolvable `ticketProvider.kind` threw uncaught inside the stdin `'data'` listener, `quit()` never ran, and the terminal was left in raw mode inside the alternate screen. The two fixes that landed then patched the specific seam that was hit; the structural gap — `cmdWatch` bypassing normalisation — is still there for the next config-derived behaviour added to the TUI.

## What Changes

- `cmdWatch` now runs a successfully-parsed config through `withDefaults` before handing it to `watch()`, so the dashboard path gets the same defaults/alias-resolution as the `sync`/`diff`/`eject`/`migrate` paths.
- `withDefaults` assumes `project`/`ticketProvider` are already-present objects (true of anything `concertino init` produces) and throws otherwise. `cmdWatch` catches that and falls back to the raw parsed object — preserving today's "watch works without config" contract for a missing file, malformed JSON, or a hand-edited config missing those keys — rather than letting a normalisation failure become fatal.
- Update the stale comments in `lib/ui/watch.js` / `lib/ui/ticket-provider.js` / their tests that currently document "cmdWatch never calls withDefaults" as an unqualified fact — it's now the common case, with an explicit, narrower fallback path documented in its place. The defensive handling those comments describe (catch-and-degrade on an unresolvable `ticketProvider.kind`, the `local.js` alias table) stays exactly as-is: normalisation doesn't validate `kind` values, so an unrecognised kind (e.g. `"github"`) can still reach `watch()` even from a fully normalised config.
- No change to `withDefaults` itself, and no change to any other `withDefaults` call site.

## Capabilities

### New Capabilities
- `watch-config-normalization`: `cmdWatch` normalises its config via `withDefaults` before constructing the dashboard, with a documented, non-fatal fallback when normalisation itself isn't safely possible.

### Modified Capabilities
(none — no existing spec covers `cmdWatch`'s config-loading behavior)

## Impact

- `lib/cli/watch.js` (`cmdWatch`) — the only production code change.
- `lib/ui/watch.js`, `lib/ui/ticket-provider.js` — comment-only updates (no behavior change; their existing defensive handling of an unnormalised/unresolvable config is still required and unchanged).
- `test/watch.test.js`, `test/ticket-provider.test.js` — comment updates to match, plus new coverage of `cmdWatch`'s own normalise-then-fallback behavior.
- No API, schema, or CLI-flag changes. No effect on `sync`/`diff`/`eject`/`migrate`, which already call `withDefaults`.
