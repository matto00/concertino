# CON-20: Launch pad cannot distinguish "no open tickets" from "misconfigured team"

## Description

The launch pad reported zero tickets and gave no reason. The cause was `ticketProvider.teamKey` still holding the shipped placeholder `ABC` rather than this project's `CON`, so the query asked Linear for a team that does not exist — and Linear answers that with an empty result, not an error.

The config is now fixed, but the failure mode is not: a successful fetch returning nothing looks identical to a correct fetch of an empty backlog. From the user's side it simply reads as broken.

The feature gate already does the right thing for its three conditions — it reports *which* one failed, so the screen can say `launch pad needs LINEAR_API_KEY in the environment` rather than hiding. This is the same problem one layer further in, where the gate has passed and the query itself is the thing that is wrong.

## Acceptance Criteria

* A fetch that returns zero tickets distinguishes between a team that returned nothing and a team key that matched no team. Linear's API can answer the latter — a team lookup by key returns null for an unknown key — so the client can tell them apart rather than inferring from an empty list.
* The screen says which it is: `no open tickets in CON` versus `no team with key "ABC" — check ticketProvider.teamKey`.
* `concertino validate` warns when `ticketProvider.teamKey` is absent while `dashboard.launchPad.enabled` is true, since the derived fallback is a placeholder that will silently match nothing.
* A cold cache still renders `press r to fetch` — that path is correct today and must not regress into an error.

## Notes

`concertino init` should probably prompt for `teamKey` when the provider is Linear, rather than leaving a placeholder that looks configured. The same trap caught the slice-3 data layer during development, which is why the explicit key exists at all — and it caught a real user immediately afterwards, which suggests the default is the problem rather than the documentation.
