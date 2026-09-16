# CON-188: Give escalations a stable id and make every resolution path emit escalation.answered

## Description

`escalation.raised` carries no id. Analysis must pair each raise with the next resolution event on the same ticket in time order, and that pairing is unsafe for roughly two-thirds of the corpus.

Measured across `.concertino/runs` in concertino + helio (2026-08-01 → 2026-09-16):

* 376 `escalation.raised` against **454 resolution events** (271 answered + 124 timeout + 59 discarded)
* 118 ticket directories have `#raises ≠ #resolutions`, covering **247 of 376 raises (66%)**
* 63 of 323 paired resolutions have sub-second latency — the signature of a raise matched to a different question's resolution
* Cause: 49 raises carry `sub_questions` instead of `options` and emit one `escalation.answered` per sub-question; 183 answered events carry no `answer` field at all

Second, independent defect: an escalation answered through **chat fallback** resolves the run but never writes `escalation.answered`, so the record shows `timeout`. This is not a rare path — 27 of 54 follow-up triage escalations record `timeout` and 15 record `answer_discarded`, and the operator confirms these were in fact answered.

Net effect: **no answer-derived or latency figure in the event log is trustworthy.** Raise-side counts and classifications are unaffected.

## Scope

1. `escalation.raised` emits a stable `escalation_id`. Sub-question answers reference the parent id plus a sub-index, so a multi-part escalation resolves once.
2. Every path that resolves an escalation — dashboard, `concertino answer`, **and chat fallback** — emits `escalation.answered` against that id. The chat-fallback path is the gap.
3. `escalation.timeout` means *no human answered*, distinguishable from *answered elsewhere*. Add `resolution_channel: "dashboard" | "cli" | "chat" | "self-approved"`.
4. Add `answer_source: "human" | "agent-default"`. A self-approval after timeout is the only direct evidence available about what the loop does unsupervised; exactly one such instance exists in the entire corpus.

## Acceptance criteria

* Every `escalation.raised` in a new run has an `escalation_id`; every resolution references one.
* A run whose escalation is answered in chat produces `escalation.answered`, not `escalation.timeout`.
* Per `escalation_id`: every non-multi-part escalation has exactly one `escalation.answered`, OR at most one `escalation.timeout` with no later answer for that id. A timeout followed by a late answer on the SAME `escalation_id` (the chat-after-timeout path) is explicitly NOT a violation — the append-only log cannot retract the timeout, and the pair sharing one id is the intended record. Multi-part raises resolve exactly once.
  * (Reworded at the design gate, round 1, change request 2. The original wording — "`#raises == #resolutions` holds per run for non-multi-part escalations" — was an ambiguous raw event count that a correctly-working system would appear to violate on the timeout-then-chat-answer path. The invariant intended by the ticket is safe pairing per id, not raw event arithmetic.)

## Context

Blocks the headline question of `01 - The Follow-Up Channel`: what fraction of agent-originated follow-up suggestions does the human actually keep? Currently answerable only from an n=10 convenience sample drawn from a lossy, unsafely-paired channel.

Filed from the Concertino research artifact (`~/obsidian/concertino`, doc `05 - Instrumentation Spec`, item I2).

## Premise validation (orchestrator, Setup step 2)

Verdict: **no-drift**. Full record at `.concertino/runs/CON-188/evidence/premise-validation.md` in the main checkout. Two findings that bind implementation:

* The multi-part "one `escalation.answered` per sub-question" cause is **already fixed in the emitter** (`write_sub_answers` emits exactly one event carrying a `sub_answers` array; `lib/cli/answer.js` only records on `result.complete`). Historical corpus events predate CON-46/CON-179. Do not "re-fix" this — the live gap is the missing id/channel.
* The chat-fallback claim is **narrower than the ticket states**. Two of three chat branches DO emit `escalation.answered` (the raw prose-instructed call at `core/roles/orchestrator.md:1699`, and the `TUI_ATTACHED=0` branch via `concertino answer`). The real defects are: the raw path is prose-dependent and unenforced; neither path records which channel resolved it; and on the `--await`-timeout branch `escalation.timeout` is already written before the chat answer lands, so one question records BOTH a timeout and an answered event — itself a direct cause of the `#raises != #resolutions` mismatch.
