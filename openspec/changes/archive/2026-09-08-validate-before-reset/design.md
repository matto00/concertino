## Context

See proposal.md — Why. Current shape of `core/scripts/squash-branch.sh`:

- L95–106 compute and disambiguate `MERGE_BASE`.
- L108–115 log base advancement (D3).
- L117–121 `git reset --soft "$MERGE_BASE"` — unconditional.
- L124–128 `STAGED_FILES="$(git_wt diff --cached --name-only)"`.
- L130–189 parse `files-modified.md`, build the allowlist, compute `UNEXPECTED`.
- L191–198 always print the staged count and list.
- L200–232 the two refusal paths (`exit 1` at 214 and 230).
- L234–241 the commit.

Everything between L124 and L232 is pure inspection: it reads the staged
name list, reads `files-modified.md` off disk, and prints. Nothing in it
depends on HEAD having moved. The reset's only load-bearing effect is on the
commit at L235, which needs the merge-base as parent with the run's whole
delta in the index.

## Goals / Non-Goals

**Goals:**
- HEAD, the index and the working tree are untouched on every refusal path.
- The set the guard inspects is bit-for-bit the set it inspected before, so no
  refusal becomes an acceptance or vice versa.
- The success path produces an identical commit (same tree, same parent).

**Non-Goals:**
- CON-162 (guard inspects one thing, commit acts on another) — untouched here,
  and deliberately so: this change must not alter *what* is inspected.
- CON-164 (dry-run mode) — untouched.
- Any change to the declaration parser (CON-149/CON-151/CON-158) or to the
  strictness of the guard.
- Re-rendering `scripts/concertino/squash-branch.sh`. That tree is a render
  target produced by `concertino sync`; the preceding CON-151/CON-152/CON-154
  commits did not re-render it either.

## Decisions

**D1: Compute the prospective staged set with `git diff --cached --name-only "$MERGE_BASE"`, not `git diff --name-only "$MERGE_BASE" HEAD`.**

The ticket proposes the latter. It is not equivalent and would silently narrow
the guard. `reset --soft` moves HEAD but leaves the index alone, so the
post-reset `git diff --cached --name-only` compares the merge-base tree
against the **index** — which includes any change already staged before the
script ran, not only what is committed on the branch. `git diff --name-only
<merge-base> HEAD` compares two commits and drops exactly those files.

`git diff --cached --name-only "$MERGE_BASE"` diffs a named commit against the
index without touching any ref, and after a `reset --soft "$MERGE_BASE"` the
default (no-commit-argument) form resolves to precisely that same comparison.
So the substitution is an identity, not an approximation: same command, same
comparison, HEAD simply has not moved yet.

*Alternative considered — reset, validate, and reset back on refusal (`git
reset --soft ORIG_HEAD`).* Rejected: it leaves a window in which the branch is
at merge-base, so an interrupted run reproduces the exact state this ticket
exists to eliminate, and it makes the refusal path depend on a second git
operation that can itself fail.

*Alternative considered — `git diff --name-only "$MERGE_BASE"` (merge-base vs
working tree).* Rejected: that would inspect the working tree rather than the
index, which is a different set, and picking between those two is CON-162's
question, not this ticket's.

**D2: Move the reset to immediately before the commit, keeping its existing failure handling verbatim.**

The reset block moves from L117 to just above the commit at L234. Its message
and exit code are unchanged, so a reset failure still reports identically —
and now it can only occur on a run whose guard already passed, where HEAD
moving is the intended outcome anyway.

**D3: Nothing else moves.** The D3 base-advancement log stays where it is
(it depends only on `MERGE_BASE` and the base tip). The always-print block
stays where it is relative to the guard, which now means it prints before the
reset as well as before the commit — a strict improvement, since the list is
now emitted even on a run that dies between print and reset.

**D4: The regression guard asserts the refusal path specifically, and is proven by mutating the ordering, not the guard.**

The suite's established idiom (`test/scripts/squash-branch.test.sh`) mutates
the real script in place, from a snapshot taken at process start, restoring
via an EXIT trap. The scenario must run against a fixture whose branch carries
at least one of its **own commits** past the merge-base — otherwise HEAD and
the merge-base coincide and the HEAD-unchanged assertion is vacuous under the
ordering mutation. Whether the undeclared path is committed on the branch or
merely `git add`ed does not matter: `git diff --cached "$MERGE_BASE"` picks up
both.

1. Record `git rev-parse HEAD` before the run.
2. Run the real script against a branch the guard will refuse; assert non-zero
   exit, no new commit, and `git rev-parse HEAD` identical to the recorded
   value.
3. Mutation proof: reintroduce the early reset by inserting `git_wt reset
   --soft "$MERGE_BASE"` back at its old position, re-run the same fixture,
   and assert the HEAD-unchanged assertion now *fails* (HEAD equals the
   merge-base). Restore.

The mutation must be the ordering itself. Mutating the guard's strictness
would make the test go red for the wrong reason — it would prove the guard
still refuses, which is already covered — so it would not exercise this
requirement at all.

**D5: Scenario 2's two ordering-dependent assertions are rewritten, not deleted.**

The existing suite is not inert with respect to this change. Scenario 2 in
`test/scripts/squash-branch.test.sh` is the one existing scenario that asserts
post-refusal state, and it encodes the *old* ordering as its expected outcome:
`:235-239` asserts "no squash commit was created (HEAD still at merge-base)"
by comparing the commit count against the literal `1`, and `:241-246` asserts
"the stray file remains staged (uncommitted) after the guard trip". Both go
red under the fix, and the comment block at `:232-234` states the inverse of
the new contract. Rewriting them is part of this change, and their correct
post-fix form is a decision made here rather than improvised under a red suite:

- The "no squash commit" assertion becomes a comparison against a HEAD value
  (or commit count) **recorded before the run**, never against a literal.
  Hardcoding `2` would reintroduce the same fixture-shaped assertion in the
  other direction.
- The "stray file remains staged" assertion is re-expressed as the
  work-is-not-lost check it actually is: the stray file is still present and
  reachable from HEAD. In this fixture it is committed on the branch, so the
  index is legitimately clean after the fix and the old form cannot hold.
  It is **not** deleted — deleting it removes exactly the coverage this ticket
  exists to create.

Because Scenario 2 already is a refusal fixture with branch-own commits and an
undeclared path, D4's guard may be built as an extension of it rather than as
a fresh fixture; either shape satisfies D4.

## Risks / Trade-offs

- **The script under change is the one this very delivery uses to squash.** →
  Mitigated by editing only `core/scripts/squash-branch.sh` while Delivery
  invokes `scripts/concertino/squash-branch.sh`, which is a separate,
  unmodified render target; and by the test suite exercising the real file
  against throwaway repos before Delivery is reached. If this run's own squash
  misbehaves, treat it as a symptom of this change first.
- **A refusal now leaves the index in whatever state the executor left it**,
  rather than the merge-base-staged state. → This is the point of the change;
  it is also the state a human already expects to find.
- **Diff overlap with CON-162/CON-164, both queued on this same file.** →
  Mitigated by holding the diff to the reset's position and the new test, so
  those tickets rebase cleanly.
