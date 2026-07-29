## 1. `lib/ui/linear.js` — the bound and the opt-out

- [x] 1.1 Add `MAX_TICKETS = 500` with a comment justifying it against the
      measured data (design.md Decision 1).
- [x] 1.2 Rewrite the `COMMENT_LIMIT` comment so it no longer claims to be
      what keeps the cache small; document it as insurance against a single
      pathological thread (design.md Decision, spec Requirement 4).
- [x] 1.3 Add `stateTypesFromConfig(config)`: returns `OPEN_STATE_TYPES`
      unchanged unless `dashboard.launchPad.backlog === false`, in which case
      it excludes `'backlog'`.
- [x] 1.4 In `fetchTickets`, accept `opts.maxTickets` (default `MAX_TICKETS`).
      After each page, if the accumulated node count reaches or exceeds the
      cap, stop paging, slice the array to exactly `maxTickets`, and set
      `truncated` per design.md Decision 3/5: `true` if that page's
      `hasNextPage` was `true` OR the accumulated count before slicing
      exceeded `maxTickets` (overshoot); `false` only when the count lands
      exactly on `maxTickets` with `hasNextPage: false`.
- [x] 1.5 Return `truncated` on the `fetchTickets` result alongside the
      existing `pages` field.
- [x] 1.6 Export `MAX_TICKETS` and `stateTypesFromConfig` from the module.

## 2. `lib/ui/cache.js` — persisting `truncated`

- [x] 2.1 `write()`: include `truncated: Boolean(data && data.truncated)` in
      the persisted payload.
- [x] 2.2 `read()`: on the success path, default `truncated` to `false` when
      absent or non-boolean, matching the existing `epics`/`teamKey`
      defaulting pattern. Do not bump `CACHE_SCHEMA_VERSION` (design.md
      Decision 4).

## 3. Wiring the launch pad

- [x] 3.1 `lib/ui/watch.js#refreshLaunchPad`: pass
      `stateTypes: linear.stateTypesFromConfig(opts.config)` into the
      `fetchTickets` call.
- [x] 3.2 `lib/ui/screens/launchpad.js#headerLine`: when `lp.cache.truncated`
      is true, append a `(truncated — more available)` marker next to the
      open-ticket count.

## 4. Config surface

- [x] 4.1 `config/concertino.schema.json`: add `dashboard.launchPad.backlog`
      (`boolean`, default `true`) with a description referencing the
      backlog-exclusion behaviour.
- [x] 4.2 `docs/dashboard.md`: document `MAX_TICKETS`, the truncation marker,
      and `dashboard.launchPad.backlog` (default and opt-out effect) in the
      launch pad "Configuration" section.
- [x] 4.3 `docs/dashboard.md`: rewrite the existing "Comments are capped"
      section (currently: "Comments are the only unbounded axis in the
      payload" and "A busy team is the case the cap exists for") so it no
      longer overclaims — describe `COMMENT_LIMIT` as insurance against a
      single pathological thread, and correct the stale "six open tickets...
      ~10 KB" figure to match `ticket.md`'s actual measurement (7 tickets /
      15.5 KB).

## 5. Tests (fixtures only — no network)

- [x] 5.1 `test/linear.test.js`: `MAX_TICKETS` value and that a fetch under
      the cap returns everything with `truncated: false`.
- [x] 5.2 `test/linear.test.js`: a fetch that would exceed the cap stops at
      exactly `maxTickets` tickets, requests no further pages past the
      cap-crossing one, and sets `truncated: true`.
- [x] 5.3 `test/linear.test.js`: a fetch landing exactly on the cap with no
      further Linear page and no overshoot sets `truncated: false`.
- [x] 5.3a `test/linear.test.js`: a fetch whose cap-crossing page overshoots
      `maxTickets` but reports `hasNextPage: false` still sets
      `truncated: true` and returns exactly `maxTickets` tickets (design.md
      Decision 3 overshoot case; use a small `maxTickets` fixture rather than
      the real 500 so a single page can exercise it).
- [x] 5.4 `test/linear.test.js`: `stateTypesFromConfig` — default/absent
      config includes backlog; `backlog: false` excludes it; any other value
      (e.g. `backlog: true`, missing `dashboard`) preserves default.
- [x] 5.5 `test/cache.test.js`: `write`/`read` round-trip `truncated: true`
      and `truncated: false`; a pre-existing cache file with no `truncated`
      field reads as `false`. Update the existing "write of an empty result"
      assertion for the new field in the round-tripped shape.

## 6. Verification

- [x] 6.1 Run the full test suite; all new and existing tests pass.
- [x] 6.2 `openspec validate --changes bound-ticket-cache-by-count` passes.
