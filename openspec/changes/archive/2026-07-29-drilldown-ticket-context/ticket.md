# CON-18: Drill-down should show the ticket's title and description

## Description

The drill-down identifies a run by ticket id and the change name derived from its branch — `HEL-334  panel-resize-handles`. That tells you which run you are looking at, but nothing about what it is *for*.

Reading the timeline, the gates and the verdicts without the ticket in front of you means holding the requirement in your head, or leaving the dashboard to go find it.

## Where the text comes from

Two sources already exist and neither needs a new fetch:

* The **launch pad cache** (`.concertino/cache/linear.json`) already holds every open ticket's title, description and comments — that is why it exists.
* Every run's worktree gets a `ticket.md` written during Planning, and `persist-evidence.sh` can make it durable past cleanup the same way planning artifacts already are.

Prefer whichever survives the run. The cache is refreshed on demand and may not contain a ticket that has since closed; the persisted `ticket.md` is a snapshot of what the run actually worked from, which is arguably the more honest thing to show next to that run's timeline.

## Acceptance criteria

* The drill-down shows the ticket title in its header and the description in a readable block.
* Long descriptions do not push the timeline or gates off the screen — bound the block and let it scroll or truncate visibly, consistent with how the rest of the screen degrades.
* A run whose ticket text is unavailable renders honestly (`ticket text unavailable`) rather than showing an empty frame — the same discipline as `no evidence recorded`.
* Markdown is rendered as plain text, not raw markup, and control bytes from ticket text are stripped the way the launch pad already strips them.
* Works for a finished run whose worktree has been destroyed.

## Notes

If the persisted-snapshot route is chosen, `ticket.md` should be added to what the orchestrator passes through `persist-evidence.sh` during Planning — a one-line change to the role, at a point it already stops.

## Metadata

- Priority: High
- URL: https://linear.app/helioapp/issue/CON-18/drill-down-should-show-the-tickets-title-and-description
