## Context

`ticketProvider.kind: "local"` tracks tickets as markdown files under
top-level `tickets/`, on purpose (design.md Decision 3 of the local-ticket-
provider change, CON-44): gitignoring them would mean the backlog dies with
the checkout, doesn't survive a clone, and is invisible to a collaborator, PR
review, or CI.

The orchestrator's only write-back seam for this is `core/scripts/
set-ticket-state.sh <tickets-dir> <TICKET_ID> <state>` (design.md Decision
6 of that same change): it validates the state, rewrites only the
frontmatter `state:` line via temp-file + rename, and exits non-zero on
failure (the orchestrator's existing `FAIL` → `BLOCKER` treatment). It is
called twice per run, always against the **main checkout** (never the
per-ticket worktree, which doesn't exist yet at the first call site and has
already been destroyed by the second):

- Setup step 1, **before** `setup-worktree.sh` creates the worktree —
  `set-ticket-state.sh tickets "$TICKET_ID" started`.
- Cleanup step 2, **after** `cleanup.sh --phase4` has already removed the
  worktree — `set-ticket-state.sh tickets "$TICKET_ID" completed`.

Today, nothing commits either write. Two consequences, both filed as CON-90:

1. The main checkout is dirty for the whole run. `cleanup.sh`'s
   `attempt_fast_forward` (`main-fast-forward` capability) checks out
   whether the base branch's worktree — which, for the primary checkout, is
   `REPO_ROOT` itself — is clean before fast-forwarding it; finding it dirty
   (because of the uncommitted `tickets/<ID>.md` this same run just
   rewrote), it sets `FF_STATUS="dirty"` and raises a blocking
   `emit-event.sh escalation --await ... options=retry,skip`. Deterministic
   on any local-provider repo with a remote: the run's own PR just merged,
   so local base is behind the remote, so the fast-forward path is always
   entered, and the tree is always dirty because the run itself dirtied it.
2. The tracked backlog never gains a commit recording the transition — the
   whole argument for tracking `tickets/` (reviewability, surviving a clone)
   is undercut, since the committed file keeps saying `unstarted` forever.

## Goals / Non-Goals

**Goals:**
- A local-provider delivery run against a repo with an (unprotected, normal)
  remote completes without the dirty-tree escalation in the common case.
- Every state transition `set-ticket-state.sh` makes is committed to git
  history — durable, not just a working-tree edit — regardless of which of
  the two call sites (pre-worktree Setup, post-cleanup Cleanup) made it.
- Whenever push access allows it, that commit also reaches the configured
  remote, so a collaborator sees it without being handed the main checkout
  directly.
- Zero behavior change for `linear`/`github` providers, and zero change to
  `cleanup.sh`'s fast-forward semantics — this fix removes the *precondition*
  that used to trigger the escalation, it does not touch the escalation path
  itself.

**Non-Goals:**
- Guaranteeing zero escalations in every configuration. A push-protected
  base branch (requiring PRs even for direct pushes) will still leave the
  commit local-only, which still trips `cleanup.sh`'s existing (unmodified)
  `diverged` escalation — documented as a residual, explicitly accepted
  case, not silently swept under the rug (see Risks below and the doc
  rewrite in the proposal).
- Retrying a failed push (e.g. fetch + rebase + push again). One best-effort
  attempt only — see Decision 3.
- A config knob to disable the auto-commit/push behavior. Consistent with
  Decision 3 of the local-ticket-provider design ("the path is fixed, not
  configurable... a knob would add config surface for a choice nobody has
  asked to make") — see Decision 4 below for why this one follows the same
  precedent rather than adding a knob.
- Reconciling a diverged base by rebasing local ticket-state-only commits
  onto a moved remote tip inside `cleanup.sh`. Considered (see Risks) and
  rejected for this change: it would touch `main-fast-forward`'s shared
  fast-forward semantics for every provider, which the original ticket
  itself flags as the higher-risk of the three options it lists ("changes
  cleanup semantics for every provider").

## Decisions

### Decision 1 — Commit lives inside `set-ticket-state.sh`, not orchestrator prose

This repo's own stated discipline is that no state mutation happens outside
a canonical script (`emit-event.sh`, `persist-evidence.sh`,
`set-ticket-state.sh` itself) — agents are explicitly told not to hand-roll
`git worktree`/env-copy/port math, and the same logic applies here: an agent
should not be trusted to remember "commit after calling this script," and a
canonical script is testable in isolation (`test/scripts/
set-ticket-state.test.sh`) where orchestrator prose is not. So the commit
(and the best-effort push) become part of `set-ticket-state.sh`'s own
contract, executed after the temp-file-rename write succeeds, before it
prints `OK <id> <state>` and exits 0.

This also solves the "timing is awkward" problem the ticket calls out
without touching orchestrator step ordering at all: both call sites already
run against the main checkout (not a worktree), so the script always has a
real git working tree to commit into, whether it's invoked pre-worktree
(Setup) or post-cleanup (Cleanup). No reordering, no new orchestrator step.

**Alternative considered:** have the orchestrator issue `git add`/`git
commit` itself, right after calling `set-ticket-state.sh`. Rejected — it
duplicates git plumbing across every rendered orchestrator prompt (Claude
Code, Codex, OpenCode), violates the "canonical script" precedent, and an
agent could plausibly skip it under prompt pressure with no test coverage
to catch the regression.

### Decision 2 — Commit is pathspec-limited to exactly the one rewritten file, using a pathspec relative to `-C`'s target

`git commit` is scoped to a single-file pathspec (never `git commit -a` or
`git add -A`), so the script only ever commits the ticket file it just
rewrote. Any other uncommitted change already sitting in the main checkout
(a real dirty tree, unrelated to this run) is left exactly as it was —
`cleanup.sh`'s dirty check still correctly escalates on *that*, which is not
spurious.

**The exact invocation matters and is easy to get wrong.** The existing
script already defines `FILE="$DIR/$ID.md"` — already prefixed with
`$DIR`. Every git command in this change uses `-C "$DIR"` to target the
tickets directory's repo. Passing `$FILE` (which still carries the `$DIR/`
prefix) as the pathspec to a command already scoped with `-C "$DIR"`
double-prefixes the path — and that is not a hypothetical: the real
orchestrator call is `set-ticket-state.sh tickets "$TICKET_ID" started`,
i.e. `$DIR` is the **relative** literal string `tickets`, invoked with cwd =
the main checkout root (`lib/cli/render.js`'s `local` block). With `$DIR`
relative, `git -C "$DIR" add -- "$FILE"` resolves to `git -C tickets add --
tickets/CON-12.md`, which fails (`fatal: pathspec 'tickets/CON-12.md' did
not match any files`) because `-C tickets` already changed the effective
root the pathspec is resolved against. This only fails silently to look
correct when `$DIR` happens to be absolute (as every `mktemp -d`-seeded
test directory is) — exactly the shape the existing and any naively-added
test coverage uses, so this defect would ship undetected without a test
using a relative `<tickets-dir>` (see tasks.md 3.x).

**The one correct invocation this design specifies:** use the pathspec
relative to `-C`'s target — `git -C "$DIR" add -- "$ID.md"` and `git -C
"$DIR" commit -m "<message>" -- "$ID.md"` (the file's basename only, since
`-C "$DIR"` already changes the effective working directory git resolves
that pathspec against). This is correct for both a relative and an
absolute `$DIR`. Do not reuse the existing `$FILE` variable for either git
command's pathspec.

### Decision 3 — Push is one best-effort attempt, never forced, never retried

After the commit, the script attempts:

```
git -C <repo> push <remote> HEAD:<current-branch-name>
```

using whatever branch is actually checked out at the tickets directory
(never a hardcoded `main`) and `project.baseRemote`/`CONCERTINO_BASE_REMOTE`
— defaulting to `origin` — the same resolution `cleanup.sh` already uses, so
no new config surface is introduced. This is inherently fast-forward-only
(a plain `git push` refspec without `--force` always is); on rejection
(offline, no push access, protected branch, or a genuine concurrent
divergence) the script does **not** retry, does **not** force, and does
**not** fail — it prints a note to stderr and still exits 0 with `OK <id>
<state>`, because the write itself (and its local commit) already
succeeded and is durable in local git history regardless of whether it
reached the remote.

**Why not retry with fetch+rebase+push?** The realistic race this would
catch — something else advancing the same remote branch in the few seconds
between fetch and push — is rare enough (this is a single ticket-status
file write, not a high-traffic branch) that the added complexity and the
new failure modes of an automatic rebase (conflict handling, needing to
detect "is this actually the shape I think it is") aren't justified for
this fix. A push that fails for a durable reason (protected branch, no
credentials) would only fail again on retry anyway.

**Why not gate this behind a config flag?** The precedent Decision 3 of the
local-ticket-provider design set (fixed `tickets/` path, no `dir` knob,
because "nobody has asked to make that choice") applies here too: pushing is
strictly additive best-effort behavior with no destructive failure mode
(never forced, never retried, scoped to one file), so there's no unsafe
default to protect a user from by adding a knob.

### Decision 4 — Skip the commit/push entirely when the tickets dir isn't a git working tree

`set-ticket-state.sh`'s existing bash tests seed a bare `mktemp -d` scratch
directory with no `git init` at all. Before attempting any git operation,
the script checks `git -C "$DIR" rev-parse --is-inside-work-tree` (and, for
the push step, `git -C "$DIR" symbolic-ref --short HEAD` succeeding — i.e.
not a detached HEAD) and silently skips straight to `OK <id> <state>` when
either isn't true. This keeps every existing test passing unmodified (they
never seed a git repo, so they now exercise the "not a git repo" no-op path
implicitly) and matches the script's actual real-world precondition: for a
genuine local-provider project, `tickets/` is always tracked in a real git
repo (Decision 3 of the local-ticket-provider design), so this branch is a
test/script-sandbox affordance, not a real-world gap.

## Risks / Trade-offs

- **[Risk] A push-protected base branch never accepts the direct push, so
  local `<base>` stays durably ahead of its remote by the ticket-state
  commits, and the next `cleanup.sh --phase4` run still hits the existing
  (unmodified) `diverged` escalation.** → Documented explicitly in
  `docs/config-reference.md` as a known, accepted residual case (the
  proposal's doc rewrite) rather than silently claimed as fixed. This is a
  materially different situation from today's bug: it is not deterministic
  for the common local-provider setup (an unprotected personal/small-project
  remote), and when it does occur the human's `retry`/`skip` answer is
  meaningful (skip and push manually later) rather than pointless busywork
  against a guaranteed-dirty tree every single run.
- **[Risk] Committing (and pushing) directly to the base branch outside of
  PR review is a departure from this project's usual code-review discipline
  for that branch.** → Scoped narrowly to a single non-code metadata file
  (`tickets/<ID>.md`'s `state:` line) that carries no reviewable logic —
  functionally the direct git-native equivalent of what a Linear/GitHub
  ticket-status API call already does today for the other two providers
  (also bypasses PR review, by design, for exactly this kind of metadata
  mutation). Never forced, never touches any other file, always reversible
  with a single `git revert`.
- **[Risk] Two runs on the same ticket, or a human editing `tickets/`
  directly, race on the same file.** → Pre-existing risk, not introduced
  by this change (today's uncommitted in-place rewrite has exactly the
  same last-write-wins shape); orthogonal to this fix and out of scope.
- **[Trade-off] Rejected the "teach `cleanup.sh` to reconcile a
  ticket-state-only divergence by rebasing" alternative**, which would have
  closed the push-protected-branch residual risk above completely. Not
  pursued in this change because it touches `main-fast-forward`'s shared
  fast-forward logic for every provider (the original ticket's own
  reservation about that option), is materially more implementation and
  test surface, and the residual risk it would close is already narrow and
  documented. Worth reconsidering as a follow-up if the residual case proves
  common in practice.

## Migration Plan

No data migration. Purely additive script behavior; a project on the
previous `set-ticket-state.sh` binary sees no difference until it's
updated (via this repo's own delivery + eventual `concertino sync` in a
consuming project). No rollback concerns beyond reverting the script change
itself — every commit it makes is a normal, individually revertable git
commit.

## Open Questions

None outstanding — the two residual risks above are accepted trade-offs,
not open decisions.
