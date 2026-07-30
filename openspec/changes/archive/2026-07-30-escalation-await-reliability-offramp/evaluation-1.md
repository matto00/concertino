## Evaluation Report — Cycle 1

Reviewed commit `9711cf9` on `task/escalation-await-reliability-offramp/CON-47`
(worktree clean, no uncommitted files). Primary surface: `git diff main...HEAD`.
`CLEAN_WORKTREE=true` — gates were re-run in a throwaway detached worktree at
`9711cf9`, since removed (`git worktree list` shows no straggler).

### Phase 1: Spec Review — PASS

Issues: none.

- **Ticket AC coverage.** Part 1: the ticket asked for the `--await` deadline to
  be measured against real traces before assuming the prose was wrong; the design
  gate did exactly that (premise refuted, root cause relocated to `.concertino.env`
  never being sourced), and the shipped fix is that root cause. `on_kill`'s
  trap-based `escalation.timeout` and the stale-`answer.json` `answer_discarded`
  handling are both untouched — verified by diff: the only change to
  `core/scripts/emit-event.sh` is the header comment block and the sourcing
  stanza after `ROOT="$(main_checkout)" || exit 0`. Part 2: all four prose
  requirements the ticket enumerated (corroborate-before-record; recording is
  terminal; do not reopen, naming the "really the human" failure mode; unsolicited
  claim with no standing `escalation.raised` still needs verification) are present
  verbatim-in-substance at `core/roles/orchestrator.md:533-566`, in the document's
  own imperative voice, and the ticket's one-line insight ("skepticism needs a
  defined stopping point, or it isn't caution — it's a run that can never be told
  anything") is carried in the clause's opening paragraph.
- **No AC silently reinterpreted.** The absence of `--resume` and
  `check-escalation-answer.sh` is the deliberately-scoped, skeptic-confirmed
  design (design.md "Rejected approaches", rounds 1 and 2), not a gap. Both are
  documented as Non-Goals with the structural reason each is unimplementable as
  specified, and follow-ups are named in Open Questions.
- **Tasks.** All 21 items across sections 1-4 are `[x]` and each matches what the
  diff actually contains. Task 1.1's requested code comment about `source`
  overriding an exported same-named variable is present (`core/scripts/emit-event.sh:167-171`).
- **Task 4 (hand-copy / hand-edit, NOT `concertino sync`) — verified explicitly,
  since a full sync run would have been a real defect here:**
  - `git diff main...HEAD --stat` touches exactly 7 non-artifact files. `scripts/concertino/setup-worktree.sh`, `scripts/concertino/resolve-speed.sh`,
    `scripts/concertino/speeds.json`, `AGENTS.md` and `.codex/**` are **absent
    from the diff entirely** — no sync (and no `--harness=codex`) was run.
  - 4.1/4.3 `emit-event.sh`: `cmp core/scripts/emit-event.sh scripts/concertino/emit-event.sh`
    → identical; both blobs go `938399f..3254f71` in the diff, and mode stays `100755`.
  - 4.1/4.3 `README.md`: the diff hunk applied to `scripts/concertino/README.md`
    is textually identical to the one applied to `core/scripts/README.md`, and
    `diff core/scripts/README.md scripts/concertino/README.md` at HEAD yields
    exactly the same pre-existing CON-22 divergence it yields on `main` (the
    `setup-worktree.sh` row rewrite, the `resolve-speed.sh` row, and the 7-line
    `resolve-speed.sh`/`speeds.json` paragraph) — no more, no less, only shifted
    by the 6 lines this change adds. Task 4.3's condition holds precisely.
  - 4.2: no `.claude/agents/concertino-orchestrator.md` in the diff (gitignored,
    not present in the worktree); `git ls-files | grep -i orchestrator` confirms
    `core/roles/orchestrator.md` is the only tracked orchestrator artifact, so
    there is nothing else to re-render.
  - 4.4: `files-modified.md` records all seven files plus an explicit note that
    the main checkout's pre-existing CON-22 vendored drift is untouched.
- **No scope creep.** Nothing outside the impact list in proposal.md is touched.
  `lib/ui/store.js`, `lib/ui/reducer.js`, the five sibling scripts, and
  `dashboard.escalationTimeoutMinutes`/`DEFAULT_ESCALATION_TIMEOUT_MIN` are all
  untouched, matching the stated Non-Goals.
- **No regressions to other specs.** `openspec/specs/orchestrator-turn-discipline/spec.md`
  is unaffected (the new clause adds a stopping rule inside "How to raise one";
  it changes no turn-ending behavior). `escalation-context` and
  `cross-screen-escalation` requirements are untouched, as proposal.md claims.
- **Contracts / docs.** `emit-event.sh`'s usage header and `core/scripts/README.md`'s
  contract entry both document the new sourcing (tasks 1.2/1.3). Checked the
  neighbouring docs for claims this change would make stale: `docs/dashboard.md:169-177`
  ("`sync` renders it into `CONCERTINO_ESCALATION_TIMEOUT_MIN` in `.concertino.env`")
  and `docs/config-reference.md` remain accurate — neither asserted a delivery
  path this change contradicts; the fix makes the already-documented value
  actually take effect.
- **Spec deltas match the implementation.** `escalation-deadline-source`'s four
  scenarios map 1:1 onto the four new test cases; `escalation-trust-offramp`'s
  three requirements each have corresponding prose in the shipped clause.

### Phase 2: Code Review — PASS

**Gates (re-run independently by me, in a clean-room worktree — not trusting the
executor's report):**

- Per `CLEAN_WORKTREE=true`: `git worktree add --detach <scratch> 9711cf9` from
  `WORKTREE_PATH`, at a temp path scoped to `CON-47`/cycle 1. No dependency or
  env priming was needed — this project's gate is `node --test` plus bash suites
  with zero third-party deps (`node_modules` is absent from the delivery worktree
  too), and `.concertino.env` is correctly absent from the fresh checkout
  (gitignored), which is exactly the state the new "no `.concertino.env` anywhere"
  cases assume.
- `npm test` in the clean worktree: **exit 0**. `test/scripts/emit-event.test.sh`
  reports `74 passed, 0 failed`, matching the executor's claimed post-fix count.
  All 7 new CON-47 assertions pass by name (`local .concertino.env applies`,
  `local .concertino.env: timeout was recorded`, `no .concertino.env beside the
  worktree's own copy`, `main-checkout .concertino.env applies from inside a
  worktree`, `worktree case: timeout recorded in the main checkout's log`,
  `sourced .concertino.env overrides an exported timeout`, `no .concertino.env:
  default deadline still governs (still waiting)`, `no .concertino.env: raised
  but not timed out`). Every other suite in the chain also reports `0 failed`,
  including the ones task 2.5 singled out as at-risk: `escalation-loop.test.sh`
  (28/0), `harness-identity.test.sh` (21/0), `cleanup.test.sh` (28/0),
  `assert-phase.test.sh` (57/0).
- Throwaway worktree removed via `git worktree remove --force`; `git worktree list`
  confirms no straggler remains.
- `shellcheck` is not installed on this machine and is not a configured gate for
  this project (`npm test` is the whole gate), so it was not run — noted rather
  than silently skipped. The `# shellcheck disable=SC1091` directive is correctly
  placed immediately before the `if`, where it covers both `source` lines.

**Review findings:**

- **Correctness of the fix's placement.** `SCRIPT_DIR` is defined at
  `core/scripts/emit-event.sh:43` and `ROOT` at `:152`, so both are in scope at
  the sourcing stanza (`:172-176`); the stanza precedes both `ROLE`/`PROJECT`
  resolution (`:180-181`) and `TIMEOUT_MIN="${CONCERTINO_ESCALATION_TIMEOUT_MIN:-60}"`
  (`:416`), which is what makes the sourced value actually reach the deadline.
  Snippet matches design.md Decision 1 exactly.
- **No collateral override risk from moving config ahead of `ROLE`/`PROJECT`.**
  I checked `renderEnv()` (`bin/concertino:541-572`) against the real generated
  file: `.concertino.env` never emits `CONCERTINO_ROLE` or `CONCERTINO_PROJECT`,
  the only other `CONCERTINO_*` variables this script reads. So the
  unconditional-`source` override the comment documents affects
  `CONCERTINO_ESCALATION_TIMEOUT_MIN` alone today.
- **Type/robustness.** `set -uo pipefail` is unaffected: the guarded `[ -f ]`
  tests mean nothing is sourced when absent, and no `set -e` means a
  hypothetically malformed env file cannot abort the telemetry path — preserving
  the script's "ALWAYS exits 0 in normal mode" contract.
- **Readable / no magic values.** The two comment blocks explain *why* each
  branch exists (branch 1 = sibling convention + custom `--out`; branch 2 = the
  worktree case) rather than restating the code. No magic numbers introduced.
- **DRY.** Reuses the already-resolved `ROOT` rather than adding a second
  `git rev-parse --git-common-dir` — as Decision 1 specified. The two-branch
  logic is duplicated in the vendored copy only because that file is a rendered
  artifact, which is correct by design. Not extracting a shared sourcing helper
  across the six scripts is an explicit Non-Goal with a named follow-up.
- **No over-engineering.** 5 lines of logic; both dropped mechanisms stayed
  dropped.
- **Security.** No new input surface: filenames are fixed literals, no
  interpolation of untrusted data. `source` of a repo-local, sync-generated,
  gitignored config file is the pre-existing project convention across five
  sibling scripts, not a new trust boundary. Nothing in the diff touches
  `json_escape`/`json_value` or the `MAX_LINE` truncation path.
- **Tests meaningful — they would catch a real regression.** Confirmed
  independently rather than taken on trust: the executor's `files-modified.md`
  records a pre-fix probe in which 5 of the new assertions fail against the
  unpatched script (`still-running-after-20s` / `expected [1] got [0]`), which is
  the correct falsification shape — the tests fail for the exact reason the bug
  exists. The suite also covers the precedence direction (file `0` beats exported
  `60`) chosen deliberately so a wrong assertion fails fast instead of parking
  the suite for an hour.
- **Test isolation is right, and this mattered.** `script_copy()` runs every new
  case against an `mktemp -d` copy, so no `.concertino.env` is ever written into
  `core/scripts/` — which the rest of the suite invokes directly via
  `SCRIPT="…/core/scripts/emit-event.sh"` (`test/scripts/emit-event.test.sh:21`)
  and where it would have silently overridden the pre-existing cases that pass
  `CONCERTINO_ESCALATION_TIMEOUT_MIN` as a process env var. The worktree case
  nests its worktree inside the throwaway repo, so `rm -rf "$REPO"` takes the
  registration with it and nothing leaks into the real repo — `git worktree list`
  after my full-suite run confirms no stray entries.
- **`run_await_bounded` uses SIGKILL deliberately**, not TERM/INT, because those
  are precisely what `on_kill` traps to write `escalation.timeout` — using them
  would forge the evidence under test. Correct, and the reasoning is in a comment.
- **No dead code.** No unused helpers, imports, TODO/FIXME, or leftover debug
  output in the diff (`git diff --check` also clean: no whitespace errors).
- **Behavior-preserving where expected.** The two "no `.concertino.env` anywhere"
  cases pin the unchanged default path, and the full pre-existing suite passes
  unchanged, so the additive claim in the Migration Plan holds.

### Phase 3: UI Review — N/A

No UI review is configured for this project, and this change has no UI surface
(one shell script, its rendered copy, two README entries, role prose, and a
bash test suite). No dev server was started.

### Overall: PASS

### Change Requests

None.

### Non-blocking Suggestions

- `test/scripts/emit-event.test.sh` — the worktree-case setup swallows setup
  failures: `git -C "$REPO" worktree add -q "$REPO/wt" -b feat-env 2>/dev/null`.
  If that ever failed, the following `cp` would still create the directory and
  the case would fail with a misleading "still-running"/missing-log message
  instead of "worktree setup failed". Dropping `2>/dev/null` (or asserting the
  add succeeded) would make a future breakage self-diagnosing.
- The `no .concertino.env: default deadline still governs (still waiting)` case
  can only assert the negative ("not a 0-minute deadline") within 3 seconds, so
  it would not distinguish the 60-minute default from any other non-trivial
  value. That limit is inherent (task 2.4 acknowledges it) and the test comment
  says so; no action needed unless the follow-up in design.md's Open Questions
  ever re-tunes that default, at which point a directly-observable assertion
  would be worth having.
- design.md's Open Questions already name the two follow-ups this review would
  otherwise raise itself — the same `SCRIPT_DIR`-only gap in the five sibling
  scripts (with `resolve-speed.sh`'s `CONCERTINO_HARNESS` fallback as the
  concrete instance), and `TIMEOUT_MIN`'s hardcoded `:-60` still being reachable
  in a fresh clone before anyone runs `concertino sync`. Worth filing as tickets
  so they don't only live in an archived design doc.
