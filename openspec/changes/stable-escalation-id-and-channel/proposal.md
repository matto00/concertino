## Why

`escalation.raised` carries no identifier, so every consumer that needs to know *which* resolution answered *which* question has to guess by time order within a run — and that guess is wrong for roughly two-thirds of the corpus (see `ticket.md` for the measured figures). Compounding it, a chat-resolved escalation is recorded inconsistently: the emission is prose-dependent rather than mechanical, no path records *which* channel resolved the question, and on the `--await`-timeout branch the run records BOTH an `escalation.timeout` and a later `escalation.answered` for one question. The net effect is that no answer-derived or latency figure in the event log is trustworthy.

## What Changes

- `escalation.raised` gains a stable `escalation_id`, generated once at raise time by `core/scripts/emit-event.sh`.
- Every resolution event — `escalation.answered`, `escalation.timeout`, `escalation.answer_discarded`, `escalation.malformed` — carries the `escalation_id` of the raise it resolves, read back from the last `escalation.raised` event for that ticket via the read-back helper the emitter and `lib/cli/answer.js` already each have for exactly this purpose.
- `escalation.answered` gains `resolution_channel` (`dashboard` | `cli` | `chat` | `self-approved`) and `answer_source` (`human` | `agent-default`).
- `escalation.timeout` keeps its "no human answered" meaning and carries no `resolution_channel`, making *timed out* structurally distinguishable from *answered elsewhere*.
- The chat-fallback path stops depending on a hand-written raw emit call: `concertino answer` gains an explicit channel selector so a chat-collected answer is recorded through the same guarded authority as every other channel, and `core/roles/orchestrator.md`'s chat-fallback instruction points at it.
- A multi-part escalation continues to resolve with exactly ONE `escalation.answered`, now carrying the parent `escalation_id`; sub-answers reference the parent id plus their sub-index. (The emitter already emitted exactly one such event — this change makes that property *verifiable in the log* rather than re-implementing it.)
- The escalation-history consumer pairs a raise to its resolution by `escalation_id` when present, falling back to today's event-order pairing only for pre-change events that have no id.

**Not breaking:** every new field is additive, and every consumer keeps a defined behavior for an event with no `escalation_id` (historical logs are never rewritten).

## Capabilities

### New Capabilities

- `escalation-resolution-telemetry`: the `escalation_id` / `resolution_channel` / `answer_source` field contract on the escalation event family — where the id is generated, which events must reference it, which channel values are legal for which event kind, and the guarantee that a chat-resolved escalation records an answer rather than a timeout. Named and shaped to match the existing flat telemetry-capability family (`phase-telemetry`, `gate-telemetry`, `evidence-telemetry`, `run-cost-telemetry`).

### Modified Capabilities

- `escalation-answer-cli`: its "records `escalation.answered` when, and only when, its write resolves the escalation" requirement enumerates the exact emit invocation (`ticket=`, `answer=`/`sub_answers=`). That enumeration becomes incomplete once a resolution must also carry `escalation_id`, `resolution_channel` and `answer_source`, and the command gains its channel selector — so the requirement is restated rather than left partially false.
- `fleet-metrics-escalation-history`: its `metricsFor()` requirement *mandates* pairing "by event order within that run's own `events` array" — precisely the unsafe algorithm this change exists to replace. Left unmodified, the spec would keep requiring positional pairing while the ids sat unused, and a timeout followed by a chat answer would still render as "no answer recorded". Restated to pair by id when present, with the positional path retained only as the documented fallback for id-less historical events.

**Considered and deliberately NOT modified:** `multi-part-escalation` (its requirements stay true verbatim — the event it mandates simply gains fields, which the instruction's "adding new concerns without changing existing behavior → use ADDED" guidance assigns to the new capability); `escalation-deadline-source` (deadline sourcing is untouched); `escalation-trust-offramp` (its list of authoritative resolution mechanisms still holds, provided `orchestrator.md` continues to document *a* manual chat fallback — see design.md).

## Impact

- `core/scripts/emit-event.sh` — id generation at raise; id/channel/source on every resolution write; read-back helper extended. This is a **render source**: `scripts/concertino/emit-event.sh` must be re-rendered in lockstep or `test/scripts/rendered-scripts-drift.test.sh` fails.
- `core/roles/orchestrator.md` — chat-fallback instruction points at the channel-aware `concertino answer` (also a render source, for the harness agent files).
- `lib/cli/answer.js` — reads the raise's `escalation_id`; passes id + channel + source on its emit.
- `lib/ui/screens/fleet/metrics.js` — pair by id, fall back to event order.
- `lib/ui/reducer.js` — carry `escalation_id` on the live escalation object.
- Tests: `test/scripts/emit-event.test.sh`, `test/scripts/escalation-loop.test.sh`, `test/scripts/escalation-raise-wait.test.sh`, `test/answer.test.js`, `test/reducer.test.js`, and the metrics/fleet tests.
- **No config surface:** `config/concertino.schema.json` carries no event-kind or event-field enum (only `escalationTimeoutMinutes` and dashboard retention), so no schema change is required.
- **Downstream:** consuming repos (helio) receive this only via a deliberate `concertino sync`; this change does not run one.
