## Context

Concertino's only GitHub Actions workflow, `.github/workflows/publish.yml`,
triggers solely on a `v*` tag push or `workflow_dispatch`. It happens to run
`npm test` as a `Self-test` step, but only at publish time — long after code
has already landed on `main`. There is no workflow triggered by
`pull_request` or by `push` to `main`, so `gh pr view --json
statusCheckRollup` returns an empty array for every open PR, and
`core/scripts/check-merge-readiness.sh` condition 1 ("CI green") passes
vacuously against that empty rollup. This is a real gap: the auditor's own
merge-readiness gate has been running with an inert first condition.

`package.json` declares `engines: { "node": ">=16" }` but the only place the
suite has ever run in CI is `publish.yml`, pinned to Node 22 — so the
declared floor has never actually been exercised.

## Goals / Non-Goals

**Goals:**
- Every PR against `main`, and every push to `main`, runs `npm test` via a
  real GitHub Actions check, so `statusCheckRollup` is populated and
  `check-merge-readiness.sh` condition 1 becomes meaningful.
- Exercise both ends of the declared Node support range: the `engines.node`
  floor (16) and the version `publish.yml` publishes from (22).

**Non-Goals:**
- No change to `check-merge-readiness.sh` — its empty-rollup pass-through is
  correct for consuming projects with genuinely no CI configured; this
  change fixes the cause (no PR-triggered workflow in this repo), not the
  script's default.
- No change to `publish.yml`'s trigger, permissions, or its own `Self-test`
  step — publish-time behavior is out of scope.
- No coverage reporting, linting, or additional quality gates beyond running
  the existing `npm test` suite — that suite (27 bash suites under Node's
  test runner) is the only check this change wires up.

## Decisions

**Decision 1: A new, separate workflow file (`pr-ci.yml`), not an extension
of `publish.yml`.**
`publish.yml`'s header comment explicitly documents that its filename is
pinned on npmjs.com's Trusted Publishing config — renaming or restructuring
it breaks publishing until that external config is updated to match. Adding
new triggers to that same file risks touching a filename/structure npm
trusted-publishing depends on, for no benefit: the two workflows have
disjoint concerns (verify vs. release) and disjoint triggers. A new file
avoids that risk entirely and keeps the "publish only runs at tag time" and
"tests run on every change" concerns cleanly separated.

**Decision 2: Node version matrix `[16, 22]`, not a single version or every
intermediate LTS.**
The acceptance criteria call for exercising "at least the `engines.node`
floor and the version `publish.yml` publishes from" — exactly two points.
Concertino has zero runtime dependencies and the 27 bash-backed test suites
run under Node's built-in test runner with no framework-specific
version-sensitivity concerns raised in this ticket, so a wider matrix (18,
20) would add CI minutes without being asked for or evidently needed. Two
points is the minimum that satisfies the stated criteria and is trivially
extendable later if a floor-adjacent regression is ever found.

**Decision 3: `pull_request` (not `pull_request_target`) plus `push:
branches: [main]`.**
`pull_request` runs with the PR's own merge commit and the contributor's
permissions — correct for a same-repo project with no need for secrets
during test (no `npm ci`, no install step, matching `publish.yml`'s own
"nothing to lock" comment). `pull_request_target` exists specifically to
grant base-repo secrets/permissions to fork PRs, which this workflow doesn't
need and which would be an unnecessary privilege-escalation surface for a
test-only job. `push: branches: [main]` covers direct pushes/merges that
don't go through a PR (todo: none currently expected, but cheap to cover)
and is required by the acceptance criteria's "on push to main" line
independent of the `pull_request` trigger.

**Decision 4: `permissions: contents: read`, no install step.**
Matches `publish.yml`'s existing minimal-permissions pattern and its
"Zero-dependency CLI: no install step, nothing to lock" comment — `npm test`
runs directly against the checked-out source with no `npm install`/`npm ci`
step, since there is nothing to install.

**Decision 5: Configure a global git identity before `npm test`.**
GitHub-hosted runners never configure a git user identity by default. Three
of the suite's test files (`test/answer.test.js`, `test/cli-help-flags.test.js`,
`test/ticket-text.test.js`) build throwaway git repos in temp dirs via
`git init` + `git commit --allow-empty` as fixtures, which fails with no
identity configured — reproduced in a clean container mirroring a real
Actions runner (non-root, no git identity, official Node 16 tarball): 3/55
test files fail deterministically, independent of Node version, and pass
once `git config --global user.name`/`user.email` are set before `npm test`
runs. Every contributor's own machine already has a git identity configured,
so this gap is invisible in local development (including task 2.1's local
`npm test` run) and would otherwise only surface as a permanent, spurious
`FAIL` on every PR — the exact opposite of this ticket's goal, and worse
than today's vacuous pass, since `check-merge-readiness.sh` condition 1
would then permanently block every merge under `agentMerge.enabled: true`
regardless of code correctness. The workflow SHALL run
`git config --global user.name "..."` and `git config --global user.email
"..."` (e.g. `github-actions[bot]` / a noreply address) before the `npm
test` step, on every matrix leg.

## Risks / Trade-offs

- [Risk] A matrix of 2 Node versions doubles CI minutes for every PR push
  compared to a single-version job. → Mitigation: each job is
  checkout + setup-node + `npm test`, no install step, so absolute cost stays
  low; this is exactly the trade the ticket's "Why it's cheap" section
  argues for.
- [Risk] `check-merge-readiness.sh` condition 1 was previously vacuous
  (always PASS); after this change a genuinely failing suite on a PR now
  produces a real `FAIL`, which could surface pre-existing flakiness in the
  27 bash suites that was never gated before. → Mitigation: none needed at
  design time — if a suite proves flaky under Actions' `ubuntu-latest`, that
  is a separate, real bug to fix, not a reason to avoid gating on it; this
  is the intended effect of the ticket.
- [Risk] Missing git-identity configuration would make every PR/push
  deterministically fail 3 of 55 test files regardless of code correctness
  (see Decision 5), turning this ticket's fix into a worse regression than
  the vacuous pass it replaces. → Mitigation: Decision 5's explicit
  `git config --global` step before `npm test`, plus tasks.md 2.4 requiring
  this to be verified in an environment with no pre-existing git identity
  before this change is considered done.

## Migration Plan

Additive only — one new workflow file. No existing workflow, script, or
config is modified. No rollback beyond removing the new file if ever needed.
