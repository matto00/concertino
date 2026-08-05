# CON-76: Escalations must reach every channel: dashboard + chat simultaneously, and bubble up to the top-level agent

## Description

An escalation today is **dashboard-first, chat-on-timeout-only**, and in the default (non-inline) topology it is invisible to every agent above the orchestrator. The result: a decision can be asked for, waited on, and resolved without the human ever being reachable on the channel they actually have, and without the session that owns the human seam ever knowing it happened.

### Current behaviour

`scripts/concertino/emit-event.sh escalation --await` writes `escalation.raised`, then blocks polling `.concertino/runs/<TICKET>/answer.json` for `dashboard.escalationTimeoutMinutes` (default 8). Two outcomes:

* **Exit 0** — a human answered on the `concertino watch` escalation screen. `answer.json` is written by exactly one path, `lib/ui/controllers/escalation.js`'s `answerEscalation` → `store.writeAnswer`. Nothing is surfaced anywhere else.
* **Non-zero** — timed out (or killed; the `TERM`/`INT` trap records `escalation.timeout`). Only *now* does the orchestrator fall back to presenting the `ESCALATION` block in chat. See `core/roles/orchestrator.md` around the `--await` contract section.

So chat is a **fallback after a multi-minute silence**, not a parallel channel.

### Problems

**1. No notification while the wait is live.** For the entire timeout window the only place the question exists is a TUI on one machine. An AFK human with a phone gets nothing — no mobile notification, because nothing reaches the chat transport until the wait has already failed. This inverts the priority: the slow path is the only one that notifies.

**2. It does not bubble past the orchestrator.** `/concertino-deliver` spawns `concertino-orchestrator` as a subagent by default (inline is opt-in, CON-49). The subagent's blocking Bash call is invisible to its parent — the parent only observes anything when the subagent *returns*. So in the default topology the escalation cannot reach the human's chat channel during the wait even in principle, no matter what the orchestrator does. Deeper nesting (executor/evaluator/skeptic/auditor raising something) is worse.

**3. The top-level agent is the only one with a user-facing channel, and it is the one left out.** Whichever agent sits at the root of the spawn tree owns the actual seam to the human. Escalation delivery should terminate there, not at whatever depth happened to raise it.

## Scope

* **Dual-channel at raise time.** Raising an escalation notifies the dashboard *and* the chat/agent channel simultaneously. Chat stops being a timeout fallback and becomes a peer path.
* **Bubble-up transport.** A mechanism for an escalation raised at any depth to reach the root agent while the raiser is still waiting — rather than only on return. This is the architecturally hard part: the current design is a blocking script call with no upward channel, so it likely needs the raiser to yield control (return-on-raise, parent polls/presents/answers) instead of blocking. Deciding that shape is part of this ticket.
* **Root-agent ownership.** Define which agent presents and collects, and make it unambiguous at every nesting depth. The root presents; intermediate agents relay without deciding.
* **Single authoritative resolution across channels.** With two live channels, two answers can race. `answer.json` is already the one resolution point and `writeAnswer` already refuses a second write (`result.reason === 'answered'`), so a chat-collected answer must write through that same store rather than being consumed directly. First write wins; the losing channel shows "already answered" rather than silently applying a second decision.
* **Visibility of the channel that won.** When an escalation resolves via the dashboard, the agents above it must be told it happened, with question, answer, and timestamp — they cannot see that channel.

## Acceptance criteria

* Raising an escalation produces a human-reachable notification on the chat channel immediately, not after `escalationTimeoutMinutes`.
* An escalation raised by a subagent at any depth reaches the root agent while the wait is still open, and the root is what presents it to the human.
* An answer given at the dashboard and an answer given in chat both resolve through `answer.json`; a second answer to an already-resolved escalation is refused, not applied.
* After a dashboard-resolved escalation, agents above the raiser can state what was asked and what was answered.
* A timeout is still never an approval — the existing invariant holds unchanged.
* Existing single-channel behaviour keeps working: `--await`'s exit-0/non-zero contract, the `TERM`/`INT` trap recording `escalation.timeout`, and the multi-part wizard path (CON-46) are not regressed.

## Grounding

Prompted by a real failure on CON-71 (2026-08-05). The design-gate escalation timed out at 23:33:43 and fell back to chat, so the top-level session saw it and relayed it. A later follow-up escalation was raised at 01:07:19 and answered `fold-in` at the dashboard at 01:09:45 — on the fast path, so it never reached chat. The top-level session, having only ever seen the fallback path, concluded the orchestrator had fabricated a human decision, and ordered it to rewrite `workflow-state.md`, `ticket.md`, and `design.md` to disclaim provenance. All of it had to be reverted. The human's answer was genuine the whole time; the channel was simply invisible from above.

Related: CON-47 (`--await` reliability and the off-ramp for unverifiable chat-relayed answers), CON-46 (multi-part escalation wizard), CON-49 (`--inline` mode, which sidesteps the bubble-up problem by removing the hop rather than solving it), CON-15 (orchestrator must never end its turn waiting on a sub-agent — relevant constraint on any return-on-raise design).
