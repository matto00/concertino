## 1. Workflow file

- [x] 1.1 Create `.github/workflows/pr-ci.yml` triggered on `pull_request`
      (targeting `main`) and `push` to `main`.
- [x] 1.2 Add a `test` job with a Node version matrix `[16, 22]` using
      `actions/setup-node@v4`.
- [x] 1.3 Configure a global git identity (`git config --global user.name`
      and `user.email`) before the test step — GitHub-hosted runners have no
      identity configured by default, and `test/answer.test.js`,
      `test/cli-help-flags.test.js`, and `test/ticket-text.test.js` each
      build a throwaway `git init` + `git commit --allow-empty` fixture that
      fails without one (see design.md Decision 5).
- [x] 1.4 Run `npm test` as the job's verification step, no install step
      (matching `publish.yml`'s "nothing to lock" pattern).
- [x] 1.5 Set `permissions: contents: read` at workflow scope, matching
      `publish.yml`'s minimal-permissions pattern.
- [x] 1.6 Give the workflow and job sensible names so the check appears
      clearly in the PR checks UI (e.g. `PR CI / test (16)`, `test (22)`).

## 2. Verification

- [x] 2.1 Run `npm test` locally to confirm the suite passes on this branch
      before relying on CI to prove it.
- [ ] 2.2 After pushing, confirm via `gh pr checks` (once the PR exists)
      that both matrix jobs run and report a real (non-empty) status, and
      that they pass (not just report a status) — since a contributor's own
      machine already has a git identity configured, this must be verified
      on the actual Actions runner, not locally. (Pending: requires the PR
      to be opened, which happens after this executor stage — see
      files-modified.md handoff note.)
- [x] 2.3 Confirm no changes were made to `check-merge-readiness.sh` or
      `publish.yml`.
- [ ] 2.4 Confirm `test/answer.test.js`, `test/cli-help-flags.test.js`, and
      `test/ticket-text.test.js` specifically pass in CI (not just the
      suite's overall exit code) — these are the three files whose fixtures
      depend on a configured git identity. (Pending: requires an actual
      Actions run — see 2.2.)
