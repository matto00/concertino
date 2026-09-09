# Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `930f733` (base `9dc1545`). All evidence below was re-derived
by this evaluator; nothing in the executor's report was taken on trust.

### Phase 1: Spec Review — FAIL

Issues:

- AC 1, 2, 3, 4, 7 addressed. AC 5 (mutation guard) addressed for the headline
  case — independently re-derived, see Phase 2.
- **AC 2 / Decision 1a is defeated at the caller.** `core/roles/auditor.md:54`
  passes `"<change-dir>"` as `ARCHIVE_PREFIX`. `<change-dir>` is a render-time
  literal substitution (`lib/cli/render.js:212`) of `specProvider.changeDir`,
  which is `openspec/changes/<CHANGE_NAME>` — the *change directory*, not the
  change-dir **root**. The prose two lines below says the opposite ("your
  resolved change-dir root (e.g. `openspec`)"), so the rendered command and the
  rendered instruction disagree. Details and a live refutation in Phase 2 CR 1.
- Task 4.4 is marked `[x]` but the erroring-git-invocation self-test it claims
  was not delivered (Phase 2 CR 2). design.md Decision 3 states "A self-test
  asserts the failing-diff case refuses"; no such assertion exists.
- Decision 4a (lease symmetry) honoured — verified mechanically, Phase 2.
- Decision 6 asymmetry implemented and genuinely tested (166.7).
- CON-173 render obligation met — verified byte-identical, Phase 2.
- No scope creep observed; the diff touches only what tasks.md enumerates.

### Phase 2: Code Review — FAIL

**Gates (re-run by me, in `WORKTREE_PATH`, not trusted from the report):**

- `npm test` (the repo's full suite, including `check-merge-readiness.test.sh`
  71/71, `emit-event.test.sh` 93/93, `rendered-scripts-drift.test.sh` 19/19,
  `phase4-teardown-guard.test.sh`) — **exit 0, green.**
- Rendered-scripts drift gate — **green**; and independently `cmp`-verified:
  `core/scripts/{check-merge-readiness.sh,emit-event.sh,README.md}` are
  **byte-identical** to their `scripts/concertino/**` renders, with matching
  executable bits.

**Evidence re-derivation (design.md Decision 7).** I copied the tree to a
scratch dir and applied each named mutation myself.

Must-PASS assertions, each RED under its own named mutation and *only* its own:

| Mutation applied | Expected red | Observed |
|---|---|---|
| Drop step 3's `':(exclude)${ARCHIVE_PREFIX}/*'` term | 166.3 | **RED** 166.3.1/166.3.2; 166.8/166.10/166.12 stayed green (69 passed, 2 failed) |
| Drop the `-- "${patharr[@]}"` PATHS restriction | 166.8 | **RED** 166.8.1/166.8.2 (and 166.10, consistently); 166.3/166.12 green; 166.9 still green (67 passed, 4 failed) |
| Delete Decision 1c's empty-`PATHS` guard | 166.12 | **RED** 166.12.1/166.12.2 only (69 passed, 2 failed) |
| Neutralise step 0's unconditional `git fetch origin <base>` | 166.10 | **RED** 166.10.1/166.10.2 only (69 passed, 2 failed) |

Refusal assertions, run against the **pre-fix** `check-merge-readiness.sh`
(`9dc1545`) with the new test file: 14 failures, comprising every refusal
assertion — 166.1.1/.2/.3 (the ticket's non-negotiable
record-verdict/add-commit/refuse mutation), 166.4.1/.2, 166.5.1/.2,
166.6.1/.2, 166.7.1/.2/.3, 166.9.1/.2. Every must-PASS assertion was green
pre-fix, exactly as Decision 7 predicts, which is why the mutation table above
is the load-bearing evidence for those.

Emit side, against the pre-fix `emit-event.sh`: `stated head_sha_source`,
`inferred head_sha equals git HEAD`, `inferred head_sha_source` all **RED**;
`stated head_sha recorded` green (explicitly declared precondition-guaranteed
by Decision 2 and labelled as such in the test).

Exact-output matching is present on every refusal assertion (full
`STALE <role> reviewed=… head=… changed=…` lines, not bare exit codes) and on
every must-PASS assertion (`check ... "$OUT" "PASS"`).

**Lease symmetry (Decision 4a / CON-171)** — verified mechanically:
`lease_acquire` appears exactly once in `check-merge-readiness.sh` at both
`9dc1545` and `HEAD`; `lease_release` appears zero times in it at both; and
exactly once in `emit-event.sh` at both. No new release site.

**Caller sweep for the new required 4th argument** — every invoking call site
found and confirmed updated: `core/roles/auditor.md:54`,
`test/scripts/phase4-teardown-guard.test.sh:73`,
`test/scripts/check-merge-readiness.test.sh:130`, plus the usage row in
`core/scripts/README.md:91` and its render. No missed caller. **But the one
production caller passes the wrong value** — see CR 1.

**`set -u` safety** — `STALE` is initialised unconditionally; `HEAD_REF_OID` is
only read on the path where condition 2 broke at `CLEAN` (every other loop exit
calls `fail`, which closes 2b's guard). Correct.

Issues:

1. **BLOCKING — `core/roles/auditor.md:54` passes the change *directory*, not
   the change-dir *root*, reinstating Decision 1's headline failure mode.**
   Rendered output (`node bin/concertino sync --config=config/examples/concertino.json`,
   `/tmp/con166render/.claude/agents/concertino-auditor.md:70`):

   ```
   scripts/concertino/check-merge-readiness.sh "$WORKTREE_PATH" "$BRANCH" "$TICKET_ID" "openspec/changes/<CHANGE_NAME>"
   ```

   The exclusion then becomes `:(exclude)openspec/changes/<CHANGE_NAME>/*`,
   which does **not** cover the two places the Phase-3 archive step actually
   writes: the archive destination
   (`openspec/changes/archive/<date>-<CHANGE_NAME>/…`, per
   `core/roles/orchestrator.md:883-887`) and the merged spec tree
   (`openspec/specs/**`). design.md Decision 1a's own scope note assumes the
   prefix covers *both* ("the archive step writes only inside the change dir
   and the spec tree, **both under that prefix**") — which is true only for
   `openspec`.

   Refuted live, on a fixture reproducing the real archive shape (change dir
   moved into `openspec/changes/archive/…`, spec delta merged into
   `openspec/specs/`), same repo, same commits, only the 4th argument varying:

   ```
   --- ARCHIVE_PREFIX=openspec
   rc=0 out=PASS
   --- ARCHIVE_PREFIX=openspec/changes/demo
   rc=4
   STALE evaluator reviewed=94e75a01… head=d4963f88… changed=openspec/changes/archive/2026-09-09-demo/x/specs/cap/spec.md,openspec/changes/archive/2026-09-09-demo/x/tasks.md,openspec/specs/cap/spec.md
   STALE skeptic  reviewed=94e75a01… head=d4963f88… changed=…same…
   ```

   So as shipped, the auditor refuses **every healthy delivery** with a false
   `STALE` — including this ticket's own auditor run. Test 166.3 does not catch
   it because it hardcodes `openspec` rather than the value the auditor is
   actually rendered to pass.

2. **BLOCKING (evidence gap) — the erroring-git-invocation leg has zero
   coverage, and its fixture's own comment says so while task 4.4 is marked
   done.** `test/scripts/check-merge-readiness.test.sh` 166.11 is titled "an
   erroring git invocation in the comparison refuses", then its body states it
   does not do that and is "instead … a control", asserting only that the
   healthy baseline passes (`166.11.1`). Its narrative ("pointing the branch
   head at a SHA that does not exist in this repo's object database") is also
   contradicted by its own code, which sets `headRefOid == local HEAD ==
   A_SHA`. The three `rc -ne 0` branches guarding `git diff` in `stale_check`
   (`core/scripts/check-merge-readiness.sh:492-503, 526-532`) are therefore
   entirely unexercised — the exact "a failing git call reads as no drift"
   shape Decision 3 was written against. The claim that 166.4/166.5 "share the
   same fail-closed code path" is false: those exercise the `cat-file -e` and
   absent-SHA branches, which are different code.

Non-blocking:

3. `test/scripts/emit-event.test.sh` now has two `echo "$PASS passed, $FAIL
   failed"` / `[ "$FAIL" -eq 0 ]` blocks (lines 610 and 659), because the
   CON-166 fixtures were appended after the original terminator. Harmless today
   (no `set -e`, and the final exit is correct), but a reader sees two summary
   lines and any future `set -e` would silently skip the new block. Fold the new
   fixtures in above the single terminator.

4. A new auditor `STALE` verdict counts against the auditor pass-rate in
   `lib/ui/screens/fleet/metrics.js:229` (`VERDICT_PASS_VALUE`), even though it
   is a resumable "do work, then retry" rather than a bad outcome. Out of this
   ticket's stated scope; noting so it is not mistaken later for a regression in
   auditor quality.

### Phase 3: UI Review — N/A

Shell/CLI tooling only; no `frontend/**` or UI-affecting paths in the diff, and
the orchestrator explicitly directed that this phase be skipped.

### Overall: FAIL

### Change Requests

1. `core/roles/auditor.md:54` — pass the change-dir **root**, not
   `<change-dir>`. `<change-dir>` renders to `openspec/changes/<CHANGE_NAME>`
   and produces a false `STALE` on every healthy squash+archive delivery
   (refutation transcript above). The value must be the prefix that contains
   both the archive destination and the spec tree (`openspec`; `spec` for a
   `kind: none` provider). Since `render.js` offers no root-only token today,
   either add one (e.g. `<change-dir-root>`, derived from
   `specProvider.changeDir`'s first segment or a new config field) and use it
   here, or state the derivation in the instruction so the auditor computes it
   — but the *rendered command* must not contain a value that refuses every
   delivery. Update the render copy accordingly (CON-173) and re-run the drift
   gate.

2. Add a regression assertion that pins the argument the auditor is actually
   rendered to pass, so CR 1's class cannot recur silently — e.g. in
   `test/scripts/auditor-render.test.sh`, assert the rendered
   `check-merge-readiness.sh` invocation's 4th argument is the change-dir root
   and contains no `changes/` segment. Prove it RED against the current
   `core/roles/auditor.md` before fixing it.

3. Deliver the self-test task 4.4 and Decision 3 require: a fixture in which a
   `git diff` inside `stale_check` genuinely **errors** (non-zero exit,
   empty/garbage stdout) and assert the exact refusal string
   (`STALE <role> could not diff …`), proven RED against a mutation that drops
   that `rc -ne 0` check. Then either rewrite 166.11 to be that test, or retitle
   it honestly as the healthy-baseline control it currently is — do not leave a
   fixture whose title claims coverage its body disclaims. Do not re-mark task
   4.4 `[x]` until the assertion exists.

### Non-blocking Suggestions

- Fold the CON-166 emit-event fixtures above the single suite terminator
  (issue 3).
- Consider whether `STALE` belongs in the auditor pass-rate denominator
  (issue 4) — likely a follow-up ticket, not this one.
