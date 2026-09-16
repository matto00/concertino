# Files modified — typed-verdict-category-validation (CON-189/CON-187/CON-194)

Base SHA resolved live via `scripts/concertino/resolve-review-base.sh "$WORKTREE_PATH" main origin`:
`d246b703059e8b8e5ecea6de31c8e46491edacac`

- `core/scripts/emit-event.sh` — captures `category`/`gate` in the `k=v` loop (no refusal there, per CON-171/design.md Decision 3); adds the verdict-field validation block immediately after the auditor-lease release: refuses a `verdict` with missing/unknown `category`, a non-`verdict` event with an illegal `category`, a stated `head_sha` that is not a full 40-character hex SHA, and a `role=skeptic` verdict with a missing/illegal `gate`.
- `scripts/concertino/emit-event.sh` — byte-identical copy of the above (`cp core/scripts/emit-event.sh scripts/concertino/emit-event.sh`, mode 0755 preserved), reproducing the render `test/scripts/rendered-scripts-drift.test.sh` checks. This path is outside the `<CHANGE_DIR>/**` allowlist and is declared here per squash-branch.sh's requirement.
- `core/roles/evaluator.md` — states the four-value category enum and when each applies; adds `category=` to the verdict emission; states the 40-character `head_sha` requirement.
- `core/roles/skeptic.md` — same as evaluator, plus states `gate=<GATE>` is required on every skeptic verdict emission (CON-194).
- `core/roles/auditor.md` — states the enum (mapped to Conditions 1–4) and adds `category=` to its verdict emission; no `head_sha`/`gate` requirement change (auditor never states `head_sha`, and `gate` is skeptic-only).
- `core/roles/orchestrator.md` — widens the existing override-scoped "never emit `verdict role=skeptic`" statement (~line 900) into the general rule that the orchestrator never emits a `verdict` event for any role/gate/outcome (CON-194), keeping the override case as the motivating example, and keeping the requirement that it still records the verdict in `workflow-state.md`.
- `test/scripts/emit-event.test.sh` — fixed the three pre-existing CON-166 verdict fixtures (lines ~692/705/720 pre-change) to carry `category=` (and `gate=` where `role=skeptic`) so they still pass under the new required fields; replaced the `head_sha=deadbeef` (8-char) fixture with a full 40-character SHA, preserving the original assertion intent (a stated SHA records verbatim with `head_sha_source=stated`) — see red/green evidence below. Appended new mutation-proven coverage for every new refusal (category missing/illegal, non-verdict illegal category, head_sha 39-char/8-char/40-char-non-hex/full-40-hex, skeptic gate missing/illegal/legal, evaluator-no-gate-still-ok) and for CON-171 lease-release-on-refusal (auditor verdict refused on illegal category, and again on malformed head_sha — lease still released, command still exits non-zero). **Cycle 2 (evaluation-1.md CR2):** the RED-baseline half no longer depends on an operator-supplied `PRE_CHANGE_SCRIPT` env var — it now self-derives the pre-change `core/scripts/emit-event.sh` via `git show d246b703059e8b8e5ecea6de31c8e46491edacac:core/scripts/emit-event.sh` into a `tmp-scratch.sh`-scoped scratch file at test-run time, and runs unconditionally on every `npm test`. `PRE_CHANGE_SCRIPT` remains available as an explicit override; an unresolvable `git show` is now a loud `exit 1`, never a silent skip.
- `test/reducer.test.js` — added CON-189/CON-187 design.md Decision 9 historical-tolerance tests: a verdict with no `category` still folds without throwing, one with a malformed `head_sha` still folds without throwing, and a mixed categorized/uncategorized log renders both without discarding either.
- `test/scripts/check-merge-readiness.test.sh` — **new in cycle 2 (evaluation-1.md CR1)**: two cases (189.1, 189.2) proving `check-merge-readiness.sh`'s own historical-tolerance half of design.md Decision 9 / tasks.md 5.3 / the `verdict-category` spec's "historical uncategorized verdict events remain readable" scenario, which was previously asserted only on the reducer side. 189.1 feeds an uncategorized evaluator+skeptic pair (the same shape `eval_pass`/`skeptic_confirm` already produce) and asserts the readiness outcome is still a clean `PASS`/exit 0. 189.2 feeds an uncategorized evaluator verdict alongside a skeptic verdict carrying a malformed (8-character) `head_sha` — the exact shape of the pre-existing HEL-1105/HEL-1121 corpus entries — and asserts it still refuses exactly as an unresolvable SHA already does (166.4/166.5's precedent: exit 4, `STALE ... reviewed SHA is unresolvable: ...`), proving no crash and no behavior change for a log written before this change. No change to `core/scripts/check-merge-readiness.sh` itself — its jq selection never referenced `category`/`gate`, confirmed by reading it, and now also by this committed test.
- `openspec/changes/typed-verdict-category-validation/tasks.md` — all 23 tasks marked complete (5.3 is now genuinely fully done — both the reducer and readiness halves are committed, re-derivable coverage). **Cycle 3:** added section 7 (four tasks, all `[x]`) documenting the shallow-clone fix below.
- `.github/workflows/pr-ci.yml` — **new in cycle 3** (orchestrator-found post-cycle-2-PASS defect): added `fetch-depth: 0` to the `actions/checkout@v4` step. CR2's self-derived `git show d246b703059e8b8e5ecea6de31c8e46491edacac:core/scripts/emit-event.sh` cannot resolve that blob in a depth-1 shallow clone (CI's un-overridden default), which would have turned `test (16)`/`test (22)` red on every future PR while staying green in any full-history local worktree. This path is outside the `<CHANGE_DIR>/**` allowlist and is declared here per squash-branch.sh's requirement. No `concertino sync` involved — this file is not a rendered artifact. `openspec/specs/pr-ci/spec.md` read in full: it asserts nothing about checkout depth (only that a check run exists and reports `npm test`'s result across the two Node versions), so no MODIFIED spec delta is needed for this change — recorded explicitly rather than left silent.
- `test/scripts/emit-event.test.sh` — **cycle 3 addendum**: the RED-baseline self-derivation now also attempts to deepen a shallow repo (`git fetch --unshallow`, falling back to `git fetch --deepen=1000`) before its second, final `git show` attempt, so the proof is robust to a shallow clone anywhere it runs — not only inside a CI job that remembered `fetch-depth: 0`. The loud `exit 1` FATAL tripwire (CR2's requirement) is unchanged in shape, only reached after the deepen-and-retry has also failed.

## CON-197 mutation proof (RED before GREEN)

Pre-change script obtained via `git show d246b703059e8b8e5ecea6de31c8e46491edacac:core/scripts/emit-event.sh` into a scratch copy, then run against `test/scripts/emit-event.test.sh`'s new assertions with `PRE_CHANGE_SCRIPT=<scratch-path> bash test/scripts/emit-event.test.sh`. Every new refusal shown RED (baseline exits 0) then GREEN (new script refuses, exit 1, no event appended):

```
ok   RED (pre-change): missing category still exits 0 (baseline had no validation)
ok   GREEN: missing category refused (non-zero exit)
ok   GREEN: missing category — no event appended
ok   RED (pre-change): bogus category still exits 0 (baseline had no validation)
ok   GREEN: bogus category refused (non-zero exit)
ok   GREEN: bogus category — no event appended
ok   RED (pre-change): 39-char head_sha still exits 0 (baseline had no validation)
ok   GREEN: 39-char head_sha refused
ok   RED (pre-change): 8-char head_sha still exits 0 (baseline had no validation)
ok   GREEN: 8-char head_sha refused
ok   RED (pre-change): 40-char non-hex head_sha still exits 0 (baseline had no validation)
ok   GREEN: 40-char non-hex head_sha refused
ok   GREEN: full 40-char head_sha accepted (exit 0)
ok   GREEN: full 40-char head_sha recorded, source=stated
ok   RED (pre-change): skeptic verdict with no gate still exits 0 (baseline had no validation)
ok   GREEN: skeptic verdict with no gate refused
ok   GREEN: skeptic verdict with illegal gate refused
ok   GREEN: skeptic gate=design accepted (exit 0)
ok   GREEN: skeptic gate=design recorded verbatim
ok   GREEN: skeptic gate=final accepted (exit 0)
ok   GREEN: skeptic gate=final recorded verbatim
ok   GREEN: evaluator verdict with no gate still exits 0
ok   refused on illegal category: lease exists before the refused verdict
ok   refused on illegal category: verdict itself still exits non-zero
ok   refused on illegal category: lease still released despite the refusal
ok   refused on malformed head_sha: lease exists before the refused verdict
ok   refused on malformed head_sha: verdict itself still exits non-zero
ok   refused on malformed head_sha: lease still released despite the refusal
167 passed, 0 failed
```

Full run: `PRE_CHANGE_SCRIPT=<scratch>/pre-change-emit-event.sh bash test/scripts/emit-event.test.sh` exits 0, 167 passed / 0 failed (up from 94 passed pre-change-suite baseline count for this file).

## Cycle 2 (evaluation-1.md CR2): the RED baseline now runs with NO env var set

Fresh, unset-env-var run (proving the self-derivation actually fires, not just that the override path still works):

```
$ unset PRE_CHANGE_SCRIPT && bash test/scripts/emit-event.test.sh
...
ok   RED (pre-change): missing category still exits 0 (baseline had no validation)
ok   GREEN: missing category refused (non-zero exit)
...
ok   refused on malformed head_sha: lease still released despite the refusal
167 passed, 0 failed
```

Exit code: `0`. Count: **167 passed** with no env var set — up from the pre-CR2 measured `161 passed` (evaluation-1.md's independent reproduction) when the RED half was silently skipped. The 6 `RED (pre-change): ...` assertions are now present in this run's own output with nothing exported, confirming the `git show d246b703059e8b8e5ecea6de31c8e46491edacac:core/scripts/emit-event.sh` self-derivation path actually executed rather than falling through to a skip.

## Cycle 2 (evaluation-1.md CR1): readiness-side mutation proof

Confirmed the two new `check-merge-readiness.test.sh` assertions are load-bearing, not decorative: in a throwaway copy of the worktree (never the tracked one), mutated `check-merge-readiness.sh`'s jq selection to additionally require `.category != null` on the evaluator verdict, re-ran the suite:

```
FAIL 189.1.1 uncategorized evaluator+skeptic verdicts: still all-pass exits zero
FAIL 189.1.2 uncategorized evaluator+skeptic verdicts: still prints PASS
FAIL 189.2.1 malformed (8-char) skeptic head_sha: refuses exactly as an unresolvable SHA does (exit 4)
FAIL 189.2.2 malformed head_sha is named in the refusal, same as 166.4's unresolvable-SHA message shape
40 passed, 41 failed
```

(The wider failure count is expected collateral — every other fixture in this file also carries no `category`, so the mutation breaks them too; that is itself further confirmation the mutation is a genuine defect-injection, not a no-op.) Restored/discarded; the tracked worktree was never touched (this proof ran against a `cp -r` scratch copy under `/tmp`).

Fresh unmutated run of the full file: `bash test/scripts/check-merge-readiness.test.sh` → `81 passed, 0 failed`, exit 0.

## Standing run-scoped constraint (design.md Decision 2)

This run's own review-agent spawn prompts (evaluator/skeptic) must carry `category=`, `gate=` (skeptic), and a full 40-character `head_sha=` explicitly, since the rendered `.claude/agents/concertino-*.md` predate this change and do not yet know to pass them. See `tasks.md`'s "Run-Scoped Execution Notes".
