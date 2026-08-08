## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

1. **Ground truth diff.** Local `main` in this worktree is 2 commits behind
   `origin/main` (missing CON-93/CON-94), exactly as the evaluator noted, so
   `git diff main...HEAD` includes unrelated noise. The true CON-95 diff is
   the single commit `09b5b83` (`git log main..HEAD` / `git show --stat
   09b5b83`): 13 files, matching `files-modified.md` and `evaluation-1.md`.

2. **AC 1 (teamNotFoundMessage guard test)** — `test/watch.test.js` gained
   `'a persisted team-not-found cache row together with an unresolvable
   ticketProvider.kind renders a gate message, not a crash'`. I did not just
   read it — I temporarily removed the `try/catch` around
   `linear.teamNotFoundMessage(...)` in `lib/ui/watch.js`'s `ensureLaunchPad`
   and reran `node --test test/watch.test.js`: the new test failed with
   exactly the uncaught-throw stack the guard exists to prevent
   (`moduleFor → teamNotFoundMessage → ensureLaunchPad → openLaunchPad`).
   Restored the file (`git diff --stat lib/ui/watch.js` clean afterward) and
   confirmed it passes again. This is a real regression guard, not
   decoration.

3. **AC 2 (duplicated test removed)** — `test/launchpad.test.js`'s
   `launchPadStatus`-calling test is gone (`git show 09b5b83 --
   test/launchpad.test.js`). `test/ticket-provider.test.js:19-20`
   (`'launchPadStatus dispatches to local, which needs no api key'`) still
   asserts `provider.launchPadStatus(LOCAL_CFG, {}).enabled === true` —
   confirmed by direct read, same assertion the deleted test made.

4. **AC 3 (magic threshold fix)** — Read `lib/ui/screens/launchpad.js:280`:
   the gate message is truncated via `f.truncate(msg, cols - 4)` with `cols`
   defaulting to 80 (line 257: `Math.max(50, (opts && opts.cols) || 80)`) —
   budget 76, matching the test's `GATE_MESSAGE_BUDGET = 80 - 4`. Computed the
   actual long-kind message length in `node -e`:
   `'launch pad needs ticketProvider.kind "linear" or "local" — not
   "kubernetes-provider"'` is 84 chars, genuinely exceeding the 76-char
   budget, so the added truncation assertion exercises a real regression,
   not a case that trivially passes.

5. **AC 4 (parseTicket try/catch move)** — `git show 09b5b83 --
   lib/ui/tickets/local.js` confirms `parseTicket(...)` now runs inside the
   existing `try` block in `readTickets`, with the identical `unreadable++`
   fallback on either failure path. `npm test` passing (see #8) confirms no
   behavior regression.

6. **AC 5 (dead exports) + documented deviation** — Verified independently,
   not taken on the executor's/evaluator's word:
   - `grep -rn TICKETS_DIR lib/ test/` shows it only as an unexported
     internal `const` inside `local.js` itself (still used at 4 call sites)
     — zero references to the *export* anywhere else. Correctly removed from
     `module.exports`.
   - `grep -n STATES test/scripts/ticket-state-vocabulary.test.sh` confirms
     line 21: `node -e "console.log(require('$ROOT/lib/ui/tickets/local.js
     ').STATES.join(' '))")"` — a genuine runtime `require(...).STATES`
     reference. `package.json`'s `test` script chains this exact script. Ran
     it standalone: `bash test/scripts/ticket-state-vocabulary.test.sh` → `6
     passed, 0 failed`. The ticket's "zero references" premise was factually
     wrong for `STATES` and right for `TICKETS_DIR`; the executor's
     deviation (keep `STATES`, remove only `TICKETS_DIR`) is the only choice
     that doesn't break a real, currently-passing gate. Confirmed correct.

7. **AC 6 (prototype-chain hardening)** — Read the diff: `MODULES` and
   `ALIASES` in `lib/ui/ticket-provider.js` are now
   `Object.assign(Object.create(null), {...})`. I did not just trust the
   comments — ran a live probe against the actual module:
   `provider.launchPadStatus({ticketProvider:{kind:'constructor'}}, {})` /
   `'toString'` / `'hasOwnProperty'` / `'__proto__'` all threw the expected
   `'...not "constructor"'`-style gate message (no silent resolution to an
   inherited member). Confirmed by a side-by-side `node -e` that a plain
   `{}`-backed table *does* resolve `MODULES['constructor']` to
   `[Function: Object]` while the `Object.create(null)` version correctly
   returns `undefined` — the fix demonstrably closes the exact hazard AC 6
   names. (Non-blocking note: no automated regression test asserts this
   directly — same gap the evaluator flagged as non-blocking; I verified it
   manually instead. See below.)

8. **AC 7 (Accepted-as-is items untouched)** — `git show --stat 09b5b83`
   touches only `lib/ui/ticket-provider.js`, `lib/ui/tickets/local.js`,
   `test/launchpad.test.js`, `test/ticket-provider.test.js`,
   `test/watch.test.js`, plus this change's own openspec artifacts. None of
   the five accepted-as-is code paths (`lib/ui/config.js` labels handling,
   frontmatter fence parsing, `lib/ui/controllers/draft.js`, `ensureLaunchPad`'s
   catch) appear in the diff.

9. **AC 8 (full suite passes)** — Ran `npm test` fresh myself (not reusing
   the evaluator's claim): `node --test` → `1681` numbered tap
   assertions, `grep -c "^not ok"` → `0`; exit code `0`. All chained shell
   gates in `package.json`'s `test` script (including
   `ticket-state-vocabulary.test.sh`) reported `N passed, 0 failed`. The
   `fail`/`FAIL` substrings visible in the log are literal expected-string
   assertions inside the shell test suites' own subtests (e.g. `ok FAIL
   printed to stderr`), not real failures — verified by reading them in
   context, not just grepping.

### Non-blocking notes

- Same gap the evaluator already flagged: task 2.3's `Object.create(null)`
  hardening has no dedicated automated regression test (a `kind:
  'constructor'`/`'toString'`/`'hasOwnProperty'` case in
  `test/ticket-provider.test.js`). AC 6 does not mandate a test, and I
  independently verified the fix works via a live probe (see #7 above), so
  this does not block delivery — but it would be a cheap, worthwhile
  follow-up test to add so the hardening isn't only provable by code
  inspection/manual probe.
- Design.md's Decision list still says "remove TICKETS_DIR and STATES"
  (written before the STATES conflict was discovered) — expected, since
  design.md is a planning artifact and the deviation is correctly documented
  downstream (tasks.md, files-modified.md, evaluation-1.md, and a code
  comment at `lib/ui/tickets/local.js:25-29`). Not a defect.

### Verdict: CONFIRM
