## Evaluation Report — Cycle 3 (evaluation-3.md)

Reviewed commit: `b7d079ca52cd0006e705beab9018714e0ff39c5b` on
`task/typed-verdict-category-validation/CON-189`, diffed against cycle 2's
reviewed commit `ac5b2c60e4dc3c01292ee8ddc80df23f50ad0f30`. Did not re-read
ticket/proposal/design/tasks (unchanged). Fixes a shallow-clone regression
the orchestrator found in CI after my cycle-2 PASS (CR2's `git show` fails
with exit 128 in a depth-1 checkout, since the base blob is absent). Diff is
exactly four files, confirmed via `git diff --name-only ac5b2c6..HEAD`:
`.github/workflows/pr-ci.yml`, `test/scripts/emit-event.test.sh`,
`openspec/changes/typed-verdict-category-validation/tasks.md`,
`files-modified.md`. The emitter (`core/scripts/emit-event.sh` /
`scripts/concertino/emit-event.sh`) is unchanged since cycle 1.

Re-derived every one of the orchestrator's 7 numbered claims independently,
plus the explicit judgment call.

### Phase 1: Spec Review — PASS

- `openspec/specs/pr-ci/spec.md` read in full: it constrains only that a
  GitHub Actions check run exists for PR/push events and reports `npm
  test`'s result across the Node 16/22 matrix; it says nothing about
  checkout depth. No MODIFIED delta is required, and the executor's own
  claim to that effect in `files-modified.md`/`tasks.md` 7.3 is accurate.
- `tasks.md` section 7 (four new items, all `[x]`) describes this cycle
  honestly against what I independently verified below — it does not
  overclaim scope, and correctly frames 7.2's fallback as covering "an ad
  hoc shallow clone made to reproduce the bug," not as a substitute for the
  CI-level fix in 7.1.
- `files-modified.md` declares `.github/workflows/pr-ci.yml` (outside
  `<CHANGE_DIR>/**`) with a clear rationale, and confirms no `concertino
  sync` was involved (correct — this file is not a rendered artifact).

### Phase 2: Code Review — PASS

Fresh, independent re-derivation of every claim (not inherited from the
orchestrator's numbers):

1. **Shallow-clone fix works.** `git clone --depth 1 --branch
   task/typed-verdict-category-validation/CON-189
   file://<worktree>` into a scratch dir (`/tmp/con189_shallow`, deleted
   after use): `git rev-parse --is-shallow-repository` → `true` before the
   test. Ran `bash test/scripts/emit-event.test.sh` → exit 0, `167 passed, 0
   failed`, `grep -c "^  ok   RED"` → 6, no `FATAL` in the output. After the
   run, `git rev-parse --is-shallow-repository` → `false`, `git rev-list
   --count HEAD` → 313 (from 1 pre-run) — confirms the deepen fallback fired
   and genuinely resolved the historical blob, not a vacuous pass.
2. **No regression in full history.** In the worktree itself, `env -u
   PRE_CHANGE_SCRIPT bash test/scripts/emit-event.test.sh` → exit 0, `167
   passed, 0 failed`, 6 RED assertions present (grep-counted). Full `npm
   test` also exits 0 end-to-end (`/tmp/npmtest_con189_cycle3.log`, no `-n`,
   run to completion).
3. **RED half still non-vacuous.** In a separate scratch copy of the
   worktree (`/tmp/con189_c3bogus`, full-history, deleted after use), I
   replaced the recorded base SHA with 40 zeros: the run exits 1 with the
   updated FATAL message ("...even after attempting to deepen a shallow
   clone... If this is CI, confirm the checkout step uses fetch-depth: 0."),
   confirming the new fallback did not introduce a silent-skip path — a
   full-history repo correctly skips the deepen attempt (not shallow) and
   still fails loudly when the SHA itself is bogus.
4. **`fetch-depth: 0` present, workflow otherwise untouched.** Confirmed by
   reading the diff hunk directly: the only change is the new `with:
   fetch-depth: 0` under the existing `actions/checkout@v4` step, plus an
   explanatory comment. The Node matrix (`[16, 22]`), its comment, and every
   step below the checkout are unchanged.
5. **`pr-ci` spec claim confirmed** (see Phase 1 above) — read the file in
   full myself rather than trusting the summary.
6. **`files-modified.md` declares `.github/workflows/pr-ci.yml`, confirmed
   by squash-guard dry run.** `DRY_RUN=1 bash scripts/concertino/squash-branch.sh
   "$PWD" origin main "CON-189 test cycle3"
   "openspec/changes/typed-verdict-category-validation"` → `READY dry run:
   guard passed, nothing committed`, staged-file list includes
   `.github/workflows/pr-ci.yml` and matches `files-modified.md` exactly (21
   files total).
7. **`tasks.md` section 7 honesty** — confirmed above; all four sub-items
   describe exactly what the diff and my independent re-runs show.

Also re-confirmed (no regression from cycles 1–2, since the emitter is
byte-unchanged): `cmp core/scripts/emit-event.sh
scripts/concertino/emit-event.sh` → identical; `rendered-scripts-drift.test.sh`
→ `19 passed, 0 failed`; `openspec validate "typed-verdict-category-validation"
--type change` → valid, exit 0 (checked directly).

`workflow-state.md` (modified) and `evaluation-{1,2}.md` (untracked) are
orchestrator/evaluator-managed artifacts inside the change dir, not executor
leakage, and covered by the `<CHANGE_DIR>/**` squash allowlist by
construction.

### Judgment call: the test's self-deepening side effect — ruled non-blocking

The orchestrator asked me to rule on whether a test suite mutating its own
invoking repository's clone depth (and requiring network to do so) is
acceptable. Reproduced and confirmed the effect is real (item 1 above: a
scratch clone went from shallow/1-commit to full/313-commits merely from
running `emit-event.test.sh`).

Ruling: **acceptable as shipped, not a blocking defect**, for three reasons:

1. **It never fires in CI.** `pr-ci.yml` now uses `fetch-depth: 0`, so the
   only place this repo's own gate runs, the deepen path is dead code in
   practice. The side effect only reaches a human running `npm test` inside
   their own ad hoc `--depth 1` clone, which is not this repo's normal
   clone shape (a plain `git clone` is full-history by default; a
   contributor has to opt into `--depth 1` deliberately).
2. **The mutation is non-destructive.** Deepening/unshallowing only adds
   history a full clone would already have; it cannot lose or corrupt
   anything already present. This is a materially different risk class than
   a test that deletes, force-pushes, or rewrites refs.
3. **The offline failure mode is exactly the CON-197-mandated behavior: loud,
   not silent.** An offline shallow clone cannot deepen, hits the FATAL, and
   `npm test` goes red with a message naming the cause and the fix
   (`fetch-depth: 0`) — this is the same "refuse loudly rather than pass
   vacuously" principle this entire ticket exists to enforce, applied
   consistently to the test's own infrastructure dependency, not a
   regression of it.

I did not find anything in `CONTRIBUTING.md` (grepped for
side-effect/hermetic/network/mutation language; no hits) that establishes a
binding "tests must not touch repo state" rule this violates. Recorded as a
non-blocking suggestion below rather than a Change Request.

### Phase 3: UI Review — N/A

No frontend/backend/schema files touched.

### Overall: PASS

The cycle-3 fix closes the CI regression the orchestrator found, is scoped
exactly to that fix (workflow + test fallback + honest task/file-modified
bookkeeping), introduces no regression to cycles 1–2's properties, and the
one judgment call raised does not rise to a blocking defect for the reasons
above.

### Non-blocking Suggestions

- Consider having the shallow-clone fallback deepen into a detached scratch
  location (e.g. a throwaway `git worktree`/bare fetch into `$TMPDIR`)
  rather than mutating the invoking repository's own shallow state in
  place, so a contributor's ad hoc `--depth 1` clone is not silently
  converted to full history as a side effect of running `npm test`. Not
  required for this change — CI itself no longer depends on the fallback —
  but would remove the one behavior a future contributor could find
  surprising.
