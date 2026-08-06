## 1. Shared helpers

- [x] 1.1 Add `resolveOut(args)` to `lib/cli/shared.js`, returning
      `path.resolve(args.out || '.')`.
- [x] 1.2 Add `resolveConfigPath(args, out)` to `lib/cli/shared.js`, returning
      `args.config ? path.resolve(args.config) : path.join(out, 'concertino.config.json')`.
- [x] 1.3 Export both from `lib/cli/shared.js`'s `module.exports`.

## 2. Switch call sites

- [x] 2.1 `lib/cli/sync.js` — replace the two-line resolution with
      `resolveOut`/`resolveConfigPath`.
- [x] 2.2 `lib/cli/diff.js` — same.
- [x] 2.3 `lib/cli/eject.js` — same.
- [x] 2.4 `lib/cli/update.js` — same.
- [x] 2.5 `lib/cli/gates.js` — same.
- [x] 2.6 `lib/cli/doctor.js` — same (note: `out` is also used later in the
      function for unrelated checks — keep those reads of `out` intact,
      only replace the two resolution lines).
- [x] 2.7 `lib/cli/watch.js` — same.
- [x] 2.8 `lib/cli/validate.js` — same.
- [x] 2.9 `lib/cli/prune.js` — same.
- [x] 2.10 `lib/cli/migrate.js` — same.

## 3. Verification

- [x] 3.1 Grep all ten files to confirm no hand-written
      `args.config ? path.resolve(args.config) : path.join(out, 'concertino.config.json')`
      duplicate remains outside `shared.js`.
- [x] 3.2 Run the existing test suite (unit tests over `lib/cli/*`, if any)
      and any relevant lint/gate scripts; confirm no regressions.
- [x] 3.3 Manually verify behavior is unchanged for at least one command with
      `--config` provided and one without, before/after comparison.
