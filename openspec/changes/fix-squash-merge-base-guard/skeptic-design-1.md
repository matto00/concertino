## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **Artifacts read in full**: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/delivery-squash-guard/spec.md`, `workflow-state.md`.

- **D1 (merge-base reset) — sound.** `git merge-base HEAD <base-ref>` is the
  correct reset target; commits the base gained after divergence cannot be
  staged. Satisfies AC3.

- **D3 (log, don't force rebase) — sound; NOT a wave-off.** I checked the
  ticket's direction against what the squash is actually for. The squash's
  output is a PR that GitHub merges with a 3-way merge against the then-current
  base; the branch does not need to contain the base tip for that to be correct.
  Once D1 is in place, a rebase buys no safety and adds real conflict-resolution
  surface mid-run (design.md's own argument). AC2 says base advancement must be
  "detected explicitly rather than absorbed" — with D1 it is no longer absorbed
  (the reset target is no longer the live tip), and the explicit log covers
  "detected". I confirm D3.

- **D2 (files-modified.md as the guard's source of truth) — REFUTED on real
  data.** The design asserts files-modified.md is "guaranteed fresh at squash
  time" with "no false-negative risk". I did not take that claim; I read the
  executor definition and four real files-modified.md files from history.
  - `core/roles/executor.md:72-82` — the executor writes it at step 4, then
    step 7 commits **all** changes from the worktree. Reports and state written
    after that step are never in it.
  - Real committed examples (helio history):
    - `151bad1b` — clean path list, and it *does* include the change-dir docs.
    - `8359d181` — lists exactly **one** file, yet the branch also committed the
      whole `openspec/changes/<name>/` dir.
    - `e56cccf2` — free prose header + path list.
    - `a194152c` — free-form prose, 83 backticked spans, most of which are
      **not paths** (`find backend/src/test/scala -name '*.scala' | wc -l`,
      `git status --short backend/src/test`, `com\.helio\.testutil`), and the
      190 relocated files are summarised as a count, **not enumerated**.
  - Consequence: the file has no enforced schema, inconsistent coverage, and
    systematically omits everything committed after the executor's last cycle.
- **What the staged set actually contains at squash time.** Phase 3 step 2
  (`lib/cli/render.js:94-118`) archives as a **separate commit after** the
  squash, so step 1's staged set is the pre-archive branch content: source files
  **plus** `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `specs/**`,
  `.openspec.yaml`, `workflow-state.md`, `files-modified.md`, and every
  `skeptic-design-*.md` (which exist *before* execution starts and are therefore
  swept into the executor's cycle-1 "commit all changes"), plus prior cycles'
  `evaluation-*.md`. Corroborated by the real squash+archive file list of
  `6699214` (CON-133), which carries 13 such change-dir/spec paths.
  The design excludes exactly one of these (`files-modified.md` itself).
  **The guard as specified therefore trips on essentially every ordinary run.**
  A guard that fires on every green run is not a safety net — it is a step
  operators learn to bypass, which is how this class of guard dies.

- **Verification standard (tasks.md §3) — partially concrete, gaps named below.**
  3.3/3.4 correctly invoke the real script by subprocess and prove red by
  reverting only that file — that is the right shape for the inline-copy trap
  the ticket warns about. But 3.4's expected-red is written as a disjunction
  ("either it wrongly commits the revert, or ... silently passes when it should
  not"), which is not a falsifiable assertion, and nothing wires the new test
  into `package.json`'s `"test"` script, which is an **explicit** list of 31
  named `test/scripts/*.test.sh` invocations — an unlisted test never runs.

- **Ground-truth error in the artifacts' premise.** design.md's Context,
  proposal.md's Impact, and tasks.md 2.1 all describe replacing an inline
  `git reset --soft origin/main` in `core/agents/orchestrator.md`. Neither
  exists: there is no `core/agents/` directory (it is `core/roles/`), and
  `core/roles/orchestrator.md:775` reads only "**Squash all branch commits**
  into one with subject ... and trailer ...". `grep -rn "reset --soft"` across
  `core/`, `lib/`, `scripts/`, `.claude/` returns **no** orchestrator hit. The
  real root cause is that the prose specifies no mechanism at all, so the agent
  improvised `reset --soft origin/main`. Task 2.1 cannot be performed as written.

- **Sync/render pipeline — task 2.2's assumption holds.** `lib/cli/emit.js:426`
  and `lib/cli/resolve-core.js:58-66` enumerate `core/scripts` via
  `listFilesRecursive`, so a new `core/scripts/squash-branch.sh` renders with no
  pipeline change. Verified, no revision needed.

- **Scope creep — clean.** No artifact touches `cleanup.sh`,
  `check-merge-readiness.sh`, fast-forward logic, or version-stamping.
  CON-128/131/132/121/HEL-764 appear only as declared non-goals. CON-133's
  landed work (`lib/git-child-env.sh`, `listFilesRecursive`,
  `CONCERTINO_CLEANUP_SKIP_SYNC`) is untouched.

### Verdict: REFUTE

### Change Requests

1. **Fix D2's declared-file set — the guard as specified false-positives on
   every run.** `files-modified.md` alone cannot be the comparison set. Revise
   design.md D2 and tasks.md 1.4 so the guard compares the staged set against
   `files-modified.md` **union an explicit workflow-artifact allowlist** that
   covers the whole change dir (`openspec/changes/<CHANGE_NAME>/**` — including
   `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `.openspec.yaml`,
   `specs/**`, `workflow-state.md`, `evaluation-*.md`, `skeptic-*.md`,
   `files-modified.md`). State the allowlist literally in the design; do not
   leave it to the executor to infer. Ground this against the real evidence
   above (commit `6699214`'s file list), not against the current claim that
   files-modified.md is complete.

2. **Specify how `files-modified.md` is parsed, and what happens when it is not
   parseable.** Real instances range from a bare `` - `path` — rationale ``
   list (`151bad1b`) to free-form prose whose backticks are mostly shell
   commands and regexes (`a194152c`). Define the extraction rule (e.g. only
   leading `- \`...\`` at line start; ignore backticks elsewhere) and define the
   behaviour when extraction yields zero paths while the staged set is
   non-empty. The `--allow-empty-declaration` opt-in currently only covers a
   *missing* file, not a *prose* one.

3. **Handle the "declared as a summary, not enumerated" case.** `a194152c`
   declares 190 moved files as a count. Decide explicitly (design.md) whether
   such a run is expected to trip the guard and be resolved by the operator
   appending paths, or whether the executor's handoff contract must first be
   tightened to require enumeration. Either is acceptable; leaving it
   unaddressed ships a guard that blocks a legitimate class of change.

4. **Correct the artifacts' factual premise.** Update design.md Context,
   proposal.md Impact, and tasks.md 2.1 to the real ground truth: the path is
   `core/roles/orchestrator.md` (there is no `core/agents/`), and Phase 3 step 1
   (line 775) contains **no** git command — it is unspecified prose that let the
   orchestrator improvise `git reset --soft origin/main`. Task 2.1 should read
   as "replace the unspecified squash prose with a call to
   `scripts/concertino/squash-branch.sh`", so the executor is not hunting for a
   string that does not exist.

5. **Wire the new test into `package.json`.** Add a task: the acceptance test
   must be added to the `"test"` script's explicit invocation list (it is a
   hand-maintained chain of 31 `bash test/scripts/*.test.sh` calls — nothing
   auto-discovers). Also settle 3.1's "or an equivalent test file": the repo's
   convention for script tests is `test/scripts/<name>.test.sh`; `core/scripts/
   *.selftest.sh` is the *rendered-artifact* selftest convention
   (`lib/git-child-env.selftest.sh`). Pick one and name it.

6. **Make tasks.md 3.4's red-proof falsifiable.** Replace the disjunctive
   expectation with a per-scenario assertion, e.g. "with the naive
   `reset --soft <base-tip>` restored, scenario 3.3 MUST fail with the sibling
   commit's file appearing in the squash commit's `--name-only` output" and
   "with the guard block deleted, scenario 3.5 MUST fail by exiting 0 and
   creating a commit". Also assert the harness executes the repo-path file
   `core/scripts/squash-branch.sh` (e.g. mutate that exact path in place under a
   restoring `trap`), so the inline-copy trap the ticket names is structurally
   excluded rather than merely intended.

7. **Add spec scenarios for the above.** `specs/delivery-squash-guard/spec.md`'s
   guard requirement needs scenarios for (a) a workflow artifact staged but not
   named in `files-modified.md` → proceeds (allowlisted), and (b) a
   `files-modified.md` from which no paths can be extracted → loud stop, not a
   silent skip.

### Non-blocking notes

- D3 is confirmed as sound — do not let CR-4's rewrite drift into reintroducing
  a forced rebase. Record in design.md *why* AC2 is met without one (the reset
  target is no longer the live tip, so advancement is no longer absorbed).
- `git merge-base` returns one base arbitrarily under criss-cross history.
  Consider `git merge-base --all` and a loud stop when it returns more than one.
- Phase 3 step 2's archive commit is created *after* the guarded squash and is
  not covered by this guard. Correct for this ticket's incident; worth one
  sentence in design.md so the coverage boundary is deliberate rather than
  accidental.
- This repo self-hosts `scripts/concertino/`; `squash-branch.sh` will not exist
  there until a `sync` runs (correctly forbidden by task 2.2). Expect the
  orchestrator's own next run here to fall back to prose until then.
