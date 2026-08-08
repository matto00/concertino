## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

- **Isolated the actual CON-92 diff.** `git diff main...HEAD` in this worktree
  is inflated (49 files) because the local `main` ref hasn't fast-forwarded
  past CON-44 — `git merge-base --is-ancestor main 6b8a226` succeeds, and
  `origin/main` (fetched) already contains CON-90 (`#79`) and CON-91 (`#80`)
  on top of CON-44, confirming those are already-landed commits, not scope
  creep introduced by this ticket. I re-verified this independently (did not
  trust the evaluator's claim) by comparing `git log --oneline main -5` vs
  `git log --oneline origin/main -5`. CON-92's actual, sole contribution is
  commit `a535e4b`, sitting on `6b8a226`. All further verification below is
  against `git diff 6b8a226..a535e4b`, which touches exactly: `lib/cli/watch.js`,
  `lib/ui/watch.js` (comments only), `lib/ui/ticket-provider.js` (comments
  only), `test/cli-watch.test.js` (new), `test/watch.test.js` (comments
  only), `test/ticket-provider.test.js` (comments only), plus the
  `openspec/changes/normalize-watch-config/` planning tree.

- **AC1** ("`watch()` receives a normalised config, or the reason it
  deliberately does not is documented at the call site") — read
  `lib/cli/watch.js` in full (46 lines). `cmdWatch` now imports `withDefaults`
  and, on a successful `JSON.parse`, attempts `withDefaults` on a deep clone
  (`JSON.parse(JSON.stringify(raw))`), with an inline comment (lines 15-27)
  explaining why, and a second comment (lines 31-37) at the fallback branch
  explaining the deliberate raw-object fallback. Both are directly at the
  call site, matching AC1 exactly.

- **AC2** ("watch works without config" preserved) — traced the control flow
  by hand: no file / `JSON.parse` failure → outer catch (line 40) → `config`
  stays `{}`, byte-identical to pre-fix behavior. Parse succeeds but
  `withDefaults` throws → inner catch (line 30) → `config = raw`. I
  independently reproduced `withDefaults`'s throw behavior for all three
  missing-key sub-cases (not just the combined one the test exercises):
  ```
  project-only throws: TypeError Cannot read properties of undefined (reading 'idExample')
  ticketProvider-only throws: TypeError Cannot read properties of undefined (reading 'baseBranch')
  empty throws: TypeError Cannot read properties of undefined (reading 'baseBranch')
  ```
  All three are caught by the inner `catch`, confirming AC2 holds for every
  sub-case even though `test/cli-watch.test.js` only names the combined one
  (a non-blocking gap, correctly flagged as non-blocking by both the skeptic
  at the design gate and the evaluator — I agree it doesn't block AC2, since
  the combined case is the realistic real-world instance and the code path
  through the single inner `catch` is identical regardless of which specific
  property access throws first).

- **Downstream "comment-only" claim verified directly, not trusted.** Ran
  `git diff 6b8a226..a535e4b -- lib/ui/watch.js lib/ui/ticket-provider.js |
  grep -E '^[+-]' | grep -v '^[+-][+-][+-]' | grep -vE '^[+-]\s*//'` — zero
  output, meaning every added/removed line in both files is inside a `//`
  comment. `moduleFor`/`kindFor`/`canonicalConfig`/`ALIASES`/`ensureLaunchPad`'s
  try/catch are unchanged. This directly confirms files-modified.md's claim
  and rules out any accidental behavior change hiding in a "comment update."

- **Gates re-run myself, fresh.**
  - `node --test test/cli-watch.test.js test/watch.test.js test/ticket-provider.test.js`
    → `# tests 125 / # pass 125 / # fail 0 / # cancelled 0 / # skipped 0`.
  - Full `npm test` (chains `node --test` + ~29 bash suites) run in the
    background to completion, exit code 0 per the tool's own completion
    status (not an assertion I trusted from a report) — tail of output shows
    the final three bash suites (`set-ticket-state`, `local-provider-render`,
    `standalone-triage-render`) all `passed, 0 failed`.
  - No lint script exists in this repo (`package.json` has no `lint` entry) —
    n/a, not skipped.

- **`withDefaults`'s throw-on-missing-shape premise re-verified against real
  code**, not just design.md's claim: read `lib/config.js:147-184`. `c.project.baseBranch`
  and `c.ticketProvider.idExample` are accessed unconditionally before any
  guard, confirming the throw is real and the deep-clone-before-normalise
  design decision (to keep `raw` pristine for the fallback, since
  `withDefaults` partially mutates `c` before it can throw) is justified.

- **No scope creep**: `files-modified.md`'s list matches the isolated diff
  exactly (one production file, two comment-only files, three test files,
  one new test file). No other `withDefaults` call site (`sync`/`diff`/`eject`/`migrate`)
  touched, matching the stated Non-Goal. Tasks 1.1-4.2 all map to real diff
  hunks I read directly.

- **No UI review applicable** — this project has no design standard
  configured and this ticket has no UI/TUI-rendering change (comment-only
  downstream, one control-flow change in a non-UI CLI file); skipped per the
  gate's own N/A instruction.

### Verdict: CONFIRM

Both acceptance criteria trace to real, verified code and passing tests. The
"comment-only" claims for the two downstream files are independently
confirmed byte-for-byte (not just trusted from the evaluation report). All
gates I re-ran myself pass. No scope creep, no regressions, no placeholders.
The one gap noted at the design gate (test doesn't split the two
missing-key sub-cases) remains non-blocking — I independently confirmed both
sub-cases actually go through the same code path and are caught by the same
`catch`, so the untested sub-case is not a live risk.

### Non-blocking notes

- Same as evaluation-1.md's: `test/cli-watch.test.js`'s "missing keys"
  fallback test could be split into two (`project` present /
  `ticketProvider` present) for completeness, but I independently confirmed
  by direct `node -e` reproduction that both sub-cases throw and are caught
  identically, so this is cosmetic test thoroughness, not a defect.
