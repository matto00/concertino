## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **The `cp -f` claim is true, not inherited from a narrative.** Read
  `core/scripts/persist-evidence.sh` directly at HEAD (`69e1c59`): line 153 is
  `if ! cp -f "$SOURCE_PATH" "$DEST_PATH" 2>/dev/null; then`. No `-p`, no
  compensating `touch -r` anywhere in the file.
- **Reproduced the bug against the real script.** In a scratch git repo: `touch -d
  "2020-01-01 00:00" a.txt`, then `core/scripts/persist-evidence.sh TICKET-1 a.txt`.
  Source mtime `2020-01-01`, destination mtime `2026-09-09 11:54:15` — the copy time.
  The premise is real and is in the sanctioned path, not just in ad-hoc rescues.
- **The proposed fix is correct.** `cp -fp a.txt /tmp/b_probe.txt` on the same
  backdated source yields destination mtime `2020-01-01 00:00:00` — a single flag
  achieves exactly the spec's new scenario. No second syscall needed; the design's
  rejection of `cp -f` + `touch -r` is sound.
- **The fix is complete for this script.** `cp` at line 153 is the only copy
  operation in the file; the `--no-clobber` identical-content branch (137–146) exits
  before it and deliberately leaves an already-persisted destination's mtime alone,
  which design.md calls out explicitly and correctly.
- **Rendered copy is currently byte-identical.** `diff core/scripts/persist-evidence.sh
  scripts/concertino/persist-evidence.sh` → identical, so task 1.4's direct-`cp` mirror
  keeps the CON-173 drift gate green. That gate is wired into the suite:
  `package.json` `test` runs `test/scripts/rendered-scripts-drift.test.sh`.
- **A test suite for this script already exists** (`test/scripts/persist-evidence.test.sh`,
  in `package.json`'s `test` script), so task 1.1's "locate the existing suite (if any)"
  resolves to a real file — the red-then-green step has a home and is not hand-waving.
- **Spec delta is well-formed and a faithful superset.** Compared the MODIFIED
  requirement against the live `openspec/specs/evidence-telemetry/spec.md` (line 10):
  the requirement title matches exactly, all seven existing scenarios are carried over
  verbatim, one mtime sentence is added to the prose, one new mtime scenario is added,
  and the idempotency scenario is amended to `content and mtime` — consistent, not
  contradictory. `npx openspec validate preserve-evidence-mtime-and-persist-screenshots
  --type change` → `Change ... is valid`.
- **AC-to-artifact trace:** AC1 (mtime preserved, backdated test) → tasks 1.1–1.3 +
  spec scenario "The persisted copy's mtime matches the source"; AC2 (named convention
  in evaluator/skeptic role docs) → tasks 3.1–3.2 + spec ADDED requirement; AC3
  (fragility of temporal/positional evidence) → task 3.3 + ADDED requirement; AC4
  (gate-defect condition) → task 3.4 + ADDED requirement; AC5 (rendered copy in sync
  via direct `cp`) → task 1.4. No AC uncovered.
- **AC2's "and, if applicable, the executor's" narrowing checked, not assumed:**
  `grep -n screenshot core/roles/executor.md` returns nothing — the executor captures
  no review screenshots, so scoping to evaluator/skeptic is a justified reading of
  "if applicable", not silent scope reduction.
- **No scope drift:** nothing in proposal/design/tasks goes beyond the five ACs; the
  non-goals correctly fence off CON-120, historical PNG re-stamping, and any mechanical
  temporal-claim detector.
- **Sibling collision:** the premise-validation note's claim that CON-166/CON-171 don't
  touch the copy logic is consistent with what I read — `persist-evidence.sh`'s copy
  path at `69e1c59` is untouched by the verdict-SHA and Phase-4-guard work.

### Verdict: CONFIRM

The premise is verified against ground truth (not narrative), the one-line fix is
empirically demonstrated to produce the required behavior, and the plan's task list
includes the red-before-green step, the drift mirror, and spec validation.

### Non-blocking notes

- The ADDED requirement "a gate that accepts disclosed-unsound mtime evidence ... SHALL
  be recorded as a gate defect" does not name *where* it is recorded, and `grep -rn
  "gate defect\|gate-defect" core/ openspec/specs/` returns zero hits — there is no
  pre-existing recording convention for the implementer to inherit. Not blocking (the
  ticket's AC asks only that the condition be *documented*, and design.md explicitly
  scopes this to process/documentation, not a mechanism), but the role-doc text added
  in task 3.4 should name the artifact of record (most naturally: a labelled line in
  that gate's own `evaluation-N.md` / `skeptic-*.md` report) so a future reviewer can
  actually check whether the obligation was met.
- The `cp` call suppresses stderr (`2>/dev/null`). Under `-p`, a failure to preserve
  ownership would be silenced, though the non-zero exit still trips the existing `FAIL`
  branch, so nothing fails silently. Same-user copies make this near-unreachable in
  practice, as design.md's risk note says; no change requested.
- Task 1.5 (header-comment update) should also record the `--no-clobber` no-op path's
  deliberate mtime behavior, so the next reader does not "fix" it into a `touch -r`.
