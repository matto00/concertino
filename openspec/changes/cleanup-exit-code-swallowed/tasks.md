## 1. Throwaway-repo probes — establish ground truth before writing any fix (red-before-green)

Reconciling with the ticket's own headline framing ("show the OLD script exits 0 with zero work
done, show the NEW one exits non-zero naming the failing command and its stderr"): design-gate
rounds 1-3 established, via direct probe, that the CURRENT script already exits non-zero (128) on
the incident's own trigger — it is the CALLER (the orchestrator, per its own unmodified Phase 4
prose) that treats any exit code as irrelevant and proceeds as though cleanup succeeded. Red-
before-green therefore spans both halves, end-to-end: task 1.2 is the script-side probe (confirms
what the script's exit code/output actually is today), task 1.3 is the caller-side probe (confirms
today's orchestrator prose never surfaces that exit code as a `BLOCKER`, so end-to-end the system
behaves exactly like "exited 0, did nothing was surfaced" even though the script's own exit code
was already non-zero). §6.1 and §7 are the corresponding green probes once both halves are fixed —
together they are the direct proof of the ticket's headline criterion, not a substitute for it.

- [x] 1.1 Extend `test/scripts/cleanup.test.sh`'s existing `new_pair()` fixture builder (bare
      remote + primary clone, `cleanup.sh`/`emit-event.sh`/`git-child-env.sh` vendored in and
      committed) — do NOT build a parallel fixture harness. All work stays under a temp dir
      (`mktemp -d`), never against `/home/matt/Development/concertino` or
      `/home/matt/Development/helio`.
- [x] 1.2 Reproduce the HEL-657 incident's exact trigger (`git config core.bare true` in the
      fixture's primary checkout) and run the CURRENT, UNMODIFIED `core/scripts/cleanup.sh
      --phase4` against it as a real subprocess. Record the actual outcome — per design-gate
      round 1's own probe this is expected to be exit 128 with `fatal: this operation must be run
      in a work tree` on stderr and no `READY` line, i.e. the *script* already fails loudly here.
      Confirm this (or record what actually happens if different) before writing anything that
      assumes otherwise.
- [x] 1.3 Separately, probe the actual swallowing mechanism: with `core/roles/orchestrator.md`'s
      CURRENT, unmodified Phase 4 prose ("it always still exits 0 ... there is nothing else to
      handle here"), demonstrate that an orchestrator following that prose literally proceeds past
      a non-zero `cleanup.sh --phase4` exit without surfacing it — e.g. by grepping the current
      prose for the absence of any exit-code check, and/or replaying the incident's own event log
      (`.concertino/runs/*/events.jsonl` — read-only, real project, historical log only, no writes)
      to confirm no `BLOCKER`/escalation was ever raised for it. This is the caller-side half of
      red-before-green; task 1.2 is the script-side half.
- [x] 1.4 Record both probes' captured (red) output as the regression fixtures for §4 below.

## 2. cleanup.sh: hard-fail git operations with named-command, isolated-stderr messages

- [x] 2.1 Add the `run_git` helper (design.md Decision 2) and `fail()` exit path (which always
      prints the current `RESULT` line before exiting — see §3). Route worktree removal through
      it.
- [x] 2.2 Route the `REPO_ROOT="$(git_child ... rev-parse --show-toplevel)"` lookup and any other
      `VAR="$(git_child ...)"` assignment in the hard-failing path through the same explicit-guard
      pattern — not because `set -e` fails to catch these today (it doesn't — confirmed by design
      gate round 1's probe), but so the failure message names the specific command and isolates
      its stderr, and so the `RESULT` line reliably reflects what happened regardless of exactly
      where the failure occurred.
- [x] 2.3 Keep `worktree prune` and the fast-forward comparison path (`attempt_fast_forward`)
      soft/tolerant exactly as today — do not route these through `run_git`.
- [x] 2.4 Correct `cleanup.sh`'s own header comment (lines 24-27, "ALWAYS exits 0 ... regardless
      of whether the fast-forward below succeeded, escalated, or was skipped") to describe the
      new, narrower contract: exits 0 only when every hard-failing step succeeded; the
      fast-forward outcome specifically remains non-fatal regardless of its own result.

## 3. cleanup.sh: postcondition RESULT line, defaulted from the start, driving the exit code immediately

- [x] 3.1 Declare `WT_OK`/`BRANCH`/`BRANCH_LOCAL`/`BRANCH_REMOTE`/`FF_STATUS` to defined defaults
      (`not-attempted` / empty) immediately after the `--phase4` guard, before any step that could
      fail — so `print_result`/`fail()` never dereferences an unset variable under `set -u`
      (design.md Decision 4, closing design-gate round 1's change request 4).
- [x] 3.2 When `$WORKTREE_PATH` does not exist at script start, set `WT_OK=ok` directly — this is
      the satisfied postcondition, not `not-attempted` (design-gate round 2 change request 1: the
      idempotent-re-run case, exercised by every fixture in `test/scripts/cleanup.test.sh` today).
      When it does exist, attempt `worktree remove` via `run_git`, then IMMEDIATELY re-probe
      `[ -d "$WORKTREE_PATH" ]`; if still present, set `WT_OK=fail` and call `fail()` right there
      — do not defer this check to the end of the script (design-gate round 2 change request 2:
      the exit code must be driven by the postcondition the instant it's known to be unmet, never
      merely reported afterward while still exiting 0).
- [x] 3.3 Apply the same immediate-re-probe-drives-exit-code pattern to branch deletion: after a
      successful `branch -D` (§4), immediately re-check `git show-ref --verify` for the branch; if
      it still exists, set `BRANCH_LOCAL=fail` and call `fail()` right there.
- [x] 3.4 Print, to **stderr** (never stdout — a `RESULT` line on stdout would be silently
      captured and discarded whenever `run_git`/`fail()` fires inside a command substitution,
      e.g. task 2.2's `REPO_ROOT="$(...)"`; fixed after design-gate round 3 change request 1, its
      own probe confirmed this exact swallow), `RESULT worktree=<ok|fail|not-attempted>
      branch_local=<ok|fail|skipped|not-attempted> branch_remote=<ok|fail_or_absent|skipped|
      not-attempted> base=<FF_STATUS value>` on every exit path past the `--phase4` guard — this
      exact grammar, matching proposal.md/design.md/the `cleanup-failure-visibility` spec
      verbatim. On the success path, print it immediately before `READY cleaned worktree=...`.

## 4. cleanup.sh: branch deletion, resolvable even when the worktree is already gone

- [x] 4.1 Resolve `BRANCH` in two steps, per design.md Decision 3 (revised, design-gate round 2
      change request 3): (a) when `$WORKTREE_PATH` exists, capture the branch it has checked out
      from `git worktree list --porcelain` — a NEW, EARLIER parse of that listing, not a reuse of
      the existing parse inside `attempt_fast_forward` (which runs later, after removal, for a
      different purpose) — captured BEFORE removing the worktree; (b) when `$WORKTREE_PATH` does
      not exist (the idempotent re-run / "branch left behind" case — the ticket's own most-cited
      real scenario), search local branches via `git branch --list "*/${T}"` (`T` = the
      already-resolved ticket id); if exactly one match, use it; if zero or more than one, leave
      `BRANCH` empty and log a note rather than guessing.
- [x] 4.2 After worktree removal (or immediately, if the worktree was already absent and step 4.1b
      resolved a branch), fetch the base remote/branch, compute content-equality using the
      TWO-DOT form `git diff "${BASE_REMOTE}/${BASE_BRANCH}" "$BRANCH"` (NOT three-dot `...` —
      three-dot is merge-base-relative and is non-empty for exactly the squash-merge case this
      feature must handle; confirmed empirically in design-gate round 1: `git diff main feat`
      empty vs. `git diff main...feat` 7 lines on a squash-merged fixture branch). Delete the
      local branch via `git branch -D` through `run_git` only when equality holds and the branch
      isn't `$BASE_BRANCH` itself.
- [x] 4.3 Attempt remote branch deletion as best-effort (never a hard failure, including when the
      remote branch is already absent); report `branch_remote=ok|fail_or_absent|skipped`
      accordingly.
- [x] 4.4 Guard against ever deleting `$BASE_BRANCH` itself.

## 5. Fixture extensions — additive/opt-in only, never changing new_pair()'s default shape

`new_pair()` currently produces only a bare remote + primary clone (no worktree, no ticket
branch) — verified in design-gate round 2 (`grep -c "worktree add" test/scripts/cleanup.test.sh`
is 0). The existing 11 `prints READY ...` assertions depend on exactly that shape (they all take
the now-explicit `WT_OK=ok`-because-already-absent path — task 3.2). The extensions below MUST be
separate, opt-in helpers the new probes call, never a change to what `new_pair()` itself produces
by default.

- [x] 5.1 Add `new_worktree(base, branch)`: given a `new_pair()`-built base, adds a real linked
      worktree checked out on a named ticket branch (e.g. `bug/x/TICK-1`), committed/clean.
- [x] 5.2 Add a squash-merge helper: given a `new_worktree()` branch, squash-merges it into the
      base's `main` (content-identical, commits not ancestors) — the fixture shape design-gate
      round 1 already probed by hand; make it reusable.
- [x] 5.3 Add an optional second, unrelated `new_worktree()` call (a second live worktree/branch
      in the same base) for the scoping probe (5.11 below).
- [x] 5.4 Confirm the full existing suite still reports `73 passed, 0 failed` unmodified after
      these additive helpers exist but before any new assertion uses them (i.e. the helpers
      themselves introduce zero behavior change to existing scenarios).

## 6. Scenario probes — extend test/scripts/cleanup.test.sh using the §5 fixtures

- [x] 6.1 Re-run task 1.2's forced-failure probe (`core.bare=true`) against the FIXED
      `cleanup.sh`; confirm exit non-zero, the failing command + its isolated stderr are printed,
      `READY cleaned worktree=...` is NOT printed, and the `RESULT` line shows
      `worktree=not-attempted` (NOT `worktree=fail` — this trigger fails at the `REPO_ROOT`
      lookup, before the worktree-removal block is ever entered, so `fail` — "removal attempted,
      still present" — does not apply; corrected after design-gate round 3 change request 2).
      Capture the probe's stdout and stderr SEPARATELY (never merged with `2>&1`, which would let
      a `RESULT`-on-stdout regression pass unnoticed) and assert the `RESULT` line is present on
      stderr specifically — this is the direct regression probe for design-gate round 3 change
      request 1 (`fail()` printing `RESULT` to stderr, not stdout) and for the ticket's own
      headline criterion: this is the incident's own exact trigger and earliest failure point, so
      a probe that can't tell the two streams apart proves nothing about it.
- [x] 6.2 Probe (using 5.1+5.2): a squash-merged branch (content-identical, commits not ancestors)
      deletes cleanly via the two-dot content-equality check even though `git branch -d` would
      refuse it — assert against the real script's actual git calls and actual resulting ref
      state, not a reimplementation of the content-equality logic.
- [x] 6.3 Probe (using 5.1): a branch with genuinely unmerged content (two-dot diff non-empty) is
      left alone — `branch_local=skipped`, no `branch -D` attempted, branch ref still exists
      afterward.
- [x] 6.4 Probe: a worktree already absent but a matching `.../<TICKET_ID>` branch still present
      (delete the worktree directory out-of-band, e.g. `rm -rf`, leaving the branch) still
      resolves and deletes that branch via the naming-convention fallback (task 4.1b).
- [x] 6.5 Probe: the naming-convention fallback with zero or multiple matches reports
      `branch_local=skipped` and deletes nothing.
- [x] 6.6 Probe (using 5.1): local `main` diverged/dirty still results in overall exit 0 (the
      deliberately tolerated fast-forward outcome, unchanged by this ticket) while worktree
      removal and branch deletion both still succeed and are reported `ok` in `RESULT`.
- [x] 6.7 Probe (using 5.1): a worktree-removal that leaves the directory behind despite `git
      worktree remove` returning 0 (simulate — e.g. an immovable file inside it) exits non-zero
      immediately, with `RESULT worktree=fail`, never `exit 0`. This is the direct regression
      probe for design-gate round 2 change request 2.
- [x] 6.8 Probe: an unrelated hard git failure (e.g. simulate worktree-removal failure) still
      exits non-zero even when the fast-forward itself resolves cleanly — proves the
      fast-forward's tolerance doesn't leak into masking other failures.
- [x] 6.9 Probe (using 5.1+5.3): cleanup scoped to its own run — a second, unrelated live
      worktree/branch in the same fixture base is left completely untouched by a `cleanup.sh
      --phase4` run targeting only the first (acceptance criterion 5; also a live real-world check
      per this delivery's own constraints — the CON-87 worktree must never be touched by this
      ticket's own Phase-4 run either).
- [x] 6.10 Re-run the full existing suite; confirm it still reports at least `73 passed, 0 failed`
      (the original 11 `prints READY ...` assertions plus every other pre-existing assertion,
      unmodified) with the new assertions from this section passing on top, not in place of them.
- [x] 6.11 Every new probe above must mutate exactly one real behavior of the ACTUAL
      script/fixture under test (not a reimplementation, not an inline copy) and demonstrate red
      before the corresponding fix lands green. Specifically avoid all four of the failure modes
      that produced false-positive evidence during this same incident's own investigation: (a) a
      selftest asserting against an inline copy of logic rather than the real file being tested;
      (b) a filter/check "verified" only against a reimplementation of its own (possibly flawed)
      spec, rather than against independent ground truth; (c) a mutation-testing arm that dies on
      an unrelated error partway through, so it registers as neither a clean red nor a clean
      green; (d) a test fixture that silently inherits the test runner's ambient default branch
      name/config rather than pinning its own (`new_pair()` already pins `main` explicitly and
      commits real content — reuse that pattern, don't bypass it).

## 7. Orchestrator prose fix (the load-bearing change) + hygiene

- [x] 7.1 Update `core/roles/orchestrator.md` Phase 4 step 1: actually run/wait for `cleanup.sh
      --phase4` and check its exit code; on 0, parse the `RESULT` line and proceed as today; on
      non-zero, treat it as an environmental `BLOCKER` per this document's own existing
      escalation table (surface to the human, do not proceed to steps 2-3 until resolved, do not
      auto-retry). Confirm the caller-side red probe from task 1.3 (current prose never surfaces
      a non-zero exit) goes green against the REVISED prose — i.e. demonstrate the revised text
      itself instructs checking the exit code and escalating, closing the loop task 1.3 opened —
      per design.md Decision 5, this is the change that actually closes the
      incident's own failure mode, not an afterthought to the script-side work above.
- [x] 7.2 Confirm (re-grep) that no other script in the repo invokes `cleanup.sh` in a way that
      assumed always-exits-0, beyond the orchestrator and `test/scripts/cleanup.test.sh` (both
      already accounted for above).
- [x] 7.3 If a sanity check of the rendered template is useful, run `concertino sync
      --out=<tmpdir>` into a throwaway directory only — never against
      `/home/matt/Development/concertino` itself.
