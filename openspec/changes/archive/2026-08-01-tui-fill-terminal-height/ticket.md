# CON-43: TUI should occupy the terminal's full height

## Description

The dashboard doesn't extend to fill the terminal's full height (reported directly, not yet independently reproduced in this ticket).

## What's confirmed vs. not

Confirmed: `lib/ui/watch.js`'s poll loop already reads the real terminal size (`process.stdout.rows`, `watch.js:505`) and computes `screenRows = totalRows - bannerLines` before handing it to screens, so the plumbing to know the real height exists and is already used for section trimming (`fleet.js`'s `sectionHeight`/`height()`/`budget`, `layout.degrade()`).

**Not yet confirmed:** why the rendered output doesn't reach that height in practice. Candidates worth checking before assuming a fix: a screen's own section/pane budgeting under-using the `screenRows` it's given rather than filling it (e.g. sections collapsing smaller than necessary when content is short); a stale/cached terminal size read; or something specific to how the alternate-screen buffer or a particular screen (fleet vs. drill-down vs. launch pad) lays out its content. This needs a repro against a real terminal at a few different heights before diagnosing further — don't guess at the fix from the report alone.

## Scope history

Originally requested alongside CON-30 (visual design pass 2) and flagged as a possible interrupt to that in-flight work. Briefly folded into CON-30's scope on 2026-07-30, mid-run — but that fold was never actually threaded into CON-30's design/tasks artifacts, and CON-30's design-gate rounds and execution proceeded on colour/hierarchy/density only. Caught and reverted 2026-07-30, after CON-30 had already shipped that narrower scope. This ticket is reopened as its own independent piece of work — not absorbed into CON-30.

## Acceptance criteria

* Reproduce the gap first (which screen, what terminal size, how much unused space) and name the actual cause before proposing a fix.
* The dashboard fills the terminal's available rows (`screenRows`, already computed) rather than rendering short of it, on every screen, without overflowing and triggering a scroll/redraw artifact of the kind CON-17/CON-26 already fixed for the opposite problem.
