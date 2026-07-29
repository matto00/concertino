## Context

Local `main` in the primary checkout only ever moves when a human runs git by hand — nothing in
the workflow does it. `setup-worktree.sh` already fetches `origin/<base>` before cutting a *new*
branch, which stops the common case, but it does nothing for the primary checkout itself, and a
run that started while a sibling's PR was still open still branches from a base that's about to
be behind. Phase 4 (`cleanup.sh --phase4`) is the one place the workflow knows, synchronously,
that a merge just happened — it is invoked by the orchestrator only after the PR has landed.

Two existing pieces of machinery this design reuses rather than re-invents:
- `emit-event.sh escalation --await` already blocks a calling process, writes `escalation.raised`,
  polls `.concertino/runs/<TICKET>/answer.json` (written atomically by `lib/ui/store.js`'s
  `writeAnswer`, `O_EXCL` so only the first answer wins), and logs `escalation.answered` or
  `escalation.timeout` when it returns. This is exactly "stash/ff/unstash is a human judgement
  call — escalate and wait for someone to decide", already built for the orchestrator's own
  escalations.
- `lib/ui/reducer.js` already models one live escalation per run (`run.escalation`,
  `run.escalationStale`) and `lib/ui/screens/escalation.js` already renders it with a `[t] type a
  reply` input box. The fleet screen already pins `NEEDS YOU` rows to the top, uncapped. The gap
  this ticket closes is visibility from every *other* screen, not a new escalation primitive.

## Goals / Non-Goals

**Goals:**
- Fast-forward local `main` automatically as part of Phase 4, silently when safe.
- Never touch a dirty tree or a diverged `main` — escalate instead, changing nothing.
- Make a stuck fast-forward visible from any dashboard screen, with a reachable way to reply, and
  make it clear the moment it's resolved.
- Name the usual cause of rendered-artifact drift in `doctor`'s existing drift check.
- Re-render (or clearly say a re-render is needed) right after a successful fast-forward, so
  staleness bite #2 (stale rendered agents) can't recur silently.
- Stay safe with several worktrees live off the same object store.

**Non-Goals:**
- The `ROADMAP.md` "stale-base warning at the delivery gate" item (a *warn, never block* check at
  PR-creation time, mid-run) — different moment, different mechanics, not in this ticket's
  acceptance criteria. Left as a follow-up.
- Automating the actual conflict resolution (stashing, resolving a real merge conflict). The
  ticket is explicit that this is a human judgement call; the escalation's job is to pause and
  ask, not to guess.
- A general escalation-queue UI (multiple simultaneous escalations get a minimal "+N more"
  affordance, not a full list/inbox view).

## Decisions

### 1. Fast-forward lives in `cleanup.sh`, gated the same way the rest of Phase 4 already is
`cleanup.sh --phase4` already refuses to run without the explicit Phase-4 opt-in. The fast-forward
step is inserted between worktree removal and the script's final `run.end` emission — so if it
blocks on an escalation, the run is *not yet* `run.end`ed, and the existing
`run.escalationStale`/`deriveStatus` logic in `reducer.js` needs no change: the raising run still
reads as "in flight, needs you" for exactly as long as the blocking `--await` call is outstanding,
and reverts to normal (`done`) once it resolves. No new run-lifecycle state was invented.

Alternative considered: a standalone `sync-main.sh` script the orchestrator calls as a separate
Phase 4 step. Rejected — it would need its own opt-in guard duplicating `cleanup.sh`'s, and would
either race the worktree-removal step or need its own ordering contract; folding it into the
existing, already-ordered script is strictly simpler.

### 2. The algorithm operates on refs, not on "whatever is checked out", except where a working
tree is actually involved
```
git fetch --quiet <remote> <base>                          # best-effort; offline = skip silently
LOCAL=$(git rev-parse <base>)
REMOTE=$(git rev-parse <remote>/<base>)
[ "$LOCAL" = "$REMOTE" ]                                    → already current, nothing to do
git merge-base --is-ancestor <base> <remote>/<base>          → true: fast-forward is safe
  find where <base> is checked out (git worktree list --porcelain)
  not checked out anywhere → git update-ref refs/heads/<base> <remote>/<base>   (no working tree
                                                                                  touched, always safe)
  checked out somewhere, clean (git status --porcelain empty there) → git -C <that worktree>
                                                                        merge --ff-only <remote>/<base>
  checked out somewhere, dirty                                      → escalate ("dirty tree")
                                                                       → escalate ("diverged")
```
Operating on the ref directly when `<base>` isn't checked out anywhere is what makes this safe
with several worktrees live: none of the ticket worktrees ever have `main` checked out (they're
all on feature branches), so in the overwhelmingly common case there is no working tree to
disturb at all, and the "clean tree" check only matters on the rare occasion a human has `main`
checked out by hand in the primary checkout.

Alternative considered: always require the primary checkout's `HEAD` to literally be `<base>`
before doing anything, matching "the normal workflow never touches `main` directly". Rejected as
unnecessarily narrow — it would escalate on the harmless case where nothing has `main` checked
out at all (e.g. a human is parked on a scratch branch in the primary checkout), which is a safe
ref update with zero working-tree risk.

### 3. Escalation is a bounded retry/skip loop, not a single fire-and-block
On any non-silent outcome (dirty, diverged, or the one fast-forward attempt itself failing for an
unexpected reason), `cleanup.sh` calls:
```
emit-event.sh escalation --await ticket=<T> \
  question="can't fast-forward local main (<reason>)" \
  options=retry,skip
```
and blocks. `retry` re-runs the same three-line algorithm once more (covers "I stashed my work and
re-ran `git fetch`" while the human was looking at the banner); `skip` proceeds without touching
`main`. Bounded to **2 total attempts** (matching this codebase's existing "executor debug, 2
attempts" circuit-breaker convention) — a third failure logs a note and moves on rather than
escalating again, so a truly stuck repo can never wedge Phase 4 forever. A free-text reply (the
existing `[t] type a reply` path) is accepted structurally by `--await` but is not specially
parsed — anything other than exactly `retry` is treated as `skip`, so typing a note like "I'll
fix it later" behaves predictably.

Whether or not the fast-forward succeeds, the rest of Phase 4 (worktree removal, ticket → Done,
hygiene report) proceeds unconditionally — a stale `main` is a *future-run* risk, not a reason to
leave the *current*, already-merged ticket dangling.

### 4. Post-fast-forward re-render resolves the same `concertino` an adopting project would
actually have, not a path only this repo happens to have
**Revised after design-gate round 1** — the first draft assumed `<checkout>/bin/concertino` is
how an adopting project runs the CLI. It is not: per `package.json`/`README.md`/
`docs/quickstart.md`/`docs/adapting-to-your-project.md`, an adopting project only ever has
`concertino` on `PATH` (global install) or invokes it via `npx`; `bin/concertino` as a real file
inside the checkout only exists in *this* repo (self-hosting). Resolution order, first match
wins:
1. `command -v concertino` on `PATH` → `concertino sync --out=<primary checkout>` (the real path
   for every adopting project).
2. `<primary checkout>/bin/concertino` exists → `node <primary checkout>/bin/concertino sync
   --out=<primary checkout>` (this repo's own self-hosting case, and any other project that
   happens to vendor the CLI the same way).
3. Neither → `npx --no-install concertino sync --out=<primary checkout>` as a last resort (covers
   a local, non-global devDependency install without triggering an unexpected network fetch via
   `--no-install`).
4. All three fail (or the command exits non-zero) → not an error: print a `note:` on stderr
   ("main fast-forwarded — re-render failed or no \`concertino\` found, run \`concertino sync\`
   manually") rather than escalate. Having moved `main` forward is strictly an improvement even
   if the re-render step itself can't run, and re-escalating over a *rendering* failure would
   conflate two different failure domains.

### 5. `doctor` names the cause, doesn't diagnose the working tree
`checkArtifacts`'s docstring already explains the failure this exists to catch ("rendered files
older than the core they came from"). The new check sits beside it (`section('Git')`, before or
after `Rendered artifacts`): fetch (best-effort, silently skipped if it fails — doctor must never
hang or fail offline), then `git rev-list --left-right --count <base>...<remote>/<base>`. A
nonzero "behind" count warns: `local <base> is N commit(s) behind <remote>/<base> — this is
usually because Phase 4 cleanup's fast-forward didn't run, or a merge landed outside the
workflow; run \`concertino sync\` after bringing it forward`. Ahead-only or equal is silent (not
a warning) — a human legitimately ahead of origin (unpushed local commits) is not this ticket's
concern and flagging it would be a false positive against a different, unrelated situation.

### 6. Cross-screen escalation banner: its own action namespace, dispatched before the screen
underneath ever sees the keystroke
**Revised after design-gate round 1** — the first draft claimed the banner could reuse
`escalation.js`'s existing action verbs (`open-reply`/`reply-type`/`submit-reply`/...) "for free"
because `watch.js` already has `case` blocks for them. Verified false against the actual code:
those `case` blocks (`watch.js`'s `applyAction`, `open-reply`/`reply-backspace`/`reply-type`/
`cancel-reply`/`submit-reply`) hardcode the dedicated escalation screen's own
`escalationReply`/`escalationNotice` state, and `submit-reply`'s success path
(`answerEscalation` → `backToFleet()`) unconditionally force-navigates to the fleet — exactly the
"leaves whatever screen you were on" requirement this capability exists to satisfy. Reusing those
verbs unmodified would silently mutate state nothing reads (`escalationReply` when `mode !==
'escalation'`) and, on a successful submit, would yank the human back to the fleet. Fixed design:

- A new pure module, `lib/ui/banner.js`, exporting `renderBanner(escalation, opts)` (one or two
  lines: role, elapsed time, truncated question, and — when a reply is in progress —
  `reply › …`) and `handleKey(key, state)` returning its **own, separately-namespaced** action
  types — `banner-reply-type`, `banner-reply-backspace`, `banner-cancel-reply`,
  `banner-submit-reply` — never the bare `reply-type`/`submit-reply`/... verbs
  `escalation.js` owns, so the two can never be dispatched into each other's `case` blocks by
  accident.
- `watch.js` computes `const liveEscalations = runs.filter(r => r.escalation &&
  !r.escalationStale)` once per poll — this is *not* the same filter `fleet.js`'s `needsYou`
  uses (`fleet.js:115` filters on `status === 'needs-you'`, which per `reducer.js`'s
  `deriveStatus` also includes a `BLOCKER`-verdict run with no live `run.escalation` at all, i.e.
  nothing `answer.json` could resolve); it is the narrower, correct filter for "something the
  banner can actually let a human reply to." Sorted oldest-`raisedAt`-first; the banner targets
  the oldest (longest-blocking, so most actionable by construction) and states `+N more` when
  `liveEscalations.length > 1`.
- New state in `currentState()`: `globalEscalationTicket`, `globalEscalationReply` (mirroring
  `escalationTicket`/`escalationReply`'s shape but never aliasing them — two independent pairs).
- Key routing in `onKey()`, checked *before* `router.handleKey` is called at all: (a) if
  `globalEscalationReply` is already open, every keystroke goes to `banner.handleKey` instead of
  the router — the same "reply box owns every keystroke while open" precedence
  `escalation.js` already gives its own reply box locally, just applied one level higher, before
  routing rather than inside one screen's handler; (b) otherwise, if the reserved key **`g`** is
  pressed, `liveEscalations` is non-empty, and no other screen-local reply/prompt already owns the
  keyboard (`!prompt && !escalationReply && !drillConfirm`), open the banner's reply box for the
  oldest live escalation. `applyAction` gains matching `banner-*` cases: `banner-reply-type`/
  `banner-reply-backspace` mutate `globalEscalationReply.value`; `banner-cancel-reply` clears
  `globalEscalationReply`/`globalEscalationTicket` with **no** call to `backToFleet()`, so `mode`
  and every other screen's state is untouched; `banner-submit-reply` calls `store.writeAnswer`
  directly (the same function `answerEscalation` calls — the write side genuinely is unchanged)
  against `globalEscalationTicket`, and on success clears the two global-reply fields *without*
  navigating — the screen underneath, whatever it was, renders on the very next frame exactly as
  it did before `g` was pressed, only now with one fewer live escalation to show a banner for.
- The banner is suppressed only when the currently open screen is *that exact* escalation
  (`mode === 'escalation' && escalationTicket === oldest.ticket`) — showing it there would
  literally duplicate the screen already on top. It is shown on every other screen, including the
  fleet (where the `NEEDS YOU` section already exists below it) and including a *different* run's
  escalation screen.
- Clearing is free: the moment `--await` picks up the answer (or times out) it logs
  `escalation.answered`/`escalation.timeout`, `reducer.js` sets `run.escalation = null` on the
  very next poll exactly as it does today, `liveEscalations` no longer contains that run, and the
  banner disappears from every screen on the next redraw — no new "clear" logic needed beyond the
  `banner-*` cases above (which only ever clear the banner's own local reply-in-progress state,
  never the escalation itself — that clearing is still owned entirely by the existing
  `--await`/`reducer.js` path, whether the answer came from the banner or the dedicated screen).

Alternative considered: render the banner as its own dashboard *mode* (a screen you navigate to),
with global keys just routing there. Rejected — it fails "appears on every screen" literally (you
would still have to leave whatever you were doing to see or answer it), and it would require a
"return to whatever I was on" stack that doesn't exist anywhere else in this codebase.

Alternative considered: let the banner offer the same lettered quick-options
(`escalation.js`'s `optionKeys`) instead of free text only. Rejected for the banner specifically —
duplicating per-escalation option letters as *global* hotkeys risks a collision with the screen
underneath's own bindings (`fleet.js`, `drilldown.js`, etc. each already own most letters); a
single reserved key (`g`) that opens a typed-reply box sidesteps that entirely, at the cost of one
extra keystroke for the common "just pick an option" case — acceptable given this path is for the
rare "I'm not currently on the fleet or the right run's screen" case, not the primary one.

### 7. Orchestrator role note, not a new procedure
`core/roles/orchestrator.md`'s Phase 4 section gets one added sentence: the `cleanup.sh --phase4`
Bash call should pass a long timeout (matching the guidance already given for the orchestrator's
own `emit-event.sh escalation --await` calls), since it may now itself block on a fast-forward
escalation. No new phase, no new signal type — Phase 4 already "runs directly (no subagent)" and
already gates on `assert-phase.sh` afterward.

## Risks / Trade-offs

- **[Risk]** A `cleanup.sh` blocked on `--await` holds up the orchestrator's Phase 4 (ticket →
  Done, hygiene report) for as long as the human takes to answer, up to
  `escalationTimeoutMinutes`. → **Mitigation**: this is the same trade-off every other BLOCKER in
  this workflow already makes; the timeout (default 8 minutes, already short by design per
  `docs/dashboard.md`) bounds it, and a timeout still lets `cleanup.sh` fall through to "skip" and
  finish Phase 4 rather than hanging forever.
- **[Risk]** `git update-ref` on an unwatched branch could, in principle, move `main` out from
  under something that reads it non-interactively at exactly that moment (e.g. an in-progress
  `git worktree add --no-track ... origin/main` in `setup-worktree.sh`, which resolves its own
  base *before* creating the worktree). → **Mitigation**: `update-ref` is only reached when
  `main` is confirmed a clean ancestor fast-forward, so the ref only ever moves strictly forward,
  and any reader that resolved it a moment earlier still gets a valid, just-slightly-stale commit
  — never a torn or invalid state.
- **[Risk]** The global banner's single reserved key (`g`) could collide with an existing
  per-screen binding. → **Mitigation**: audited during implementation (see tasks); if a collision
  exists, the design falls back to an unused letter, not a code-level conflict — no architectural
  change needed either way.
- **[Trade-off]** The banner shows only the *oldest* live escalation when several are live at
  once, with a bare count for the rest. A fleet running many concurrent orchestrators could have
  more than one live escalation with no way to jump directly to the second-oldest from the banner
  itself (only by navigating to the fleet and finding it in `NEEDS YOU`, which already works
  today). Accepted for this ticket's scope — multiple simultaneous escalations are the rare case,
  and the fleet screen remains the full picture.

## Migration Plan

Additive only — no data migration, no schema change, no existing behavior removed. Both new
scripts sections and the new dashboard module ship in one PR. Safe to roll back by reverting the
commit; nothing persists a new on-disk format (the escalation event shape is unchanged from
`escalation-context`).

## Open Questions

None outstanding — the design gate is expected to confirm the `g` key choice and the
retry/skip-bounded-at-2 shape against ground truth before implementation starts.
