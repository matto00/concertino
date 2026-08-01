# CON-21: "New run" without a ticket should create one — a ticket-creation workflow in the TUI

## Description

`n` currently takes a ticket id and starts a run against it. But the thing you often have is not an id — it is an intention: *"add a share button to dashboards"*.

Today that means leaving the dashboard, writing a ticket in Linear, waiting for the launch pad's cache to refresh, then coming back to start the run. The dashboard already has the pieces to do it in place.

## Shape

`n` accepts either a ticket id or free text. A ticket-shaped value behaves exactly as now. Anything else opens a ticket-creation flow: the description becomes the seed, an agent drafts a well-scoped ticket from it, the human reviews and edits it in the TUI, and on confirmation it is created in the provider and immediately launched.

Note this closes a gap the project already knows about. `ROADMAP.md`'s first near-term item is a provider-aware `concertino-create-ticket` command, extracted from Helio's in-repo `/linear-create-ticket` so it is not left behind in adopting repos. This ticket is the TUI face of that work — the two should be built as one thing, with the CLI command and the TUI flow sharing a single implementation rather than diverging.

## Why the drafting step matters

Every ticket delivered by this project so far has been written deliberately for an autonomous run: context, why it matters, acceptance criteria, and the traps worth naming. The ones that went cleanest — one pass, no REFUTE — were the ones where the trap was stated up front. A one-line intention turned straight into a ticket would lose exactly that, and the design skeptic would then spend its rounds rediscovering it.

So the drafting step is not decoration. It is what makes the resulting run behave like the good ones.

## Acceptance Criteria

* `n` distinguishes a ticket id from free text using the existing `looksLikeTicket` predicate — one definition, not a fourth.
* Free text opens a draft flow that produces title, description and acceptance criteria, and shows them for review before anything is created.
* The human can edit before confirming, and can abandon without creating anything.
* On confirmation the ticket is created via the provider, and the run starts against the real id — the launch path stays `submitTicket`, so validation and the single `{{TICKET}}` substitution site are unchanged.
* Provider-aware, per `ticketProvider.kind`, rather than Linear-only.
* The cache updates so the new ticket appears in the launch pad without a manual refresh.

## Notes

This is the first place the dashboard would *write* to the ticket provider — everything so far is read-only, deliberately, because the orchestrator owns ticket state transitions. Creation is a different act from transition, but the boundary should be stated explicitly rather than assumed.

Worth considering whether the draft should be reviewed by a cold skeptic before creation, the way a design is. A badly-scoped ticket is the cheapest possible thing to catch and the most expensive to discover three cycles into a run.
