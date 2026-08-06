# CON-87: Extract shared `--config`/`--out` path resolution helper (duplicated across 10 CLI modules)

## Description

Found during the CON-59 CLI audit (`docs/cli-audit-2026-08.md`, finding 7).

The one-liner `const cfgPath = args.config ? path.resolve(args.config) : path.join(out, 'concertino.config.json')` (or the near-identical `out` resolution above it) appears, hand-written, in `sync.js`, `diff.js`, `eject.js`, `update.js`, `gates.js`, `doctor.js`, `watch.js`, `validate.js`, `prune.js`, and `migrate.js` — ten of thirteen `cmd*` modules. Behavior is identical everywhere (verified byte-identical modulo variable names), so this is not a current user-facing inconsistency, but it is a maintenance hazard: a future change to the resolution rule (e.g. an env-var fallback) needs ten synchronized edits with no compiler/test enforcement that all ten were updated.

## Suggested approach

Extract a shared `resolveConfigPath(args, out)` (and/or `resolveOut(args)`) helper into `lib/cli/shared.js` and switch all ten call sites to use it. Straightforward mechanically, but touching ten files and unrelated to CON-59's bare-invocation/discoverability focus, so scoped as its own independently-reviewable change.

Referenced from `docs/cli-audit-2026-08.md` finding 7.

## Acceptance Criteria

- A shared helper (`resolveConfigPath(args, out)` and/or `resolveOut(args)`) is extracted into `lib/cli/shared.js` (or an equivalent shared module).
- All ten call sites (`sync.js`, `diff.js`, `eject.js`, `update.js`, `gates.js`, `doctor.js`, `watch.js`, `validate.js`, `prune.js`, `migrate.js`) are switched to use the shared helper(s), removing the duplicated hand-written logic.
- Behavior is unchanged for all ten commands (verified byte-identical resolution logic before/after).
- No new external dependencies; this is a pure internal refactor.
