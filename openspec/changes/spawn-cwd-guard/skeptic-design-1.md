## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **Read all five artifacts** in `openspec/changes/spawn-cwd-guard/`: `ticket.md`,
  `proposal.md`, `design.md`, `tasks.md`, `specs/spawn-cwd-guard/spec.md`.

- **The cwd-reset premise — reproduced twice, live, in this very agent.** I ran
  `cd /tmp && pwd` (→ `/tmp`), then in the *next* Bash call `pwd -P` (→
  `/home/matt/Development/helio`). Repeated a second time with a `git` probe:
  after `cd /tmp`, the following call returned `pwd -P=/home/matt/Development/helio`
  and `git rev-parse --abbrev-ref HEAD=main`. So: (a) a `cd` performed inside one
  Bash call does not survive to the next; (b) I am *right now* a live instance of
  the exact condition CON-174 describes — a spawned role whose ambient cwd is a
  different repository (`helio`, branch `main`) than its `WORKTREE_PATH`. This is
  ground truth, not a claim from design.md — though design.md's own Context
  paragraph asserts the same thing.

- **`core/scripts/` inventory** (`ls`): 20 scripts, `start-servers.sh` present,
  no `assert-cwd.sh` yet — consistent with the plan.

- **`BRANCH` availability (Decision 2).** Verified true: `core/workflow-state.template.md`
  contains a literal `BRANCH: <branch>` field. `grep -n BRANCH core/roles/orchestrator.md`
  returns exactly one hit (line 1094, the auditor spawn), and
  `core/roles/auditor.md:26` does list `BRANCH`. Decision 2's factual premises hold.

- **Render-block mechanism (Decision 4).** `lib/cli/render.js:218` —
  `out.replace(/\{\{block:([a-zA-Z]+)\}\}/g, (_, n) => block(n, c, harness))`.
  The block function signature is `block(name, c, harness)`; there is **no
  per-call-site parameter channel**. Unknown names fall through to
  `default: return '{{block:' + name + '}}'` (silent literal passthrough, no error).

- **CON-139 cross-check** (`mcp__linear__get_issue CON-139`): confirmed it is
  squarely about `ORCHESTRATOR_AGENT_REF` not being a structured spawn input and
  the silent fallback-to-`main` misdelivery. Genuinely a different mechanism.

- **Relative-path script invocations in role docs** (`grep -c '^\s*scripts/concertino/'`):
  auditor 3, evaluator 6, executor 1, skeptic 4, orchestrator 18. These are
  ambient-cwd-relative.

### Verdict: REFUTE

The scope call on CON-139 is fine (see Non-blocking notes). The blocking problem
is that **the designed guard does not detect the incident the ticket was filed
for**, and the test plan meant to catch that cannot catch it either.

### Change Requests

1. **`assert-cwd.sh` as specced in Decision 1 never inspects the inherited
   ambient cwd, so it returns `READY` on the live CON-174 incident.**
   `ticket.md` is explicit that the mis-spawned executor "received the correct
   `WORKTREE_PATH`/`CHANGE_NAME`/`TICKET_ID` inputs but an actual sandboxed cwd
   resolving to lane 1's worktree." Trace Decision 1's contract against those
   inputs: it `cd`s to the (correct) lane-2 `WORKTREE_PATH`, which exists; `pwd -P`
   after that `cd` equals `realpath "$WORKTREE_PATH"` by construction; `git
   rev-parse --abbrev-ref HEAD` inside it equals lane 2's `BRANCH`. Every check
   passes → `READY` → the role proceeds, ambient cwd still lane 1. The script's
   output is a pure function of `(WORKTREE_PATH, BRANCH)` and is **invariant under
   the ambient cwd** — i.e. invariant under the only variable that distinguishes a
   normal spawn from the incident. It validates "the WORKTREE_PATH input names a
   valid worktree on the expected branch," which is a different (and never-failing,
   in the incident) proposition from "I am working in the right place."
   Required: make the check actually read the pre-`cd` ambient state (e.g. the role
   passes `"$(pwd -P)"` in, or the script records it) and define the guard around
   *that* value, or replace the mechanism entirely per CR #2.

2. **The `cd` the whole design rests on is discarded the moment the script exits,
   and design.md knows this but does not follow it through.** design.md's own
   Context says "the subagent's own `cd` calls never persist across its own Bash
   tool calls" — reproduced above. `assert-cwd.sh`'s `cd` happens in the script's
   subshell; it cannot relocate the calling role at all, not even for the caller's
   remainder of that same Bash call. Consequently spec.md's scenario "Normal spawn
   lands on an unrelated ambient cwd, then corrects itself — **THEN** the role's
   first action changes its working directory to `WORKTREE_PATH`" asserts something
   that is false as written: nothing about running this script changes the role's
   working directory for any subsequent action. `ticket.md`'s AC ("its actual
   resolved cwd (`pwd -P`) is under `WORKTREE_PATH`'s real path") is satisfied only
   trivially, inside a subshell that no longer exists.
   The residual live hazard this leaves open is concrete and measured: the role
   docs contain 32 ambient-cwd-relative `scripts/concertino/...` invocations
   (counts above), every one of which resolves against the *inherited* cwd. A
   mis-spawned executor would run lane 1's `emit-event.sh`/`next-report-number.sh`
   against lane 1's tree with `READY` in hand. Required: design a mechanism that
   actually binds subsequent work to `WORKTREE_PATH` under cwd-reset semantics —
   e.g. mandating `cd "$WORKTREE_PATH" && …` (or absolute paths) on *every* Bash
   call in the affected role docs, with the once-per-spawn script reduced to what
   it can honestly do — and state plainly in design.md which residual risk remains.

3. **Decision 5's "red-first" fixture is the vacuous fixture it claims to rule out,
   and tasks.md 1.3's redness criterion proves nothing.** Decision 5 proposes a
   fixture where "the *ambient* cwd at invocation time is deliberately a different,
   valid, pre-existing worktree … proving `assert-cwd.sh` actually inspects
   post-`cd` state rather than passing vacuously." Given CR #1, that fixture and
   the plain happy path (tasks.md 1.3 case (d)) are the *same input* to the script
   and must produce identical output; the fixture therefore has zero discriminating
   power, and it is byte-identical to the incident, which the plan labels a
   **pass**. Separately, tasks.md 1.3 asks to "confirm (a)/(b)/(c) are true
   regressions against the pre-fix tree (script absent)" — a test that fails because
   the file does not exist is red for the wrong reason and demonstrates nothing
   about the assertion's strength. Required: a redness criterion by **mutation** —
   name the specific mutant each case kills (e.g. delete the branch comparison →
   case (b) must fail; hardcode `exit 0` → the misdirected-spawn case must fail) —
   and at least one case whose result differs between "correctly spawned" and
   "mis-spawned against another lane," which today no listed case does.

4. **Decision 4's parameterization is not supported by the mechanism it cites.**
   Decision 4 says the `cwdGuard` block is "parameterized only by the role label
   passed to the script," but `lib/cli/render.js`'s block API is
   `block(name, c, harness)` with no call-site argument channel (line 218), so
   `{{block:cwdGuard}}` renders identically in all four role docs. Relatedly,
   Decision 1's contract lists `<ROLE_LABEL>` as the third positional argument but
   never says what the script does with it (it appears in no `READY`/`FAIL` output
   line). Required: either drop `ROLE_LABEL`, or specify both its effect on script
   output and how the differing per-role value reaches the rendered text (a
   `$ROLE`-style convention, four call sites, or an extension to `block()`).

### Non-blocking notes

- **The CON-139 scope call is sound and I would not block on it.** Non-Goals says
  "**Decision: left entirely to CON-139**" — unambiguous, and correct on the merits:
  I read CON-139 directly and it is an addressing/validation defect
  (`ORCHESTRATOR_AGENT_REF` unstructured, silent fallback to `main`), orthogonal to
  cwd verification. One sentence inside that Non-Goal is, however, false as a
  consequence of CRs #1–#2 and should be struck or rewritten when they are
  addressed: "there is no silent-invisible-work scenario left for THIS specific
  incident once this ships." Under the designed contract the role never BLOCKERs on
  this incident, so the scenario is left fully open. The scope *conclusion* survives
  without that sentence; only the rationale needs repair.
- Decision 2 checks out factually — `BRANCH` is already a `workflow-state.md`
  field, so this really is pure wiring, and the auditor really does already receive
  it (`core/roles/auditor.md:26`).
- `lib/cli/render.js`'s unknown-block fallback returns the literal
  `{{block:cwdGuard}}` rather than erroring, so a typo'd block name would ship
  silently into rendered role docs. Worth one assertion in the render tests when
  task 3.1 lands.
