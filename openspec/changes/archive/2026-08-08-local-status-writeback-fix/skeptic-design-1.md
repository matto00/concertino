## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/local-ticket-state-durability/spec.md`, `.openspec.yaml`,
  `workflow-state.md`.
- Cross-checked design.md's claims about `core/scripts/cleanup.sh` against
  the actual file (read `cleanup.sh:1-220`): the `attempt_fast_forward`
  logic, `FF_STATUS` values (`dirty`/`diverged`/`failed`), the
  `BASE_REMOTE`/`BASE_BRANCH` resolution via `CONCERTINO_BASE_REMOTE`/
  `CONCERTINO_BASE_BRANCH` sourced from `.concertino.env`, and the
  `escalation --await options=retry,skip` call all match the design's
  description exactly. No fabricated citations found.
- Read the current `core/scripts/set-ticket-state.sh` in full (134 lines) —
  confirms the "no commit today" starting state and the exact call shape
  the design assumes (temp-file+rename write, `FOUND` flag, `$FILE =
  "$DIR/$ID.md"`).
- Confirmed the real production invocation shape: `lib/cli/render.js:143`
  and `ticket.md`/`design.md` all agree the orchestrator calls
  `scripts/concertino/set-ticket-state.sh tickets "$TICKET_ID" started`
  — i.e. `<tickets-dir>` is the **relative** literal string `tickets`,
  invoked with cwd = the main checkout root. This is the load-bearing fact
  behind the finding below.
- Read `test/scripts/set-ticket-state.test.sh` in full — confirmed its
  `seed()` helper always uses `D="$(mktemp -d)"`, i.e. **every existing
  (and, per tasks.md 3.1–3.6, every planned new) test invokes the script
  with an absolute `<tickets-dir>`**, never the relative `tickets` shape
  production actually uses.
- Reproduced, empirically, in a scratch repo
  (`/tmp/claude-.../scratchpad` is unused here — used `/tmp/giteg*` per
  Bash tool, cleaned up), the exact git pathing task 1.2/1.3 propose:

  ```
  DIR=tickets; ID=CON-12; FILE="$DIR/$ID.md"
  git -C "$DIR" add -- "$FILE"
  # fatal: pathspec 'tickets/CON-12.md' did not match any files
  # exit 128
  ```

  vs. the same operation with an **absolute** `$DIR` (which is what every
  existing/planned test exercises via `mktemp -d`):

  ```
  DIR=/tmp/giteg2/tickets; FILE="$DIR/CON-12.md"
  git -C "$DIR" add -- "$FILE"   # succeeds
  ```

  and confirmed the actual fix (pathspec relative to `-C`'s target, not
  re-prefixed with `$DIR`) works in both shapes:

  ```
  git -C "$DIR" add -- "$ID.md"
  git -C "$DIR" commit -m "..." -- "$ID.md"   # succeeds, commits only that file
  ```

### Verdict: REFUTE

### Change Requests

1. **`design.md` Decision 1 / `tasks.md` task 1.2 gives incorrect guidance
   that would silently defeat the fix in production.** Task 1.2 says:
   > resolve the repo root ... **or simply pass `-C "$DIR"` to every git
   > invocation — either works since git resolves relative to the given
   > path.**

   This is false for the real invocation shape. `$FILE` is defined
   upstream (existing script, line 77) as `"$DIR/$ID.md"` — already
   prefixed with `$DIR`. If the implementer takes the "pass `-C "$DIR"`
   to every git invocation" branch literally and reuses the existing
   `$FILE` variable for the `add`/`commit` pathspec (tasks 1.3: `git -C
   "$DIR" add -- "$FILE"`, `git -C "$DIR" commit ... -- "$FILE"`), the
   pathspec gets double-prefixed with `$DIR` whenever `$DIR` is a
   **relative** path — and the real orchestrator invocation always passes
   the literal relative string `tickets` (confirmed above), not an
   absolute path. Demonstrated above: `git -C "$DIR" add -- "$FILE"`
   fails with `fatal: pathspec 'tickets/CON-12.md' did not match any
   files` in exactly this shape.

   Worse, task 1.4 explicitly makes a failed `add`/`commit` **non-fatal**
   ("print a note to stderr and still proceed to `OK <id> <state>`"). So
   this isn't a loud failure an implementer would catch by running the
   script once — it degrades silently to a printed stderr note that's
   easy to miss, while the script still reports `OK` and exits 0, and no
   commit is ever made. That is precisely the bug CON-90 exists to fix,
   now shipped again under the cover of a "fixed" changelog entry.

   **Required revision:** `tasks.md` (and ideally `design.md` Decision 1)
   must specify one concrete, correct approach, not two options where one
   is broken for the real call shape. Recommend: use a pathspec relative
   to whatever `-C` target is chosen — e.g. `git -C "$DIR" add --
   "$ID.md"` / `git -C "$DIR" commit -m ... -- "$ID.md"` (basename only,
   since `-C "$DIR"` already changes the effective cwd), or alternatively
   resolve `$FILE` to an absolute path once (`FILE_ABS="$(cd "$DIR" &&
   pwd)/$ID.md"`) and use `$FILE_ABS` consistently for every git
   invocation. Verified both fixes work in the reproduction above.

2. **The new test plan (`tasks.md` 3.1–3.6) cannot catch the bug above
   because it inherits the existing `seed()` convention of an absolute
   `mktemp -d` directory.** Every existing test, and by extension every
   planned new git-repo test that follows the same pattern, passes an
   **absolute** `<tickets-dir>`. Absolute paths sidestep the `-C`
   re-prefixing problem entirely (also demonstrated above), so a test
   suite written this way would pass green even with the broken
   `-C "$DIR"` + `$FILE` combination from Change Request 1 — masking
   exactly the shape (`tickets`, a relative path, cwd = repo root) that
   production actually uses.

   **Required revision:** add at least one explicit test case to task 3
   that invokes the script with a **relative** `<tickets-dir>` argument
   from a controlled `cwd` (e.g. `(cd "$REPO" && "$SCRIPT" tickets CON-12
   started)`), mirroring the orchestrator's actual `set-ticket-state.sh
   tickets "$TICKET_ID" started` call shape, and assert the commit lands
   exactly as in the absolute-path case. This is the regression test that
   would have caught Change Request 1's defect before it shipped.

### Non-blocking notes

- Everything else checked out cleanly: the `cleanup.sh` behavior claims in
  design.md are accurate, the pathspec-limited-commit approach (Decision
  2) is sound in principle (only the literal git invocation needs
  fixing), the best-effort-push semantics (Decision 3) and the
  not-a-git-working-tree skip (Decision 4) are well-specified and match
  existing script conventions, the AC's are traceable to concrete tasks,
  and the spec delta scenarios are unambiguous. No scope drift, no
  placeholders/TBDs, no missing contract updates found.
- Separately (not blocking, out of scope for this design): the checked-in
  `scripts/concertino/` in this repo's own worktree does not currently
  contain a synced copy of `set-ticket-state.sh` at all (a pre-existing
  gap from CON-44 never having had `concertino sync` re-run/committed
  here) — irrelevant to this repo's own delivery since this project uses
  the Linear provider, but worth a heads-up in case a consuming
  local-provider project is assumed to already have it synced.
