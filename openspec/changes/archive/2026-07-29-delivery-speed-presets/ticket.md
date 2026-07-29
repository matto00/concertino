# CON-22: Delivery speeds — trade rigour against turnaround, with harness-aware model presets

URL: https://linear.app/helioapp/issue/CON-22/delivery-speeds-trade-rigour-against-turnaround-with-harness-aware
Priority: High

## Description

Every ticket currently gets identical treatment: full planning, a cold design gate, the execution↔evaluation loop, a cold final gate — and identical models for every role regardless of what the work is. A one-line hotfix and a six-screen redesign pay the same price.

Proposal: a **speed** on the invocation — `/concertino-deliver CON-17 fast`, `… slow`, default in between — that tunes both how much verification a run buys *and* which models it runs on. The two are one concept: rigour is bought with rounds and with capability, and choosing them separately would let a run be fast in gates and slow in model, which is nobody's intent.

## What the evidence from real runs says

Fifteen tickets have gone through the loop, and the cost is wildly uneven:

| Ticket | Shape | Design gate | Eval cycles |
| -- | -- | -- | -- |
| CON-15 | prose change to a role doc | CONFIRM first round | PASS cycle 1 |
| CON-7, CON-8 | small script fixes | 1 REFUTE between them | 1–2 |
| CON-11 | new script + screen changes | CONFIRM first round | PASS cycle 1 |
| CON-12 | six-screen visual redesign | REFUTE ×2 then CONFIRM | FAIL then PASS |
| CON-13 | subtle core-resolution change | REFUTE ×3, budget exhausted, escalated | not reached |

A speed dial is clearly justified. The same table warns against the obvious implementation.

## The trap: do not buy speed by removing the skeptic

The instinct is that `fast` drops the evaluator or the skeptic. The record says that is backwards — the cold gate is where nearly all the value has come from:

* CON-10 — caught the fix for a dangling-reference bug *reintroducing the same dangling reference* in its fallback path.
* CON-13 round 2 — ran its own git reproductions and found `--git-common-dir` cannot distinguish a worktree of this repo from an npm-installed dependency in a consumer's `node_modules`; a regression that would have broken a stated acceptance criterion, and that nobody else spotted.
* CON-12 — caught a failed run rendering a different colour on the drill-down than on the fleet screen.

Every one of those had green tests. Removing the gate that caught them to save time optimises the wrong variable.

## A better shape

Tune **budgets, depth and model tier** rather than deleting gates:

* **fast** — design gate capped at one round; execution cycles capped at 2; cheaper models for executor and evaluator; final skeptic gate always runs, at full strength and on a capable model. Suited to a hotfix or a one-file bug where the design is not in question.
* **default** — today's behaviour.
* **slow** — larger round budgets; a second independent final-gate skeptic whose verdict must agree; the evaluator re-runs gates from a clean worktree rather than the executor's; the most capable model available for skeptic and evaluator. Suited to anything touching shared contracts, the procedure scripts, or the dashboard.

`budgets` already holds `executionCycles`, `skepticDesignRounds`, `skepticFinalRounds` and `debugAttempts`. A speed is a named preset over those plus the model dimension below.

## Model selection, and a structural problem it exposes

`models` is already per-role — `orchestrator`, `executor`, `evaluator`, `skeptic` — but only for Claude Code. Codex gets a **single flat** `models.codex` shared by every role, and the schema describes the whole block in Claude Code's vocabulary ("Accepts Claude Code model aliases (opus, sonnet, haiku)"). On top of that, `ROADMAP.md` records that `adapters/codex/agent.toml.tmpl` still renders a hardcoded `CODEX_MODEL` constant rather than reading config at all.

So a harness-aware preset cannot be layered over the current shape — the shape has to change first:

* Model config becomes **per harness, per role**, so a speed can resolve `(speed, harness, role) → model`.
* The Codex path becomes config-driven, closing the existing ROADMAP item. That item should be considered part of this ticket rather than done separately, since a speed preset for Codex is meaningless while its model is a constant.
* Presets name **tiers** — cheap / standard / capable — resolved per harness, rather than hardcoding `opus` or `gpt-5.1-codex` into the speed definition. A project on Codex and a project on Claude Code should both get a sensible `slow` without either being second-class.

Explicit `models.*` overrides continue to win over a preset, so a project that has deliberately pinned a role keeps it.

## The TUI side

Run creation should let a human choose, and see the consequence before committing:

* The `n` prompt takes a speed alongside the ticket.
* The launch plan screen shows the speed and the **resolved per-role models** before launch — consistent with its existing discipline of showing ports pre-flight rather than discovering them. It already cycles harness with `h`; speed is the natural sibling.
* A batch launched from the launch pad carries one speed for the batch, since batching hotfixes is the obvious use.

## Acceptance criteria

* `/concertino-deliver <TICKET> [fast|slow]` accepted; absent means default. The rendered slash command and the orchestrator role both understand it.
* Speeds are named presets in `concertino.config.json` over `budgets` and model tiers, so a project retunes without editing role prose.
* Model config is per harness and per role; the Codex path is config-driven, closing the ROADMAP item.
* Presets resolve tiers through the harness rather than naming provider-specific models.
* Explicit `models.*` overrides beat presets.
* **The final skeptic gate runs at every speed.** An implementation wanting to make that configurable must argue the case, not assume it.
* The speed *and* the resolved models are emitted on `run.start` and rendered on the drill-down, so a run's rigour is auditable after the fact.
* The `n` prompt and the launch plan let a human set the speed and see the resolved models before launching.
* Escalation behaviour is unchanged at every speed — an exhausted budget still reaches a human rather than silently degrading.

## Notes

Two risks worth designing against:

`fast` **becomes the default in practice.** If it is easier to type and usually works, it will be used everywhere and the erosion will be invisible until something ships broken. Emitting speed and models on `run.start` at least makes it auditable.

**Speed is chosen before the work is understood.** A ticket that looks like a hotfix and turns out to touch a shared contract is exactly where rigour was wanted. Consider letting the design gate *escalate its own speed* — a `fast` run whose skeptic finds something structural should be able to say so rather than being capped at one round.
