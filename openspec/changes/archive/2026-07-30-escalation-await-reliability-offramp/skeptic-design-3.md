## Skeptic Report — design gate (round 3)

Spawned cold. Every conclusion below is derived from files/commands I read myself
in this worktree; the rounds 1–2 reports were treated as claims, and each claim I
relied on was re-verified independently.

### What I verified (with evidence)

**A. The safety-net mechanism is genuinely and fully removed.**
- `grep -rn "check-escalation-answer"` across `proposal.md`, `design.md`,
  `tasks.md`, `specs/` returns exactly **two** hits, both deliberate historical
  records: `proposal.md:22` ("Explicitly descoped") and `design.md:35` ("Rejected
  approaches"). Zero hits in `tasks.md`. Zero hits in either spec file.
- `grep -rniE "\-\-resume|re-issue" tasks.md specs/` → no output. No task or
  requirement depends on a script that no longer exists; no orphaned section.
- Section numbering is self-consistent after the removal: `tasks.md` runs 1→4 with
  no gap; `design.md`'s "Decision 2" is now the trust off-ramp (correctly
  renumbered), and `tasks.md` section 3 maps to it. Both dropped mechanisms are
  listed under Non-Goals (`design.md:18-19`) and cross-referenced to "Rejected
  approaches", which is the right disposition.
- `openspec validate escalation-await-reliability-offramp --strict` → `Change
  'escalation-await-reliability-offramp' is valid` (exit 0).

**B. The CR6 test hazard is genuinely avoided by the rewording.**
- `test/scripts/emit-event.test.sh:21` — `SCRIPT="…/core/scripts/emit-event.sh"`,
  i.e. the live source tree, shared by every case in the suite.
- Lines 155 and 238 invoke `CONCERTINO_ESCALATION_TIMEOUT_MIN=0 "$SCRIPT"
  escalation --await …`. Because Decision 1 sources unconditionally (a sourced
  value overrides ambient env — stated in Decision 1 and in the spec), a
  `.concertino.env` dropped into `core/scripts/` would override the `=0` and hang
  both cases. The suite has no per-test timeout, so that is an indefinite hang of
  `npm test`, not a failure. **The hazard is real.**
- Tasks 2.1, 2.2, 2.3 each explicitly require an isolated temp copy of the script
  rather than `$SCRIPT`, and 2.1 states the reason inline. Hazard avoided as
  described.
- `ls core/scripts/.concertino.env` → does not exist, so branch 1 cannot fire for
  `$SCRIPT` today; combined with every case running in a `mktemp -d` throwaway repo
  (`new_repo()`, lines 29-35), neither branch fires anywhere in the existing suite.
  Design's "zero behavior change for the entire existing suite" claim confirmed.

**C. Independent blast-radius check of Decision 1 (my own, not from prior rounds).**
- `grep -n "CONCERTINO_[A-Z_]*" core/scripts/emit-event.sh` → the script reads only
  `CONCERTINO_ROLE` (145), `CONCERTINO_PROJECT` (146),
  `CONCERTINO_ESCALATION_TIMEOUT_MIN` (381).
- `renderEnv()` (`bin/concertino:543-570`) emits a fixed key set that never
  includes `CONCERTINO_ROLE` or `CONCERTINO_PROJECT`. So the only variable the new
  sourcing can change is the timeout — even though the insertion point (line 143)
  precedes the ROLE/PROJECT reads.
- `grep -rn "concertino.env" test/` → the only suite that places a
  `.concertino.env` next to a copy of `emit-event.sh` is
  `harness-identity.test.sh` (lines 137/145/153/161/169/189/208), and that file
  sets only `CONCERTINO_HARNESS`, which `emit-event.sh` never reads (harness is
  passed as a positional `harness=` field — `core/scripts/setup-worktree.sh:245`).
  No test anywhere writes `CONCERTINO_ESCALATION_TIMEOUT_MIN` into a
  `.concertino.env`. Confirms C is safe, and see non-blocking note 1.

**D. Decision 1's premises, re-verified on this worktree.**
- `scripts/concertino/.concertino.env` does **not** exist in this worktree;
  `.gitignore:5` ignores it; `concertino.config.json` has `worktree.envFiles: []`.
  The main checkout's copy exists and carries
  `CONCERTINO_ESCALATION_TIMEOUT_MIN=8`. Branch 2 is therefore the branch that
  matters in a real run — premise confirmed independently.
- `core/scripts/emit-event.sh:142` is exactly `ROOT="$(main_checkout)" || exit 0`;
  `main_checkout()` (58-67) uses `git rev-parse --git-common-dir`, which resolves
  from a worktree. Insertion point valid.
- Five sibling scripts use the `SCRIPT_DIR`-only pattern (`assert-phase.sh:26`,
  `cleanup.sh:47`, `start-servers.sh:35`, `setup-worktree.sh:70`,
  `resolve-speed.sh:77`) — the convention claim is accurate.
- Third-source corroboration of the root cause: `docs/dashboard.md:169-177` tells
  users `escalationTimeoutMinutes` "bounds how long `emit-event.sh --await`
  blocks", and `config/concertino.schema.json:125` says the same. Both are
  currently **false** (the script never reads it) and become true with this fix.
  No doc update is required as a result — the docs are already written for the
  fixed behavior.

**E. Ticket acceptance criteria traced.**
- Part 1 "measure against real traces before changing prose" — done in rounds 1–2;
  the corrected root cause is what this change fixes. Part 1's preservation
  constraints (`on_kill` trap recording `escalation.timeout`, `answer_discarded`
  for a stale `answer.json`) are untouched by a purely additive change and are
  covered by existing cases (`emit-event.test.sh:193-231` TERM/INT →
  `escalation.timeout`; `:242` `answer_discarded`), which task 2.5 requires to keep
  passing.
- Part 2 items 1–4 → tasks 3.1/3.2/3.3/3.4, plus 3.5 for the answers-not-timeouts
  scoping. Insertion point verified real: `core/roles/orchestrator.md:468` "How to
  raise one", exit-code bullets 519-533, `### Resolves in-loop` at 535, "A timeout
  is never an approval" at 525-526, manual `escalation.answered` fallback at
  529-533. Spec `escalation-trust-offramp` covers all four with scenarios.
- "Both parts ship together" → Migration Plan, one PR. ✓
- No existing spec requirement touches the `--await` deadline (`grep -rn
  "ESCALATION_TIMEOUT\|escalationTimeoutMinutes\|deadline" openspec/specs/` → no
  output), and `cross-screen-escalation`/`escalation-context` requirement lists
  don't overlap. "Modified Capabilities: (none)" is accurate.

**F. What the removal *did* leave undisturbed — and the one place it didn't hold up.**
Section 4 ("Sync and evidence") and `proposal.md`'s What Changes/Impact carry
render targets I could not reconcile with ground truth. Verified three ways:
- `emitCodex()` (`bin/concertino:623-653`): the codex `.toml` loop is
  `['executor', 'evaluator', 'auditor']` — **there is no orchestrator `.toml` for
  any project, ever**. The codex orchestrator prose renders into `AGENTS.md` as a
  `## Role: Orchestrator` section (lines 625-641). The diff path (1230-1243)
  matches.
- Probe (dry run, writes nothing) — `node bin/concertino sync --dry-run` in this
  worktree: `harnesses: claude-code`, and the render list is
  `.claude/agents/concertino-{orchestrator,executor,evaluator,skeptic,auditor}.md`
  + `.claude/commands/concertino-deliver.md`. **No `.codex/` output at all**
  (`concertino.config.json` → `harnesses: ["claude-code"]`).
- Probe, forced: `node bin/concertino sync --dry-run --harness=codex` → would write
  `AGENTS.md` + `.codex/agents/concertino-{executor,evaluator,auditor}.toml`. No
  orchestrator toml. `AGENTS.md` does not exist in this repo and `git ls-files |
  grep -c "^\.claude/agents"` → `0`; `.gitignore:8` ignores
  `/.claude/agents/concertino-*.md`.
- Pre-existing vendored drift, reproduced twice with `node bin/concertino doctor`
  (identical output both runs):
  `! differs from core: scripts/concertino/README.md, scripts/concertino/setup-worktree.sh`
  `! missing: scripts/concertino/resolve-speed.sh, …`
  Direct `diff` confirms: `scripts/concertino/setup-worktree.sh` is ~78 diff lines
  stale, `scripts/concertino/README.md` is stale by a 2-line table change plus a
  7-line paragraph — all CON-22 carry-over, none of it CON-47's. `git check-ignore`
  says `scripts/concertino/speeds.json` and `scripts/concertino/resolve-speed.sh`
  are **neither tracked nor ignored**. (`scripts/concertino/emit-event.sh` is
  currently byte-identical to core — that one is clean.)

### Verdict: REFUTE

The mechanism is sound. Decision 1 (root-cause `.concertino.env` sourcing) and
Decision 2 (the trust off-ramp) both hold up under fresh scrutiny, the safety-net
removal is clean and complete, and the CR6 rewording does what it claims. What
does not hold up is section 4 / the Impact list: it instructs the executor to
refresh an artifact that cannot exist, and sets an acceptance signal ("only the
intended sections changed") that ground truth makes unsatisfiable. Both are
one-paragraph fixes here and a wasted execution cycle (or a polluted PR) if left.

### Change Requests

1. **`tasks.md` 4.1 and `proposal.md` (What Changes bullet 3, Impact bullet 3)
   name `.codex/agents/concertino-orchestrator.toml`, which `concertino sync`
   cannot produce for any project.** `emitCodex()` (`bin/concertino:645`) emits
   `.toml` only for `executor`/`evaluator`/`auditor`; the Codex orchestrator prose
   goes into `AGENTS.md`'s `## Role: Orchestrator` section instead — and this
   project (`concertino.config.json` → `harnesses: ["claude-code"]`) renders no
   codex output at all (verified by dry-run probe). Also, `.claude/agents/
   concertino-orchestrator.md` **is** produced but is gitignored (`.gitignore:8`)
   and has never been tracked, so it will not appear in `git diff main...HEAD`.
   Revise all three places to say, accurately:
   - the tracked artifacts this change must re-render are
     `scripts/concertino/emit-event.sh` and `scripts/concertino/README.md`
     (byte-identical copies of their `core/` sources, per `copyAssets()`);
   - `.claude/agents/concertino-orchestrator.md` is regenerated locally but is
     gitignored and is deliberately absent from the diff — say so, so the
     evaluator and the final-gate skeptic don't go looking for it;
   - the Codex-side orchestrator render needs **nothing** in this change: any
     codex-configured project's own next `concertino sync` reads
     `core/roles/orchestrator.md` directly into `AGENTS.md`. This is the correct
     answer to the ticket's Notes claim that the prose is "rendered into every
     future orchestrator (Claude Code and Codex adapters both)" — state it rather
     than implying a codex file must be touched here.
   - Add an explicit guard: **do not run `concertino sync --harness=codex`** to
     satisfy this task. Doing so would create `AGENTS.md` plus three
     `.codex/agents/*.toml` files that this claude-code-only repo has never
     tracked.

2. **`tasks.md` 4.2's acceptance signal ("confirm only the intended sections
   changed") is unsatisfiable as written, because main HEAD already carries
   pre-existing CON-22 vendored drift that a full `sync` will sweep into this
   change's diff.** `concertino doctor` in this worktree (reproduced twice)
   reports `scripts/concertino/setup-worktree.sh` and
   `scripts/concertino/README.md` as differing from `core/`, and
   `scripts/concertino/resolve-speed.sh` as missing; `scripts/concertino/
   speeds.json` and `resolve-speed.sh` are neither tracked nor gitignored. So task
   4.1 as written will additionally rewrite ~78 lines of
   `scripts/concertino/setup-worktree.sh`, add the `resolve-speed` rows/paragraph
   to `scripts/concertino/README.md` (a file this change legitimately edits for a
   *different* reason, so it can't simply be reverted wholesale), and drop two new
   untracked files into the worktree. Decide this in the task list rather than
   leaving it to the executor. Either is defensible:
   - **Preferred (matches the immediately-preceding merged precedent):** scope the
     render step to the two files this change actually touches — hand-copy
     `core/scripts/emit-event.sh` → `scripts/concertino/emit-event.sh` and
     `core/scripts/README.md` → `scripts/concertino/README.md` so each stays
     byte-for-byte identical to `core/`, and skip a full `sync` entirely. This is
     verbatim what CON-16's task 1.4 did
     (`openspec/changes/archive/2026-07-30-utf8-safe-context-truncation/tasks.md`:
     "via `concertino sync` (or by hand if `concertino` isn't runnable in this
     worktree) so the two stay byte-for-byte identical to `core/`"), and it makes
     4.2's "only the intended sections changed" true again.
   - **Or:** run the full `sync` and state explicitly in the task that the
     CON-22 carry-over (`setup-worktree.sh`, the `resolve-speed` README rows,
     and the two new `scripts/concertino/` files) is expected, is to be included
     deliberately, and must be called out in `files-modified.md` (task 4.3) as
     unrelated-but-intentional so the final gate doesn't read it as scope drift.
   Whichever is chosen, 4.2's wording needs to match it.

### Non-blocking notes

1. **Task 2.5 under-scopes the regression run.** It names only
   `emit-event.test.sh` and `escalation-loop.test.sh`. Three other suites copy
   `emit-event.sh` into scratch directories and/or place a `.concertino.env` beside
   it: `harness-identity.test.sh` (137/145/…/208), `cleanup.test.sh` (56), and
   `assert-phase.test.sh`. I verified none of them can be affected (they set only
   `CONCERTINO_HARNESS`, which `emit-event.sh` never reads), but the cheap and
   correct instruction is "run the full `npm test`", naming those three as the ones
   worth watching.
2. **Task 2.3 doesn't pin the direction of the precedence test, and one of the two
   readings hangs the suite indefinitely.** Exported `=0` with `.concertino.env`
   `=60` would block for an hour with no per-test timeout; exported `=60` with
   `.concertino.env` `=0` asserts the same thing in milliseconds. Specify the
   latter explicitly — same class of hazard as CR6, one clause to close.
3. **`emit-event.sh`'s hardcoded `${…:-60}` fallback is now the only remaining path
   back to the original bug, and it's reachable.** After the fix, 60 minutes
   applies only when no `.concertino.env` is found at either location — which
   includes a **fresh clone** of a project (the vendored `scripts/concertino/*.sh`
   are committed, but `.concertino.env` is gitignored and absent until someone runs
   `sync`). Aligning that literal with `DEFAULT_ESCALATION_TIMEOUT_MIN = 8`
   (`bin/concertino:53`) would make the script safe under the ~10-minute call cap
   even with no config found, and would remove the inconsistency with what
   `docs/dashboard.md:172` and `config/concertino.schema.json:125` already promise.
   The design non-goals this deliberately, which I accept for this ticket — but it
   belongs in Open Questions as a named follow-up alongside the sibling-script
   audit, not left unmentioned.
4. **Minor factual imprecision, repeated in both `proposal.md:5` and
   `design.md:3`/`:21`:** the 8-minute value is not "configured" in this project —
   `concertino.config.json`'s `dashboard` block has no `escalationTimeoutMinutes`,
   so 8 comes from `DEFAULT_ESCALATION_TIMEOUT_MIN` (`bin/concertino:53`) via
   `renderEnv()`. The conclusion is unchanged; the wording ("the schema default of
   8, rendered into `.concertino.env`") would just be accurate.
5. **Running `sync` inside a worktree writes `scripts/concertino/.concertino.env`
   there** (dry-run probe confirms). Harmless — branch 1 then finds the same
   rendered content branch 2 would have — but it means any post-sync manual
   verification in this worktree exercises branch 1, not branch 2. If the executor
   wants to demonstrate branch 2 by hand, do it before syncing (or delete the
   worktree copy first).
6. **Environmental, for the orchestrator, not this change:** the main checkout is
   currently dirty (`M scripts/concertino/README.md`, `M
   scripts/concertino/setup-worktree.sh`, `?? scripts/concertino/resolve-speed.sh`,
   `?? scripts/concertino/speeds.json` — the same CON-22 carry-over as CR2).
   `cleanup.sh:140` checks the base worktree with `git status --porcelain` and
   escalates on `dirty`, so Phase 4's base fast-forward will escalate for reasons
   unrelated to CON-47 unless that is tidied first.
