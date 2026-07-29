## Context

`bin/concertino` is a single Node script. Today `CORE` is computed once at
module load as `path.join(path.resolve(__dirname, '..'), 'core')` — the core
next to the *executing* copy of `bin/concertino`. `CORE` is then read
directly, as a closed-over module constant, by every function that actually
performs core-relative I/O: `readRoleFile` (`bin/concertino:92`), `emitCodex`
(`:438`), `copyAssets` (`:472-478`), and `checkArtifacts` (`:773-777`). Those
functions are in turn called by `cmdSync`, `cmdDoctor`, `cmdUpdate`,
`cmdInit` (which calls `copyAssets` directly, before `cmdSync` even runs),
and `cmdEject`/`cmdDiff` (which call `readRoleFile`/`emitClaude`/`emitCodex`
independently of `cmdSync` entirely). Any fix has to reach every one of these
call sites, not just the top-level command dispatch.

This resolution is correct when the CLI and the target project are the same
tree (the common case: you run `./bin/concertino sync` inside the project
you're rendering into) and correct for the npm-installed case (a project
installs `concertino` as a dependency; `REPO` is `node_modules/concertino`,
which owns the only `core/` in play).

It breaks for Concertino developing itself: `concertino` is `npm link`ed
globally to the main checkout, and delivery worktrees are created as git
worktrees of that same repo under `.concertino/worktrees/...`. A worktree has
the same tracked files as any other checkout of the repo, including its own
`core/scripts/*`, already checked out at its own branch/commit — no
rendering needed to get it there, git already did that. Running the
globally-linked `concertino sync` from inside the worktree still resolves
`CORE` from `__dirname`, i.e. the main checkout's `core/`, not the worktree's
already-checked-out `core/`. If the worktree's branch has edited
`core/scripts/start-servers.sh`, `sync` overwrites that edit with the main
checkout's version — invisibly, because both are valid-looking shell scripts
and nothing checks they came from different commits.

`emit-event.sh` already solves the adjacent problem — "given I'm in a
worktree, find the main checkout" — via `git rev-parse --git-common-dir`,
which returns the shared `.git` directory (inside the main checkout) even
when invoked from a linked worktree. This design reuses that same primitive,
but for a different purpose than `emit-event.sh` uses it for: not to
*collapse* every worktree to one shared location (which is what
`emit-event.sh` wants, for one shared events log), but to *confirm ancestry*
— that the target directory and the executing script's own repo share the
same superproject at all — before trusting the target's own, worktree-
specific `core/`.

## Goals / Non-Goals

**Goals:**
- `sync`/`doctor`/`update`/`init`/`eject`/`diff` render from the core that
  matches the repository being operated on, when that repository is
  confirmed to be part of the same superproject as the executing script (a
  worktree or the main checkout of the very repo the CLI's own code lives
  in) and has its own `core/`.
- The npm-installed case — including the ordinary topology where the
  executing package is nested inside a git-tracked consumer's own tree via
  `node_modules`, and that consumer project coincidentally has its own
  top-level `core/` directory for unrelated reasons — is provably unchanged.
  Ancestry requires both (a) the executing script's own `REPO` being a git
  working-tree root in its own right (not merely nested inside a foreign
  repository), and (b) matching `git rev-parse --git-common-dir` between
  `REPO` and the target. Common-dir equality alone is not sufficient — it
  cannot distinguish a genuine worktree of the same superproject from a
  package nested inside an unrelated consumer's tree, since both produce
  identical common-dir values; condition (a) is what rules the latter out.
- When the target's own core is used and its content differs from the
  executing script's own core, say so with a visible, non-blocking note
  naming both paths — never silently.
- `doctor` always reports which core path it used for the artifact-drift
  comparison, whether or not a mismatch was detected, and whether that path
  was auto-detected or forced via `--core`.
- Every function and command that reads `CORE` today keeps working after it
  stops being a bare module constant (`readRoleFile`, `emitClaude`,
  `emitCodex`, `copyAssets`, `checkArtifacts`, and the commands that call
  them: `cmdSync`, `cmdDoctor`, `cmdUpdate`, `cmdInit`, `cmdEject`, `cmdDiff`).

**Non-Goals:**
- Not attempting to support two *unrelated* repositories both having a
  `core/` — ancestry is confirmed via requiring `REPO` itself to be a git
  working-tree root *and* matching common-dir with the target (see Decision
  1's two-part check below); a package merely nested inside a foreign
  project's tree (the ordinary `npm install` topology) never satisfies the
  first half, so it can never be mistaken for a worktree of the same
  superproject.
- Not changing what gets rendered (`copyAssets`, templates, role rendering)
  — only which `core/` directory those functions read from.
- Not adding a config option for this — it is repo-topology detection, not a
  project setting.
- Not implementing a hard refusal when the two cores differ (see Decision 2
  — the ticket's own acceptance criteria require a successful render in
  exactly that case).

## Decisions

**Decision 1: confirm ancestry via a two-part check — `REPO` must itself be a
git working-tree root, *and* its common-dir must match the target's — then
use the target's own `show-toplevel` core.**

An earlier version of this decision (design-gate round 2) compared only
`git rev-parse --git-common-dir` between `REPO` and `out`, reasoning that
equality proves "same superproject." The skeptic reproduced, with real git
commands, why that's insufficient: `git rev-parse --git-common-dir`, run from
inside a directory with no `.git` of its own, walks *up* the filesystem to
find the nearest enclosing `.git` — exactly what happens when `REPO` is
`node_modules/concertino` inside an ordinary npm-installed consumer project.
In that topology, `REPO`'s common-dir resolves to the *consumer's own* `.git`
— identical to `out`'s common-dir, since `out` is (or is inside) that same
consumer project. The common-dir check alone cannot tell "REPO is a worktree
of the same superproject as out" apart from "REPO is merely a vendored
dependency nested inside out's own, unrelated repository" — both produce
common-dir equality, because common-dir only answers "do these two paths
belong to the same working tree," which is true whenever *either* path is a
descendant of the other's repo root, regardless of *why* it's a descendant.

The fix is a second, prior check: confirm `REPO` is itself the root of a git
working tree — `git rev-parse --show-toplevel` run from `REPO` equals `REPO`
(normalized) — before trusting any common-dir comparison at all. This is
exactly the distinction that matters: the main checkout of Concertino's own
repo satisfies it (its own toplevel is itself); any worktree of that repo
also satisfies it (a worktree's toplevel is its own directory, not the main
checkout's — `git rev-parse --show-toplevel` never returns the *other*
worktree's path). A `node_modules/<pkg>` install satisfies it only if the
published package happens to ship its own `.git` (rare, and irrelevant here
since it would then be its own, unrelated repo, correctly excluded by the
common-dir mismatch that follows) — in the ordinary case it fails the check
immediately, because `node_modules/concertino` is not itself a working-tree
root; it's just a subdirectory of the consumer's tree.

```
resolveCore(REPO, out, coreOverride):
  if coreOverride:
    return absolute(coreOverride)

  # Part 1: REPO must be a git working-tree root in its own right — not
  # merely nested inside a foreign repository it doesn't control (the
  # ordinary `node_modules/<pkg>` topology fails this immediately, since
  # node_modules/concertino has no .git of its own).
  repoToplevel = gitTopLevel(REPO)      # may fail: REPO not in a git repo at all
  if not repoToplevel or normalize(repoToplevel) != normalize(REPO):
    return join(REPO, 'core')            # today's behavior, unchanged

  # Part 2: out belongs to the same superproject as REPO — same shared
  # .git, whether out is a worktree of REPO, REPO is a worktree of out's
  # main checkout, or they're literally the same checkout.
  scriptCommon = gitCommonDir(REPO)
  targetCommon = gitCommonDir(out)      # may fail: out not inside a git repo at all
  if scriptCommon and targetCommon and normalize(scriptCommon) == normalize(targetCommon):
    targetRoot = gitTopLevel(out)        # out's OWN checkout root — this is the
                                          # key difference from emit-event.sh's
                                          # main_checkout(): we want out's own
                                          # tree, not the shared main checkout.
    targetCore = join(targetRoot, 'core')
    if exists(targetCore):
      if targetRoot != REPO and bytesDiffer(targetCore, join(REPO, 'core')):
        printNote('rendering from ' + targetCore + ' — differs from the ' +
                   'executing script\'s own core at ' + join(REPO, 'core'))
      return targetCore

  # Not the same superproject, out has no core of its own, or git is
  # unavailable — today's behavior, unchanged.
  return join(REPO, 'core')
```

Verified against both reproductions from the skeptic's round-2 report: for
`REPO = node_modules/concertino` inside a git-tracked consumer, Part 1 fails
immediately (`gitTopLevel(REPO)` resolves to the consumer's root, not
`node_modules/concertino` itself) — resolution stops there, falls back to
`REPO`'s own core, and the consumer's coincidental top-level `core/`
directory is never even considered. For the genuine worktree case (`REPO` =
main checkout or a worktree, `out` = a different worktree of the same repo),
Part 1 passes (`REPO` is its own toplevel either way) and Part 2 then behaves
exactly as originally designed.

Once ancestry is confirmed, we deliberately do **not** reuse `out`'s
*common-dir* (which, again, always collapses to the shared main checkout) to
locate the core to render — we use `git rev-parse --show-toplevel` from
`out` instead, which resolves to `out`'s own worktree root. That is the
worktree that has the possibly-diverged, already-checked-out `core/` this
whole ticket is about; the main checkout's `core/` is exactly the stale
source of truth we're trying to stop rendering from. This is the sense in
which the design reuses `emit-event.sh`'s mechanism "pointed the opposite
direction," per the ticket's note: `emit-event.sh` wants the one shared main
checkout; this wants the specific worktree currently being operated on.

Alternatives considered and rejected across two rounds of review:
- Skip ancestry detection entirely and just look for "does the target's
  checkout have a `core/` directory, at a path different from `REPO/core`."
  Rejected (design-gate round 1, finding 3) — false-positives on any
  unrelated project with its own top-level `core/` directory.
- Confirm ancestry via common-dir equality alone, with no check that `REPO`
  is itself a working-tree root. Rejected (design-gate round 2, finding 3,
  reproduced with real git commands) — common-dir equality alone cannot
  distinguish a genuine worktree of Concertino's own repo from an ordinary
  npm-installed dependency merely nested inside a consumer's unrelated tree;
  both produce identical common-dir values. The two-part check above (Part
  1: `REPO` is its own toplevel; Part 2: common-dir equality) closes this by
  requiring `REPO` to be a bona fide checkout root before ever trusting a
  common-dir match — a package nested via `node_modules` never satisfies
  Part 1, so it never reaches the common-dir comparison at all.

**Decision 2: pick the target's own core, loudly — not a hard refusal, when
cores differ.**

This reverses the first draft of this design, which proposed refusing
outright when the executing script's core and the target's own core differ
in content. The skeptic (design-gate round 1, finding 1) correctly identified
that this contradicted the ticket's own literal acceptance criterion: *"A
test covers the worktree case specifically: create a worktree, change
`core/scripts/*`, run sync from inside it, and assert the rendered copy
matches the worktree's core rather than the main checkout's."* That AC
demands a **successful render** in exactly the scenario — worktree core has
diverged from the main checkout's — where the first draft's refusal would
have exited non-zero and written nothing. `tasks.md`'s own task 3.1 (written
against the AC) and task 3.3 (written against the first draft's Decision 2)
consequently described mutually exclusive expected outcomes for the same
input; that contradiction is resolved here, in favor of the AC.

Revisiting the actual judgment call the ticket asks for: is there genuine
ambiguity about *which* core is correct when the target's own checked-out
core differs from the executing script's? No. The target's own core is the
one that will actually be committed, tested, and merged on that branch —
"the repository being operated on," in the ticket's own words. There is
exactly one sane answer once ancestry is confirmed (Decision 1); this is not
a coin flip between two equally plausible options the way an actual conflict
(e.g. two independent, unrelated projects disagreeing about something) would
be. Refusing here would not resolve any real ambiguity — it would just make
the user do, by hand, the one thing the tool already knows how to do
correctly.

What *was* actually wrong with the original bug was not "the CLI picked a
core" — every invocation has to pick one — it was that the pick was made
**silently**, with no way to notice it happened until a merge got reverted
and someone spent an hour debugging it. That is the failure this design
fixes directly: whenever the target's own core is used and it differs in
content from the executing script's own core, `sync`/`update`/`init`/`eject`/
`diff` print a one-line note naming both paths, and `doctor` unconditionally
reports which core it compared against (Decision 4). The "loud refusal would
have surfaced this immediately" framing in the ticket is satisfied by making
the pick loud, not by declining to render at all.

`--core=PATH` (Decision 3) remains available for the rare case where a human
genuinely wants to force a specific core regardless of detection — e.g.
testing an old core against a new worktree deliberately. That is the
mechanism for handling true ambiguity, when it exists; it does not need to be
the default path for the ordinary worktree case the ticket is about.

**Decision 3: `--core=PATH` as the explicit override, on every command that
reads `core/`.**
`sync`, `doctor`, `update`, `init`, `eject`, and `diff` all currently read
the same module-level `CORE`, so all six need the same override. `--core`
bypasses detection entirely — set the resolved core to the given path
(resolved absolute), full stop. This is useful standalone (e.g. CI comparing
a project's rendered output against an arbitrary core version) independent
of any divergence.

**Decision 4: `doctor` reports the core path unconditionally.**
Add one line to `cmdDoctor`'s "Rendered artifacts" section: `core:
<resolved path>` (or `core (forced via --core): <path>` when overridden),
printed before the comparison runs, regardless of whether a mismatch was
found. This directly satisfies "doctor reports which core it compared
against, so a mismatch is legible rather than mysterious" — today doctor
gives zero indication of which `core/` produced its warnings.

**Decision 5: thread the resolved core as a parameter, not a reassigned
module variable.**
`resolveCore(REPO, out, coreOverride)` is called once per command invocation
(`cmdSync`, `cmdDoctor`, `cmdUpdate`, `cmdInit`, `cmdEject`, `cmdDiff`), and
its result is passed explicitly into `readRoleFile(role, out, core)`,
`emitClaude(..., core)`, `emitCodex(..., core)`, `copyAssets(out, core, dry)`,
and `checkArtifacts(out, core, harnesses, r)` — replacing every direct read
of the module-level `CORE` inside those five functions with the parameter.
Threading as a parameter (rather than reassigning a shared module-level
variable before each call) is preferred because `bin/concertino` is a single
process per invocation with no concurrent commands in flight, but parameter
threading makes each function's dependency on the resolved core visible at
its call site and is trivially testable in isolation (a unit test can call
`copyAssets(out, someCore, dry)` directly without needing to first poke a
module global into the right state).

**Decision 6: `cmdInit`'s internal `cmdSync(...)` call must reuse `cmdInit`'s
already-resolved core, not re-resolve independently.**

`cmdInit` is not a single, self-contained call site from `resolveCore`'s
point of view — it is two. It calls `copyAssets` directly (`bin/concertino:
1381`), and it then triggers a second render pass by calling `cmdSync(...)`
itself, internally, to produce the role/agent files (`bin/concertino:
1394-1395`, currently `cmdSync({ _: ['sync'], config: cfgPath, out })` — a
hand-built literal object, unlike `cmdUpdate`, which forwards the entire
original `args` object at its own trailing `cmdSync(args)` call). Left as
planned in Decision 5, that literal object would never carry `core`, so
`concertino init --core=X` would render the directly-copied assets from `X`
but the role/agent files from the inner `cmdSync`'s own, independent
auto-detection — the exact mixed-provenance, silent-divergence failure mode
this entire ticket exists to eliminate, reintroduced in one new place.

The fix: `cmdInit` resolves its core exactly once, at its own top (the same
`resolveCore(REPO, out, args.core)` call every other command makes), and
passes that single resolved value into *both* its direct `copyAssets` call
and the internal `cmdSync` call — not by having `cmdSync` re-resolve. Two
implementation shapes both satisfy this; either is acceptable:
(a) extend `cmdSync`'s own signature to accept an optional pre-resolved
`core` parameter (`cmdSync(args, resolvedCore)`) that, when given, is used
instead of `cmdSync` calling `resolveCore` itself — `cmdInit` then calls
`cmdSync({ _: ['sync'], config: cfgPath, out }, core)`; or (b) forward
`core: args.core` into the literal object and let the inner `cmdSync` call
`resolveCore` again — acceptable only because `resolveCore` is a pure
function of `(REPO, out, coreOverride)`, so a second call with the same
inputs is guaranteed to agree, at the cost of running the git subprocesses
twice and (when no `--core` is given and the cores genuinely diverge)
printing the divergence note twice for what the user experiences as one
`init` invocation. (a) is preferred for exactly that reason — one
resolution, one note, no redundant git subprocess calls — but (b) is not
wrong, just slightly wasteful; the executor may pick either, but must not
ship the literal object exactly as it stands today with no `core` field at
all.

Either way, the guarantee this closes: `concertino init --core=X` renders
**all** of its output — both the directly-copied assets and the
internally-synced role/agent files — from `X`, with no split provenance.

## Risks / Trade-offs

- [Risk] Using the target's own core whenever it exists and ancestry is
  confirmed means a worktree with a *broken* `core/scripts/*` (e.g.
  mid-edit, syntactically invalid) gets rendered as-is, with no refusal to
  fall back on.
  → Mitigation: this is exactly the ticket's own explicit AC — the CLI must
  render the worktree's own core, correct or not; validating the content of
  `core/scripts/*` is out of scope for this ticket (it's `bash -n`/lint
  territory, not core-resolution). The visible note at least tells the user
  which core produced the result they're looking at.
- [Risk] `git rev-parse --git-common-dir`/`--show-toplevel` can fail or
  behave unexpectedly in edge environments (bare repos, no git installed).
  → Mitigation: mirror `emit-event.sh`'s existing `main_checkout()` failure
  handling — any failure of either git call is treated as "not the same
  superproject," falling back to today's `REPO`-relative behavior exactly.
  Never block on git being unavailable; this feature only ever *adds* a
  preference for the target's own core, it never removes the fallback path
  that already works.
- [Risk] Byte-comparing `core/` trees on every invocation (when ancestry is
  confirmed) adds a small amount of work.
  → Mitigation: only triggered when ancestry is confirmed at all (rare
  outside worktree-based development on Concertino itself); the comparison
  itself is the same `fs.readFileSync(...).equals(...)` pattern
  `checkArtifacts` already runs today, over a handful of small script files —
  negligible cost, and it only gates whether to print a note, never whether
  to proceed.
- [Risk] This change touches `bin/concertino` itself, the tool this very
  delivery workflow depends on for `sync` — an in-flight edit could corrupt
  the executor's own worktree if `sync` were invoked mid-implementation with
  a half-written core-resolution function, or if `cmdInit`/`cmdEject`/
  `cmdDiff` are missed and silently break with no test coverage.
  → Mitigation: task ordering requires implementing + testing the new
  resolution logic (all six call sites, not just `cmdSync`) in isolation
  against throwaway repos before any `sync`/`doctor` invocation is issued
  *from within this worktree* during execution; the executor validates via
  `node --check bin/concertino`, the new shell test, and an explicit smoke
  check of `cmdInit` before ever calling `concertino sync`/`doctor` on its
  own worktree. This is called out explicitly in tasks.md.

## Migration Plan

No data migration. This is a CLI behavior change with one new flag
(`--core`) and one new non-blocking notice (printed when the target's own
core differs from the executing script's), both backward compatible with
every case that doesn't hit the new worktree-with-divergent-core condition.
No rollback machinery needed beyond reverting the commit.

## Open Questions

None outstanding. The refuse-vs-pick call is resolved in Decision 2: pick
the target's own core (satisfying the ticket's literal acceptance criteria),
made loud via a visible note and `doctor`'s unconditional reporting (Decision
4), rather than a hard refusal.
