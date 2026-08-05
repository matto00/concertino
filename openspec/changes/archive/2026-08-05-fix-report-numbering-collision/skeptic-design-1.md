## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and both spec deltas
  (`specs/gate-report-numbering/spec.md`, `specs/evidence-telemetry/spec.md`) in full.
- Grepped the change dir for `TODO|TBD|figure out|placeholder` — no hits. No hand-waving found.
- Cross-checked the ticket's cited mechanism against real repo state: read
  `openspec/changes/archive/2026-08-05-shared-widget-layer/` in the main checkout and confirmed
  `evaluation-1.md`, `evaluation-2.md`, `skeptic-design-1..6.md`, `skeptic-final-1..3.md` do
  live alongside `ticket.md`/`proposal.md`/etc. in the archived change dir — confirming the
  ticket's core mechanism claim (reports get archived-out and restored-in together with the
  rest of the change dir) is grounded in actual repo behavior, not speculation.
- Read `core/roles/orchestrator.md` lines 466-530 (the fold-in sub-procedure) and confirmed the
  design's cited anchors (`Phase 1 step 6` for the planning-artifact persist calls at line 216;
  the fold-in step 5's "re-create worktree" language at lines 499-504) are accurate.
- Read `core/scripts/persist-evidence.sh` in full — confirmed the current unconditional-overwrite
  behavior the design's Decision 3 says it's preserving for non-`--no-clobber` callers is
  real (`cp -f`, no existence check).
- Read `core/roles/evaluator.md` and `core/roles/skeptic.md` in full — confirmed the current
  hardcoded `evaluation-<CYCLE>.md` / `skeptic-<GATE>-<N>.md` write targets and persist-evidence
  calls the tasks propose to change are exactly as described.
- Confirmed both `evidence-telemetry` MODIFIED requirement headers (`persist-evidence.sh copies
  an artifact...` and `verdict.ref is durable; evaluator and skeptic reports do not also emit a
  redundant evidence event`) exist verbatim in `openspec/specs/evidence-telemetry/spec.md`, and
  that `gate-report-numbering` is a genuinely new capability (no existing
  `openspec/specs/gate-report-numbering/`) — spec-delta hygiene is correct.
- `openspec validate fix-report-numbering-collision --strict` → `Change
  'fix-report-numbering-collision' is valid`.
- Ran `openspec validate --help` and confirmed `--change` is **not** a valid flag (only
  `--changes`, `--specs`, `--all`, or a positional `[item-name]`); `tasks.md:78` (task 5.3)
  literally instructs `openspec validate --change fix-report-numbering-collision`, which errors
  (`error: unknown option '--change' (Did you mean --changes?)`).
- Found `test/scripts/*.test.sh` is this repo's actual test-script location (not
  `core/scripts/*.test.sh`, which tasks.md 1.3/5.1 loosely refer to) and confirmed
  `package.json`'s `"test"` script is a hardcoded `&&`-chain that explicitly lists every
  `test/scripts/*.test.sh` file by name (no glob) — `test/scripts/persist-evidence.test.sh` is
  already in that chain (task 2.4 correctly extends an existing, wired-in file), but nothing in
  `tasks.md` adds the brand-new `next-report-number.test.sh` (task 1.3) to that same chain.
- Traced every AC in `ticket.md` to a specific task/spec-scenario: AC1/AC2 (fresh filenames,
  numbering continues across sub-runs, no prior report modified) → `next-report-number.sh`'s
  disk-scan design + spec scenarios "Numbering continues..." / "A third sub-run continues...";
  AC3 (one evidence entry per report across sub-runs) → `--no-clobber` on the verdict.ref persist
  call (tasks 3.2/4.2, design Decision 3); AC4 (loud failure on collision) → both
  `next-report-number.sh`'s FAIL path and `persist-evidence.sh --no-clobber`'s FAIL path; AC5
  (single-sub-run unaffected) → explicit Non-Goal + spec scenarios "Single-sub-run numbering is
  unaffected" (both evaluator and skeptic requirements). All five ACs are covered by name.

### Verdict: REFUTE

The design is sound in substance — the disk-derived numbering approach is well-reasoned, the
`--no-clobber` opt-in scoping correctly avoids breaking the planning-artifact re-persist flow, and
every AC traces to a concrete task/spec scenario. But two concrete defects in `tasks.md` should be
fixed before execution starts — one is a literal command that will error if followed as written,
the other is a real coverage gap in this change's own regression-test story.

### Change Requests

1. **`tasks.md:78` (task 5.3) uses an invalid `openspec` CLI invocation.**
   `openspec validate --change fix-report-numbering-collision` errors: `--change` is not a
   recognized flag (confirmed via `openspec validate --help`; the correct form used elsewhere in
   this repo's own workflow docs is the positional form, `openspec validate
   fix-report-numbering-collision --strict`, which I ran successfully). Fix task 5.3 to use the
   correct invocation so the verification step is actually executable as written.

2. **`tasks.md` never wires the new `next-report-number.test.sh` into `package.json`'s `test`
   script, so it would never run as part of this project's actual test gate.** Task 1.3 says to
   "add a test script" but doesn't name its path or say to register it. `package.json`'s `"test"`
   entry is a hand-maintained `&&`-chain that explicitly lists every `test/scripts/*.test.sh` file
   (confirmed: no glob, 20 files individually named) — `persist-evidence.test.sh` is already in
   that chain, which is why extending it in task 2.4 needs no wiring change, but a brand-new file
   is invisible to `npm test` (and therefore to the evaluator's/executor's gate runs, and to task
   5.1's "run the full script test suite") until someone adds it. Add a task (e.g. 1.4) that: (a)
   states the new test file's path explicitly —
   `test/scripts/next-report-number.test.sh` (matching the existing `test/scripts/*.test.sh`
   convention task 1.3 gestures at but doesn't name), and (b) adds
   `&& bash test/scripts/next-report-number.test.sh` to `package.json`'s `"test"` script chain.
   Without this, task 5.1's "confirm no regressions" would not actually exercise the new script's
   own regression coverage through the standard gate path — a gap worth closing at design time
   for a change whose entire purpose is closing exactly this kind of silent gap.

### Non-blocking notes

- `core/scripts/README.md`'s scripts table (lines ~30-40) lists every script in `core/scripts/`
  with purpose/args, but no task updates it to add a `next-report-number.sh` row. Not required by
  the ticket's AC or the `doctor.js`/`concertino sync` contract (which is directory-content-based,
  not README-based, and correctly does not need updating per the design's own claim), but leaving
  it out means the new script is undocumented in the one place a human would look for the full
  script inventory. Worth a one-line addition during execution even though tasks.md doesn't call
  it out.
- `tasks.md:73`/`design.md`'s "existing test conventions for `core/scripts/*.sh`" phrasing is
  imprecise — the actual test files live under `test/scripts/`, not `core/scripts/`. Task 2.4's
  correct naming of `persist-evidence.test.sh` makes the intent recoverable, but tightening the
  wording would remove the ambiguity entirely.
