## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

**D1's equivalence claim — VERIFIED TRUE, by experiment, not assertion.**
Built a throwaway repo with a merge-base `MB`, two branch commits, a
staged-but-uncommitted new file, a staged modification to a committed file,
and a worktree-only file. Results:

- `git diff --cached --name-only $MB` (pre-reset, proposed) → `c1.txt c2.txt staged_only.txt`
- `git diff --cached --name-only` (post-`reset --soft $MB`, current code) → `c1.txt c2.txt staged_only.txt`

Byte-identical, same order. `reset --soft` moves only the branch ref, never
the index, so both forms are literally the same comparison (MB tree vs index).
The substitution is an identity, as D1 claims.

**The ticket's suggested `git diff --name-only <merge-base> HEAD` — rejection is
CORRECT.** Same fixture: it returned `c1.txt c2.txt`, dropping
`staged_only.txt`. It is a commit-to-commit diff and silently narrows the
guard's decision set. Design is right to reject it, and right about the
mechanism it gives.

**The guard's decision set is unchanged — measured.** I applied the exact
planned reorder (delete the reset block at L117-121, add `"$MERGE_BASE"` to the
L124 diff, reinsert the reset block verbatim above the commit at L234) to a
scratch copy of the tree under `/tmp` (the worktree was never modified), and
ran the real suite. 20 of 22 assertions pass unchanged, including every
guard-decision assertion: undeclared stray refuses, guard names the file,
unparseable declaration fails loudly, `--allow-empty-declaration` opts in,
CON-151 grouped-bullet and continuation-line cases, success-path commit content
and parent. Nothing in the plan weakens what the guard rejects.

**Mutation-failability of the planned guard — VERIFIED, and specifically by the
ordering.** My two runs are themselves the mutation proof: against the existing
Scenario 2 fixture, `git rev-list --count HEAD` after a refusal is `1` with the
current (early-reset) script and `2` with the reordered script. Only the
HEAD/commit-count assertion flips; exit code and no-commit-created assertions
hold in both directions. So the planned guard goes red for the ordering and
nothing else. D4's insistence on mutating the ordering rather than the guard's
strictness is correct reasoning.

**Scope discipline — clean.** CON-162 and CON-164 are named non-goals, and D1's
rejected alternative (`git diff --name-only "$MERGE_BASE"`, merge-base vs
working tree) is rejected on exactly the right ground: choosing index-vs-worktree
is CON-162's question. The plan keeps the index-based set, so the diff stays
narrow and those tickets rebase cleanly.

**No downstream dependency on the refusal state.** `core/roles/orchestrator.md`
:988-997 treats a non-zero exit as a `BLOCKER` and surfaces the printed output;
nothing consumes the merge-base-staged state the fix removes.

**Render target.** `core/scripts/squash-branch.sh` and
`scripts/concertino/squash-branch.sh` already differ on `main` (pre-existing);
task 3.3's "unmodified" check is the right formulation and is satisfiable.

### Verdict: REFUTE

One real gap. The plan states, twice, that the existing suite stays green
(tasks 1.2 "the existing success-path scenarios still pass", 3.1 "zero
failures", 3.2 "no change to any other script's behaviour"), and that is
provably false. Two existing assertions in Scenario 2 encode the *old* ordering
as the expected outcome and go red under the fix — reproduced twice, stable:

```
FAIL 3.5 no squash commit was created on guard trip (HEAD still at merge-base)
     commit count=2
FAIL 3.5 the stray file remains staged (uncommitted) after the guard trip
     not found in staged diff
```

This matters at the design gate rather than as an executor detail, because how
those two assertions are re-expressed is a decision that must not be improvised
under a red suite. The second one in particular is load-bearing — it is the
suite's existing "the work is not lost" check — and the tempting response
(delete it) would silently remove coverage this very ticket is about.

### Change Requests

1. **`tasks.md` — add an explicit task to update the two stale Scenario 2
   assertions**, `test/scripts/squash-branch.test.sh:235-239` and `:241-246`,
   together with the comment block at `:232-234` ("the guard trips AFTER the
   (already-performed) `reset --soft <merge-base>`, so HEAD is back at the
   merge-base (1 commit — 'init')"), which states the inverse of the new
   contract. Name the required post-fix semantics so the executor is not
   choosing them under a red suite:
   - `:237` "no squash commit was created" must become an assertion that no
     *new* commit exists — compare `git rev-parse HEAD` (or the commit count)
     against a value recorded **before** the run, not against the literal `1`.
     Hardcoding `2` reintroduces the same fixture-shaped assertion in the other
     direction.
   - `:241` "the stray file remains staged" must be re-expressed as the
     work-is-not-lost check it actually is — the stray file is still present
     and reachable from HEAD (it is committed on the branch in this fixture, so
     the index is legitimately clean). Do not delete this assertion; deleting
     it removes exactly the coverage this ticket exists to create.

2. **`tasks.md` 3.1/3.2 — correct the claim.** As written they instruct the
   executor to confirm an unchanged suite, which cannot hold. State that
   Scenario 2's two ordering-dependent assertions are expected to be rewritten
   by task 1, and that "zero failures" is asserted only after that rewrite.

3. **`design.md` — record the Scenario 2 rewrite as a decision** (a short D5,
   or an addition to D4). D4 currently covers only the *new* scenario and its
   mutation proof, and reads as though the existing suite is inert with respect
   to this change. It is not: Scenario 2 is the one existing scenario that
   asserts post-refusal state, and its correct post-fix form is part of "the
   guard's decision set is unchanged" being demonstrable.

### Non-blocking notes

- The good news buried in CR-1: Scenario 2 already *is* a refusal fixture with
  branch-own commits and an undeclared path, so the new guard in task 2.1 may
  be cheaper as an extension of it than as a fresh fixture. Either is fine.
- Task 2.1 says "an undeclared **staged** path". In Scenario 2 the undeclared
  path is *committed* on the branch (`commit_all`), not merely `git add`ed.
  Both are picked up by `diff --cached "$MERGE_BASE"` and both satisfy the
  requirement; the wording is just imprecise about which fixture shape is
  intended. Worth pinning so the executor does not build a fixture whose branch
  has no own commits — that shape would make the HEAD-unchanged assertion
  vacuous under the ordering mutation.
- D3's observation that the always-print block now precedes the reset is
  correctly characterized as a strict improvement, and the spec delta
  ("before that reset and commit") already captures it. No action.
