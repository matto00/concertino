## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed SHA: **b5e4aefd54d0a2aa4be9f9ad591ca48c8e384814** (branch head; commits `930f733`, `b5e4aef` over base `9dc1545`).

### What I verified (with evidence)

**Ground truth.** `git rev-parse HEAD` = `b5e4aef…`; `git diff --stat 9dc1545..HEAD` = 31 files. Read the full diff of `core/scripts/check-merge-readiness.sh`, `core/scripts/emit-event.sh`, `core/roles/auditor.md`, `lib/config.js`, `lib/cli/render.js`, `test/scripts/derive-auditor-archive-prefix.js`, and the 166.x fixture block of `test/scripts/check-merge-readiness.test.sh`.

**Priority 2 — the end-to-end question no fixture answers. Answered affirmatively, against real objects.** I cloned this worktree, added the real `origin` (`9dc1545`), and simulated Phase 3 exactly: `git reset --soft $(git merge-base origin/main b5e4aef)` + re-commit (verified the squash tree is byte-identical to the reviewed tree), then a real archive commit (`git mv openspec/changes/bind-… → openspec/changes/archive/2026-09-09-bind-…`, a new `openspec/specs/verdict-sha-binding/spec.md`, an `auditor-report.md`; 17 files changed, all under `openspec/`). I then ran Decision 1's exact comparison with `ARCHIVE_PREFIX=openspec`:

- `PATHS` union = 31 paths; `git diff --name-only b5e4aef $SQUASH_ARCHIVE -- "${PATHS[@]}" ':(exclude)openspec/*'` → **empty, rc=0 → PASS**.
- Control (same command without the exclude term) → non-empty, listing the archive paths. The exclusion is load-bearing on the real artifact, not just in a fixture.

So the check does **not** brick its own delivery, and the healthy-squash claim holds on the actual change rather than an archive-*shaped* fixture.

Separately confirmed this run cannot deadlock on the new required 4th argument: this repo's `.claude/agents/concertino-*.md` are gitignored and locally rendered, still carrying the 3-arg invocation, and the auditor's relative `scripts/concertino/check-merge-readiness.sh` resolves against the **main checkout** (`9dc1545`, old 3-arg script). `cleanup.sh` Phase 4 auto-runs `concertino sync` (`cleanup.skipSync` unset here), re-rendering the auditor for subsequent runs. Verified the missing-arg behaviour is a hard `exit 1` with a bare usage line and no `FAIL` (`bash check-merge-readiness.sh /tmp foo BAR` → `EXIT=1`), which is why the render ordering matters; see non-blocking note 2.

**Priority 1 — hunting precondition-guaranteed assertions. I applied eight mutations myself and observed each result; I did not rely on the executor's or evaluator's transcripts.**

Baseline: `bash test/scripts/check-merge-readiness.test.sh` → **77 passed, 0 failed**. Full `npm test` → exit 0 (all suites, including the rendered-scripts drift gate, 19/0).

| # | Mutation of the fix | Expected red | Observed |
|---|---|---|---|
| A | drop step 3's `':(exclude)${ARCHIVE_PREFIX}/*'` | 166.3 | **red** (166.3.1, 166.3.2) |
| B | drop the `"${patharr[@]}"` PATHS restriction | 166.8 | **red** (166.8.1/2, plus 166.10.1/2) |
| C | disable Decision 1c's empty-`PATHS` guard | 166.12 | **red** (166.12.1/2) |
| D | drop step 0's unconditional `git fetch origin <base>` | 166.10 | **red** (166.10.1/2) |
| E | swallow the `paths_r` diff's exit status (`2>/dev/null; rc=0`) | 166.11 | **red on 166.11.2 only** — 166.11.1's exit-4 stayed green because another fail-closed leg fires. This is exactly why Decision 7 mandates exact-output matching, and the exact-string assertion is what caught it. |
| H | `if [ -n "$diff_out" ]` → `if false` (kills AC 5's core detection) | 166.1, 166.7, 166.9 | **red** (7 assertions) |
| G | revert `core/roles/auditor.md` to the cycle-1 defect (`<change-dir>` for `<change-dir-root>`) | 0.1 — and, per the fixture's own comment, 166.3 | **0.1 red; 166.3 stayed GREEN** — see Change Request 1 |
| F | hardcode `ARCHIVE_PREFIX="openspec"` in the script | (none claimed) | 77/0 green — expected, since the caller-side value is what 0.1 guards |

Every Decision-7 mutation named in the design reproduces red under my own hand. Assertions A–D and H are genuinely load-bearing; E demonstrates the exact-output discipline working as designed.

**Priority 3 — acceptance criteria traced.**

1. `head_sha` recorded — `core/scripts/emit-event.sh:257-264` (explicit `head_sha)` case) and the post-loop `KIND = "verdict"` block. Observed live in this run's own log: the evaluator's PASS carries `"head_sha":"b5e4aef…","head_sha_source":"stated"` and evaluation-1's FAIL carries `…"930f733…","head_sha_source":"inferred"`. Real, not fixture.
2. Condition 3 refuses on moved source, naming both SHAs and paths — `stale_check()`, `check-merge-readiness.sh:445-540`; asserted verbatim by 166.1.2/166.1.3 (`STALE evaluator reviewed=<A> head=<B> changed=late.txt`) and proven non-vacuous by mutation H.
3. Machine-readable distinct outcome — `exit 4`, documented in the script header alongside CON-159's exit 3; `core/roles/auditor.md` gains the `STALE` verdict; `core/roles/orchestrator.md` gains the remediation obligation.
4. Resolves by re-review — 166.2.1/166.2.2 (fresh verdict at B clears; prints `PASS`).
5. **The non-negotiable mutation requirement** — 166.1 does exactly this (verdict at A, commit B, assert exit 4) and I proved it red under mutation H.
6. Renders — `diff core/scripts/X scripts/concertino/X` **identical** for all three changed files (`check-merge-readiness.sh`, `emit-event.sh`, `README.md`); `git diff --name-only 9dc1545..HEAD -- core/scripts/` lists exactly those three; the drift gate is green.
7. CON-171 lease symmetry — `git diff 9dc1545..HEAD -- core/scripts/lib/auditor-lease.sh` is **empty**; the emit-event diff touches `release_auditor_lease` **0 times**; `phase4-teardown-guard.test.sh` green (its only edit is passing the new 4th argument).

**Priority 4 — caller sweep.** `grep -rn "check-merge-readiness.sh"` over the repo: the only *invoking* callers are `core/roles/auditor.md:54` (updated to 4 args) and the two test files (updated). `docs/harness-capabilities.md` and `adapters/codex/prompt.md` mention the script by name with no argument list — no change needed.

**Priority 5 — the evaluator's ARCHIVE_PREFIX correction.** Verified and **correct**: mutation G turns only `0.1` red; 166.3 stays green. Judging sufficiency: it is **not** sufficient — see below.

### Verdict: REFUTE

One narrow but real defect, of precisely the class this ticket exists to eliminate.

### Change Requests

1. **`test/scripts/check-merge-readiness.test.sh:649-670` — fixture 166.3 is precondition-guaranteed with respect to the archive prefix, and its own comment claims otherwise.** The fixture builds its archive path *from* the value under test (`mkdir -p "$REPO/$AUDITOR_ARCHIVE_PREFIX/changes/demo"`), then excludes `$AUDITOR_ARCHIVE_PREFIX/*`. Fixture and exclusion are derived from the same variable, so the case is green for **any** value that variable takes — including the cycle-1 defect. Proof: mutation G (`core/roles/auditor.md`'s `<change-dir-root>` → `<change-dir>`, making the derived prefix the literal `openspec/changes/<CHANGE_NAME>`) leaves 166.3.1 and 166.3.2 **green**. The comment at lines 663-665 — *"a regression in that default is caught by this exact case"* — is therefore false, and is the kind of false evidential claim that leads a later maintainer to delete `0.1` as redundant.

   The coverage hole is wider than the comment. `0.1` is a *shape* check (`*/changes/*` or `*<CHANGE_NAME>*`). A prefix that is shapely but **wrong in value** — e.g. `lib/config.js`'s `changeRoot` derivation regressing to `spec` for an `openspec` project, or to an empty string — passes `0.1`, passes 166.3 (self-derived), and would make the auditor refuse **100% of deliveries**: Decision 1a's own headline failure mode, unguarded by the suite.

   Required: make 166.3's archive fixture path a **literal**, realistic archive path independent of `$AUDITOR_ARCHIVE_PREFIX` (e.g. `openspec/changes/archive/2026-01-01-demo/proposal.md`, matching what `config/examples/helio.json` actually archives), while still passing the derived value as the 4th argument. Correct or delete the false comment. Evidence required in the executor's report, in the Decision 7 style: (a) mutation G must now turn **166.3 red as well as 0.1**; (b) an additional named mutation of `lib/config.js`'s `changeRoot` derivation to a shapely-but-wrong value (e.g. forcing `spec`) must turn at least one assertion red — today it turns none. Both transcripts, exact output matched, not exit codes.

### Non-blocking notes

- **Emit-side inference resolves the wrong repository if the role emits from outside the worktree.** `emit-event.sh`'s fallback runs a bare `git rev-parse HEAD` in the emitting process's CWD, not `git -C "$WORKTREE_PATH"`. A role emitting from the main checkout would record main's HEAD, labelled `inferred`. The direction is safe (the comparison then sees the branch's whole contribution and refuses, fail-closed), and Decision 2 already declares `inferred` a weaker guarantee — but tightening this to the worktree, or making `stated` mandatory once logs show it is universal, is worth the follow-up the design already contemplates.
- **Bootstrap ordering, for the human, not for this diff.** The new 4th argument is required and the rendered `.claude/agents/**` are gitignored, so the safety property first applies one run *after* the Phase-4 `concertino sync` that re-renders the auditor. `cleanup.sh` **skips** that sync when another run is live (it prints a note). In a fleet batch, a skipped sync leaves a stale 3-arg auditor calling a merged 4-arg script, which is a bare `exit 1` usage error with no `FAIL` line — read as `BLOCKER` by the auditor. Worth running `concertino sync` deliberately after this merges rather than relying on the batch to do it.
- `core/roles/auditor.md`'s new `STALE` verdict is added to the emission vocabulary and the report template consistently; the orchestrator's circuit-breaker table covers exit 4. No gap found.
