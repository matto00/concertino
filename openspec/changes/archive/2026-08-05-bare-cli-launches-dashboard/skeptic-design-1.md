## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/cli-default-command/spec.md` in full.
- Cross-checked the Linear ticket (`mcp__linear__get_issue CON-59`) against
  `ticket.md` — text matches; no drift between the two.
- Read the actual current `bin/concertino` (69 lines). Confirmed:
  - `const cmd = args._[0] || 'help';` (line 40) is exactly what design.md's
    Decision 1 targets, and the dispatch chain's `else if (cmd === 'watch') await
    cmdWatch(args);` / final `else help();` means changing the default to
    `'watch'` routes correctly with no other code touched — mechanically sound.
  - `args.version` is checked before `cmd` is used (line 41) and `help` has no
    explicit `cmd === 'help'` branch — it falls through to the final `else
    help()`, unaffected by the default change. Confirms design.md Decision 2's
    claim.
  - Note: the ticket's own cited line numbers (`bin/concertino:1830-1853`,
    `:1130-1139`, `:1740-1827`, `:1835-1848`) are stale — the file is only 69
    lines post the CON-58 split into `lib/cli/*.js`. Not a design flaw: design.md
    and proposal.md independently re-derive the correct current locations
    (`bin/concertino:22-69`, `lib/cli/watch.js`), so the plan is grounded in
    reality, not the ticket's stale references.
  - `lib/cli/watch.js` (18 lines) — confirmed `cmdWatch(args)` already resolves
    `--out`/`--config` exactly as design.md describes; reusing it via the single
    dispatch-default change (rather than a duplicate call site) is sound and
    matches Decision 1's stated rationale.
- Read `lib/cli/completion.js`: `CMDS = ['init','sync','update','validate',
  'diff','doctor','upgrade','gates','watch','completion','help']` — confirmed
  `prune`, `eject`, `migrate`, `answer` are indeed absent, matching the
  proposal/design's audit-fix claim exactly.
- Read `lib/cli/help.js`: confirmed every dispatched subcommand except
  `answer` has an entry — matches the claimed gap exactly.
- Searched `test/` for any test asserting on `bin/concertino`'s dispatch
  default string — none exists, consistent with tasks.md 4.2's conditional
  phrasing ("if one exists").
- Read `docs/repo-audit-2026-08.md` as the cited precedent for
  `docs/cli-audit-2026-08.md`'s format — confirmed it exists and uses the
  finding → fixed-inline-or-follow-up structure the design references.
- **Found an uncovered discoverability surface**: `README.md`'s `## CLI
  reference` section (lines 82–136) is a third, independent full listing of
  every subcommand — a near-verbatim duplicate of `lib/cli/help.js`'s text,
  clearly meant to be kept in sync with it (compared both side by side; the
  usage lines and descriptions match nearly word-for-word). It is **missing
  both `answer` and `prune`** (checked via `grep -n "answer\|prune" README.md`
  against the CLI reference block — neither appears). It also documents
  `concertino watch` (line 111) as the way to launch the dashboard, with no
  mention of the new bare-invocation default.
  - This is exactly the class of gap the ticket's own acceptance criteria
    call out ("commands that exist but aren't discoverable... e.g. from
    top-level `help`") — README.md's CLI reference is a second
    top-level-help-equivalent surface (it's the first thing a new user or
    `npm` page visitor reads) that neither `proposal.md`'s Impact section,
    `design.md`, nor `tasks.md` (sections 2 or 3) mention updating. The scope
    as currently planned would ship with `lib/cli/help.js` and
    `lib/cli/completion.js` corrected while `README.md` — arguably the most
    visible of the three — stays wrong on both the `answer`/`prune` gap and
    the new bare-invocation behavior.
  - Grepped the rest of the repo (`docs/`, `CONTRIBUTING.md`,
    `.claude-plugin/`) for a similar full-command listing — found none other
    than README.md, so this is a single, bounded, mechanically-fixable gap
    (same character as the two already-planned fixes), not scope creep.

### Verdict: REFUTE

### Change Requests

1. Add `README.md`'s `## CLI reference` section to this change's scope
   alongside `lib/cli/help.js` and `lib/cli/completion.js`:
   - Add a `concertino prune` and `concertino answer` entry to the block
     (currently spans `README.md:84-134`), matching the existing entries'
     format, to close the same discoverability gap already being fixed in
     `help.js`/`completion.js`.
   - Update the `concertino watch` entry (`README.md:111-113`) or the
     surrounding prose to note that bare `concertino` is now the primary way
     to launch the dashboard, consistent with design.md Decision 3's
     treatment of `lib/cli/help.js` and `docs/dashboard.md`.
   - Reflect this in `proposal.md`'s Impact section and `tasks.md` section 2/3
     so it isn't dropped during implementation.

### Non-blocking notes

- `tasks.md` 3.1's one-line note in `docs/dashboard.md` and Decision 3's
  "bare form documented first, `watch` noted as alias immediately after" are
  both sound and consistent between design.md and tasks.md — no changes
  needed there beyond applying the same treatment to README.md per above.
- The Non-Goals in design.md (no per-subcommand `--help`, no flag-naming
  rename) are appropriately scoped against the ticket's own scope-check
  clause and don't need revision.
