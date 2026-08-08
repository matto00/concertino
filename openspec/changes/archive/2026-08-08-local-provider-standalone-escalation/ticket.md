# CON-91: The `standalone` escalation branch has no valid action under ticketProvider.kind local

## Description

Found by the Task 7 review of the CON-44 first slice (PR #78, finding A).

`core/roles/orchestrator.md:479` renders unconditionally for every provider:

> `standalone` — file a new Linear ticket (`mcp__linear__save_issue`, no `id`) summarizing `description` and linking back to the current ticket

Under `ticketProvider.kind: "local"` the agent is granted **no** Linear MCP tools (`lib/cli/emit.js:56` yields `[]` for an absent `mcpTools` key), so that instruction is unexecutable. This is strictly worse than under `github`, where the agent at least has `gh` / `mcp__github__*` and can translate the intent.

The reviewer noted a correction worth carrying: it is not quite true that there is *no* substitute — the orchestrator has `Write`, and the rendered prose already documents the ticket file format. The real gaps are that the prose does not say to write one, and that there is no id allocator for picking the next `CON-N`.

### Why it was not fixed in the first slice

`core/roles/orchestrator.md` was outside Task 7's scope, and a correct fix is not a wording tweak — it needs a new `{{block:...}}` seam (or provider-conditional prose), which changes rendered output for `linear` and `github` too, with no test coverage for those paths in that task's scope. Judged genuine follow-up rather than scope creep.

### Related, deliberately not filed

`core/roles/orchestrator.md:136`'s CON-62 harness-override note also mentions `mcp__linear__get_issue` unconditionally. That one was judged cosmetic and accepted as-is: the `local` block renders directly above it and says to read `labels` from frontmatter, so it reads as an aside about why no extra call is needed rather than a contradictory instruction. Worth folding into the same `{{block:}}` seam if this ticket is picked up.

## Acceptance Criteria

* Under `local`, the `standalone` triage branch names an action the agent can actually perform.
* `linear` and `github` rendered output is unchanged, or the change is deliberate and covered.
