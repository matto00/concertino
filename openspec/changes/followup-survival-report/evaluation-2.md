## Evaluation Report — Cycle 3 (evaluation-2.md)

Scope: task 7.1's REFUTE fix (`lib/cli/report.js`) and the newly-added
`verification-vacuity-analysis` capability (`docs/verification-vacuity-2026-09.md`
+ `specs/verification-vacuity-analysis/spec.md`, 5 requirements). Cycle 1's
PASS on the survival-report half stands; re-checked only incidentally via the
full test run and `files-modified.md` diff match, and found intact.

### Phase 1: Spec Review — PASS

- Ticket's `ADDED SCOPE` section (enumerate+classify, test the candidate
  signature, state the detection rule with limits, recommend-not-implement,
  acceptance bar of a control on every count) is addressed point-for-point in
  the artifact's §B–§G structure.
- All 5 `verification-vacuity-analysis` requirements independently re-checked
  against the artifact:
  - **R1 (evidence-per-instance)**: all 14 §B entries state verifying
    evidence or are marked PARTIALLY VERIFIED with the unreproducible part
    named (#2). #7 and #8 are explicitly marked CORRECTED with the original
    framing stated as wrong, not repeated. PASS.
  - **R2 (signature tested, not adopted)**: §C states non-disjointness (#5,
    #9, #13 dual-shape), restates shape (c) with reasoning, and adds shape
    (f) for #8 which resists all five original shapes. PASS.
  - **R3 (detection rule states its limits)**: §D lists each of the 8 missed
    instances individually with its own escape reason (never summarised),
    and the 6/8 split is quantified against the enumerated 14. Verified the
    partition arithmetic myself: 6+8=14, sets disjoint, union = {1..14}. PASS.
  - **R4 (every figure carries a control)**: every §F count has an adjacent
    discriminating control (impossible-needle → 0, a known-present control
    that must differ). Re-ran all of them (below). PASS.
  - **R5 (recommend, don't implement)**: §G's six items are prose-only;
    confirmed `git diff` touches neither `test/scripts/` nor
    `lib/cli/doctor.js` (S1/S2's targets). No Linear tickets filed, matching
    the deliberate-gap note. PASS.
- No AC silently reinterpreted; no scope creep — the diff's file set exactly
  matches `files-modified.md`'s declared list (`git diff 5a8edb8...HEAD
  --name-only` vs. the handoff, verified line-for-line).
- C6 grep (case-insensitive) confirms "ambient-state contamination" appears
  only as retraction language at three sites (lines 183, 237, 272/278) —
  never as the shape's name (shape is named "(f)" throughout).

### Phase 2: Code Review — PASS

Fresh gate run in `WORKTREE_PATH` (no `CLEAN_WORKTREE` set):

- `npm test` (full suite, `timeout: 600000`, no `-n`): **rc=0, `# tests 2365`,
  `# pass 2365`, `# fail 0`**. No `diff-coverage.test.js` / `renderEnv` flake
  hit. Matches the claimed baseline.
- `openspec validate "followup-survival-report" --type change`: `Change
  'followup-survival-report' is valid`, exit 0. Requirement counts confirmed
  by grep: `specs/followup-survival-report/spec.md` = 11, 
  `specs/verification-vacuity-analysis/spec.md` = 5.
- **Task 7.1 fix, independently re-verified for failability** (the
  acceptance bar): diffed `8ec49c7:lib/cli/report.js` against the fixed
  version — confirms `"...this run's own filing is the exception; see
  below)."` was removed and replaced with a comment explaining why (present-
  tense claim false whenever the branch fires) plus corrected prose. I then
  restored the **pre-fix** file body into the worktree and ran
  `node --test test/cli-report.test.js`: **26 passed, 1 failed** — confirms
  the regression test genuinely reds against the old code. Restored the
  fixed file immediately after; `git status --short lib/cli/report.js` shows
  no diff. `test/cli-report.test.js` alone: 27/27 pass on the actual HEAD.
- §F's computed figures, all re-derived independently with my own
  needle/root choices (not copies of the artifact's commands):
  - `hasnt()` helper files under `test/scripts/`: **14** (artifact: 14).
    Impossible-name control: **0**.
  - Files whose `hasnt` definition line swallows stderr: my own
    independently-written check (definition-line + 2 lines, grep for
    `2>/dev/null`) → **9** — matches the artifact's corrected 9, not the
    ledger's stale 8, and is a genuinely different needle shape from the
    artifact's own second check, so this is real corroboration, not an
    echo. Confirmed `test/scripts/` is unchanged since `5a8edb8` via both
    `git diff --name-only` and `git status --short` (both empty) — the 8→9
    gap is a ledger miscount, not drift, exactly as claimed.
  - `doctor.js` `fail(`/`warn(` counts: **5** / **19**, matches ledger and
    artifact exactly. `function fail`-style presence check: literal `const
    fail = ...` assignment found (1 hit), matching the artifact's "its
    assignment" wording.
  - Auditor mention count: narrow root (`openspec/changes/`) → **4** files
    total, **0** would match under that scope (artifact's retracted
    figure); wide root (`.concertino/runs/*/evidence/`) → **69** auditor
    files, **11** match `vacuous|vacuity` case-insensitively. Exact match
    to the artifact's corrected 11/69 and its account of the 0→11 gap being
    a search-root scope artifact, not drift.
  - Skeptic/evaluation/planning mention counts, independently re-run against
    `.concertino/runs/*/evidence/`: skeptic **41/297**, evaluation
    **21/110**, planning (proposal.md+design.md+tasks.md) **18/249** — all
    match the artifact exactly. Controls reproduced: impossible needle → 0;
    "the" across all 297 skeptic reports → 297/297.
  - All figures in §F therefore verify exactly as stated, including the
    artifact's own disclosure that they differ from `class-evidence.md`'s
    54/25/0/22 and the three-way attribution of why (needle drift vs.
    search-root correction vs. ledger miscount) — I could not find a case
    where that attribution was wrong.
- Canonical standards: no CONTRIBUTING.md violations found in the diff (docs
  artifact + a small, well-commented code change). DRY/readable/modular:
  the report.js fix is a minimal, correctly-scoped comment+prose change; no
  dead code, no new TODO/FIXME introduced.
- No regressions: full suite green, `git status` shows only the orchestrator-
  owned `workflow-state.md` phase-bookkeeping edit (pre-existing when I
  started, not touched by me) and no other stray modification.

### Phase 3: UI Review — N/A

CLI + docs artifact only; no `frontend/**`, `ApiRoutes.scala`, `schemas/**`,
or `openspec/specs/**` changes. No dev servers started.

### Overall: PASS

### Non-blocking Suggestions

- §F's per-callsite `hasnt` figure (14 files / 5 with no existence guard) is
  explicitly flagged by the artifact itself as a coarser per-file heuristic
  than the ledger's callsite-level classification — already disclosed
  appropriately, no action needed, just noting I did not attempt to
  independently re-derive the callsite-level figure (the artifact doesn't
  either, and says so).
- The stray `.openspec.yaml` file in the diff (not listed in
  `files-modified.md`) appears to be openspec-tooling-generated boilerplate
  (`schema: spec-driven`, `created: 2026-09-16`) rather than an undisclosed
  content change; harmless, but a future `files-modified.md` could mention
  tooling-generated files explicitly to keep the declared-set-equals-diff
  invariant airtight.
