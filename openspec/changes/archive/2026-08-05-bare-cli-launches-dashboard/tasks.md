## 1. Bare invocation launches the dashboard

- [x] 1.1 In `bin/concertino`, change `const cmd = args._[0] || 'help'` to
      `const cmd = args._[0] || 'watch'`. Confirm `args.version` and the
      `help` fallthrough (`else help()`) are otherwise untouched.
- [x] 1.2 Grep `scripts/`, `package.json`, and any CI config for a bare
      `concertino` invocation with no subcommand and confirm none exists
      (per design.md's risk mitigation).

## 2. Discoverability fixes found by the audit

- [x] 2.1 Add `prune`, `eject`, `migrate`, `answer` to `lib/cli/completion.js`'s
      `CMDS` array and `DESC` map (fish/zsh/bash completions all read from
      the same tables, so one edit covers all three shells).
- [x] 2.2 Add a `concertino answer` entry to the top-level help text in
      `lib/cli/help.js`, matching the existing entries' format (usage line +
      short description).
- [x] 2.3 Update `lib/cli/help.js` to document bare `concertino` as the
      primary way to launch the dashboard, with `concertino watch` noted as
      the explicit alias immediately after (per design.md Decision 3).
- [x] 2.4 Update `README.md`'s `## CLI reference` section (currently
      `README.md:82-134`): add a bare-`concertino` entry (primary form) and
      `concertino watch`'s note that it's an alias, plus missing
      `concertino prune` and `concertino answer` entries — the same
      discoverability gap as 2.1/2.2, on README's independent listing.

## 3. Docs

- [x] 3.1 Add a one-line note near the top of `docs/dashboard.md` that bare
      `concertino` (no subcommand) is equivalent to `concertino watch`.
- [x] 3.2 Write `docs/cli-audit-2026-08.md`: review `init`, `sync`, `update`,
      `validate`, `diff`, `doctor`, `prune`, `upgrade`, `gates`,
      `completion`, `eject`, `migrate` for flag-naming consistency, missing
      per-subcommand `--help` support, and any other discoverability gaps
      beyond the two already fixed in section 2. Follow
      `docs/repo-audit-2026-08.md`'s format: one section per finding, each
      ending in a "fixed inline" or "follow-up" verdict with rationale.
- [x] 3.3 Filed by the orchestrator (this executor has no Linear tool
      access): finding 3 -> CON-84, finding 4 -> CON-85, finding 5 -> CON-86,
      finding 7 -> CON-87. Identifiers referenced in
      `docs/cli-audit-2026-08.md` (each finding's section, the summary
      table, and the "Follow-up tickets" closing note).

## 4. Verification

- [x] 4.1 Manually confirm (or via an existing test harness if one exercises
      `bin/concertino` dispatch) that bare `concertino`, `concertino watch`,
      `concertino help`, and `concertino --version` each produce the
      expected behavior.
- [x] 4.2 Run the project's existing test suite and lint/gate commands; add
      or update any test that asserts on `bin/concertino`'s default-command
      fallback string (`'help'` → `'watch'`) if one exists.
