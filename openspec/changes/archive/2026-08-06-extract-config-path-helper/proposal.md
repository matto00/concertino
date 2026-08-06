## Why

Ten of the thirteen `lib/cli/cmd*` modules (`sync.js`, `diff.js`, `eject.js`,
`update.js`, `gates.js`, `doctor.js`, `watch.js`, `validate.js`, `prune.js`,
`migrate.js`) each hand-write the identical two-line `out`/`--config` path
resolution:

```js
const out = path.resolve(args.out || '.');
const cfgPath = args.config ? path.resolve(args.config) : path.join(out, 'concertino.config.json');
```

Verified byte-identical (modulo the local variable name) across all ten call
sites. This is not a current user-facing bug, but it is a maintenance hazard:
a future change to the resolution rule (e.g. an env-var fallback) needs ten
synchronized edits with no compiler or test enforcement that all ten were
updated consistently.

## What Changes

- Extract two shared helpers into `lib/cli/shared.js` (the existing home for
  cross-command CLI plumbing — `parseArgs`, `exists`, `read`, etc.):
  - `resolveOut(args)` → `path.resolve(args.out || '.')`
  - `resolveConfigPath(args, out)` → `args.config ? path.resolve(args.config) : path.join(out, 'concertino.config.json')`
- Switch all ten call sites to import and call these helpers instead of the
  hand-written duplicate.
- No behavior change: the resolution rule itself is untouched, only its
  location.

## Capabilities

### New Capabilities
- `cli-config-path-resolution`: shared `resolveOut`/`resolveConfigPath`
  helpers used by every CLI command that accepts `--out`/`--config`, replacing
  ten independent hand-written copies of the same resolution logic.

### Modified Capabilities
(none — this is a pure internal refactor; no existing spec's requirements change)

## Impact

- `lib/cli/shared.js` — adds `resolveOut`, `resolveConfigPath` to its exports.
- `lib/cli/sync.js`, `diff.js`, `eject.js`, `update.js`, `gates.js`,
  `doctor.js`, `watch.js`, `validate.js`, `prune.js`, `migrate.js` — each
  switches its local two-line resolution to a call to the shared helpers.
- No dependency, config schema, or CLI-flag behavior changes. No other
  modules are affected (the remaining three `cmd*` modules — `init.js`,
  `answer.js`, `upgrade.js` — do not use this pattern and are out of scope).
