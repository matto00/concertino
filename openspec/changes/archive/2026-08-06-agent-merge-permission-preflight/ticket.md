# CON-88: agent-merge: config-only opt-in is blocked by the harness permission classifier

## Description

`agentMerge.enabled: true` in `concertino.config.json` is not sufficient authorization to actually run the agent-merge path. The orchestrator resolves `AGENT_MERGE = true`, reaches Delivery, tries to spawn the cold `concertino-auditor` sub-agent — and the harness's auto-mode permission classifier denies the spawn:

> "Permission for this action was denied by the Claude Code auto mode classifier... If you believe this capability is essential to complete the user's request, STOP and explain to the user what you were trying to do and why you need this permission."

The classifier's reasoning is correct as far as it goes: the auditor can run `gh pr merge`, and nothing *in the session transcript* authorized an agent to merge on the human's behalf. The opt-in lives in a config file the classifier never sees, so from its point of view the only evidence of authorization is the agent's own assertion that agent-merge is enabled — which is exactly the shape of a self-granted permission.

## Concrete case hit on 2026-08-05

CON-73, delivered via `/concertino-deliver CON-73` with `AGENT_MERGE_OVERRIDE=unset`:

* `agentMerge.enabled` resolved `true` from project config.
* All gates passed — design-soundness skeptic CONFIRM, evaluator PASS, final-gate skeptic CONFIRM.
* PR #69 created, link posted to the ticket.
* Auditor spawn **denied by the classifier**. The orchestrator correctly refused to work around it, fell back to the `AGENT_MERGE = false` path, and asked the human to either merge themselves or grant permission.
* The run additionally surfaced a `SECURITY WARNING: [Merge Without Review]` to the root session.

The fallback behaved well — no workaround was attempted, and the human got a clear question. But the effective behaviour is that config-only agent-merge silently degrades to a manual pause on every run, while also emitting a security warning that reads as though the workflow tried to do something illegitimate.

## The gap

There is no path today by which a durable, human-authored opt-in (a config file the human wrote) reaches the permission classifier as evidence of authorization. Options worth weighing:

1. **Accept and document it** — treat `agentMerge.enabled` as "prepare for merge, then ask", and make the orchestrator state upfront that a human confirmation is always required under auto mode. Cheapest, but makes the config key misleading.
2. **Pre-authorize via harness settings** — express the opt-in where the harness *does* honour it (a `permissions` allow rule in `.claude/settings.json` covering the auditor spawn and `gh pr merge` for this repo), and have `concertino doctor` / `validate` warn when `agentMerge.enabled` is `true` but no matching allow rule exists. Makes the two opt-ins agree instead of one silently overriding the other.
3. **Make the ask explicit and once-per-run** — have the orchestrator raise a real escalation at the start of Delivery rather than discovering the denial mid-spawn, so the human answers a clean question before any wasted work, via the existing escalation channel.

Option 2 plus the doctor check is probably the right shape: the human's intent is recorded in the place the classifier actually reads, and a mismatch between the two becomes a diagnosable config error rather than a surprise at merge time.

## Acceptance Criteria

* `concertino doctor` (and `validate` where it applies) warns when `agentMerge.enabled` is `true` but the harness has no corresponding permission grant — naming what is missing and how to grant it.
* The orchestrator's agent-merge path either succeeds without a mid-run permission denial, or asks the human **before** the auditor spawn rather than after being denied.
* Docs state plainly that `agentMerge.enabled` alone does not authorize a merge under auto mode, and what the second half of the opt-in is.
* The `AGENT_MERGE = false` fallback keeps its current behaviour: never work around a denial, always hand the decision back to the human.

## Notes

Not a regression in the workflow's own logic — the escalation/fallback design did its job. This ticket is about the two opt-in mechanisms not knowing about each other.
