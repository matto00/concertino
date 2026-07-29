# CON-13: `concertino sync` run inside a worktree renders from the wrong core

## Description

`bin/concertino` resolves `CORE` as `path.resolve(__dirname, '..')` — the core
belonging to whichever copy of the script is executing. That is right for an
npm-installed package, but wrong in the case Concertino puts itself in
constantly.

When the CLI is `npm link`ed to a development checkout and you run
`concertino sync` from inside one of that repo's delivery worktrees, it
renders the **main checkout's** `core/` into the worktree — not the
worktree's own. A run editing `core/scripts/*.sh` then syncs and gets its own
changes silently reverted to whatever `main` happens to have.

Found the hard way while rescuing PR #5: the merge resolved
`core/scripts/start-servers.sh` correctly, and `concertino sync` regenerated
`scripts/concertino/start-servers.sh` from the *stale* main-checkout core. It
only worked once invoked as `./bin/concertino sync` from inside the worktree.

## Why it matters

This is the same staleness class that has already cost real time twice —
once when the rendered agents in the main checkout predated the core they
were generated from and every run emitted no telemetry, and again here. The
`doctor` drift check added in that first round catches divergence *after* it
happens; this makes it happen.

It bites hardest in exactly the situation Concertino is built for: an
autonomous run, in a worktree, changing a procedure script, calling sync as
its own docs instruct.

## Acceptance criteria

* `concertino sync` renders from the core belonging to the repository it is
  operating on, not the one belonging to the executing script — when those
  differ and the target is a git worktree of the same repository.
* The npm-installed case is unchanged: a project that has installed
  Concertino as a dependency must still render from the package's core, since
  it has no `core/` of its own.
* `doctor` reports which core it compared against, so a mismatch is legible
  rather than mysterious.
* A test covers the worktree case specifically: create a worktree, change
  `core/scripts/*`, run sync from inside it, and assert the rendered copy
  matches the worktree's core rather than the main checkout's.

## Notes

Detecting "am I inside a worktree of the same repo whose core I am about to
use" is the crux. `git rev-parse --git-common-dir` already does this job for
`emit-event.sh`, which resolves the main checkout from inside a worktree —
the same mechanism, used in the opposite direction, is probably the answer.

Consider also whether sync should simply refuse and explain when the two
cores differ, rather than silently picking one. A loud refusal would have
surfaced this immediately instead of producing a wrong file.

## Orchestrator's framing (from the delivery run)

Two things to weigh explicitly:

1. The npm-installed case must not regress. A project with no `core/` of its
   own must keep rendering from the package's core. Only the case where the
   executing script's repo differs from the target repo AND the target is a
   worktree of that same repository should change behavior.
2. Consider refusing rather than guessing when the two cores differ, instead
   of silently picking one. Silently picking the *right* one is defensible,
   but silently picking either without saying so is what caused the bug.

Caution: this ticket modifies `concertino sync` itself, which this very
delivery workflow depends on (docs instruct calling it from inside worktrees).
Any executor change must be validated carefully so a mid-flight edit does not
corrupt this worktree's own rendered scripts under `scripts/concertino/` or
`.claude/agents/`. If there's genuine risk of that, it should be flagged
rather than discovered at the gates.
