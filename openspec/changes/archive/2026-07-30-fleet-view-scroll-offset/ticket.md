# CON-6: Fleet view cannot scroll, so selection can move onto a row that isn't rendered

## Description

The fleet screen caps its finished sections and clamps total output to the terminal height, so a long history cannot push `NEEDS YOU` off the top. But `j`/`k` still move the selection across the full `runs` array, including rows the cap removed from the render.

The result is a selection marker you cannot see. Attach still targets the correct run — this was verified across 20 runs at six terminal heights with zero index mismatches, and a mis-aimed `tmux attach` errors rather than silently attaching to the wrong agent — so this is a usability gap, not a correctness bug.

## Acceptance Criteria

* Moving the selection past the last rendered row scrolls the view rather than moving onto an invisible row.
* The `NEEDS YOU` section stays pinned and visible regardless of scroll position.
* The selection index and the rendered `▸` marker remain in agreement at every scroll offset — there is an existing test asserting this alignment; extend it to cover scrolled states.
* Behaviour is sane at very small terminal heights, where fewer rows fit than there are sections.

## Notes

The renderer is a pure function of `(runs, opts)`; keep it that way by passing a scroll offset in `opts` rather than giving the screen its own state. Scroll position belongs in `lib/ui/watch.js` with the rest of the stateful poll-loop bookkeeping.

This is adjacent to the slice-2 drill-down work and may be worth doing alongside it.
