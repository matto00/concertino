## Skeptic Report — design gate (round 3, final allowed round)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/core-resolution/spec.md` in full (all revised since round 2), plus
  `skeptic-design-1.md` and `skeptic-design-2.md` for context only (treated as
  claims, not fact).
- **Reproduced the round-2 npm-nested-dependency scenario with real `git`
  commands** in a throwaway repo (`mkdir myproject && git init`,
  `node_modules/concertino/` with no `.git` of its own, `myproject` has its
  own `core/`): confirmed `git rev-parse --show-toplevel` run from inside
  `node_modules/concertino` resolves to `myproject`, **not**
  `node_modules/concertino` itself. This means Part 1 of the revised Decision
  1 (`repoToplevel == REPO`) correctly fails immediately for this topology,
  before ever reaching the common-dir comparison that round 2 showed was
  insufficient on its own. This closes round 2's finding 3.
- **Reproduced the three legitimate ancestry scenarios** in a second
  throwaway repo (main checkout + two sibling worktrees `wt1`, `wt2` via
  `git worktree add`): confirmed (a) `REPO=main, out=wt1` — Part 1 passes
  (`show-toplevel(main) == main`), Part 2 passes (common-dir equal), target
  root resolves to `wt1`'s own directory; (b) `REPO=wt1, out=wt2` (sibling
  worktrees, neither containing the other) — Part 1 passes for `wt1` (a
  worktree's own toplevel is itself, never the other worktree's path), Part 2
  passes (both share the main checkout's common-dir); (c) `REPO=out=main` —
  trivially passes, and the pseudocode's `targetRoot != REPO` guard correctly
  suppresses the divergence note in this case. No legitimate case is rejected
  by requiring `REPO` to be its own toplevel.
- Confirmed `core/scripts/emit-event.sh`'s `main_checkout()` (lines 58-67)
  already normalizes relative-vs-absolute `git rev-parse --git-common-dir`
  output via `cd`+`pwd`, the exact pattern design.md/tasks.md say `resolveCore`
  will mirror — a concrete, working reference implementation, not hand-waving.
- Re-ran `grep -n "CORE\b" bin/concertino` and
  `grep -n "function cmdInit\|function cmdEject\|function cmdDiff\|function cmdSync\|function cmdDoctor\|function cmdUpdate\|copyAssets(\|emitClaude(\|emitCodex(\|readRoleFile(" bin/concertino`
  against the real file — confirmed every line reference design.md/tasks.md
  cite (`readRoleFile`, `emitCodex`, `copyAssets`, `checkArtifacts`, and all
  six commands) is accurate against current source.
- Read `cmdInit` (bin/concertino:1351-1395), `cmdSync` (:1286-1302),
  `cmdUpdate` (:1304-1342), `cmdEject` (:662-716), `cmdDiff` (:928-975),
  `cmdDoctor` (:805-845) in full to check for any cross-command call site the
  design/tasks might have missed.
- Grepped all planning docs for `refus|non-zero|exit 1|exit non` — confirmed,
  fresh, that no residual refuse-vs-pick contradiction survives in
  `tasks.md`/`design.md`/`spec.md` (only historical mentions remain, in the
  ticket's own notes and design's Decision 2 rationale explaining the
  rejection, exactly as round 2 found).
- Confirmed `test/scripts/` and `package.json`'s `test` script have no
  existing `eject`/`diff` coverage, so task 3.7 is the only thing that would
  close that gap.

### Point-by-point answers to the review's five questions

**1. Does the two-part check close round 2's gap?** Yes — verified by direct
reproduction above, not just trusting the prose. `gitTopLevel(node_modules/concertino)`
really does resolve to the consumer's root, not to `node_modules/concertino`
itself, so Part 1 rejects the topology round 2 found unhandled, before any
common-dir comparison runs.

**2. Does it still permit the genuine cases?** Yes, for all three variants
(main→worktree, worktree→sibling-worktree, same-checkout), reproduced above.
I found no case where requiring "`REPO`'s own show-toplevel equals `REPO`"
incorrectly rejects a legitimate worktree. (`bin/concertino`'s `REPO` is
computed as `path.resolve(__dirname, '..')`, and `bin/` sits directly at the
repo root in this project, so `REPO` genuinely is the checkout root in every
real invocation — confirmed via `bin/concertino:20`.)

**3. Is the eject/diff test gap genuinely closed?** Task 3.7 names the exact
gap round 2 flagged and the exact spec.md scenario ("eject and diff read from
the resolved core", spec.md:99-104) it backs. This is adequate at the design
gate — a task now exists that a competent executor can follow to close the
gap; actual passing tests are for the final gate to verify.

**4. New contradictions/gaps from this round's revision — one found:**

`cmdInit` internally invokes `cmdSync` as a nested call, and this call site
is unaddressed by every planning artifact:

```
bin/concertino:1394-1395
  // Auto-sync so agent files are ready immediately.
  cmdSync({ _: ['sync'], config: cfgPath, out });
```

This is a **hand-built literal object**, not the original parsed `args` —
compare `cmdUpdate` (bin/concertino:1341), which forwards the *entire*
original `args` object (`cmdSync(args)`), so `--core` (once added) propagates
transparently there. `cmdInit`'s literal object carries only `_`, `config`,
and `out` — it does not, and per the current design/tasks plan will not,
carry `core`.

Concretely: `design.md` Decision 5 (design.md:262-276) says `resolveCore` is
"called once per command invocation (`cmdSync`, `cmdDoctor`, `cmdUpdate`,
`cmdInit`, `cmdEject`, `cmdDiff`)" — but `cmdInit` is not one command
invocation from `resolveCore`'s point of view; it is two, nested: `cmdInit`'s
own direct `copyAssets` call at line 1381 (which needs its own resolved core,
per task 1.3), and then a second, independent resolution inside the
internally-triggered `cmdSync` at line 1395 (whose `copyAssets`/`emitClaude`/
`emitCodex` calls are what actually render the role/agent files `init`
produces). Neither `design.md`, `tasks.md`, `proposal.md`, nor `spec.md`
mentions this internal call site at all (confirmed via grep across all four
for `cmdInit`, `1394`, `1395`, `nested`, `internal.*sync`, `Auto-sync` — the
only `cmdInit` mentions describe it calling `copyAssets` directly "before
`cmdSync`", never that it also *calls* `cmdSync` itself, nor how the override
should reach that inner call).

The consequence is a direct violation of Decision 3 / spec.md's own
unconditional requirement ("`concertino sync`, `doctor`, `update`, `init`,
`eject`, and `diff` SHALL accept a `--core=PATH` argument that, when given,
is used as the resolved core directly, bypassing ancestry detection... 
entirely" — spec.md:69, naming `init` explicitly): as currently planned,
running `concertino init --core=X` would use `X` for the files `copyAssets`
writes directly at line 1381, but the role/agent files rendered by the
internally-triggered `cmdSync` at line 1395 would silently fall back to
auto-detected resolution instead of `X`, since the override never reaches
that inner call. That is exactly the class of silent, mixed-provenance
output this entire ticket exists to eliminate — reintroduced by the fix,
in a new place, for one specific flag/command combination. (When no `--core`
override is given at all, the practical harm is smaller — `resolveCore` is a
pure function of `REPO`/`out` so both resolutions would agree — but it does
mean `resolveCore`'s git subprocesses run twice and, if divergence exists,
the divergence note would print twice for a single `init` invocation, which
nothing in the plan anticipates either.)

I checked whether any other command has a similar hidden nested call:
`cmdEject` (:662-716) and `cmdDiff` (:928-975) are both self-contained, only
calling `readRoleFile`/`emitClaude`/`emitCodex` directly, no cross-command
calls. `cmdDoctor` (:805-845 and its `checkArtifacts` call) is likewise
self-contained. `cmdInit`→`cmdSync` is the only such nested call in the
codebase.

Everything else checked holistically — `tasks.md` vs. `design.md` vs.
`spec.md` vs. `ticket.md`'s four ACs — remains consistent: all four ACs trace
to real requirements/tasks, Decision 2's pick-not-refuse reasoning is
unchanged and sound (per round 2), and no other new contradiction surfaced.

**5. Is this fixable in one more pass, or does it need a human?** This is a
narrow, mechanical, single-call-site gap — not a deep architectural problem.
The fix is scoped and obvious once named: either thread `core: args.core`
(or the coreOverride string) into the literal object at
`bin/concertino:1395`, or (cleaner) have `cmdInit` resolve the core once and
pass the resolved value down so the inner `cmdSync` doesn't re-resolve at
all. I have high confidence this is fixable in one more design revision
without needing to escalate to a human — it's the same category of "missed
call site" that round 1 already caught and round 1's revision successfully
fixed for the six top-level commands; this is the one nested call site that
slipped through because it isn't a top-level command dispatch.

### Verdict: REFUTE

### Change Requests

1. Add explicit handling for `cmdInit`'s internal `cmdSync(...)` call
   (`bin/concertino:1394-1395`) to `design.md`'s Decision 5 / Impact section
   and to `tasks.md` (a new sub-task under section 1, alongside 1.1-1.3):
   either forward the coreOverride (`core: args.core`) into the constructed
   args object at that call site, or refactor `cmdInit` to compute the
   resolved core once (via its own `resolveCore` call) and pass that resolved
   value through to the inner `cmdSync` invocation directly (e.g., by
   extracting a shared render-step helper both `cmdInit` and `cmdSync` call
   with an already-resolved `core`, rather than `cmdInit` re-invoking
   `cmdSync` and letting it re-resolve). Either fix must guarantee: (a)
   `concertino init --core=X` renders identically-sourced output for both the
   direct `copyAssets` call and the role/agent files the inner sync pass
   produces, and (b) no `--core` given still produces exactly one divergence
   note per `init` invocation, not two.
2. Add a test case (or extend task 3.6's `cmdInit` smoke test) asserting that
   `concertino init --core=PATH` against a worktree target renders **all**
   of its output — both the directly-copied assets and the
   internally-synced role/agent files — from `PATH`, not a mix of `PATH` and
   auto-detected core.

### Non-blocking notes

- The two-part ancestry check (Decision 1) is sound and, per my own
  reproduction with real git commands, actually closes round 2's finding —
  well done tightening it rather than re-asserting the prior prose claim.
- Task 3.4's realistic npm-nested-dependency test setup matches my own
  reproduction exactly and would catch a regression if the executor ever
  weakens Part 1.
- Task 3.7 adequately backs spec.md's eject/diff scenario at the design
  level; final-gate review should confirm the test actually exercises both
  commands and would fail if a call site were missed.
- This is a narrowly-scoped, easily-actionable finding, not a sign of a
  deeper unresolved ambiguity in the design's core approach — the two-part
  ancestry check and Decision 2's pick-not-refuse resolution are both sound
  and should not be revisited.
