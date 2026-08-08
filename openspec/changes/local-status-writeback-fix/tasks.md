## 1. `set-ticket-state.sh` — commit the write

- [x] 1.1 After the existing temp-file+rename write succeeds (and `FOUND`
      was 1), check `git -C "$DIR" rev-parse --is-inside-work-tree`. Skip
      straight to the existing `echo "OK $ID $STATE"` when it fails (not a
      git working tree) — no other behavior changes for that case.
- [x] 1.2 When it is a git working tree, run every subsequent git command
      with `-C "$DIR"` (never resolve/prepend a separate repo-root path —
      one consistent target for every git invocation in this task group).
- [x] 1.3 Stage and commit **only** the file — `git -C "$DIR" add -- "$ID.md"`
      then `git -C "$DIR" commit -m "<message>" -- "$ID.md"` — the
      basename only, **not** the existing `$FILE` variable (which is
      `"$DIR/$ID.md"`, already prefixed with `$DIR`; reusing it here
      double-prefixes the pathspec against `-C "$DIR"` and fails whenever
      `$DIR` is relative — see design.md Decision 2 for the verified
      reproduction). Never `-a` or `add -A`. Commit message names the
      ticket id and new state (e.g. `tickets: CON-12 -> started`); exact
      wording is free, but keep it short and greppable.
- [x] 1.4 If the commit itself fails unexpectedly (e.g. no git identity
      configured), do not treat this as fatal to the state write that
      already succeeded — print a note to stderr and still proceed to `OK
      <id> <state>` / exit 0. (The file rewrite is the primary contract;
      the commit is additive durability, not a precondition for success.)

## 2. `set-ticket-state.sh` — best-effort push

- [x] 2.1 Only after a successful commit (step 1.3): resolve the remote name
      — `CONCERTINO_BASE_REMOTE` if set in the environment, else `origin`
      (mirror `core/scripts/cleanup.sh`'s existing `BASE_REMOTE` default
      exactly, including sourcing `.concertino.env` the same way if
      present, for consistency — but do not hard-require it).
- [x] 2.2 Resolve the current branch: `git -C "$DIR" symbolic-ref --short
      HEAD`. If this fails (detached HEAD), skip the push attempt entirely
      — go straight to `OK <id> <state>`.
- [x] 2.3 Otherwise attempt exactly one `git -C "$DIR" push "$REMOTE"
      "HEAD:$BRANCH"` (no `--force`, no `--force-with-lease`). On failure
      (non-zero exit — offline, rejected, no permission), print a note to
      stderr naming the ticket/state and that the push did not land; do
      **not** retry, rebase, or fail the script.
- [x] 2.4 Either way (push succeeded, push failed, or push skipped), the
      script's stdout (`OK <id> <state>`) and exit code (0) are unaffected
      — verify no existing early-return/exit path changed.

## 3. Tests

- [x] 3.1 Add a new test block to `test/scripts/set-ticket-state.test.sh`
      that seeds a **real** temporary git repo (`git init`, configure a
      throwaway `user.email`/`user.name` for the test repo only, seed and
      commit an initial `tickets/CON-12.md`) and asserts: after calling the
      script, `git log` on that repo shows a new commit touching only
      `tickets/CON-12.md`, and `git status --porcelain` is empty
      afterward (matches Requirement 1's first two scenarios).
- [x] 3.2 Add a case with an unrelated uncommitted file present in the same
      repo before the call; assert it is still uncommitted and unstaged
      after the call (Requirement 1's third scenario).
- [x] 3.3 Add a push case: seed a local bare repo as the `origin` remote of
      the test repo (`git init --bare` elsewhere, `git remote add origin
      <path>`), run the script, and assert the bare remote's branch now
      contains the new commit (Requirement 2's "push succeeds" scenario).
- [x] 3.4 Add a push-rejected case: point `origin` at a bare repo, but push
      is not fast-forwardable (e.g. the bare repo already has a divergent
      commit on the same branch) — assert the script still prints `OK <id>
      <state>` and exits 0, and that the local repo still carries the
      commit (Requirement 2's "push is rejected" scenario). Confirm a
      stderr note is printed but assert on exit code/stdout, not on the
      note's exact wording.
- [x] 3.5 Add a detached-HEAD case: `git checkout --detach` in the test
      repo before calling the script; assert the commit still happens but
      no push is attempted (no `origin` needed for this case — confirm no
      error trying to resolve one) and the script still exits 0.
- [x] 3.6 Confirm every pre-existing test in the file (all of which seed a
      bare `mktemp -d` with no `git init`) still passes unmodified — they
      now exercise the "not a git working tree" no-op path.
- [x] 3.7 **Required regression test (design.md Decision 2):** add a case
      that invokes the script with a **relative** `<tickets-dir>` argument
      from a controlled `cwd` — e.g. `(cd "$REPO" && "$SCRIPT" tickets
      CON-12 started)` with `tickets/` as a real subdirectory of a git repo
      seeded at `$REPO` — mirroring the orchestrator's actual production
      call shape (`set-ticket-state.sh tickets "$TICKET_ID" started`, cwd =
      main checkout root). Assert the commit lands exactly as in the
      absolute-path case (3.1). This is the case that must fail against a
      naive `git -C "$DIR" add -- "$FILE"` implementation and pass against
      the `-C "$DIR" ... -- "$ID.md"` one specified in design.md Decision 2
      — every other planned case in this section uses an absolute
      `mktemp -d` path and cannot catch that defect by itself.
- [x] 3.8 Run `bash test/scripts/set-ticket-state.test.sh` directly and
      confirm a clean pass before moving on.

## 4. Docs

- [x] 4.1 Rewrite `docs/config-reference.md`'s "### Status write-back
      leaves the main checkout dirty" section (currently lines ~212–240):
      describe the new commit + best-effort-push behavior, state plainly
      that the common case (an unprotected remote) now completes without
      the dirty-tree escalation, and document the residual case explicitly
      — a push-protected base branch leaves the commit local-only, which
      still trips `cleanup.sh`'s existing `diverged` escalation, with
      `retry`/`skip` remaining the way to handle it when it does occur.
      Update or retitle the section heading if the "leaves the main
      checkout dirty" framing no longer fits.

## 5. Verification

- [x] 5.1 `npm test` (or the project's equivalent full suite command) passes,
      including the new/updated `set-ticket-state.test.sh` cases.
- [x] 5.2 Manually exercise (or describe exercising, if a full end-to-end
      local-provider delivery run isn't practical inside this session) the
      Setup `started` write and Cleanup `completed` write against a scratch
      git repo with a real (bare, local-filesystem) remote, confirming no
      dirty/diverged state remains in the main checkout afterward.
- [x] 5.3 Check whether `scripts/concertino/set-ticket-state.sh` exists in
      this checkout as a synced copy of `core/scripts/set-ticket-state.sh`.
      As of this change it does **not** (a pre-existing gap, unrelated to
      this fix — this repo's own delivery uses the `linear` provider, so
      the local-provider synced copy was never rendered/committed here).
      If it's present, confirm it stays identical to the canonical `core/`
      source (re-run `concertino sync` if needed); if absent, no action
      needed — do not introduce it as part of this change, that's a
      separate pre-existing gap out of scope here.
