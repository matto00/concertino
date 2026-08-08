## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
  `specs/pr-ci/spec.md` under
  `openspec/changes/add-pr-ci-workflow/` in the worktree.
- Read `.github/workflows/publish.yml` (only existing workflow; confirmed it
  triggers on `push: tags: ['v*']` + `workflow_dispatch` only, pins
  `node-version: 22`, and its header comment pins the filename to npm
  Trusted Publishing config — matches design.md Decision 1's stated reason
  for a separate file).
- Read `package.json`: `"engines": { "node": ">=16" }` and the `"test"`
  script (`node --test && bash test/scripts/*.test.sh` × 27 suites) — matches
  the ticket/design's description.
- Read `core/scripts/check-merge-readiness.sh` condition 1 (CI green):
  confirmed its documented "empty rollup passes" behavior and that the
  design correctly proposes zero changes to it — consistent with the
  ticket's explicit AC #4 and design's Non-Goals.
- Confirmed no `.github/workflows/pr-ci.yml` exists yet (`ls
  .github/workflows/` → only `publish.yml`) — this is genuinely pre-execution.
- Traced every ticket AC against `tasks.md`/`design.md`: all four are
  addressed (PR + push-to-main trigger → task 1.1; Node floor+publish
  version matrix → task 1.2/Decision 2; condition 1 becomes meaningful →
  Decision 1 rationale; no `check-merge-readiness.sh` change → task 2.3 +
  explicit Non-Goal). No placeholders, no `TODO`/`TBD`, no internal
  contradictions between proposal/design/tasks/spec found.
- **Adversarial check that surfaced a real gap**: the design assumes
  `checkout + setup-node + npm test` (Decision 4, tasks 1.1–1.3, no other
  setup step) is sufficient to get a meaningful pass/fail signal. I tested
  this assumption directly rather than trusting it, since task 2.1
  ("run `npm test` locally") would not catch it — a developer's own machine
  already has git identity configured, which masks exactly the failure mode
  below.
  - Confirmed via `gh run list --workflow=publish.yml` + `gh run view
    --job=88690272100 --log` (a real, completed `publish.yml` run) that
    `actions/checkout@v4` only ever adds `safe.directory` to the temporary
    global git config — `grep -i "user.name\|user.email"` over the full log
    returns **nothing**. GitHub-hosted runners do not pre-configure a git
    identity.
  - Reproduced this in a clean container built to mirror a real Actions
    runner as closely as practical: `ubuntu:latest` base, a genuine
    non-root user (`useradd -m runner`, not root — root-context testing
    produced a misleading npm-setuid artifact I had to rule out separately),
    official Node 16.20.2 tarball on `PATH`, **no** git identity configured
    anywhere (matching the log evidence above), then ran `node --test`
    directly against a full clone of this worktree.
  - Result: **3 of 55 test files fail**, all with `fatal: unable to
    auto-detect email address` / `Author identity unknown`:
    `test/answer.test.js`, `test/cli-help-flags.test.js`,
    `test/ticket-text.test.js`. Each creates a fresh temp dir via `git init`
    then calls `git commit` (e.g. `test/answer.test.js`'s `newRoot()`,
    lines ~26–32) with no identity ever set, local or global.
  - Confirmed the fix and that it is sufficient: adding
    `git config --global user.name ci && git config --global user.email
    ci@example.com` before `node --test` in the same harness brings the
    suite to **55/55 passing** (`/tmp/.../full-withconfig.log`: `# tests 55
    # pass 55 # fail 0`). This is Node-version-independent (the failure is
    in JS `child_process` calls, not a Node 16 vs 22 API gap), so it would
    equally strike both matrix legs.

### Verdict: REFUTE

### Change Requests

1. **Design omits a required git-identity setup step; as specified, the new
   workflow will report a permanent, spurious `FAIL` on every PR and every
   push to `main`, regardless of code correctness.** `design.md` Decision 4
   and `tasks.md` 1.1–1.3 specify `checkout → setup-node → npm test` with no
   other step. That is insufficient: `test/answer.test.js`,
   `test/cli-help-flags.test.js`, and `test/ticket-text.test.js` each shell
   out to `git commit` in a freshly-initialized temp repo with no identity
   configured, and GitHub-hosted runners do not provide one by default
   (confirmed from an actual `publish.yml` run log, and reproduced directly
   — see evidence above). Please revise the design to add an explicit step
   — e.g. `git config --global user.name/user.email` before the test step —
   and add a corresponding task under "1. Workflow file". This is not a
   hypothetical "if the suite proves flaky" risk (which is how the current
   Risks section frames failures uncovered post-hoc); it is a deterministic,
   already-reproduced failure given the suite's current content, discoverable
   before any implementation effort is spent.
   - This directly undermines the ticket's own intent for AC #3
     ("`check-merge-readiness.sh` condition 1 becomes meaningful... a PR
     with a failing suite reports FAIL"): as designed, condition 1 would
     become meaningful in the *wrong* direction — permanently FAIL instead
     of vacuously PASS — which would make `agentMerge.enabled: true` unable
     to merge anything in this repo at all, a worse regression than the
     status quo the ticket set out to fix.
   - Also worth an explicit line in the Verification tasks (section 2):
     "confirm `npm test` passes in an environment with no pre-existing git
     identity," since task 2.1 ("run npm test locally") will not catch this
     on a developer machine that already has `user.name`/`user.email` set
     globally — exactly why this only surfaces once the workflow first runs
     in CI otherwise.

### Non-blocking notes

- I did not extend this same identity-setup check to the 27
  `test/scripts/*.test.sh` bash suites (ran out of practical need once the
  primary `node --test` finding was confirmed and fixed) — worth a quick
  local sanity pass in a clean, non-root, no-git-identity shell during
  execution, in case any of those bash suites make the same assumption.
- Everything else in the design — separate workflow file to protect
  `publish.yml`'s pinned filename, the `[16, 22]` matrix scope, `pull_request`
  (not `pull_request_target`) + `push: branches: [main]`, minimal
  `permissions: contents: read`, no install step — is sound and matches
  ground truth in `publish.yml`/`package.json`/`check-merge-readiness.sh`.
  No scope drift, no missing contract updates, no ambiguity that would let a
  competent implementer read a task two ways.
