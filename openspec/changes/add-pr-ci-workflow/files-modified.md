- `.github/workflows/pr-ci.yml` — new workflow, separate from `publish.yml`
  (whose filename is pinned by npm Trusted Publishing). Triggers on
  `pull_request` (targeting `main`) and `push` to `main`. Runs a `test` job
  on a Node `[16, 22]` matrix (the `engines.node` floor and the version
  `publish.yml` publishes from) via `actions/setup-node@v4`. Configures a
  global git identity (`git config --global user.name`/`user.email`) before
  `npm test`, since GitHub-hosted runners have no identity by default and
  `test/answer.test.js`, `test/cli-help-flags.test.js`, and
  `test/ticket-text.test.js` build throwaway `git init` +
  `git commit --allow-empty` fixtures that fail without one (design.md
  Decision 5). `permissions: contents: read` at workflow scope, no install
  step (zero runtime dependencies, matching `publish.yml`'s own pattern).

## Pending follow-up (not completable by this executor stage)

`tasks.md` 2.2 and 2.4 require an actual GitHub Actions run against a real
PR (`gh pr checks` on both matrix legs, confirming the three
git-identity-dependent test files pass in CI, not just locally). That
requires the branch to be pushed and a PR opened — outside this executor
stage's scope (no push/PR-creation step in the executor's instructions).
As a substitute local probe validating the same root-cause hypothesis
design.md Decision 5 relies on: running `test/answer.test.js`,
`test/cli-help-flags.test.js`, and `test/ticket-text.test.js` under
`node --test` with `HOME` pointed at a fresh directory with no git
identity reproduced 6/6 failures in `answer.test.js` (git identity
missing); re-running with `git config --global user.name`/`user.email`
set in that same fresh `HOME` (the exact commands the workflow runs) then
passed all 34 tests across the three files with `# fail 0`. This confirms
the workflow's git-identity step addresses the documented root cause, but
does not substitute for the real-runner verification 2.2/2.4 call for —
whoever pushes this branch and opens the PR should confirm `gh pr checks`
shows both matrix jobs green before considering 2.2/2.4 done.
