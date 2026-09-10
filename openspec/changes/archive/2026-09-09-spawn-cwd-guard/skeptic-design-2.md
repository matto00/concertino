## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Read all five artifacts fresh: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/spawn-cwd-guard/spec.md`, plus round 1's `skeptic-design-1.md` (as claims only).

- **I am a live instance of a CORRECTLY-spawned role, and I measured my own ambient cwd.**
  Standalone `pwd -P` as an isolated Bash call → `/home/matt/Development/helio`.
  Re-run a second time, standalone, later in the session → `/home/matt/Development/helio`
  (stable, reproduced). My `WORKTREE_PATH` is
  `/home/matt/Development/concertino/.concertino/worktrees/bug/spawn-cwd-guard/CON-174`
  (`realpath` confirms it exists and is that same path — no symlink indirection).
  My ambient cwd is **not equal to, and not under**, `WORKTREE_PATH`. It is in a
  different repository entirely.

- **cwd-reset semantics reproduced independently.** `cd /tmp && pwd -P` → `/tmp` in one
  Bash call; the *next* Bash call's standalone `pwd -P` → `/home/matt/Development/helio`.
  So Context's fixed-baseline claim holds as stated.

- **Worktree layout for the other target repo.** `helio`'s `concertino.config.json`
  and `scripts/concertino/.concertino.env` both give `worktree.base = .claude/worktrees`,
  i.e. `WORKTREE_PATH` is a *descendant* of the driver session's cwd (`/home/matt/Development/helio`).
  Ambient is the parent of `WORKTREE_PATH`, never under it.

- **`core/scripts/lib/git-child-env.sh` exists** (with a selftest) — Decision 1's
  `git_child` dependency is real.

- **`lib/cli/render.js`**: `block(name, c, harness)` at the `renderBody` call site
  (`out.replace(/\{\{block:([a-zA-Z]+)\}\}/g, (_, n) => block(n, c, harness))`), a flat
  `switch (name)` with `default: return '{{block:' + name + '}}'`. No per-call-site
  argument channel — round 1's finding confirmed at ground truth.

### Verdict: REFUTE

Round 1's core finding is genuinely fixed: the check no longer re-derives a value that is
correct by construction. But the revision overshot. The round-1 design **always returned
READY**; this one **always returns FAIL** — including on my own correct spawn, right now.
The guard still does not distinguish a normal spawn from the incident; it has only flipped
which side of the indistinguishability it lands on. That is a worse failure mode, because
it makes every delivery run BLOCKER at step 1.

### Change Requests

1. **The revised check FAILs on every normal spawn in the deployments this ships to — I
   am the counterexample, measured, not hypothesized.** Trace Decision 1 against my own
   real inputs: `AMBIENT_PWD=/home/matt/Development/helio` (measured twice, standalone),
   `WORKTREE_PATH=.../concertino/.concertino/worktrees/bug/spawn-cwd-guard/CON-174`.
   `realpath(AMBIENT_PWD)` is not equal to and not under `realpath(WORKTREE_PATH)` →
   `FAIL cwd-mismatch` → per Decision 3 I BLOCKER and stop without doing this review.
   This is not an edge case: the same holds for **every** helio-repo run too, because
   `worktree.base = .claude/worktrees` makes `WORKTREE_PATH` a descendant of the driver
   session's cwd, so ambient is always the parent, never "under". Spawned agents inherit
   the *top-level driver session's* cwd, not the orchestrator's intended one — which is
   precisely what `ticket.md`'s Correction #1 already said in writing:
   > "A bare pre-cd mismatch check would BLOCKER on essentially every spawn."
   The design implements exactly the shape that correction rules out, and never
   acknowledges or refutes the correction. It also directly violates `ticket.md` AC #3
   ("A normal spawn ... must NOT trigger a BLOCKER") and makes `spec.md`'s first scenario
   ("Normal spawn where the ambient cwd already resolves under WORKTREE_PATH", lines
   10–12) a state the system does not actually produce.
   Required: resolve the contradiction explicitly rather than picking one horn silently.
   The two premises "the guard reads the ambient cwd" and "a normal spawn must pass" are
   jointly unsatisfiable **as long as the ambient cwd is the driver's cwd**. So the fix has
   to change that third term — e.g. a spawn-side obligation on the orchestrator/driver
   (the spawn is made from, or explicitly declares, the run's worktree, so ambient becomes
   meaningful), or a guard that discriminates on something that *does* differ between a
   correct spawn and the incident (e.g. ambient must not resolve under a *different*
   registered `.concertino` worktree — the incident's signature — while ambient being an
   unrelated ancestor/neutral directory is tolerated). Whichever is chosen, design.md must
   name it and state which of `ticket.md`'s ACs is being met and how.

2. **Decision 2's soundness argument does not survive the "or under" allowance it is
   built on.** The fixed-baseline premise itself checks out (I reproduced the reset). But
   Decision 1 passes when `realpath(AMBIENT_PWD)` is *under* `realpath(WORKTREE_PATH)`,
   not only when equal. Take `AMBIENT_PWD = $WORKTREE_PATH/frontend`: the check returns
   `READY`, yet a later bare `scripts/concertino/emit-event.sh` resolves to
   `$WORKTREE_PATH/frontend/scripts/concertino/emit-event.sh`, which does not exist — or,
   worse, in a nested-repo layout, to some other tree's copy. Decision 2's claim "there is
   no reachable state where the check passes and a later relative invocation runs against
   the wrong tree" is therefore false as written; it needs **strict equality** to hold.
   Required: either tighten the check to `realpath(AMBIENT_PWD) == realpath(WORKTREE_PATH)`
   and say so, or restrict Decision 2's conclusion to the equality case and state plainly
   what happens to the 32 relative call sites in the "under, but not equal" case.

3. **Decision 5 still lacks discriminating power on the question that matters, for a new
   reason.** The mutation mapping is a genuine improvement and each named mutant/case pair
   is plausible (case 2 kills the deleted path-comparison, case 3 the branch check, case 4
   a hardcoded `exit 0`). But case 1 — "correct spawn: `AMBIENT_PWD == WORKTREE_PATH`" —
   is labelled *correct spawn* while being a condition a real spawn never produces
   (CR #1). So the suite proves the script's internal branching works, and proves nothing
   about whether the guard separates a real correct spawn from the real incident: the only
   two inputs the system actually generates (ambient = driver root; ambient = another
   lane's worktree) both land in case 2 and both return `FAIL`. This is a hand-built
   fixture asserting a state that does not occur.
   Required: at least one case whose `AMBIENT_PWD` is the value a **real** spawn produces
   in this deployment (the driver session's cwd — a repo root that is an *ancestor* of
   `WORKTREE_PATH`), with the design stating which verdict that case must produce. That
   case is the design decision in CR #1, made testable.

4. **`ticket.md` AC #1's prescribed shape is silently abandoned and never reconciled.**
   AC #1 requires each role to perform "an unconditional `cd \"$WORKTREE_PATH\"`" as its
   literal first action. The revised design has the role run only `pwd -P`; the `cd` moves
   inside the script's subshell, after the path check, and (correctly, per the reproduced
   reset semantics) cannot relocate the role. I think abandoning it is *right* — but a
   design that departs from an explicit AC must say so. Required: one paragraph in
   design.md stating that AC #1's literal `cd`-first shape is unimplementable under
   cwd-reset semantics, what replaces it, and why the replacement satisfies the AC's
   intent. Right now a reader diffing design.md against the ACs finds an unexplained gap.

5. **Decision 3's "round-1 rationale correction" is once again asserted rather than
   derived, and is false for the second time.** It restores the sentence "there is no
   silent-invisible-work scenario left for the live incident this ticket describes" on the
   grounds that the role now BLOCKERs on the incident. Under CR #1 the role BLOCKERs on
   *everything*, so the sentence is true only in the degenerate sense that no work of any
   kind happens. The CON-139 scope *call* remains sound (I agree with round 1 there, and
   with it being left entirely to CON-139) — it is the rationale sentence that keeps
   getting written to match whatever the current mechanism is claimed to do.
   Required: rewrite it once CR #1 is settled, stated against what the mechanism is then
   demonstrated to do, not against what it is intended to do.

### Non-blocking notes

- **Decision 4 is correct and consistent.** Dropping `ROLE_LABEL` follows from the
  `block(name, c, harness)` signature I read at ground truth, the fixed-text block matches
  the existing `docsExecutor`/`specReadNote` pattern, and nothing else in the design or in
  `tasks.md` 3.1/3.2 still references a per-role argument. No further action.
- Decision 1's absolute-path invocation (`"$WORKTREE_PATH/scripts/concertino/assert-cwd.sh"`)
  is the right call and the stated reasoning is sound — the check must not be located via
  the thing it is verifying. Keep this regardless of how CR #1 resolves.
- The `git_child` / `lib/git-child-env.sh` dependency (CON-133 hermetic git) is real and
  present in `core/scripts/lib/`; that part of Decision 1 is implementable as written.
- Round 1's note still stands and is still unaddressed in `tasks.md`: `render.js`'s
  `default:` arm returns the literal `{{block:...}}` rather than erroring, so a typo'd
  block name ships silently. Worth one assertion when task 3.1 lands.
