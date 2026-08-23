## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

Round-2 change requests, re-checked against the current artifacts (not the narrative):

- **CR1 (worktree-absence path / the 11 `prints READY` assertions)** — ADDRESSED. design.md
  Decision 4 now has an explicit `else WT_OK=ok   # already absent` branch, Decision 6 states the
  corrected justification, tasks 3.2 and §5 preamble both restate it. Baseline re-probed myself:
  `bash test/scripts/cleanup.test.sh` → `73 passed, 0 failed`; `grep -n "prints READY"
  test/scripts/cleanup.test.sh | wc -l` → `11`. The numbers the artifacts cite are real.
- **CR2 (design vs spec on exit code after a nominally-successful step)** — ADDRESSED. Decision 4
  re-probes `[ -d "$WORKTREE_PATH" ]` immediately after `worktree remove` and `show-ref --verify`
  immediately after `branch -D`, calling `fail()` at that point; `specs/cleanup-failure-visibility/
  spec.md` requirement 2 states the same in normative language. Exit 0 can no longer coexist with
  `worktree=fail` / `branch_local=fail`. Design and spec now say the identical thing.
- **CR3 (branch unreachable when the worktree is already gone)** — ADDRESSED, and the mechanism
  works. Decision 3 revised + tasks 4.1 + a dedicated spec requirement/scenario. Probed the
  fallback myself on git 2.55.0 with branches `bug/foo/CON-9` and `task/bar/CON-9x`:
  `git branch --list "*/CON-9" --format='%(refname:short)'` → exactly `bug/foo/CON-9`, count 1.
  The glob does cross `/` and does not over-match the `CON-9x` sibling.
- **CR4 (tasks presupposed fixture capabilities `new_pair()` lacks)** — ADDRESSED. tasks §5 now
  enumerates `new_worktree()`, a squash-merge helper and a second-worktree helper as additive,
  opt-in helpers, with 5.4 requiring the existing suite still report `73 passed, 0 failed` before
  any new assertion uses them.
- Ticket ACs 1-5 each trace to a task and a spec requirement (AC1→§2+failure-visibility req 1;
  AC2→§3+req 2; AC3→§1/6.1; AC4→§4+branch-deletion reqs; AC5→6.9). Out-of-scope list respected;
  no bare-repo support anywhere.
- Read `core/scripts/cleanup.sh` directly: `REPO_ROOT="$(git_child rev-parse --show-toplevel)"` is
  at line 52 — **before** the worktree-removal block (line ~68) and before `T=` (line ~80).

### Verdict: REFUTE

Two findings, both in the same narrow place: the earliest hard-failure path — which is the
incident's own path (`core.bare=true` fails at line 52's `rev-parse`, long before any worktree
work). They are precise and cheaply fixable; I would not have blocked on style.

### Change Requests

1. **BLOCKING — `fail()`'s `RESULT` line is swallowed when `run_git` is used in a command
   substitution, which is exactly what tasks 2.2 mandates for `REPO_ROOT`.**
   design.md Decision 2 specifies `run_git` to print the command's stdout on stdout so it can be
   used as `VAR="$(run_git ... )"`, and tasks 2.2 requires routing
   `REPO_ROOT="$(git_child ... rev-parse --show-toplevel)"` (cleanup.sh:52) through it. But
   `fail()` prints `RESULT ...` **to stdout** and `exit 1`s — inside the command substitution's
   subshell. The `RESULT` line is therefore captured into the variable and discarded, and the
   `exit 1` only leaves the subshell (`set -e` then correctly kills the script, so the exit code
   is fine). I reproduced this twice with the design's verbatim helper:

   ```
   cleanup.sh: FAILED repo root: git rev-parse --show-toplevel
     fatal: not a git repository ...
   exit=1
   STDOUT:[]        # second run, redirected: grep -c RESULT out.txt err.txt → 0 and 0
   ```

   This directly violates design.md Decision 4 ("`RESULT` is printed on every exit path ...
   including the earliest possible hard failure") and `specs/cleanup-failure-visibility/spec.md`
   ("on every exit path past the `--phase4` opt-in guard (both the success path and any
   `fail()`-triggered exit, however early)"). Written as-is, the executor ships a script that
   prints no `RESULT` on precisely the failure this ticket was filed about. Pick one and state it
   in Decision 2/4: (a) `print_result` writes to **stderr** (or `>&2` from `fail()` only), or
   (b) emit `RESULT` from a single `trap ... EXIT` handler installed after the `--phase4` guard,
   or (c) forbid `run_git` in command-substitution position and give assignments a separate
   `assign_git VAR desc -- ...` form that runs in the current shell. Note (a) alone changes where
   callers grep, so whichever is chosen must be reflected in the spec's wording and in tasks 3.4.

2. **BLOCKING (same probe) — tasks 6.1 contradicts design Decision 4 on the expected `RESULT`
   value for the `core.bare=true` probe.** tasks.md 6.1 requires the fixed script to show
   "`RESULT` line shows `worktree=fail`". On that trigger the script dies at cleanup.sh:52's
   `rev-parse`, before the worktree block is ever entered, so per Decision 4 `WT_OK` is still
   `not-attempted` (`fail` is reserved for "removal attempted, directory still present"). The
   spec's vocabulary allows `not-attempted` here, so the spec is right and the task is wrong.
   Left as written the executor either writes an assertion that cannot pass or "fixes" it by
   loosening the semantics of `fail`. Change 6.1 to assert `worktree=not-attempted` (and,
   consistent with CR1, that the `RESULT` line is actually visible on that path at all).

### Non-blocking notes

- design.md Decision 3's revised section is structurally malformed markdown: the heading
  `### Decision 3 revised (design-gate round 2, change request 3): ...` and its prose sit **inside**
  an opened ```bash fence, and a second ```bash fence opens mid-block. It renders as code. Content
  is understandable but worth reflowing so a reader doesn't skim past it.
- proposal.md's Impact bullet still asserts the 11 assertions "are unaffected by this change" and
  defers to Decision 6 for why. That is now accurate, but the proposal reads as the round-1 claim
  unless the reader follows the pointer; one clause ("because worktree-absence-at-start is an
  explicit `WT_OK=ok` branch") would make it self-contained.
- tasks 6.9 / AC5 (scoping) is covered by a fixture probe only. Given the new `push --delete` and
  `branch -D` behavior, consider also asserting in that probe that `git branch --list` on the
  fixture base is byte-identical before/after except for the target branch.
