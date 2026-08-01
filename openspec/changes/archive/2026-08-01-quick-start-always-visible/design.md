## Context

`QUICK START` (`lib/ui/screens/fleet.js`) is currently gated by `watch.js`'s `quickStartVisible` state, `false` by default, toggled by the dedicated `Q` key (`QUICK_START_TOGGLE_KEY`). `buildSections()` only pushes the `QUICK START` entry `if (o.quickStartVisible)`. The section's own local focus mechanism (digit-jump entry, `j`/`k` cursor, `a`-to-queue, Escape-to-exit) is independent of the visibility flag and must not change.

A directly comparable precedent already exists in the same file: `METRICS` (lazygit-layout pass) is unconditional — `buildSections()` includes it whenever `o.metrics` is truthy, and its caller (`renderFleet`) always passes it. `QUICK START` should follow the same shape.

## Goals / Non-Goals

**Goals:**
- `QUICK START` renders on every fleet page load, no toggle required.
- The `Q` key and its `'toggle-quickstart'` handling are removed outright, not left as a dead no-op.
- Everything else about `QUICK START` — ranking, exclusions, empty/cold hints, row rendering, local focus navigation (digit-jump, `j`/`k`, `a`, Escape) — is unchanged.

**Non-Goals:**
- Reassigning capital `Q` to a new action. It becomes free but this change does not claim it for anything else.
- Any change to `QUICK START`'s content (ranking, filters, count) or its focus/queue-add behavior.

## Decisions

**Decision 1 — remove the `quickStartVisible` flag entirely, rather than default it `true`.**
The acceptance criteria say `buildSections()` no longer gates the section behind a visibility flag — not merely that the flag defaults `true`. Keeping a flag that is always `true` would leave dead state and an unused toggle-adjacent code path behind, exactly the "dead no-op" the ticket calls out to avoid. Instead:
- `watch.js` drops the `quickStartVisible` variable, its `currentState()` entry, and its `draw()`-time conditional (`quickStartTickets`/`quickStartCold` are now computed unconditionally, every poll — the same way nothing else in `draw()` gates on a visibility flag before computing its inputs).
- `fleet.js`'s `buildSections()` pushes the `QUICK START` entry unconditionally (mirroring `METRICS`'s `o.metrics` truthy-branch, but with no opts flag needed at all — `quickStartTickets`/`quickStartCold` are passed as before, just always populated now).
- `sectionJumpTargets()` drops the `quickStartVisible` parameter — the internal `buildSections()` call it makes no longer needs it, since inclusion is now unconditional. `render()` drops forwarding `quickStartVisible` into `opts`.

Alternative considered: keep the flag, initialize `true`, and simply delete the `Q` key/`'toggle-quickstart'` case so nothing ever sets it `false`. Rejected — leaves a permanently-`true`, never-read-as-`false` flag threaded through `currentState()`, `render()`, and `sectionJumpTargets()` for no behavioral purpose, which is exactly the "dead" state the ticket is asking to remove alongside the toggle key itself.

**Decision 2 — free `Q`, do not reassign it.**
The ticket's own acceptance criteria flags this as a call to make ("check `fleet.js`'s collision-avoidance comment... in case that key should be freed up or reassigned"). No other pending need for a capital-`Q` binding exists in this codebase today, so the simplest correct move is to delete `QUICK_START_TOGGLE_KEY` and its collision-avoidance comment block outright, freeing the key for a future ticket to claim rather than speculatively assigning it here.

**Decision 3 — `quickStartFocus`/`focus === 'quickstart'` local state is untouched.**
Digit-jump into `quickstart` focus, the local `j`/`k` cursor, `a`-to-add, and Escape-to-exit all key off `focus`/`quickStartFocus`, never off `quickStartVisible` — removing the visibility flag does not touch any of this. `quickStartFocus` keeps its existing `0` default (no longer meaningfully tied to "the `Q` toggle's open action always sets `focus: 'quickstart'` in the same step" comment, since there is no longer an explicit open action — but the default of `0` is still correct: the section is on screen from the first frame, and digit-jump still explicitly sets `quickStartFocus: 0` on entry).

## Risks / Trade-offs

[Existing tests assert `quickStartVisible` defaults `false` / is toggled by `Q`] → These are expected to be rewritten, not preserved — they test the exact behavior this ticket removes. The executor updates/removes them as part of this change.

[`docs/dashboard.md` or other docs might reference `Q` in more than one place] → grep the full docs tree for `Q` / "Quick Start" toggle language before considering documentation done, not just the one location named in the ticket.
