# CON-9: Ticket cache is bounded by the wrong thing — comments are 0.6% of it, descriptions are 79%

## Description

The launch pad's ticket cache (`lib/ui/cache.js`, `lib/ui/linear.js`) was given a `COMMENT_LIMIT = 50` per ticket to keep it from growing unbounded. Measurement against real data shows that limit is aimed at the wrong thing.

### What was measured

A real fetch against two teams:

| Team | Tickets | Cache size |
| -- | -- | -- |
| Concertino | 7 | 15.5 KB |
| Helio Platform | 267 | 740.1 KB |

Composition of the 740 KB:

* **Descriptions: 79%** (586 KB)
* **Comments: 0.6%**

Zero of the 267 tickets came close to the 50-comment cap. The busiest thread in the entire backlog has **one** comment.

So the cap does nothing, and the thing that actually drives size — ticket count — is unbounded. Extrapolated, a 1,000-ticket backlog produces roughly 2.8 MB, re-fetched and re-parsed on every refresh.

A second contributing factor: **266 of Helio's 267 open tickets are** `backlog`. `OPEN_STATE_TYPES` includes `backlog` deliberately, so the launch pad can browse work that hasn't been started — but it means the cache carries an entire backlog to support a screen where you pick one or two tickets to run.

### Why not just cap descriptions

Because the description is the point. The cache exists so the launch pad can show a full ticket viewer without a network round-trip, and reading the ticket properly is exactly what you want to do before handing it to an autonomous agent. Truncating descriptions would break the feature the cache was built for.

## Acceptance Criteria

* The cache has a bound that reflects what actually grows it. Ticket count is the candidate; justify whatever you choose against the measurements above rather than picking a round number.
* A `backlog: false` style opt-out under the `dashboard.launchPad` config, so a project with a large backlog can fetch only started and unstarted work. Default should preserve today's behaviour.
* When a bound truncates the fetch, the launch pad can say so — a silently short list is worse than a visible "showing 200 of 1,043".
* `COMMENT_LIMIT` stays as cheap insurance against an outlier thread, but its comment should stop claiming it is what keeps the cache small.
* Tests cover the bound and the opt-out with fixtures. No test may hit the network.

## Notes

Sibling of CON-4 (https://linear.app/helioapp/issue/CON-4/event-logs-under-concertinoruns-accumulate-with-no-retention-policy), which is the same unbounded-growth problem for `.concertino/runs/` event logs. The two have different right answers — event logs are append-only history worth keeping, the ticket cache is a disposable mirror that can be refetched — so resist the temptation to solve both with one mechanism.

Measurements come from the slice-3 data-layer verification; the full numbers are in `.superpowers/sdd/2026-07-27-tui-slice-1-telemetry-and-fleet-view/slice3-data-report.md` under "Real fetch — gap closed".
