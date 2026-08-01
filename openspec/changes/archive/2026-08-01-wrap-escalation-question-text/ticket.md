# CON-53: Escalation question text is truncated with an ellipsis instead of wrapping

## Description

On both the fleet page and the escalation answer screen, a long escalation *question* is hard-truncated with `…` instead of word-wrapping, so it runs off (or is clipped at) the edge of the screen. The escalation *context* field, right next to it, already wraps correctly — the question field just wasn't updated to match.

Confirmed sites:

* `lib/ui/screens/fleet.js:196` — the NEEDS YOU / RUNNING row does `f.truncate(run.escalation.question + stale + keys, opts.cols - 8)` instead of wrapping.
* `lib/ui/screens/escalation.js:146` — the escalation answer screen's headline does `f.truncate(currentQuestion, innerWidth)`.
* By contrast, `escalation.js:160` already wraps the context field correctly via `textwrap.wrap(String(esc.context), innerWidth)` — `lib/ui/textwrap.js`'s `wrap()` is the utility to reuse.

## Acceptance Criteria

* On the fleet page, a long escalation question wraps onto additional lines under the run row instead of being clipped with `…`. Row/box layout accommodates the extra line(s) without corrupting the box borders or other rows.
* On the escalation answer screen, the question headline wraps the same way, using `textwrap.wrap()` like the context field already does.
* Short questions that already fit on one line are unaffected.
* Verify with a synthetic escalation question long enough to overflow a narrow terminal (e.g. 80 cols).
