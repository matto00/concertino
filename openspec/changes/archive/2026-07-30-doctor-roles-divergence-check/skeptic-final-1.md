## Skeptic Report — final gate (round 1)

All verification was done in an isolated `git clone` of this worktree at
`/tmp/.../scratchpad/clone`, never by mutating the worktree under review.

### What I verified (with evidence)

**Ground truth: the diff is a one-line production change plus one test case.**
`git diff main...HEAD --stat` → `bin/concertino` (1 line), `test/scripts/doctor-artifacts.test.sh`
(+30), plus two change-dir docs. `bin/concertino:188` is now
`for (const sub of ['scripts', 'laws', 'roles']) {`. Only caller of `coresDiffer()`
is `resolveCore()` at `bin/concertino:219`. `core/roles/` is flat (5 `.md` files), so
the non-recursive `readDirSafe` is adequate.

**AC1 — `coresDiffer()` compares `core/roles/*`: MET.** `bin/concertino:188`, identical
per-file `fileDiffers()` logic as `scripts`/`laws`.

**AC2 — a diverged `core/roles/*.md` produces the same divergence note: MET.** Verified
by my *own* isolated probe (throwaway git-init'd copy + worktree, `core/roles/executor.md`
the *only* divergence, `scripts`/`laws`/`workflow-state.template.md` byte-identical — i.e.
exactly the spec-delta scenario):

```
=== with the fix ===
  note: rendering from /tmp/tmp.NSUzH1ju15/wt/core — differs from the executing script's own core at /tmp/tmp.NSUzH1ju15/core
=== with 'roles' removed from the loop ===
(no divergence note — bug reproduced)
```

**AC3 — existing `scripts`/`laws`/`workflow-state.template.md` behavior unchanged: MET.**
The change is purely additive to a loop; `checkArtifacts()` untouched.

**Declared gate (`npm test`, `when: always`) re-run by me, in full:** exit `0`,
every suite passing (doctor-artifacts 11/11, check-merge-readiness 22/22,
auditor-render 13/13, doctor-base-branch 10/10, etc.). `GATE EXIT=0`.

**Regression test fails without the fix (clean tree):** reverted `'roles'` in the clone →
`FAIL detects diverged roles file / expected to find [differs from]`, `10 passed, 1 failed`,
exit 1. So the test is not inert.

**But the regression test yields a false green under ordinary working-tree state
(reproduced twice, plus a control):**

| run | fix | working tree | result |
|---|---|---|---|
| control | reverted | clean | `FAIL detects diverged roles file` (correct) |
| repro 1 | reverted | uncommitted edit in `core/scripts/emit-event.sh` | `ok detects diverged roles file`, **11 passed, 0 failed** |
| repro 2 | reverted | uncommitted edit in `core/laws/systematic-debugging.md` | `ok detects diverged roles file`, **11 passed, 0 failed** |

The bug is fully present in rows 2 and 3 and the test reports green.

**The test mutates the real repository and leaks state.** `git worktree remove` in the
trap fails by design when the worktree has untracked files (the test creates a synced
project inside it):

```
fatal: '/tmp/tmp.DTyvTMuzDg' contains modified or untracked files, use --force to delete it
remove exit=128
```

The trap then `rm -rf`s the directory, leaving the registration behind. This is already
observable in the user's real repo — `ls /home/matt/Development/concertino/.git/worktrees/`
shows **10 leaked `tmp.*` entries** alongside the legitimate `CON-30`/`CON-36`/
`tui-fleet-dashboard` ones, accumulated during this ticket's own gate runs.

**This violates the documented safety contract of the sibling test for the same code
path.** `test/scripts/sync-core-resolution.test.sh` header states: *"SAFETY: every
`concertino sync`/`doctor`/`init`/`eject`/`diff` invocation below runs against a
throwaway COPY ... built fresh per test by `new_main()`, never against this checkout's
own `bin/concertino`. This test never invokes this repo's own CLI on itself."* That file
already has the exact machinery needed (`new_main()`, worktree-on-throwaway-repo, and
at 3.7 it already appends a marker to `$WT/core/roles/executor.md`).

**UI review: N/A.** `concertino.config.json → ui.enabled: false`, `tool: "none"`; no UI
files in the diff. Servers not started, per the config.

### Verdict: REFUTE

The production fix is correct, minimal, and I confirmed all three ACs independently. The
refusal is entirely about the delivered test: it does not reliably protect the fix, and it
writes into the user's real repository as a side effect.

### Change Requests

1. **`test/scripts/doctor-artifacts.test.sh:69` — stop running `git worktree add` against
   the real checkout.** `git -C "$ROOT" worktree add "$WORKTREE_DIR" HEAD` registers a
   worktree in the developer's (and CI's) actual repo, and the cleanup at line 71 cannot
   remove it (`git worktree remove` refuses on untracked files → exit 128), so every
   `npm test` leaves a permanent `prunable` entry. Ten such entries already exist in
   `/home/matt/Development/concertino/.git/worktrees/`. Build the scenario against a
   throwaway copy instead — reuse the `new_main()` pattern from
   `test/scripts/sync-core-resolution.test.sh`, whose header declares this exact
   invariant. (If any worktree removal is kept anywhere, it needs `--force`.)

2. **`test/scripts/doctor-artifacts.test.sh:89` — the assertion does not discriminate
   `roles`.** `has "detects diverged roles file" "differs from" "$OUT"` matches *any*
   divergence: the `roles` note, a `scripts`/`laws`/`workflow-state.template.md` note, and
   even the unrelated artifact warning `differs from core: ...` at `bin/concertino:981`.
   Because the fixture's baseline is `$ROOT`'s *working tree* vs. a worktree at `HEAD`, any
   uncommitted `core/**` edit satisfies it with the bug fully present (reproduced twice
   above — the normal state of this repo while a `core/` ticket is in flight). Fix both
   halves: (a) construct the isolated condition the spec delta actually names — `roles`
   diverged, `scripts`/`laws`/`workflow-state.template.md` byte-identical — rather than
   depending on ambient repo cleanliness; and (b) assert the specific string
   `differs from the executing script`, as `sync-core-resolution.test.sh` already does,
   not the ambiguous `differs from`.

3. **`test/scripts/doctor-artifacts.test.sh:90-93` — the skip path hides lost coverage.**
   If `git worktree add` fails, the case prints `skipped` and the suite still exits 0, so
   this regression test can silently stop existing (CI runs on a shallow
   `actions/checkout@v4` checkout). With CR1 applied the throwaway repo is created by the
   test itself, so this branch should become a hard failure rather than a silent skip.

4. **`bin/concertino:177-180` — the comment above `coresDiffer()` is now false.** It reads
   *"Byte-identical to `checkArtifacts()`'s own comparison, over the same set of files
   (`core/scripts/*`, `core/laws/*`, `core/workflow-state.template.md`) — the only files a
   render actually reads from `core/`."* After this change `coresDiffer()` covers a
   strictly larger set than `checkArtifacts()` (which still compares only
   scripts/laws/workflow-state at `bin/concertino:971-976`), and `roles/` is plainly read by
   renders. Update the comment to state the new set and why it intentionally exceeds
   `checkArtifacts()`'s (role files are rendered, not copied, so there is no byte-identical
   artifact to compare — which is exactly why the divergence note is the only signal
   available for them).

### Non-blocking notes

- Consider relocating this case to `test/scripts/sync-core-resolution.test.sh` as `3.8`.
  It tests `resolveCore()`/`coresDiffer()`, which is that file's subject; `doctor-artifacts`
  is about rendered-artifact drift within a project. CR1 and CR2 largely fall out for free
  there, since `new_main()` and the roles-marker pattern (3.7) already exist.
- The ten leaked `tmp.*` worktree registrations in the user's real repo should be cleared
  with `git worktree prune` in `/home/matt/Development/concertino` once CR1 lands. I did
  not run it — it mutates the user's repository and is outside a reviewer's remit.
- `files-modified.md` and the spec delta accurately describe the production change; no
  scope creep. The one-line fix itself needs no revision.
