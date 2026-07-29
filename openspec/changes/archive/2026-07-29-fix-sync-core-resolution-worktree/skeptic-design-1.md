## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/core-resolution/spec.md` in full.
- Read `bin/concertino` (1501 lines) end-to-end for the parts touching `CORE`,
  `cmdSync`, `cmdInit`, `cmdEject`, `cmdDiff`, `checkArtifacts`, `copyAssets`,
  `emitClaude`, `emitCodex`, `readRoleFile` — `grep -n "CORE\b" bin/concertino`
  and `grep -n "copyAssets(\|emitClaude(\|emitCodex(\|readRoleFile(\|function cmdInit\|checkArtifacts("
  bin/concertino`.
- Read `core/scripts/emit-event.sh`'s `main_checkout()` (lines 58-67), the
  mechanism Decision 1 says it mirrors.
- Checked existing test coverage: `ls test/scripts/`, `package.json`'s `test`
  script, and confirmed no existing test exercises `cmdInit`/`cmdEject`/`cmdDiff`.
- Checked `workflow-state.md` — confirms this is genuinely the design gate,
  planning artifacts marked complete/validated.

### Finding 1 — tasks.md contradicts itself on the central behavior (blocking)

Task 3.1 and Task 3.3 describe the **identical** input scenario — a git
worktree whose `core/scripts/*` has been edited (diverged from the main
checkout), with the executing `bin/concertino` living in the main checkout
and `--out` pointed at the worktree, `--core` **not** given — and assert
**opposite** outcomes:

- Task 3.1 (`tasks.md:29-37`): "...edit `core/scripts/*` inside the worktree,
  run `node bin/concertino sync` from inside the worktree (simulating the
  executing script living in the *main* checkout...), and **assert the
  rendered `scripts/concertino/*` in the worktree matches the worktree's own
  `core/`**, not the main checkout's." → expects a **successful render**.
- Task 3.3 (`tasks.md:41-43`): "Add a case for the refusal path: worktree +
  main checkout with genuinely divergent `core/`, `--core` not given —
  **assert non-zero exit and that no files under `scripts/concertino/` were
  written/changed**." → expects **refusal, zero output**.

These cannot both pass. This isn't a subtle reading — it's the same setup
(worktree diverged from main, no `--core`) with contradictory expected exit
code and file-write behavior in the same task list.

This traces directly to a deeper conflict between the ticket's literal
acceptance criterion and `design.md`'s Decision 2:

- `ticket.md:43-45` (AC): "A test covers the worktree case specifically:
  create a worktree, change `core/scripts/*`, run sync from inside it, and
  **assert the rendered copy matches the worktree's core** rather than the
  main checkout's." This demands a *successful render* in the exact scenario
  where the worktree's core has diverged (that's what makes it worth
  testing) — "assert the rendered copy matches" presupposes a copy exists.
- `design.md` Decision 2 (`design.md:94-131`) and `spec.md`'s Requirement 3 +
  its scenario "worktree edited core/scripts since branching from main"
  (`spec.md:29-38`) say the CLI **SHALL refuse to proceed... and does not
  write or overwrite any rendered files** for this exact setup.

Task 3.1 was clearly written to satisfy the ticket's literal AC (hence its
"assert ... matches the worktree's own core" language, copied almost
verbatim from the ticket). Task 3.3 and `spec.md` Requirement 3 were written
to satisfy Decision 2. Nobody reconciled the two before handoff — the
planning artifacts ship two different, incompatible target behaviors for the
one scenario the ticket cares about most.

This must be resolved explicitly, one way or the other, before implementation:
either (a) Decision 2's refusal should not fire when the target unambiguously
*is* the worktree/cwd itself (the AC's scenario is exactly "target wants its
own core rendered into itself" — arguably not actually ambiguous, since there
is only one plausible intent: render the target's own checked-out files), and
`design.md`/`spec.md` need rewriting to make identical-or-target-preferred
the default with refusal reserved for some other case; or (b) the ticket's AC
and task 3.1 are wrong/stale relative to the now-decided refuse-first design
and need to be rewritten to describe a refusal, not a successful render —
but that would mean the shipped behavior does not satisfy the ticket's
explicit, human-authored acceptance criterion, which should not be resolved
unilaterally by the executor.

Either way, this is not a minor nit: it determines what the executor writes,
and the two paths produce mutually exclusive code.

### Finding 2 — the core-rendering functions that actually do the I/O are never mentioned as needing the resolved core (blocking)

`CORE` (`bin/concertino:21`) is read directly, as a closed-over module
constant, by `readRoleFile` (:92), `emitCodex` (:438), `copyAssets` (:472-478),
and `checkArtifacts` (:773-777) — the functions that actually perform the
file reads/copies this whole ticket is about. `design.md`'s Impact section
(`design.md:49-51`) and `tasks.md` 1.1-1.3 only describe wiring `cmdSync`,
`cmdDoctor`, `cmdUpdate`, and `checkArtifacts` (partially — checkArtifacts is
named but not `copyAssets`/`emitClaude`/`emitCodex`/`readRoleFile`, which
`cmdSync` itself calls at `bin/concertino:1297,1299-1300` to do the actual
work) to "call `resolveCore` instead of reading the module-level `CORE`
constant."

If `resolveCore()` is only called inside `cmdSync`/`cmdDoctor`/`cmdUpdate`
and the module-level `CORE` constant is genuinely removed (as task 1.1
literally instructs: "replace the module-level `CORE` constant with a
`resolveCore(...)` function"), every one of `readRoleFile`, `emitClaude`,
`emitCodex`, `copyAssets`, `checkArtifacts` will throw `ReferenceError: CORE
is not defined` the moment they run — including from inside `cmdSync`
itself, since `cmdSync` calls `copyAssets`/`emitClaude`/`emitCodex`
transitively. The plan as written never says how the resolved core value
reaches these functions (parameter threading vs. a per-invocation
module-level variable reassignment) — that's left for the executor to
invent mid-implementation, which is exactly the kind of unspecified decision
that should be resolved at design time, not discovered while editing the
tool this delivery workflow depends on.

Additionally, `cmdInit` (`bin/concertino:1381`) calls `copyAssets` directly,
*before* calling `cmdSync` — and `cmdEject`/`cmdDiff` (:679-715, :928-982)
call `readRoleFile`/`emitClaude`/`emitCodex` independently of `cmdSync`
entirely. None of these three commands are named anywhere in `design.md`'s
Impact section, `tasks.md`'s task list, or the new tests (3.1-3.4, which only
exercise `sync`). If the executor's refactor doesn't also update these call
sites, `concertino init`/`eject`/`diff` will break with no test in this
change or the existing suite (`ls test/scripts/` — none reference
`cmdInit`/`cmdEject`/`cmdDiff`) to catch it. Task 4.1's `node --check` is a
syntax check only and will not catch a `ReferenceError` at runtime.

Mitigating factor I want to be fair about: task 3.1 does invoke `sync`
end-to-end via subprocess against a throwaway repo, which *would* surface a
broken `CORE` reference inside `cmdSync`'s own call graph before task 4.2
ever touches this worktree — so the specific safety concern the orchestrator
flagged (don't corrupt this worktree's own rendered files) is likely covered
in practice for `sync`. But `init`/`eject`/`diff` have zero coverage in this
plan and are a real, currently-unflagged regression risk.

### Finding 3 — Decision 1's detection doesn't actually implement the "only ancestry-linked cores" guarantee it claims (non-blocking but worth tightening)

`design.md`'s Non-Goals (`design.md:52-61`) explicitly claims detection is
scoped to "target is a worktree/checkout of the same superproject the
executing script's repo belongs to," and reasons "in practice, 'same
superproject' reduces to: target's main-checkout path equals the executing
script's `REPO` path, or vice versa." But Decision 1's actual algorithm
(`design.md:69-92`, `tasks.md:3-12`) never checks that — it only checks
"does the target's main checkout have *any* `core/` directory, at a
different path than `REPO/core`." For an npm-installed `concertino` used
inside an arbitrary git-tracked consumer project that happens to have its
own unrelated top-level `core/` directory (a common name — plenty of
projects have one), this would trigger a byte-comparison (near-certain
mismatch, since the file sets are unrelated) and a **refusal**, directly
regressing the ticket's own explicit AC #2 ("the npm-installed case is
unchanged"). The design's own reasoning for why this can't happen doesn't
hold — nothing in the algorithm confirms ancestry, it just confirms
existence-and-path-difference. Worth tightening (e.g., verify the target's
`.git`'s remote/commit ancestry actually relates to `REPO`, not just that a
`core/` dir exists) before this ships, though it's a rarer real-world case
than Finding 1/2.

### Verdict: REFUTE

### Change Requests

1. Resolve the tasks.md 3.1 vs 3.3 contradiction (and the underlying
   design.md Decision 2 vs. ticket.md AC conflict) explicitly in `design.md`
   before any code is written. State plainly what happens when the target
   *is* the worktree/cwd itself and its checked-out core has diverged from
   the executing script's core with no `--core` given: does `sync` render
   using the worktree's own core (satisfying the ticket's literal AC and
   task 3.1), or refuse (satisfying Decision 2 and task 3.3 as currently
   written)? Rewrite whichever of `design.md`/`spec.md`/`tasks.md` is wrong
   so all three agree, and if the resolution changes Decision 2's outcome
   from "always refuse on divergence," update the Decision 2 rationale
   accordingly rather than leaving stale reasoning in place.
2. Add explicit guidance in `design.md`'s Impact section and `tasks.md`
   (new task under section 1) for how the resolved core reaches
   `readRoleFile`, `emitClaude`, `emitCodex`, `copyAssets`, and
   `checkArtifacts` — parameter-threading vs. a per-command-invocation
   module variable — and name `cmdInit` and `cmdEject`/`cmdDiff` explicitly
   as call sites that also depend on `CORE` and must not break. Add (or
   explicitly scope out with justification) test coverage for `init`/
   `eject`/`diff` continuing to work after `CORE` stops being a bare module
   constant.
3. Tighten Decision 1's detection to actually verify ancestry between
   `REPO` and the target's main-checkout (not just "a `core/` dir exists at
   a different path"), or explicitly narrow the Non-Goals claim to match
   what the algorithm really does, so the npm-installed-project-with-an-
   unrelated-`core/`-directory case doesn't produce a false-positive
   refusal that regresses AC #2.

### Non-blocking notes

- Decision 1 (reuse `git rev-parse --git-common-dir`, mirrored from
  `emit-event.sh`) is sound and well-justified; the git-failure fallback
  (Risks section) correctly preserves the npm-installed / non-git case.
- Decision 3 (`--core=PATH` on `sync`/`doctor`/`update`) and Decision 4
  (`doctor` always prints the compared-against core path) are both clear,
  testable, and correctly scoped.
- Once Finding 1 is resolved, the rest of the test plan (3.2 npm-installed
  parity, 3.4 `--core` override) looks adequately specified.
