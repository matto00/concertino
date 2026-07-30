## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
  `specs/evidence-telemetry/spec.md` in full at
  `WORKTREE_PATH/openspec/changes/fix-persist-evidence-path-collision/`.
- Read the current implementation, `core/scripts/persist-evidence.sh` (87 lines), to confirm the
  design's description of the bug (`DEST_PATH="${DEST_DIR}/${BASENAME}"` at line 79, `cp -f` at
  line 81 with no collision check) matches ground truth.
- Read the existing test suite, `test/scripts/persist-evidence.test.sh` (95 lines), to check which
  existing assertions hardcode a destination path and would need to change vs. survive unmodified.
- Traced every acceptance criterion in `ticket.md` against `design.md`'s Decisions section and
  `spec.md`'s five new/modified scenarios — each AC maps to a specific scenario:
  - "distinct destinations for differing paths" → spec.md's "Two same-named artifacts from
    different directories persist to distinct destinations" scenario.
  - "idempotent re-persist of the same source" → spec.md's existing "Re-persisting the same
    artifact is idempotent" scenario, unchanged, and design.md's "Idempotency is preserved for
    free" argument (DEST_PATH is a pure function of SOURCE_PATH's resolved absolute path).
  - "unresolvable collision reports FAIL" → spec.md's "A source path outside any git working tree
    fails rather than risking a collision" scenario; design.md's Decisions correctly note that
    because the worktree-relative-path scheme is a prefix-strip of a unique absolute path, it is
    injective within a single worktree — the *only* case that can't be resolved safely is "no
    worktree to be relative to," which is exactly what's checked.
  - "tests cover the two-deltas-named-spec.md case end to end" → tasks.md 3.1.
- Checked the claim in design.md's Risks/Trade-offs ("every existing test places its source file
  directly at the worktree/repo root, so the worktree-relative path equals the basename in every
  existing case") against the actual test file line by line: test 1 (`$REPO/wt/proposal.md`,
  worktree root `$REPO/wt`), test 2 (`$REPO/wt/design.md`), test 4/5 (`$REPO/report.md`,
  `$REPO/source.md`, repo root `$REPO`) — in every case the file sits directly at its worktree's
  top level, so relative-path-from-toplevel reduces to the basename. Only test 1's assertion
  hardcodes an exact expected `DEST_PATH` string (`.../evidence/proposal.md`); it will still hold
  under the new scheme. This claim is correct.
- Checked for a downstream consumer that might assume a flat (non-nested) `evidence/` directory
  and break once destinations gain subdirectory structure: grepped the TUI's evidence-reader code
  (`lib/ui/screens/drilldown.js`, `docview.js`) — it opens `ev.ref` (the full path printed by
  `READY ref=`) directly; it never lists or globs the `evidence/` directory by basename. No
  contract update is needed there, and none was claimed to be needed.
- Checked `core/scripts/README.md` / `scripts/concertino/README.md`'s one-line description of
  `persist-evidence.sh` — it describes behavior ("copies an artifact into
  `.../evidence/`") at a level of detail that remains accurate after the fix; no stale doc update
  is missing from tasks.md.

### Verdict: CONFIRM

The design is internally consistent (proposal, design, tasks, and spec delta all describe the same
scheme), each ticket AC traces to a concrete design decision and spec scenario, and the chosen
"strip the git worktree toplevel prefix" scheme is provably collision-free within a single
worktree (a prefix-strip of unique absolute paths is injective), which is exactly what AC3 ("a
collision that cannot be resolved safely reports FAIL") requires interpreting correctly, and the
design does interpret it correctly — the only genuinely unresolvable case is "not inside any git
working tree at all," which is the one it fails on. No placeholders, no deferred decisions that
block implementation, no scope drift, and the alternatives considered (hash/counter suffix, full
absolute path, hardcoded prefix strip) are each given a concrete, checkable reason for rejection
rather than hand-waved.

### Non-blocking notes

1. Implementation detail not spelled out in design.md: stripping the toplevel prefix from
   `SRC_ABS` (e.g. via `${SRC_ABS#"$TOPLEVEL"/}`) must quote `$TOPLEVEL` in the parameter
   expansion, or a toplevel path containing shell glob metacharacters (`*`, `?`, `[`) would be
   interpreted as a pattern rather than a literal prefix. Extremely unlikely to bite given this
   repo's actual paths, but worth a one-line callout to the executor since it's the one subtlety
   design.md's decisions don't spell out.
2. Design.md's Risk #1 mitigation is scoped to "a `SOURCE_PATH` outside any git working tree" but
   there's an adjacent, pre-existing (not newly introduced) case it doesn't call out: retrying the
   *same ticket* from a fresh worktree reproduces the identical worktree-relative path for the same
   logical artifact (e.g. `proposal.md`) across two unrelated attempts, and the new scheme's
   idempotency-by-construction means the second attempt's evidence silently overwrites the first's
   — same class of problem this ticket fixes, just at attempt-granularity instead of
   within-one-run-granularity. This is unchanged from current (basename-only) behavior, so it's not
   a regression and is legitimately out of this ticket's scope, but it wasn't flagged as a known
   follow-up anywhere in the artifacts. Worth a one-line note in design.md's Risks section or a
   ticket follow-up, not a blocker to this design.
3. Ordering between the new "source not inside a git working tree → FAIL" check and the
   `mkdir -p` for the destination directory isn't specified in design.md; depending on
   implementation order, an empty `evidence/` directory could be created even on that FAIL path
   (unlike the invalid-`TICKET_ID` case, which the spec explicitly requires to leave no
   filesystem trace). The spec doesn't require "no side effect" for this particular failure mode,
   so this isn't a contract violation — just worth the executor picking an order deliberately
   rather than by accident.
