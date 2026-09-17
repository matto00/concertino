# Files modified — cycle 4 addendum (post-archive fix-inline)

The change directory was already squashed (`295c65f`) and archived (`4f7331b`)
before this cycle started, per Delivery. `files-modified.md` was removed by
the archive step; this file is a short, honest addendum recording only this
cycle's work, written into the archived directory so the record stays
complete. It is NOT consumed by `squash-branch.sh` (no further squash is
performed this cycle, per the orchestrator's explicit "do not re-squash"
instruction) — this fix lands as its own, third, un-squashed commit on top
of `4f7331b`.

## Owner-authorized cycle 4 (fix-inline ruling, +1 execution cycle)

PR #143 (https://github.com/matto00/concertino/pull/143) went red on
`test (22)=FAILURE` / `test (16)=CANCELLED` due to a pre-existing (not
introduced by this change — byte-identical at line 95 on base
`d246b703059e8b8e5ecea6de31c8e46491edacac`) flaky assertion in
`test/scripts/emit-event.test.sh`'s leaked-child self-test.

## File modified

- `test/scripts/emit-event.test.sh` — the self-test's final `assert_children_dead`
  call (previously line 95, base SHA) ran immediately after
  `kill -KILL "$LEAKY_CHILD"` / `wait "$LEAKY_CHILD"` with no bounded wait.
  `$LEAKY_CHILD` is a grandchild of the test script (a child of the
  already-dead `LEAKY_PARENT_SCRIPT` subshell), not a direct job of this
  shell, so bash's `wait` on it is a silent no-op rather than a real block
  until the kernel finishes tearing the process down — under load, the very
  next `kill -0`-based check could still observe it alive. Fixed by adding a
  bounded poll (mirroring this same file's own pre-existing "wait for the
  child to appear" idiom a few lines above: `seq 1 50` / `sleep 0.1` = a 5s
  bound, polling `children_alive` for emptiness) between the kill and the
  assertion — the same 0.1s-resolution polling idiom `wait_killed_bounded`
  (`test/scripts/lib/wait-bounded.sh`) already uses elsewhere in this file,
  per CON-200's established principle that no constant at or below the poll
  period it races is ever safe, so a wider fixed sleep was not an option.

No other file touched. No change to `core/scripts/emit-event.sh` or its
rendered copy — confirmed via `git status --short` before committing.

## Mutation proof: the assertion remains failable (owner constraint 2)

Two independent mutations, each run against a copy of the FIXED self-test
extracted in place inside a scratch worktree's own `test/scripts/` directory
(preserving the `BASH_SOURCE`-relative sourcing of `lib/wait-bounded.sh` and
`lib/tmp-scratch.sh`, which breaks silently if the file is copied elsewhere —
learned the hard way mid-cycle when an out-of-tree copy produced unrelated
"command not found" failures that had nothing to do with the real defect):

**Mutation 1 — skip the kill, so the child genuinely survives cleanup:**
```
$ sed -i 's/^kill -KILL "\$LEAKY_CHILD" 2>\/dev\/null$/# MUTATED: kill removed/' mutant-nokill.sh
$ bash mutant-nokill.sh
  ok   self-test: leaky parent has a live child to capture
  ok   self-test: the OLD vacuous check (pgrep -P the now-dead parent) finds nothing, proving it cannot fail
  ok   self-test: the FIXED check (captured child pid, by PID) correctly reports it alive
  FAIL self-test: after cleanup, assert_children_dead reports it gone
       expected [none] got [alive: 1184364]
  3 passed, 1 failed
exit=1
```

**Mutation 2 — point `assert_children_dead` at a different, deliberately
still-live pid** (a freshly backgrounded `sleep 60`), to confirm failability
via a second, independent injection rather than trusting one mutation shape:
```
$ bash mutant-livepid.sh
  ok   self-test: leaky parent has a live child to capture
  ok   self-test: the OLD vacuous check (pgrep -P the now-dead parent) finds nothing, proving it cannot fail
  ok   self-test: the FIXED check (captured child pid, by PID) correctly reports it alive
  FAIL self-test: after cleanup, assert_children_dead reports it gone
       expected [none] got [alive: 1185828]
  3 passed, 1 failed
exit=1
```

The bounded poll's own 5s bound does not rescue either mutation (a genuinely
undead/still-alive child never satisfies `children_alive` emptiness within
that bound), confirming the fix did not make the assertion vacuous — it
remains a real, failable check, still guarding CON-181/CON-183's leak-detection
fix.

## Pinned before/after failure rates (owner constraint 3)

Both measured with `taskset -c 0`, plus 12 CPU-bound spin loops running
concurrently across all cores (`( end=$((SECONDS+N)); while [ $SECONDS -lt $end ]; do :; done ) &`,
matching the load-emulation shape CON-200 used) — an unpinned/unloaded run is
not evidence for this defect class (owner's own 1-of-3 pinned baseline; my
unloaded pre-fix run happened to fail on its very first, unpinned/unloaded
try too — see below — but the pinned+loaded numbers are the ones that matter
for the report).

Extracted self-test block only (everything through the self-test's
`rm -f "$LEAKY_PARENT_SCRIPT"` line), run in place inside each variant's own
`test/scripts/` directory so `BASH_SOURCE`-relative sourcing resolves
correctly; 10 trials each, `timeout 20` per trial to guard against an
unrelated hang (none occurred: `0/10 timed out` both sides).

**Pre-fix (base SHA `d246b703059e8b8e5ecea6de31c8e46491edacac`'s copy of this
assertion, byte-identical to `295c65f`'s pre-cycle-4 state), `taskset -c 0` +
12-loop load, 10 trials:**
```
trial 1: FAIL (rc=1)  self-test: after cleanup, assert_children_dead reports it gone — expected [none] got [alive: 1181802]
trial 2: FAIL (rc=1)  ... alive: 1181832
trial 3: FAIL (rc=1)  ... alive: 1181865
trial 4: FAIL (rc=1)  ... alive: 1181898
trial 5: FAIL (rc=1)  ... alive: 1181931
trial 6: FAIL (rc=1)  ... alive: 1181964
trial 7: FAIL (rc=1)  ... alive: 1181997
trial 8: FAIL (rc=1)  ... alive: 1182030
trial 9: FAIL (rc=1)  ... alive: 1182063
trial 10: FAIL (rc=1) ... alive: 1182096
RESULT: 10/10 failed, 0/10 timed out
```
(Notably worse than the owner's 1/3 — this machine's load emulation
apparently contends harder than the owner's trial, or the owner's 3 trials
simply undersampled a variable-rate flake; either way, 10/10 is unambiguous.
An UNLOADED, unpinned single run of the pre-fix copy also failed on its very
first try during initial reproduction, before the load harness was set up —
consistent with, not contradicting, the owner's point that this is a real,
reproducible race, not a rare corner case requiring heavy contention to
surface at all.)

**Post-fix (this cycle's fix), same `taskset -c 0` + 12-loop load, 10 trials:**
```
trial 1: pass
trial 2: pass
trial 3: pass
trial 4: pass
trial 5: pass
trial 6: pass
trial 7: pass
trial 8: pass
trial 9: pass
trial 10: pass
RESULT: 0/10 failed, 0/10 timed out
```

**Summary: 10/10 (100%) pinned+loaded failure pre-fix → 0/10 (0%) pinned+loaded
failure post-fix.**

## Sibling-assertion check (owner constraint 4)

Searched every `assert_children_dead`/`capture_children`/`children_alive`/
`wait_killed_bounded` call site in `test/scripts/emit-event.test.sh`. The
four REAL `--await`-checking call sites (the ones guarding the actual
CON-181/CON-183 leak-detection behavior, e.g. "killed --await leaves no
orphan child" and "INT-killed --await leaves no orphan child") already call
`wait_killed_bounded "$AWAIT_PID" N` immediately before their own
`assert_children_dead` call — that bounded-wait-then-assert pattern was
already correct everywhere except the self-test's own demonstration block.
**Only the one assertion fixed this cycle shared the defect; no sibling
assertion needed changing.** This matches CON-200's own finding shape
("exactly one of four such waits was actually defective, the others were
race-tolerant or deliberately over-long") — the diff is kept to that one
assertion, per the owner's fourth constraint.

The self-test's OTHER `kill`/`wait` pair (`kill -TERM "$LEAKY_PID"` /
`wait "$LEAKY_PID"`, checked via the intentionally-vacuous
`pgrep -P "$LEAKY_PID"` demonstration a few lines above the fixed
assertion) is not a race: `$LEAKY_PID` is a DIRECT child of this shell
(assigned from `$!` immediately after backgrounding it), so bash's `wait`
on it is a real blocking reap, not the silent no-op a non-direct-child
`wait` produces. That check is also deliberately demonstrating a KNOWN-vacuous
pattern (its own label says so), not asserting real correctness, so it needs
no bounded wait regardless.
