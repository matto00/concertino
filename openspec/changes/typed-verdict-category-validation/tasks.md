## 1. Emitter: capture the new verdict fields without refusing yet

- [x] 1.1 In `core/scripts/emit-event.sh`, add a `category)` case to the `k=v` argument loop that captures the value into a new `CATEGORY` variable AND folds it into `FIELDS`/`OTHER_FIELDS` exactly like the generic `*)` case, with no refusal in the loop itself. Verify by emitting a `verdict` with `category=mechanical` and reading back the appended line: the `category` field is present with that value.
- [x] 1.2 In the same loop, add a `gate)` capture into a new `GATE_FIELD` variable, folded into `FIELDS`/`OTHER_FIELDS` like the generic case, with no refusal in the loop. Verify a non-verdict event passing `gate=` is byte-identical in shape to before this change (the generic passthrough already handled it).
- [x] 1.3 Confirm by code reading and by a comment citing CON-171 that NO refusal was added inside the `k=v` loop, because the loop runs above the auditor-lease release. Verify with `grep -n "exit 1" core/scripts/emit-event.sh` that no new `exit 1` appears between the loop's start and the `lease_release` call.

## 2. Emitter: refuse invalid verdict fields, below the auditor-lease release

- [x] 2.1 Immediately AFTER the existing `if [ "$KIND" = "verdict" ] && [ "$ROLE" = "auditor" ]; then lease_release ...` block, add the verdict-field validation block. Verify placement with `grep -n` that the new validation's line numbers are strictly greater than the `lease_release` line's.
- [x] 2.2 Refuse a `verdict` whose `category` is missing, and one whose `category` is outside `mechanical|spec-divergence|design-judgment|intent-mismatch`: non-zero exit, message naming the four legal values on stderr, no event appended. Verify all four legal values exit 0 and are recorded, and that a bogus value and an omitted value each exit non-zero with an empty/absent log.
- [x] 2.3 Validate a `category` value supplied on a NON-verdict event too (refuse an illegal value), while never requiring it there. Verify `phase.enter` with no category exits 0 and is appended, and `phase.enter category=bogus` exits non-zero.
- [x] 2.4 Refuse a `verdict` whose STATED `head_sha` is not 40 hexadecimal characters: non-zero exit, message stating the required form, no event appended. Verify a full 40-char SHA exits 0 and records `head_sha_source=stated`; a 39-char, an 8-char, and a 40-char non-hex value each exit non-zero.
- [x] 2.5 Leave the omitted-`head_sha` paths untouched: an omitted SHA inside a git worktree still infers HEAD and marks `inferred`; an unresolvable HEAD still writes the event with no SHA and still exits 0. Verify by re-running the three pre-existing CON-166 assertions in `test/scripts/emit-event.test.sh` unchanged (other than fixture 692, task 5.2).
- [x] 2.6 Refuse a `role=skeptic` verdict whose `gate` is missing or outside `design|final`; leave `role=evaluator` and `role=auditor` verdicts not requiring `gate`. Verify `gate=design` and `gate=final` exit 0, a skeptic verdict with no gate and with `gate=bogus` each exit non-zero, and an evaluator verdict with no gate still exits 0.
- [x] 2.7 Verify a refused auditor verdict STILL releases the teardown lease: emit `verdict role=auditor` with an illegal category (and again with a malformed stated `head_sha`), and assert the lease is released exactly as for an accepted verdict while the command still exits non-zero. This is the CON-171 guarantee and the reason for the placement in 2.1.

## 3. Rendered-copy parity

- [x] 3.1 Reproduce the render by copying the single changed file byte-for-byte: `cp core/scripts/emit-event.sh scripts/concertino/emit-event.sh` and ensure the destination stays mode 0755. Do NOT run `concertino sync` (owner instruction for this batch). Verify with `cmp -s` that the two files are byte-identical and `test -x` on the rendered copy.
- [x] 3.2 Verify `bash test/scripts/rendered-scripts-drift.test.sh` exits 0 with no file listed under "content differs" or "not executable".

## 4. Role definitions

- [x] 4.1 In `core/roles/evaluator.md`, `core/roles/skeptic.md`, and `core/roles/auditor.md`, state all four category values and when each applies, and add `category=<value>` to each role's `emit-event.sh verdict` invocation. Verify by grepping each file for all four enum values and for `category=` on the verdict emission line.
- [x] 4.2 In `core/roles/skeptic.md`, add `gate=<design|final>` to the verdict invocation and state that it is required. Verify by grep that the skeptic's verdict emission passes `gate=`.
- [x] 4.3 In `core/roles/evaluator.md` and `core/roles/skeptic.md`, state that a stated `head_sha` must be the full 40-character SHA. Verify by grep for the 40-character requirement near each `head_sha=` instruction.
- [x] 4.4 In `core/roles/orchestrator.md`, widen the existing override-scoped prohibition (~line 900) into the general rule that the orchestrator never emits a `verdict` event for any role, gate, or outcome, keeping the override case as the motivating example, and keeping the requirement that it still records verdicts in `workflow-state.md`. Verify by reading the section back that the general statement is present and is not conditioned on an override.
- [x] 4.5 Verify `core/roles/executor.md` is unchanged and still emits no `verdict` event (`grep -c "emit-event.sh verdict" core/roles/executor.md` is 0).

## 5. Tests — each new assertion proven RED before green

- [x] 5.1 For every new refusal added in section 2, first run the assertion against the PRE-change script (`git show <base>:core/scripts/emit-event.sh` into a scratch copy) and record that it FAILS; then run it against the new script and record that it passes. Capture the red and green output for each in `files-modified.md`. A validation that cannot fail is worse than none (CON-197).
- [x] 5.2 Fix the pre-existing fixture at `test/scripts/emit-event.test.sh:692`, which passes `head_sha=deadbeef` (8 characters) and which task 2.4's validation necessarily breaks. Replace it with a full 40-character SHA and keep the assertion's original intent (that a stated SHA is recorded verbatim with `head_sha_source=stated`). Do NOT weaken the validation to accommodate the fixture. Verify the amended assertion passes and still asserts `stated`.
- [x] 5.3 Add a historical-tolerance test: append a `verdict` event carrying NO `category` (and one carrying a malformed `head_sha`) directly to a fixture log, then assert every consumer still behaves — the reducer folds it without throwing, and `check-merge-readiness.sh`'s verdict selection reaches the same outcome as before. Verify the test passes and that it fails if the consumer is mutated to require `category`.
- [x] 5.4 Verify no event log under `.concertino/runs/` was rewritten, reordered, or backfilled by this change (`git status --short` shows no modification to any `events.jsonl`).

## 6. Full verification

- [x] 6.1 Run the whole gate: `npm test` from the worktree root, to completion, with a long timeout and without `-n`. Verify it exits 0 and paste the tail. Never cite `npm run test:selftest`, which asserts nothing (CON-142).
- [x] 6.2 Re-run `openspec validate "typed-verdict-category-validation" --type change` and verify it exits 0, capturing the exit status directly or via `PIPESTATUS` (never `cmd | tail -2; echo $?`, which reports `tail`'s status).

## 7. Cycle 3: fix CR2's shallow-clone regression (found post-cycle-2-PASS by the orchestrator)

- [x] 7.1 CR2's self-derived `git show <base-sha>:core/scripts/emit-event.sh` in `test/scripts/emit-event.test.sh` fails on a depth-1 (shallow) clone — `pr-ci.yml`'s bare `actions/checkout@v4` defaults to `fetch-depth: 1`, so CI would go red on `test (16)`/`test (22)` while green in every full-history local worktree. Add `fetch-depth: 0` to the checkout step in `.github/workflows/pr-ci.yml`. Verify: a fresh `git clone --depth 1` of this branch, followed by `bash test/scripts/emit-event.test.sh`, now exits 0 with the 6 RED assertions actually executing (not skipped) — the deepen fallback in 7.2 covers the clone-under-test itself, since fetch-depth: 0 only fixes CI's own checkout, not an ad hoc shallow clone made to reproduce the bug.
- [x] 7.2 Add a runtime fallback in `test/scripts/emit-event.test.sh`: if the first `git show` fails AND the repo is shallow (`git rev-parse --is-shallow-repository`), attempt `git fetch --unshallow` (falling back to `git fetch --deepen=1000`) once, then retry `git show` before treating the failure as FATAL — so the RED-baseline proof is robust to a shallow clone wherever it runs, not only inside a CI job that remembered the workflow-level fix. The FATAL exit remains as the tripwire when even the deepened retry cannot resolve the blob.
- [x] 7.3 Confirm `openspec/specs/pr-ci/spec.md` asserts nothing about checkout depth (read in full) — no MODIFIED delta needed for this change; recorded explicitly here rather than left silent.
- [x] 7.4 Re-run the full gate (`npm test`, `rendered-scripts-drift.test.sh`, `openspec validate`) and update `files-modified.md` to declare `.github/workflows/pr-ci.yml`.

## Run-Scoped Execution Notes

Deliberately NOT under a `## Standing Constraints` heading: these bind this
run's orchestration, and no Planning escalation or skeptic verdict promoted a
tracked `C<n>` constraint, so the `CONSTRAINTS` / `CONSTRAINT_REVIEWS` /
`SKEPTIC_VERDICTS_TOTAL` id sets stay empty and
`check-constraints-carryover.sh` reports `OK (none)`.

- **The strict emitter can break THIS run's own gate chain.** Review agents
  are spawned from `.claude/agents/concertino-*.md` rendered at the last
  `concertino sync`, so they do not yet know to pass `category=`, while the
  worktree's emitter will require it once section 2 lands. The orchestrator
  carries the `category=`, `gate=` (skeptic), and full-40-character
  `head_sha=` instructions explicitly in every evaluator/skeptic spawn prompt
  for this run. See design.md Decision 2.
- **`read_raised_field()` is deliberately NOT tightened** (design.md Decision
  7). This change adds no fourth escalation-raise field; `category`, `gate`,
  and `head_sha` are `verdict` fields. Filed as a spinoff instead of folded in.
