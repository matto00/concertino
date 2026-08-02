## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

- **Ground truth diff**: `git diff main...HEAD --stat` (23 files, +1769/-90).
  Read every non-test source file in full: `core/scripts/setup-worktree.sh`,
  `core/roles/orchestrator.md`, `lib/config.js`, `bin/concertino`,
  `lib/ui/linear.js`, `docs/config-reference.md`, `docs/harness-capabilities.md`,
  plus proposal.md, design.md, tasks.md, spec delta
  (`openspec/changes/per-ticket-harness-override/specs/harness-identity/spec.md`).

- **AC traceability** (ticket.md) — each of the 7 ACs traced to real code:
  1. Label read at Setup: `core/roles/orchestrator.md` Setup step 1 (`labels`
     via `mcp__linear__get_issue`, no new call).
  2. Override precedence over both project default and runtime detection:
     `core/scripts/setup-worktree.sh` lines 152-160 (`HARNESS`/`HARNESS_SOURCE`).
  3. No-regression when absent: verified independently (see below) and by
     pre-existing test sections a/b/c in `test/scripts/harness-identity.test.sh`
     still passing unmodified.
  4. Fail loud, before worktree setup: two call sites —
     `core/roles/orchestrator.md` Setup step 1 hard stop (before branch
     derivation/script call) and `setup-worktree.sh` lines 118-127
     (validated before `REPO_ROOT="$(git rev-parse --show-toplevel)"` at
     line 192, i.e. before any git/worktree op).
  5. `concertino validate` surfaces/validates overrides: `bin/concertino`
     `cmdValidate`/`buildTicketHarnessCheck` + `lib/config.js`
     `classifyHarnessOverride`. Reproduced live (see below).
  6. Docs updated: `docs/config-reference.md` and `docs/harness-capabilities.md`
     both updated and cross-linked.
  7. No local-llm adapter added — confirmed, out of scope as declared.

- **Decision 5 (HARNESS vs MODEL_TIER_HARNESS split) — independently
  reproduced, not just re-read the executor's claim.** Built a throwaway
  scratch git repo + copied `setup-worktree.sh`/`resolve-speed.sh`/
  `emit-event.sh`/`speeds.json` out of the worktree, then ran the real script
  directly (not the test harness the executor wrote):
  - `CLAUDECODE=1 setup-worktree.sh TEST-500 feat/500 default codex` →
    `READY harness=codex`, `READY harness_source=ticket-override` (override
    wins for identity despite the contradicting `CLAUDECODE` runtime signal).
  - Same run's `READY models=` →
    `{"orchestrator":"sonnet","executor":"sonnet",...}` — i.e. Claude Code
    model ids, NOT Codex's (`codex-mini-latest`/`gpt-5.1-codex`), confirming
    `MODEL_TIER_HARNESS` (fed to `resolve-speed.sh`) is never influenced by
    `HARNESS_OVERRIDE` even when the override contradicts the live runtime
    signal — this is the exact regression the design-gate round-1 REFUTE was
    about.
  - `CLAUDECODE=1 setup-worktree.sh TEST-502 feat/502 default local-llm` →
    `FAIL unsupported harness 'local-llm' — no adapter implemented
    (implemented: claude-code codex)`, exit 1, and confirmed via
    `git show-ref --verify --quiet refs/heads/feat/502` (exit 1 = branch was
    never created) that no worktree/branch mutation happened.
  - Code-read confirms `core/scripts/setup-worktree.sh` and
    `scripts/concertino/setup-worktree.sh` are byte-identical
    (`diff` → empty), so the synced copy actually running in this repo's own
    delivery flow matches what I exercised.

- **`concertino validate --ticket` reproduced live** (not just via the test
  file): built two scratch configs.
  - `ticketProvider.kind: "manual"` + `--ticket=CON-99` →
    `✓ ticket harness  --ticket live-checking is only implemented for
    ticketProvider.kind "linear" today (this project: "manual")` — matches
    spec's non-linear scenario, no crash.
  - `ticketProvider.kind: "linear"` + `--ticket=CON-99` with
    `LINEAR_API_KEY` unset → `error: linear: LINEAR_API_KEY is not set`,
    exit 1, no stack trace, no network call attempted (fails before fetch) —
    matches AC4's "fail clearly and early."

- **Full test suite re-run myself**: `npm test` in the worktree → exit 0.
  `node --test` summary: `tests 1280 / pass 1280 / fail 0`. All 17 chained
  bash test scripts (`emit-event`, `persist-evidence`,
  `gather-escalation-context`, `triage-followup`, `assert-phase`,
  `start-servers`, `watch-smoke`, `doctor-artifacts`, `ticket-pattern`,
  `escalation-loop`, `sync-core-resolution`, `harness-identity`,
  `resolve-speed`, `cleanup`, `doctor-base-branch`, `auditor-render`,
  `check-merge-readiness`) report `N passed, 0 failed` — grepped full output
  for `fail|not ok|✗` outside intentional test-name text; none found.
  `test/scripts/harness-identity.test.sh` section (d) contains the specific
  regression assertions (`d.1`-`d.4`), all passing, including `d.4`'s
  explicit "must NOT contain codex's model ids" check on both `READY models=`
  and the `run.start` event.

- **No scope creep**: the only change outside the ticket's direct footprint
  is `scripts/concertino/speeds.json`'s `executionCycles: 7 → 3` — confirmed
  this is a legitimate resync byproduct (`concertino.config.json`'s own
  `budgets.executionCycles` is `3`; the prior `7` in the synced copy was
  pre-existing drift, now corrected by the required task 2.7/3.4 resync),
  not unrelated logic change.

- **Verification-before-completion / systematic-debugging**: no bug was
  being fixed here (this is a net-new capability), so the debugging law
  doesn't apply; `files-modified.md`'s "Debugging notes" section correctly
  notes this and describes the one test-authoring self-correction (a
  redirect ordering issue in the test's own helper), which is not a
  product-code bug.

- **UI/design judgment**: N/A — this ticket touches only CLI/bash/backend
  tooling (`bin/concertino`, `setup-worktree.sh`, `lib/config.js`,
  `lib/ui/linear.js`'s data layer, docs). No dashboard UI screens changed.
  Per role instructions, no design standard is configured for this project
  and this ticket has nothing to screenshot.

### Verdict: CONFIRM

### Non-blocking notes
- Carried forward from the evaluator's report (originally the skeptic's own
  round-2 design-gate note): `harness:<value>` label matching has no documented
  normalization convention (case sensitivity / whitespace). Not blocking —
  current case-sensitive exact match is reasonable and consistent with how
  `VALID_HARNESSES` values are already written elsewhere in the codebase.
