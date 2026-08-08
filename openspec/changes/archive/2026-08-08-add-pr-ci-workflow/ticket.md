# CON-96: No CI runs on pull requests — agent-merge's "CI green" gate passes vacuously

## Description

Found while running the agent-merge procedure on PR #78 (the CON-44 first slice).

### The gap

`.github/workflows/publish.yml` is the repo's **only** workflow, and it triggers on `push: tags: ['v*']` and `workflow_dispatch`. Nothing runs on `pull_request` or on `push` to `main`. There is no other CI config in the repo (no CircleCI, GitLab, Travis, Azure).

So **every merge to** `main` **lands with zero machine verification.** The suite does run — `publish.yml` has a `Self-test` step calling `npm test` — but only at publish time, on a tag, long after the code is on `main`. A regression merged today is caught at the next release, if at all.

### Why this is worse than ordinary missing CI

`core/scripts/check-merge-readiness.sh` is the deterministic pre-merge gate the auditor runs under `agentMerge.enabled: true`. Its condition 1 is "CI green", and its documented behaviour is:

> An empty rollup (no checks configured) passes.

That is a reasonable default for the script — a project with no CI shouldn't be blocked from merging by a check that doesn't exist. But it means that **in this repo**, condition 1 is satisfied vacuously on every run, for every PR, forever. Concertino ships an auditor whose first safety condition is inert in Concertino's own repository.

Concretely, on PR #78 the gate reported conditions 1 and 2 satisfied. Condition 1's "pass" was `statusCheckRollup: []`. The only thing standing behind that merge was a local `npm test` run and a human's judgement.

### Also worth fixing while here

`package.json` declares `engines: { "node": ">=16" }`, but `publish.yml` is the only place the suite runs in CI and it pins `node-version: 22`. **The declared floor has never been tested.** Anything using a Node 18+ API would ship while claiming Node 16 support.

### Why it's cheap

Concertino has zero runtime dependencies — `publish.yml`'s own comment says *"Zero-dependency CLI: no install step, nothing to lock"* and it runs `npm test` with no `npm ci`. A PR workflow is checkout + `setup-node` + `npm test`. The 27 bash suites need only `bash`, which `ubuntu-latest` has.

## Acceptance Criteria

* A workflow runs `npm test` on `pull_request` against `main` and on push to `main`.
* It runs on at least the `engines.node` floor and the version `publish.yml` publishes from, so the declared support range is actually exercised.
* `check-merge-readiness.sh` condition 1 becomes meaningful in this repo: a PR with a failing suite reports `FAIL` rather than an empty-rollup pass.
* No change to `check-merge-readiness.sh` itself — its empty-rollup behaviour is correct for consuming projects that genuinely have no CI. The gap is this repo's, not the script's.
