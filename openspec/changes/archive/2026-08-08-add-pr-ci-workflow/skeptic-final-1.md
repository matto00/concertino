## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

**Ground truth re-established (not trusted from evaluator narrative)**
- `git log --oneline HEAD --not origin/main` -> single commit `963bcbd`. The
  worktree's local `main` ref is stale (points at `94604ca`, several merges
  behind `origin/main`), which is why a naive `git diff main...HEAD` shows
  ~64 files (CON-93/94/95's already-merged work). Diffed against
  `origin/main` instead: `.github/workflows/pr-ci.yml` (45 lines, new) plus
  10 `openspec/changes/add-pr-ci-workflow/` planning files — 11 files, 583
  insertions, 0 deletions. This is the real change scope; confirms the
  evaluator's "isolated via the single-commit diff" claim in
  `evaluation-1.md` was accurate, not hand-waved.
- Read `.github/workflows/pr-ci.yml` in full and `.github/workflows/publish.yml`
  in full.

**AC1 — "A workflow runs `npm test` on `pull_request` against `main` and on
push to `main`"**
- `pr-ci.yml:9-13`: `on: pull_request: branches: [main]` and
  `push: branches: [main]`, job runs `npm test` (`pr-ci.yml:44-45`). Met.

**AC2 — "Runs on at least the `engines.node` floor and the version
`publish.yml` publishes from"**
- `package.json:19-21` declares `"engines": {"node": ">=16"}`.
- `.github/workflows/publish.yml:28` pins `node-version: 22`.
- `pr-ci.yml:26` matrix is `node-version: [16, 22]` — exactly both. Met.

**AC3 — "`check-merge-readiness.sh` condition 1 becomes meaningful... a PR
with a failing suite reports FAIL rather than an empty-rollup pass"**
- Mechanism: `check-merge-readiness.sh` reads `gh pr view --json
  statusCheckRollup`; a `pull_request`-triggered workflow populates that
  rollup with a real check run, so a failing `npm test` step produces a
  non-success entry the script's existing rollup-aggregation logic already
  handles. Confirmed the script's rollup logic itself is untouched (see
  AC4) — this is a genuine "cause fixed, not a script patch" resolution,
  matching the ticket's explicit non-goal. The live "does GitHub actually
  populate/aggregate this correctly" leg is inherently unverifiable without
  a real PR — correctly deferred to tasks.md 2.2/2.4 and the post-PR
  auditor per the task's explicit scope note. Not a REFUTE reason.

**AC4 — "No change to `check-merge-readiness.sh` itself"**
- `git diff origin/main...HEAD -- core/scripts/check-merge-readiness.sh` ->
  empty output, exit 0. Confirmed independently (not just trusting
  evaluation-1.md's claim).

**Design Decision 5 (git-identity fix) — scrutinized directly, not just
read**
- Confirmed via `grep` that `test/answer.test.js`, `test/cli-help-flags.test.js`,
  and `test/ticket-text.test.js` each call bare `git init` / `git commit
  --allow-empty` (execFileSync, no `-c user.name=`/`user.email=` scoping) —
  these three genuinely depend on a global identity. Cross-checked the other
  files in the repo that also call `git init`/`git commit`
  (`test/config.test.js`, and the `test/scripts/*.test.sh` suites) — every
  one of those already scopes identity inline via `-c user.email=... -c
  user.name=...` or an explicit local `git config`, so the three-file list
  in the workflow's comment is accurate and complete, not merely plausible.
- **Independently reproduced the root cause**, not trusting design.md's
  claimed container repro: ran `HOME=<fresh empty dir> node --test
  test/answer.test.js` — reproduced 6/6 failures, `Author identity unknown
  / *** Please tell me who you are.`, exactly the documented failure mode.
- **Independently reproduced the fix**: in that same fresh `HOME`, ran the
  exact two commands the workflow runs (`git config --global user.name
  "github-actions[bot]"` / `user.email
  "github-actions[bot]@users.noreply.github.com"`), then re-ran `node --test`
  across all three identity-dependent files -> `# pass 34, # fail 0`. This
  confirms Decision 5's fix is both correctly targeted and sufficient.

**Local `npm test` (task 2.1's claim, and a general regression check)**
- Ran `npm test` fresh myself (Node v22.23.2) to completion: exit code 0,
  `grep -c "^not ok"` on the full log = 0, final tally lines show `0 failed`
  throughout. Confirms no regression and the local-Node-22 leg of the
  matrix's intent.

**Scope discipline**
- `git diff origin/main...HEAD --stat` confirms only the workflow file and
  the change's own `openspec/` planning artifacts were touched — no
  unrelated file changes, matching the "no change to `publish.yml`" and "no
  change to `check-merge-readiness.sh`" non-goals.

**UI gate**
- N/A per task input — no UI configured for this project, and this change
  is a CI-config-only change (no dev server relevant).

### What I could not verify (correctly out of scope)
- Whether GitHub Actions' hosted runner actually schedules/passes Node 16 on
  `ubuntu-latest` today, and whether `check-merge-readiness.sh` sees the
  populated rollup correctly end-to-end on a live PR — both require a real
  PR/Actions run. tasks.md 2.2/2.4 are correctly left unchecked and are
  explicitly deferred to the post-PR auditor per this task's own
  instructions; not treated as a REFUTE reason.

### Verdict: CONFIRM

### Non-blocking notes
- Matches evaluation-1.md's suggestion: once a real Actions run exists,
  confirm `actions/setup-node@v4` actually provisions Node 16 (EOL) on
  `ubuntu-latest`, and that `gh pr checks` shows both matrix legs green —
  this is exactly what tasks.md 2.2 exists to close.
