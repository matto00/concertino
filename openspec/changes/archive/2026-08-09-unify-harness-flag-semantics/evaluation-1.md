## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS
Issues: none.

- Ticket (CON-84, `docs/cli-audit-2026-08.md` finding 3) asked to unify `--harness`
  semantics between `sync`/`diff` (comma-list) and `eject` (single-value strict
  equality). Implementation delivers exactly that: a shared `parseHarnessList`
  helper (`lib/cli/shared.js`) used by all three commands, and `eject` now
  accepts and meaningfully acts on a comma-separated list.
- All design.md decisions (1–6, including the 5a/5b split for global-role-vs-
  codex-specific-role validation that the design's own skeptic gate flagged)
  are implemented as specified — verified against `lib/cli/eject.js`'s diff.
- All 23 items in `tasks.md` are marked `[x]` and each one's corresponding
  code/test change is present in commit `e52002d` (verified line-by-line
  against the diff, not just the checkbox).
- No scope creep: `git show e52002d --stat` touches only
  `README.md`, `lib/cli/{diff,eject,help,shared,sync}.js`,
  `test/cli-shared.test.js`, `test/eject.test.js`, and the change's own
  openspec artifacts. (Note: `git diff main...HEAD` on this worktree also
  shows unrelated CON-99/CON-97 commits as ancestors of this branch tip —
  those are pre-existing history from before this branch was cut, not part
  of this commit; reviewed `git show e52002d` in isolation instead, per the
  task instructions.)
- No regressions: full `npm test` passes (1739 node `--test` cases + all
  bash gate suites, 0 failures), including
  `test/scripts/opencode-render.test.sh`'s pre-existing
  `eject --harness=opencode --role=$role` calls (task 5.7), confirming the
  single-harness path is unaffected.
- No API/schema contracts affected beyond the documented `--harness` CLI
  flag semantics; `lib/cli/help.js` and `README.md` both updated to match
  (per tasks 4.1/4.2 — help.js uses `claude-code[,codex,opencode]` bracket
  notation, README uses `claude-code,codex,opencode` to match sync/diff's
  existing style; this divergence is intentional and specified separately by
  tasks 4.1 and 4.2, not an inconsistency).
- `specs/cli-harness-flag/spec.md`'s five requirements/nine scenarios all
  have a corresponding implementation path and, for the observable ones, a
  corresponding subprocess test in `test/eject.test.js` / `test/cli-shared.test.js`.

### Phase 2: Code Review — PASS
Issues: none blocking.

Gates re-run fresh in `WORKTREE_PATH` (no `CLEAN_WORKTREE` — not `slow` speed):
- `npm test` → exit 0. 1739 `node --test` cases pass (0 fail), all 29 bash
  gate scripts in the `test` script chain pass, including
  `opencode-render.test.sh`.
- Manual sanity check (mirrors task 6.2):
  `node bin/concertino eject --role=executor --harness=claude-code,codex,opencode --out=<tmp>`
  against `config/examples/generic.json` produces three sections, each with
  its own `# ---- harness: <name> ----` header, in the given order — matches
  Decision 4/spec.md.

Code-quality checks (no canonical standard configured for this project —
reviewed against general DRY/readability/modularity/type-safety/error-
handling/test criteria):
- **DRY**: `renderForHarness()` extraction removes the previous duplicate
  `agents.json` re-reads in the old codex/opencode branches (each branch
  independently `JSON.parse(read(...agents.json))`'d before this change);
  now read once in `cmdEject` and passed as `meta`. `KNOWN_HARNESSES` in
  `lib/cli/shared.js` replaces three separately-hardcoded three-name lists
  design.md flagged as a real (if low-severity) pre-existing risk.
- **Readable**: `parseHarnessList`, `renderForHarness`, and the `results`
  loop in `cmdEject` are self-explanatory; the design-decision comments
  (Decision 1, 5a, 5b references) in `shared.js`/`eject.js` are appropriately
  terse and point at the design doc rather than re-deriving the rationale
  inline.
- **Modular**: role-validity (global, once) is now cleanly separated from
  per-harness capability (codex's narrower role set) exactly as
  design.md Decision 5a/5b specify — this was the specific defect the
  design's own skeptic gate caught in an earlier draft, and the split is
  correctly present in the shipped code.
- **Type safety**: N/A (plain JS, no gradual typing in this codebase); no new
  untyped escape hatches introduced.
- **Error handling**: every new failure path (`parseHarnessList`'s `error`,
  the global role check, the all-skipped-harnesses case) follows each
  command's pre-existing `console.error(red('error: ') + ...); process.exit(1);`
  convention; no silent failures introduced. `parseHarnessList` itself stays
  a pure function (never exits), matching design.md Decision 1's explicit
  testability rationale.
- **Tests meaningful**: `test/cli-shared.test.js` exercises the helper's
  boundary cases (whitespace, trailing/repeated commas, single vs. multiple
  invalid entries, empty/undefined fallback). `test/eject.test.js` covers
  byte-for-byte single-harness parity, multi-harness headered output,
  codex-skip-but-overall-success, the 5a/5b split (globally-invalid role vs.
  codex-specific-unsupported role, both single- and multi-harness), and
  `bogus`-harness rejection across all three commands — these would catch a
  real regression in any of the paths they name.
- **No dead code**: no leftover TODO/FIXME, no unused imports (`sync.js`
  newly imports `red`, which it now uses; `diff.js`/`eject.js` newly import
  `parseHarnessList`, which they use).
- **No over-engineering**: the shared helper is a single small pure function;
  no premature abstraction beyond what three call sites needed.
- **Minor, non-blocking observation**: `cmdEject`'s new check ordering
  validates `--harness` (via `parseHarnessList`) *before* the `!exists(cfgPath)`
  check, whereas previously an invalid-harness error could only surface
  after the config-exists check (since the old code's harness dispatch was
  reached only after config was loaded). Neither the ticket, design, nor
  spec.md specifies precedence between "no config" and "unknown harness"
  errors, and no test depends on the old ordering, so this isn't a
  regression against any stated requirement — noted for awareness only.

### Phase 3: UI Review — N/A
This is a CLI-only change with no UI review configured for this project, per
task instructions.

### Overall: PASS

### Non-blocking Suggestions
- Consider documenting (e.g. a one-line comment in `cmdEject`) that
  `--harness` validation now intentionally runs before the config-existence
  check, if that ordering is meant to be permanent, so a future refactor
  doesn't accidentally reorder it back without noticing it's now
  load-bearing for anything.
