## Skeptic Report — design gate (round 4)

Spawned cold. Rounds 1–3 reports were read as *claims only*; every conclusion
below is derived from files and commands I ran myself in this worktree. Where a
finding is tooling-sensitive (`doctor`, drift diffs) I reproduced it before
drawing a conclusion.

### What I verified (with evidence)

**A. CR1 (round 3) is genuinely and completely resolved — the phantom codex
orchestrator artifact is gone everywhere.**
- `grep -rn "concertino-orchestrator" openspec/changes/.../` excluding the
  skeptic reports returns exactly **three** hits, all now accurate and all about
  the *Claude Code* file: `proposal.md:13`, `proposal.md:39`, `tasks.md:26`. Every
  one of them describes `.claude/agents/concertino-orchestrator.md` as
  gitignored/untracked and deliberately absent from the diff. **Zero occurrences
  of `.codex/agents/concertino-orchestrator.toml` anywhere in proposal.md,
  design.md, tasks.md, or either spec file.**
- The only surviving `.codex` mentions are the two *correct* ones: `tasks.md:25`'s
  new guard ("do **not** run `concertino sync --harness=codex` … would create
  `AGENTS.md` plus `.codex/agents/*.toml` files this repo has never tracked") and
  `proposal.md:41` ("No `.codex/` output — this project renders `claude-code`
  only").
- Independently re-derived the underlying facts rather than trusting round 3:
  `bin/concertino:625` — `emitCodex()`'s `roleSections` maps all five roles
  (orchestrator included) into `AGENTS.md` as `## Role: Orchestrator`, read live
  from `core/roles/orchestrator.md`; `bin/concertino:645` — the `.toml` loop is
  `for (const role of ['executor', 'evaluator', 'auditor'])`, so **no orchestrator
  `.toml` is emitted for any project, ever**. `concertino.config.json:2-4` →
  `"harnesses": ["claude-code"]`. `.gitignore:8` → `/.claude/agents/concertino-*.md`;
  `git ls-files | grep -c "^\.claude/agents"` → `0`. Every claim the new prose
  makes is true.

**B. `openspec validate --strict` passes.**
- `npx openspec validate escalation-await-reliability-offramp --strict` →
  `Change 'escalation-await-reliability-offramp' is valid` (exit 0).

**C. The narrow edits did not disturb the sound parts.**
- Both spec files re-read in full and unchanged in substance (mtime 18:52, before
  this round's edits at 19:26): `escalation-deadline-source` still specifies the
  two-branch lookup, the no-`.concertino.env` no-op, and the sourced-overrides-
  exported precedence; `escalation-trust-offramp` still covers all four of the
  ticket's Part-2 items with reader-facing scenarios. `grep` confirms **no**
  `codex`/`concertino sync` references leaked into either spec.
- Decision 1's snippet, insertion point, and rationale (design.md:43-60) are
  untouched and still match ground truth: `core/scripts/emit-event.sh:142` is
  exactly `ROOT="$(main_checkout)" || exit 0`, and `main_checkout()` uses
  `git rev-parse --git-common-dir` (resolves from a worktree). Decision 2
  (design.md:62-70) untouched.
- Round 3's two accepted non-blocking notes were applied correctly: `tasks.md:11`
  (2.3) now pins the precedence direction as exported=60 / file=0 with the
  fail-fast rationale stated inline; `tasks.md:13` (2.5) now says "Run the full
  `npm test`" and names `harness-identity.test.sh`, `cleanup.test.sh`,
  `assert-phase.test.sh` as the additional suites to watch, with the correct
  reason (they set only `CONCERTINO_HARNESS`, which `emit-event.sh` never reads).
- Round 3's notes 3 and 4 landed in `design.md:88` (the reachable-on-a-fresh-clone
  60-minute fallback as a named follow-up) and `design.md:3` / `proposal.md:5`
  (the 8 minutes correctly attributed to `bin/concertino`'s own
  `DEFAULT_ESCALATION_TIMEOUT_MIN`, "since this project sets no explicit
  override"). See non-blocking note 1 for the two spots that still say
  "configured".
- CR6's test-isolation hazard remains closed: tasks 2.1/2.2/2.3 each still require
  an isolated temp copy of the script rather than `$SCRIPT`
  (`test/scripts/emit-event.test.sh:21` points at the live `core/scripts/` tree).

**D. The precedent `tasks.md:25` cites is real and accurately characterized.**
- `openspec/changes/archive/2026-07-30-utf8-safe-context-truncation/tasks.md:14-17`
  (CON-16 task 1.4): re-render `scripts/concertino/emit-event.sh` and
  `assert-phase.sh` "via `concertino sync` (or by hand …) so the two stay
  byte-for-byte identical to `core/`".
- `git show --stat 4ddb958` confirms CON-16 actually did it: `core/scripts/
  assert-phase.sh |24`, `core/scripts/emit-event.sh |58` mirrored exactly by
  `scripts/concertino/assert-phase.sh |24`, `scripts/concertino/emit-event.sh |58`
  — a clean, scoped, two-file hand-copy with no vendored collateral. The
  hand-copy-only approach is the right shape.

**E. The pre-existing drift, reproduced twice (this is where CR2 is only
partly closed).**
- `node bin/concertino doctor`, run twice in this worktree with byte-identical
  output both times:
  `! missing: scripts/concertino/resolve-speed.sh, …`
  `! differs from core: scripts/concertino/README.md, scripts/concertino/setup-worktree.sh`
- Direct diffs: `diff core/scripts/emit-event.sh scripts/concertino/emit-event.sh`
  → exit 0 (**clean** — the hand-copy of that file will carry only CON-47's own
  change). `diff core/scripts/README.md scripts/concertino/README.md` → exit 1,
  and the delta is **exactly the CON-22 carry-over**: the `setup-worktree.sh`
  table row rewrite, a new `resolve-speed.sh` table row, and a 7-line
  `resolve-speed.sh`/`speeds.json` paragraph.
- Confirmed this is committed state, not a dirty working tree:
  `git status --porcelain` in the worktree shows only the untracked
  `openspec/changes/…` dir, and `git show HEAD:scripts/concertino/README.md`
  diffed against `core/scripts/README.md` reproduces the same 9 lines.
- Origin confirmed: `git show --stat 2846da5` (CON-22) touched
  `core/scripts/README.md`, `core/scripts/resolve-speed.sh`,
  `core/scripts/setup-worktree.sh` and **no** `scripts/concertino/` counterpart —
  CON-22 skipped the vendor step, which is why the drift exists.
- **Simulation of task 4.1 as written** (`cp core/scripts/README.md` to a scratch
  file, then `diff -u scripts/concertino/README.md <copy>`): the prescribed
  byte-for-byte hand-copy adds **+9 / -1 lines of CON-22 resolve-speed content**
  to `scripts/concertino/README.md`, before CON-47 has made its own edit to that
  file at all. That is one of the four drift items task 4.1 claims its approach
  avoids — and the one item its inventory omits.
- For completeness: the **main checkout's working tree** already has
  `scripts/concertino/README.md` byte-identical to `core/` (uncommitted —
  `M scripts/concertino/README.md`). So the collateral would disappear *if* someone
  commits that tidy to `main` first. Nothing in the change artifacts states that
  dependency, and `git diff main...HEAD` compares against committed `main`, so as
  things stand today the 9 lines land in CON-47's diff.

**F. Ticket acceptance criteria still traced end-to-end.**
- Part 1 "measure against real traces before changing prose" — satisfied by rounds
  1–2; the corrected root cause is what Decision 1 fixes, and Part 1's
  preservation constraints (`on_kill`'s trap recording `escalation.timeout`,
  `answer_discarded` for a stale `answer.json`) are untouched by a purely additive
  sourcing step and are guarded by task 2.5's full-suite run.
- Part 2 items 1/2/3/4 → tasks 3.1/3.2/3.3/3.4, plus 3.5 for the
  answers-not-timeouts scoping; all four are covered by
  `specs/escalation-trust-offramp/spec.md`'s three requirements.
- "Both parts ship together" → design.md Migration Plan, one PR. But see CR2:
  that same Migration Plan sentence is now self-contradictory with tasks.md.

### Verdict: REFUTE

The design is sound and round 3's CR1 is fully closed — I could not find a single
surviving trace of the impossible `.codex/agents/concertino-orchestrator.toml`
artifact, and the replacement prose is accurate against `bin/concertino`'s actual
`emitCodex()`. Decision 1, Decision 2, the specs, and the CR6 isolation guard all
re-verified sound.

What blocks is that CR2 is **three-quarters** closed. The hand-copy approach
correctly keeps `setup-worktree.sh`, `resolve-speed.sh`, and `speeds.json` out of
the diff — but the fourth drift item is `scripts/concertino/README.md` itself, the
one file besides `emit-event.sh` that this change legitimately edits, and the
prescribed byte-for-byte copy demonstrably sweeps 9 lines of CON-22 resolve-speed
content into CON-47's diff (finding E). Task 4.1's own inventory omits README.md
from the drift list, and task 4.4 would have the executor write a
files-modified.md note asserting the CON-22 drift is untouched — which the diff
will contradict. Separately, `design.md`'s Migration Plan still instructs "run
`concertino sync`", the exact action `tasks.md:25` now forbids in bold; an
executor reading design.md first would produce precisely the polluted diff CR2
exists to prevent. Both are one-clause fixes here; left in, they are a wasted
execution cycle or a PR the final gate has to adjudicate.

### Change Requests

1. **`tasks.md` 4.1's drift inventory omits `scripts/concertino/README.md`, which
   its own prescribed hand-copy will sweep CON-22 content into.** Ground truth
   (reproduced): `diff core/scripts/README.md scripts/concertino/README.md`
   differs by the `setup-worktree.sh` row rewrite, a new `resolve-speed.sh` row,
   and a 7-line `resolve-speed.sh`/`speeds.json` paragraph — all CON-22
   carry-over from commit `2846da5`, which updated `core/scripts/README.md`
   without vendoring it. Copying `core/scripts/README.md` byte-for-byte therefore
   adds **+9/-1 unrelated lines** to this change's diff. Pick one and say it
   plainly:
   - **Preferred:** keep the byte-for-byte hand-copy (it matches CON-16 and keeps
     `doctor` clean), but *correct the parenthetical* in 4.1 to list README.md as
     a fourth drift item that this copy **will** unavoidably bring in — naming the
     specific content (the `resolve-speed.sh` table row, the `setup-worktree.sh`
     row rewrite, the 7-line `resolve-speed.sh` paragraph) — and state it is
     expected and deliberate. Then fix 4.4 to say the same thing, instead of its
     current claim that the CON-22 drift ("`setup-worktree.sh`,
     `resolve-speed.sh`, `speeds.json`") is untouched: as written that note is
     incomplete and reads as a false all-clear to the final gate.
   - **Or:** apply only CON-47's own README hunk to `scripts/concertino/README.md`
     (leaving the pre-existing CON-22 staleness exactly as `main` has it), and drop
     "byte-for-byte identical" for that file in both 4.1 and 4.3 — `doctor` already
     reports that file as drifted today, so this changes nothing about the
     pre-existing state.
   - Optionally note the escape hatch I found: the main checkout's *working tree*
     already has this file synced to `core/` (uncommitted). If that tidy is
     committed to `main` before this branch is diffed, the collateral vanishes on
     its own. Do not rely on it silently — if the tasks depend on it, say so.

2. **`design.md:81` (Migration Plan) still says "run `concertino sync` to refresh
   the rendered copies", directly contradicting `tasks.md:25`'s bolded "**not** by
   running a full `concertino sync`".** This is the one place the round-3 edits
   didn't reach. An executor working from design.md would run the full sync and
   sweep in all four drift items plus two untracked files — the exact outcome CR2
   was raised to prevent. Reword that sentence to match tasks.md: hand-copy the
   two touched `core/` files into their `scripts/concertino/` counterparts, no
   full sync. (`proposal.md:13` is already correct; only design.md's Migration
   Plan is stale.)

### Non-blocking notes

1. **Round 3's note 4 was only half-applied.** `proposal.md:5` and `design.md:3`
   were correctly fixed to attribute the 8 minutes to `bin/concertino`'s own
   default, but `proposal.md:11` still says "the configured 8-minute value" and
   `design.md:21` still calls it "a project choice". `concertino.config.json`'s
   `dashboard` block has no `escalationTimeoutMinutes`, so it is a rendered
   default, not a project choice. Conclusion unaffected; wording only.
2. **Environmental, for the orchestrator, not this change (round 3's note 6 still
   stands, re-verified):** the main checkout is dirty —
   `M scripts/concertino/README.md`, `M scripts/concertino/setup-worktree.sh`,
   `?? scripts/concertino/resolve-speed.sh`, `?? scripts/concertino/speeds.json`.
   `cleanup.sh` checks the base worktree with `git status --porcelain` and
   escalates on `dirty`, so Phase 4's base fast-forward will escalate for reasons
   unrelated to CON-47 unless that is tidied first. Tidying it by *committing* the
   sync would also resolve CR1's collateral (see CR1's third bullet).
3. `scripts/concertino/emit-event.sh` is currently byte-identical to `core/`
   (`diff` exit 0), so that half of task 4.1 is genuinely clean — the hand-copy
   there will show only CON-47's own change. No action needed; noted so the
   executor doesn't over-generalize CR1 to both files.
