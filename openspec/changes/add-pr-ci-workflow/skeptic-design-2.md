## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Re-read the full change set fresh: `ticket.md`, `proposal.md`, `design.md`,
  `tasks.md`, `specs/pr-ci/spec.md`, and the round-1 `skeptic-design-1.md`
  (treated as a claim to verify, not fact).
- **Round-1 change request re-check.** Round 1 REFUTEd because the design's
  `checkout → setup-node → npm test` sequence has no git-identity setup step,
  and `test/answer.test.js`, `test/cli-help-flags.test.js`, and
  `test/ticket-text.test.js` each build a fixture via `git init` +
  `git commit --allow-empty` with no identity configured, which fails
  deterministically on GitHub-hosted runners.
  - `design.md` now has **Decision 5** requiring
    `git config --global user.name`/`user.email` before the `npm test` step,
    on every matrix leg, with the reproduction evidence (3/55 files fail
    without it, 55/55 pass with it) carried over from round 1's findings.
  - `tasks.md` now has **task 1.3** ("Configure a global git identity... before
    the test step") sitting correctly between the matrix setup (1.2) and
    running `npm test` (1.4, renumbered from 1.3), and **task 2.4** requiring
    the three specifically-named files to be confirmed passing in CI, not
    just the suite's aggregate exit code.
  - I independently re-read `test/answer.test.js` (lines 25-34, `newRoot()`)
    and confirmed it calls `execFileSync('git', ['init', '-q'])` then
    `execFileSync('git', ['commit', '-q', '--allow-empty', ...])` with no
    `-c user.email=`/`user.name=` override and no prior `git config` call —
    the failure mode is real and exactly as described. `test/cli-help-flags.test.js`
    (lines 35-42, `newAnswerRoot()`) is a byte-for-byte duplicate of the same
    pattern. This matches round 1's reproduced finding; the fix (global
    `git config` before `npm test`) is the correct and sufficient remedy for
    both, since it configures identity before either file's `git commit` call
    runs.
  - This change request is **properly addressed**.
- **Adversarial extension the round-1 report flagged as an open question but
  didn't finish** (its own non-blocking note: "did not extend this same
  identity-setup check to the 27 `test/scripts/*.test.sh` bash suites").
  I did the check myself: `grep -n "git init\|git commit\|user.name\|user.email"`
  across `test/config.test.js` and the `test/scripts/*.test.sh` suites shows
  every one of them either passes `-c user.email=... -c user.name=...` inline
  on the `git commit`/`git checkout` invocation itself (e.g.
  `doctor-base-branch.test.sh`, `cleanup.test.sh`, `assert-phase.test.sh`,
  `config.test.js`) or calls `git config user.email`/`user.name` locally on
  the fixture repo before committing (`set-ticket-state.test.sh`). None of
  them rely on a global identity, so none of them are exposed to the gap
  Decision 5 fixes — the design's fix is correctly scoped to exactly the
  three files that need it, no broader change required.
- Confirmed this is still genuinely pre-execution: `ls .github/workflows/`
  shows only `publish.yml`; `git status` on the worktree shows only the
  untracked `openspec/changes/add-pr-ci-workflow/` directory, no code changes
  yet.
- Re-traced all four ticket ACs against `tasks.md`/`design.md`/`spec.md`: PR +
  push-to-main trigger (task 1.1, spec scenarios 1-2), Node floor+publish
  version matrix (task 1.2, Decision 2, spec scenarios 3-4), condition 1
  becomes meaningful in the *correct* direction now that Decision 5 prevents
  a spurious permanent FAIL (Decision 1 + Decision 5 + spec scenario "Failing
  suite reports a real failure"), no `check-merge-readiness.sh` change (task
  2.3, explicit Non-Goal). All four traced to concrete tasks/decisions.
- Checked for new placeholders/contradictions/ambiguity introduced by the
  round-2 edits: none. `design.md`'s "todo: none currently expected" (line 70)
  is an inline aside explaining *why* `push: branches: [main]` is included
  despite no current direct-push workflow, not a deferred decision blocking
  implementation — it doesn't leave anything unspecified.
- Re-read `.github/workflows/publish.yml` and `package.json`'s `engines`/`test`
  script directly (not from memory of round 1) to confirm the design's stated
  ground truth (Node 22 pin, `engines: >=16`, no-install pattern) still holds
  — unchanged since round 1, as expected for an additive-only design.

### Verdict: CONFIRM

### Non-blocking notes

- Task 2.4's phrasing ("confirm ... pass in CI, not just the suite's overall
  exit code") is slightly ambiguous about *how* to confirm this — e.g. via
  `gh run view --log` grepping for the three file names' `# pass`/`# fail`
  lines, or via the Actions UI. Not blocking: any competent implementer can
  satisfy the intent (verify those specific files pass, not just an overall
  green checkmark) with either method, and the design's own Decision 5
  evidence trail already shows exactly what a passing run should look like.
