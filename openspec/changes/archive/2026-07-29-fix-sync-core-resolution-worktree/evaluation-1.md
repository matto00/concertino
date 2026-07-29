## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

- All four ticket ACs addressed explicitly:
  - Worktree case renders from target's own core (verified via new test 3.1
    and independent manual repro against a throwaway repo).
  - npm-installed case unchanged (test 3.2, byte-identical assertion).
  - `doctor` unconditionally reports the resolved core path and
    auto-detected/forced status (`bin/concertino:850-851`, Decision 4;
    confirmed via manual `doctor` run).
  - New test covers the worktree case specifically, including the realistic
    npm-nested-dependency false positive from design-gate round 2 (test 3.4),
    not just the simpler unrelated-repo case (test 3.3).
- All 16 tasks in tasks.md are genuinely done, not just checked off — verified
  each task item against the diff and by independently re-running the full
  suite (35/35 new assertions pass, plus the full pre-existing suite).
- No AC silently reinterpreted. In particular, the ticket's own suggestion to
  "consider refusing" was explicitly considered and rejected in design.md
  Decision 2 (with skeptic sign-off across 3 design-gate rounds), and the
  implementation matches that decision: no refusal path exists; cores that
  differ still render successfully with a note (confirmed: `sync` exits 0
  with a printed note in both the automated test and my independent manual
  run).
- Decision 6 (cmdInit's internal cmdSync call) is genuinely implemented, not
  just described: `cmdInit` resolves `core` once (`bin/concertino:1482`) and
  passes it into both its direct `copyAssets` call (`:1483`) and the internal
  `cmdSync({...}, core)` call (`:1497`), using implementation shape (a) from
  Decision 6 (an optional `resolvedCore` second parameter on `cmdSync`,
  `:1388`). Test 3.6b independently confirms both the directly-copied law
  file and the internally-synced role file come from the same `--core` value.
- No scope creep: `git diff main...HEAD --stat` outside `openspec/` touches
  exactly `bin/concertino`, `package.json`, and the new test file — the exact
  footprint the proposal's Impact section describes.
- No regressions: full pre-existing test suite (`emit-event`,
  `persist-evidence`, `gather-escalation-context`, `assert-phase`,
  `start-servers`, `watch-smoke`, `doctor-artifacts`, `ticket-pattern`,
  `escalation-loop`, plus `node --test`) all pass unchanged.
- No API/schema contracts affected beyond the new `--core=PATH` CLI flag,
  which is documented in `bin/concertino`'s own `help()` text for all six
  commands. `docs/*.md` do not maintain an exhaustive flag-reference table for
  these commands (only illustrative usage examples), so task 4.3's own
  conditional ("if it documents sync/doctor flags") does not require further
  doc edits — checked all of `docs/*.md` for any flag-enumeration and found
  none needing updates.
- Planning artifacts (spec.md, design.md, tasks.md) accurately reflect the
  final implemented behavior; no drift between what was designed and what
  shipped.

### Phase 2: Code Review — PASS
Issues: none blocking.

- `resolveCore`'s two-part ancestry check (`bin/concertino:173-207`) correctly
  requires `repo` to be its own git working-tree root (Part 1,
  `!samePath(repoToplevel, repo)` short-circuit) before ever computing or
  comparing common-dirs (Part 2) — matches design.md Decision 1 exactly, and
  is exercised by test 3.4 (the realistic `node_modules/concertino` false
  positive) in addition to test 3.3 (wholly-independent-repo case).
- Falls back to `path.join(repo, 'core')` on any git failure or missing
  ancestry (verified by reading the fallback branches and by test 3.2/3.3/3.4
  all landing on the fallback path correctly).
- Parameter-threading reaches every call site: `grep -n '\bCORE\b'
  bin/concertino` returns zero matches (the bare module constant is fully
  removed), and `readRoleFile`, `emitClaude`, `emitCodex`, `copyAssets`,
  `checkArtifacts` are all threaded a `core` parameter, with every call site
  across `cmdSync` (:1388-1396), `cmdDoctor` (:960-961), `cmdUpdate`
  (unchanged — forwards `args` wholesale to `cmdSync(args)`, which resolves
  its own core, correctly picking up any `--core` forwarded in `args`),
  `cmdInit` (:1482-1497), `cmdEject` (:766, :780, :792), `cmdDiff` (:1024,
  :1040, :1056) updated and calling `resolveCore` once per command.
- `--core=PATH` needs no dedicated argument-parsing code beyond what already
  exists — `parseArgs`'s generic `--key=value` parser already produces
  `args.core` for free; confirmed this is sufficient and task 1.2 doesn't
  require anything more.
- DRY / readable / modular: `gitRun`/`gitTopLevel`/`gitCommonDir`/
  `normPath`/`samePath`/`coresDiffer` are small, single-purpose helpers with
  clear names; `resolveCore` reads as a direct transcription of design.md's
  pseudocode, well commented with references to the design decision it
  implements.
- Type safety: plain JS, consistent with the rest of `bin/concertino`; no new
  untyped escape hatches beyond what the file already uses throughout.
- Error handling: `gitRun` catches and returns `null` on any git failure,
  consistent with `emit-event.sh`'s existing `main_checkout()` pattern this
  design explicitly reuses; no silent swallowing beyond the deliberate
  "unavailable git = fall back to old behavior" contract set out in design.md
  risk mitigation.
- No dead code / no leftover TODO-FIXME introduced by this change (pre-existing
  gate placeholder TODOs in `bin/concertino` are unrelated and untouched).
- No over-engineering: the two-part check is exactly as complex as the design
  requires, no more.
- Behavior-preserving where expected: the ordinary same-checkout and
  npm-installed paths are provably unchanged (test 3.2 asserts byte-identical
  output to the old behavior).

Non-blocking observation (not a spec deviation — see below): `coresDiffer`
only byte-compares `scripts/`, `laws/`, and `workflow-state.template.md`
between the two cores, not `roles/`. This exactly matches what task 1.1 and
design.md's Decision 1 specify ("the same `fs.readFileSync(...).equals(...)`
byte comparison `checkArtifacts` already uses," which itself only covers
those three categories, since rendered role/agent files have no byte-
identical source to compare against). So a worktree that has only edited
`core/roles/*.md` (not `scripts/`/`laws/`) would render correctly from the
worktree's own core but print no divergence note. This is faithful to the
plan as written, not a bug in the implementation — flagged only as a
non-blocking suggestion below, since it's a real (if narrow) gap in the
"make every divergence loud" goal that a future ticket could close.

### Phase 3: UI Review — N/A
This project has no UI review configured for this change; per instructions,
Phase 3 is skipped (change is a CLI-only fix with no UI surface).

### Overall: PASS

### Non-blocking Suggestions
- Consider extending `coresDiffer` to also compare `core/roles/*.md` between
  the two cores, so a worktree that has only edited a role template (not
  `scripts/`/`laws/`) still gets a divergence note. Current scope exactly
  matches what design.md/tasks.md specified, so this is not a defect against
  the plan — just a possible follow-up if role-only divergence turns out to
  matter in practice.

### Verification performed independently (not just trusting the executor's report)
- `node --check bin/concertino` — syntax OK.
- `npm test` run in full from a clean worktree — all suites pass, including
  the new `test/scripts/sync-core-resolution.test.sh` (35/35 assertions).
- Manually built a throwaway main-checkout + worktree pair (outside this
  worktree, per the orchestrator's safety note), edited
  `core/scripts/start-servers.sh` in the worktree, ran `node
  <main>/bin/concertino sync --out=<worktree>` and `... doctor --out=<worktree>`
  directly: confirmed the rendered script contains the worktree's edit, `sync`
  printed the expected divergence note naming both core paths and exited 0,
  and `doctor` printed `core: <worktree>/core (auto-detected)` unconditionally.
- Grepped for any remaining bare `CORE` module-level reference post-refactor —
  none found.
- Confirmed `git diff main...HEAD --stat` touches exactly the files the
  proposal's Impact section describes, with no scope creep.
