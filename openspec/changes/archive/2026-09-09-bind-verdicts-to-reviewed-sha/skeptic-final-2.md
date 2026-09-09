## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed SHA: **7c9f63da80c09dfa848ca1991c043ebe1aae5f8f** (branch head; commits `930f733`, `b5e4aef`, `7c9f63d` over base `9dc1545`). Fresh cold agent — every result below is one I produced and read myself; the executor's and evaluator's claims were treated as claims.

Working tree at review time: clean except `openspec/changes/bind-verdicts-to-reviewed-sha/workflow-state.md` (orchestrator bookkeeping, `SKEPTIC_CYCLE: 1 → 2`). Every mutation below was restored and `git status` re-checked afterwards.

### (a) Round 1's Change Request 1 — both mutations applied by me

Baseline: `bash test/scripts/check-merge-readiness.test.sh` → **77 passed, 0 failed**.

**Mutation G** — `core/roles/auditor.md:54`, `<change-dir-root>` → `<change-dir>` (the cycle-1 defect). Derived prefix becomes `openspec/changes/<CHANGE_NAME>`:

```
FAIL 0.1 auditor renders the change-dir ROOT, not the per-change directory
FAIL 166.3.1 squash-shaped archive-only diff passes (exit 0)
FAIL 166.3.2 squash-shaped archive-only diff prints PASS
74 passed, 3 failed
```

166.3 now turns red alongside 0.1. Round 1's finding is fixed: previously only 0.1 turned.

**New mutation — shapely-but-WRONG value.** `lib/config.js:172-174` replaced with `sp.changeRoot = 'spec';`. Derived prefix becomes the literal `spec` — which passes 0.1's shape check (`*/changes/*` / `*<CHANGE_NAME>*`) and would refuse 100% of deliveries on an openspec project:

```
PREFIX NOW: [spec]
FAIL 166.3.1 squash-shaped archive-only diff passes (exit 0)
FAIL 166.3.2 squash-shaped archive-only diff prints PASS
75 passed, 2 failed
```

0.1 correctly stays green (the value *is* shapely); 166.3 catches it. The wider coverage hole round 1 named is closed.

**166.3 is no longer self-derived** (`test/scripts/check-merge-readiness.test.sh:670-672`): the archive path is now the literal `openspec/changes/archive/2026-01-01-demo/proposal.md`, built with `git add openspec`, while `$AUDITOR_ARCHIVE_PREFIX` is still passed explicitly as the 4th argument (line 678). Fixture path and exclusion no longer share a source. The derived prefix is currently `openspec` (verified by running `test/scripts/derive-auditor-archive-prefix.js`), so the literal and the derived value are genuinely coupled. The false comment is gone and the replacement comment's claims match what I observed.

### (b) The diff since `b5e4aef` is test-only

`git diff --stat b5e4aef..HEAD`: `test/scripts/check-merge-readiness.test.sh` (+25/-9) plus four planning artifacts (`evaluation-2.md`, `files-modified.md`, `skeptic-final-1.md`, `workflow-state.md`). `lib/config.js`, `lib/cli/render.js`, `core/roles/auditor.md`, `core/scripts/**` and `scripts/concertino/**` are **not** in the diff. Claim verified.

### (c) Freshness pass — hunting a third precondition-guaranteed assertion

I mutation-tested the assertions rounds 1–2 had not covered, chiefly the emit side.

**Mutation — delete the whole post-loop `if [ "$KIND" = "verdict" ]` block** (`core/scripts/emit-event.sh:308-318`):

```
FAIL stated head_sha_source      expected [stated] got [undefined]
FAIL inferred head_sha equals git HEAD   expected [5940548…] got [undefined]
FAIL inferred head_sha_source    expected [inferred] got [undefined]
90 passed, 3 failed
```

**Mutation — drop the empty-inferred-SHA guard** (`if [ -n "$INFERRED_SHA" ]` → `if true`):

```
FAIL unresolvable-HEAD case: no head_sha field   expected [absent] got [present]
92 passed, 1 failed
```

So six of the seven new emit-side assertions are load-bearing. The seventh — `stated head_sha recorded` — stays green under every mutation, but that is **honestly and prominently labelled** in the fixture's own comment as precondition-guaranteed by the pre-existing `k=v` passthrough and explicitly not the assertion under test (matching design.md Decision 2 and task 1.1's note). That is disclosure, not the round-1 defect, which was a comment claiming coverage the fixture did not provide.

I also checked that the new emit-event tests actually execute despite being appended after the file's original `[ "$FAIL" -eq 0 ]` terminator: the suite sets `set -uo pipefail` and **not** `set -e`, so execution continues; observed `86 passed` then `93 passed, 0 failed`, exit 0. The final exit status is the new terminator's. Real, not assumed.

Re-checked the remaining must-PASS fixtures for the same class. 166.2 is not precondition-guaranteed: it is a differential twin of 166.1 (identical fixture, only the verdict SHA differs) and 166.1 is red-proven. 166.8/166.10/166.12 each turn red under a distinct named mutation (round 1's B/D/C, and my mutation H below re-turns 166.9). 166.11 carries its own explicit setup sanity checks (166.11.0/0b/0c) that assert the corruption is real before relying on it — the right discipline. **No third precondition-guaranteed assertion found.**

### (d) End-to-end: this branch's own Phase-3 squash+archive still PASSES

Re-run at `7c9f63d` (round 1 established this at `b5e4aef`). Cloned the worktree, attached the real `origin`, `git reset --soft $(git merge-base origin/main 7c9f63d)` + re-commit — **squash tree byte-identical to the reviewed tree (YES)** — then a real archive commit (`git mv` the change dir under `openspec/changes/archive/2026-09-09-…`, add `openspec/specs/verdict-sha-binding/spec.md` and an `auditor-report.md`): 19 files changed, **0 outside `openspec/`**. Then Decision 1's exact comparison, `PATHS` union = 52 paths:

- with `':(exclude)openspec/*'` → **empty output, rc=0 → PASS**
- control without the exclude term → 19 paths, all archive paths

The check does not brick its own delivery, and the exclusion is load-bearing on the real artifact rather than an archive-shaped fixture.

### (e) Acceptance criteria traced

1. **`head_sha` + source recorded** — `core/scripts/emit-event.sh:257-264` (stated) and `:308-318` (inferred/absent); proven non-vacuous by my two emit-side mutations above.
2. **Condition 3 refuses on moved source, naming both SHAs and paths** — `check-merge-readiness.sh:533`; asserted verbatim by 166.1.2/166.1.3.
3. **Distinct machine-readable outcome** — exit 4, distinct from exit 1 (166.6.1 asserts a headRefOid divergence is 1, not 4) and CON-159's exit 3; `core/roles/auditor.md:166` adds the `STALE` verdict to the emission vocabulary and report template; `core/roles/orchestrator.md:138` and `:1659` carry the remediation obligation and exempt it from the circuit-breaker.
4. **Resolves by re-review** — 166.2.1/166.2.2.
5. **The non-negotiable mutation requirement** — 166.1 is exactly "record a verdict at A, add commit B, assert REFUSES" (exit 4 + exact `STALE evaluator reviewed=A head=B changed=late.txt`). I proved it red myself: disabling the core detection (`:533`, `if [ -n "$diff_out" ]` → `if false`) gives `70 passed, 7 failed`, turning 166.1.1/1.2/1.3, 166.7.1/7.2 and 166.9.1/9.2.
6. **Renders** — `diff core/scripts/X scripts/concertino/X` **identical** for all three changed files; `git diff --name-only 9dc1545..HEAD` lists exactly those three core files and their three renders, nothing else under either tree.
7. **CON-171 lease symmetry** — `git diff 9dc1545..HEAD -- core/scripts/lib/` is **empty** (0 lines); `lease_release` survives at `emit-event.sh:359`, after the CON-166 block, which is a pure `FIELDS` append with no early exit and a `|| INFERRED_SHA=""`-guarded `rev-parse`.

Full `npm test` → **exit 0** (all suites including the rendered-scripts drift gate, 19/0). Baseline `check-merge-readiness.test.sh` re-run after every restore → 77/0.

### Verdict: CONFIRM

Round 1's single blocking Change Request is fixed, and fixed in the way it asked for — with the wider shapely-but-wrong hole closed, not just the literal complaint. I found no third precondition-guaranteed assertion, no untraced acceptance criterion, and no regression in the end-to-end property this run's own auditor depends on. Ships.

### Non-blocking notes

- **`core/scripts/emit-event.sh:243` comment is inaccurate.** It says "the generic `*)` case still folds head_sha into FIELDS/OTHER_FIELDS unchanged for every other event kind" — but the new `head_sha)` arm intercepts for *every* kind, and unlike `*)` it writes only `FIELDS`, not `OTHER_FIELDS`. The behavioural consequence is nil in practice (`OTHER_FIELDS` is consumed only by `write_escalation_raised()`'s oversized-payload rebuild at `:426-526`, `head_sha` is meaningless on `escalation.raised`, and no caller passes it there), so this is a comment-accuracy nit rather than a defect. Worth correcting given this ticket's history with comments that overstate.
- **Duplicate summary line in `emit-event.test.sh`.** The CON-166 block is appended after the original `echo "$PASS passed, $FAIL failed"` / `[ "$FAIL" -eq 0 ]`, so the suite prints its tally twice (`86 passed` then `93 passed`). Harmless — no `set -e`, and the final status is correct — but folding the new block in above the terminator would read better.
- Round 1's two non-blocking notes still stand and I re-confirmed both: `emit-event.sh`'s inference runs a bare `git rev-parse HEAD` in the emitting CWD rather than `git -C "$WORKTREE_PATH"` (fail-closed direction, `inferred` already flagged as weaker); and the bootstrap ordering means the new required 4th argument only takes effect one run after the Phase-4 `concertino sync` that re-renders the auditor — worth running `concertino sync` deliberately after this merges.
