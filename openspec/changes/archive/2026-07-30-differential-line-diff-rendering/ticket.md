# CON-27: Differential (line-diff) rendering for the dashboard's poll loop

## Description

Follow-up from CON-17 ("Every dashboard screen flickers on each render"). CON-17's own ticket text described three approaches to fixing the render-loop flicker, in increasing order of effort:

1. Stop clearing — cursor-home + pad-to-width overwrite (implemented in CON-17).
2. Alternate screen buffer on entry/exit (implemented in CON-17).
3. **Differential rendering** — keep the previous frame, diff line by line, and only rewrite changed lines.

CON-17 deliberately implemented only (1) and (2), per the ticket's own guidance: "(1) and (2) together are probably the right first move; (3) is a follow-up if the poll ever gets more expensive." This ticket tracks that deferred follow-up.

## Current behavior

`lib/ui/watch.js`'s poll loop (`draw()`, now via the `buildFrame` helper added in CON-17) writes every visible row of the frame on every 1 Hz tick, regardless of whether that row's content changed since the previous tick — it homes the cursor and rewrites the full padded frame each time (no more full-screen clear/blank-frame flicker as of CON-17, but still a full-frame rewrite).

## Desired behavior

Track the previous frame's rendered lines (already partially tracked in CON-17 for shrink-cleanup purposes — see `lastFrameLines`/the frame-diffing groundwork in `buildFrame`). Diff the new frame against the previous one line by line, and only write the rows that actually changed (positioning the cursor per-row via `\x1b[<row>;1H` rather than rewriting the whole frame). This should make the 1 Hz poll's terminal-write cost close to free in the common case where most of the dashboard is unchanged between ticks.

## Why this is a separate ticket, not part of CON-17

- CON-17's five acceptance criteria (no blank frame; scrollback preserved; stale-row cleanup on shrink; terminal state restored on every exit path; resize reflows correctly) are all fully satisfied by the cheaper (1)+(2) approach — full-frame writes are cheap enough at 1 Hz that there's no performance motivation to do this now.
- This is a materially larger change: it needs a real line-by-line diff algorithm (not just a line-count comparison) and has more edge cases (partial-line changes, colour-escape boundaries mid-line, interaction with the existing shrink-cleanup logic) than CON-17's scope.
- No behavioral requirement forces it today; it's purely a performance/efficiency improvement to revisit "if the poll ever gets more expensive" (CON-17's own phrasing).

## Scope note

Should remain entirely confined to `lib/ui/watch.js` — `lib/ui/router.js` and every `lib/ui/screens/*` module must stay pure, string-returning, and untouched, exactly as CON-17 preserved. This constraint carries over unchanged.

Relates to CON-17: https://linear.app/helioapp/issue/CON-17/every-dashboard-screen-flickers-on-each-render
