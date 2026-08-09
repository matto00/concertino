# CON-110: Fleet-wide search (`/`) to jump to a run or ticket

## Description

Jumping to a specific run or ticket today means visually scanning whichever sections are on screen (`1`-`9` jumps to a *section*, not a row) — there's no way to type a partial ticket id or title and land directly on the matching row, especially once a fleet has enough RUNNING/DONE rows that `… and N more` trims are in play.

## Proposed

`/` opens a search prompt (reusing the existing text-input widget, `lib/ui/widgets/textinput.js`) that filters/highlights matching rows across every section currently rendered (ticket id or title substring match), `↵` jumps the selection to the first/best match, `esc` cancels.

## Design decisions to escalate

* Does search need to reach into sections' trimmed-off rows (`… and N more`) and DONE's cap, or is it scoped to what's already on screen? Reaching further means querying the underlying run store beyond what `sections.js` currently renders.

## Acceptance criteria

* `/` from the fleet view opens a search prompt; typing filters/highlights matching rows live; `↵` jumps to the first match; `esc` cancels with no state change.
* Documented in `docs/dashboard.md`'s key table.
