## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/agent-merge/spec.md` in full.
- Cross-checked design claims against the actual codebase in the worktree
  (`lib/config.js`, `lib/cli/emit.js`, `lib/cli/sync.js`,
  `core/roles/orchestrator.md`, `core/workflow-state.template.md`,
  `scripts/concertino/check-merge-readiness.sh`,
  `scripts/concertino/setup-worktree.sh`, `.gitignore`).
- Confirmed the "Providers" section design.md Decision 5 anchors on actually
  exists in `lib/config.js` (`sec('Providers')`, line 551), and that
  `collectConfigIssues`'s `ok/warn/fail` helper shape (lines 294-305) matches
  what Decision 5 assumes.
- Confirmed `emitClaude`/`write()`/`dry` threading (`lib/cli/emit.js`) matches
  what Decision 4 assumes for the additive merge.
- Confirmed `agentMerge.enabled` already exists as a real config key
  (`lib/config.js:171`, `config/concertino.schema.json:206`, `init.js`,
  `README.md:33`) — the proposal correctly builds on existing infrastructure
  rather than inventing it.
- **Directly tested the two load-bearing infrastructure claims below against
  this literal worktree** (`.concertino/worktrees/.../CON-88`, i.e. ground
  truth, not narrative):
  - `ls -la .claude/` in this worktree: no `agents/` dir, no `settings.json`.
  - `ls -la /home/matt/Development/concertino/.claude/agents/`: all five
    `concertino-*.md` role files present, only in the **main checkout**.
  - `.gitignore` confirms `/.claude/agents/concertino-*.md` and
    `/.claude/commands/concertino-*.md` are gitignored (not tracked), so a
    fresh `git worktree add` never brings them along.
  - `lib/cli/sync.js`: `out = path.resolve(args.out || '.')` — `sync` targets
    the **cwd** (normally the main checkout), never `$WORKTREE_PATH`.
  - `scripts/concertino/setup-worktree.sh`: the only file-copy mechanism into
    a new worktree is `CONCERTINO_ENV_FILES`/`worktree.envFiles` (currently
    `[]` in this project's own `concertino.config.json`), which is a general
    opt-in allowlist, not something this change proposes adding
    `.claude/settings.json` to.
  - `scripts/concertino/check-merge-readiness.sh` (the script design.md
    explicitly says the new script shares a "contract" with) resolves a
    `main_checkout()` from `$WORKTREE_PATH` via `git rev-parse
    --git-common-dir` specifically because some data (the event log) lives
    only in the main checkout — the exact same class of problem
    `.claude/settings.json` has, and the exact precedent this design needed
    but doesn't use.
  - `core/workflow-state.template.md` and `core/roles/orchestrator.md`
    (grepped for every field name and every `workflow-state.md` write site):
    no `harness`/`HARNESS` field exists anywhere in the persisted state.
    Setup step 6 explicitly enumerates the fields written on the initial
    write (`SPEED, EXECUTION_CYCLES, SKEPTIC_DESIGN_ROUNDS,
    SKEPTIC_FINAL_ROUNDS, DEBUG_ATTEMPTS, MODELS,
    SECOND_FINAL_GATE_SKEPTIC, EVALUATOR_CLEAN_WORKTREE`) and `harness`/
    `harness_source` (parsed in step 3 from `setup-worktree.sh`'s `READY`
    line) is not among them.

### Verdict: REFUTE

The proposal/design is well-reasoned on paper (the two-part-opt-in framing,
the additive-merge safety posture, the honestly-disclosed
unverifiable-classifier-syntax risk are all sound), but two of its
load-bearing mechanisms are specified against infrastructure that doesn't
work the way the design assumes, verified directly against this codebase —
not just plausible nitpicks, but findings that would make the change fail to
achieve its own stated purpose (the "no behavioral or cost change to the
already-working case" claim) on every single run.

### Change Requests

1. **`check-agent-merge-permission.sh` is checked against the wrong
   directory — the design's central mechanism does not work as specified.**
   Design.md Decision 2/3, tasks.md 1.2/4.1, and `specs/agent-merge/spec.md`
   ("run `scripts/concertino/check-agent-merge-permission.sh` against the
   run's worktree immediately before spawning the auditor") all have the
   orchestrator's pre-check read `<WORKTREE_PATH>/.claude/settings.json`. But
   `.claude/settings.json` (like `.claude/agents/concertino-*.md`) is written
   only by `concertino sync`, which targets the **main checkout**
   (`lib/cli/sync.js`'s `out` defaults to cwd), and is gitignored — nothing
   copies it into a freshly created worktree (`setup-worktree.sh`'s only
   copy mechanism, `CONCERTINO_ENV_FILES`/`worktree.envFiles`, is not
   proposed to include it). Verified directly: this very worktree has no
   `.claude/agents/` or `.claude/settings.json` at all, while the main
   checkout has the full rendered set. As specified, the pre-check would
   report `FAIL "no .claude/settings.json found"` on **every** agent-merge
   run, in every worktree, even immediately after a correct `concertino
   sync` — directly contradicting the design's own "PASS → proceed... no
   behavioral or cost change to the already-working case" claim, and
   `doctor`'s own "no warning once the grant is present" scenario would never
   be reachable from a worktree-scoped check either. Required: revise
   Decision 2 (and the script's own contract) and Decision 3 (and tasks.md
   4.1, and the spec's "checks the permission grant before spawning the
   auditor" requirement) to resolve and check the **main checkout**, not
   `$WORKTREE_PATH` — following this codebase's own existing precedent for
   exactly this class of problem:
   `scripts/concertino/check-merge-readiness.sh`'s `main_checkout()` helper
   (resolves the main checkout from `$WORKTREE_PATH` via `git rev-parse
   --git-common-dir`, used there because the event log it needs also lives
   only in the main checkout, not the worktree) and/or
   `scripts/concertino/emit-event.sh`'s identical `ROOT`-resolution pattern.
   Also worth resolving explicitly: does Claude Code's permission classifier
   for a session actually consult a worktree-scoped `.claude/settings.json`
   at all, or only the session's project-root one? If it's the latter (which
   the sync-always-targets-cwd architecture strongly suggests), checking the
   main checkout is not just a workaround for the copy problem — it is the
   *correct* location regardless.

2. **The pre-check's harness gate depends on a `workflow-state.md` field
   that does not exist.** Design.md Decision 3 says the orchestrator's
   pre-check runs "only when `claude-code` is this run's resolved harness
   (read from `workflow-state.md`'s `harness` field — on Codex/OpenCode this
   step is a no-op...)"; tasks.md 4.1 repeats this ("when this run's resolved
   harness (`workflow-state.md`) is `claude-code`..."). Grepped exhaustively:
   `core/workflow-state.template.md` has no `harness`/`HARNESS` field, and
   `core/roles/orchestrator.md`'s Setup step 6 — which explicitly enumerates
   every field written on the initial `workflow-state.md` write — does not
   include `harness`/`harness_source`, even though `setup-worktree.sh`'s
   `READY harness=`/`harness_source=` lines are parsed in step 3. There is no
   task anywhere in tasks.md to add this field. As written, a competent
   implementer has no data source for "this run's resolved harness" at Phase
   3 Delivery. Required: either (a) add a task to persist `HARNESS` (and
   decide whether `HARNESS_SOURCE` is also needed) into
   `core/workflow-state.template.md` and Setup step 6's write list, or (b)
   use this exact file's own existing convention for a harness-conditional
   step — a `{{block:...}}` template conditional resolved at `concertino
   sync` render time (see `{{block:harnessResume}}` at
   `core/roles/orchestrator.md:71`), which needs no new runtime field at all
   since each harness already gets its own rendered copy of this file.

### Non-blocking notes

- `core/workflow-state.template.md`'s `PENDING_ESCALATION.kind` is a closed
  enum (`planning | blocker | budget | followup | final-gate`). The new
  permission-grant escalation doesn't map cleanly onto any of them, and
  neither design.md nor tasks.md says which `kind` it should use. Not
  blocking on its own (`blocker` is a plausible implementer choice), but
  worth stating explicitly in the design so it doesn't drift.
- Decision 1's risk disclosure (the `Task(concertino-auditor)`/`Bash(gh pr
  merge:*)` rule syntax is unverifiable in this environment) is honestly
  framed and appropriately scoped as a Non-Goal with a stated fallback — no
  objection to that part of the design as such, once Change Requests 1-2
  above are addressed and the mechanism can actually be exercised for real.
