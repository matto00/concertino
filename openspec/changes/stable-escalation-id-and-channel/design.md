## Context

See proposal.md — Why. The constraints that actually shape the approach:

- **Two read-back mechanisms already exist.** `core/scripts/emit-event.sh`'s `read_raised_field()` already reads the LAST `escalation.raised` event for a ticket and prints one field of it (`raised_at`, `sub_questions`). `lib/cli/answer.js`'s `readEscalationShape()` does the same from the JS side, deliberately preferring the raised event over caller-supplied claims (CON-156). Both are exactly the lookup an `escalation_id` needs, so no new source of truth or sidecar file is required.
- **`emit-event.sh` already passes unknown `k=v` fields straight through** to the event line via its generic `*)` case. `escalation_id=`, `resolution_channel=` and `answer_source=` therefore need no new argument parsing for the *generic* write path — only generation at raise time, read-back at resolution time, and validation.
- **`core/scripts/emit-event.sh` is a render source.** `scripts/concertino/emit-event.sh` is its byte-identical render (currently 965 lines each), enforced by `test/scripts/rendered-scripts-drift.test.sh`, whose exemption table is deliberately empty. Any edit must land in `core/` and be re-rendered in the same commit. The same is true of `core/roles/orchestrator.md`.
- **The multi-part single-resolution property already holds in code** (`write_sub_answers` emits one event with a `sub_answers` array; `answer.js` emits only on `complete`). The corpus evidence of one-event-per-sub-question predates CON-46/CON-179. This change makes the property *verifiable* rather than re-implementing it.
- **`config/concertino.schema.json` carries no event-kind or event-field enum** — only `escalationTimeoutMinutes` and dashboard retention. No config surface is touched.

## Goals / Non-Goals

**Goals:**
- Pairing a raise to its resolution is an identity lookup, not a time-order guess.
- "Timed out, never answered" is structurally distinguishable from "timed out on the dashboard, answered elsewhere".
- The chat path's record is produced mechanically, not by an agent composing a raw emit call correctly.
- Every new field is additive; a pre-change log still renders.

**Non-Goals:**
- **No migration or rewriting of historical events.** The corpus stays as written; consumers keep an id-less fallback path forever.
- **Not making the historical corpus trustworthy.** This fixes new runs. The existing 66%-unsafely-paired data stays unsafely paired — that is the ticket's premise, not a regression.
- **No latency metric or analysis surface.** This lands the field contract the analysis needs; computing the answer-rate figure is downstream work.
- **No change to the verdict event path**, which CON-189 owns (see Risks).
- **No `escalation.raised` deduplication.** Re-raising an identical question intentionally yields a new id.

## Decisions

### 1. Generate the id in `emit-event.sh` at raise time; format `<TICKET>-<epoch_ms>-<hex>`

The raise is the one moment every escalation passes through exactly once, in both `--await` and `--raise-only` modes, so it is the only correct generation point. Format is the ticket id, millisecond epoch, and a short random hex suffix.

*Why not a bare UUID:* node is already a hard dependency and `crypto.randomUUID()` is available, but an opaque UUID makes the log much harder to read by eye — and reading `events.jsonl` with `grep`/`jq` is how this project actually debugs runs (the orchestrator role instructs exactly that). Embedding the ticket and a sortable timestamp keeps a `grep`-visible id.

*Why not epoch seconds alone:* two raises inside one second is a realistic case (a `--raise-only` bubble followed quickly by a re-raise), and the spec requires them to differ. Milliseconds plus random hex covers both same-second and cross-process concurrency without a lock.

*Why not a content hash of the question:* a re-raised identical question must get a distinct id, which a content hash cannot provide.

### 2. Resolution events learn the id by extending the two existing read-back helpers

Extend `read_raised_field()` to serve `escalation_id`, and `readEscalationShape()` to return it. Every resolution write site then reads it from the raise event.

*Why not store the id in `answer.json`:* `answer.json` is written by the *answering* side, which would then be asserting which escalation it is answering — exactly the caller-claims-over-ground-truth inversion CON-156 removed. The raise event is already the authority both readers consult.

*Why not thread the id through as a parameter:* the resolving process is frequently not the raising process (`--raise-only` raises, `concertino answer` or a later `--wait-only` resolves), so there is no call stack to thread it through.

### 3. A missing raise omits the field rather than blocking the write

If no `escalation.raised` exists for the ticket, the resolution event is still written, with no `escalation_id` key. Suppressing the record would lose the only evidence that something resolved; writing an empty-string id would create a false pairing key that consumers could match against each other.

### 4. `resolution_channel` lives on `escalation.answered` only; `escalation.timeout` keeps its narrow meaning

A timeout is the *absence* of a resolution channel, so giving it one would be incoherent. `escalation.timeout` gains only the `escalation_id`.

### 5. A late answer after a timeout is appended, never suppressed, and never retracts the timeout

`events.jsonl` is append-only, so retraction is not available even in principle. Both events sharing one `escalation_id` is a strictly more informative record than either alone: it says the dashboard deadline lapsed *and* a human answered through another channel — which is precisely the "27 of 54 follow-up triage escalations record timeout" symptom. Consumers resolve the pair by preferring the answer (see the metrics delta).

*Why not suppress the late answer:* that would preserve exactly the data loss this ticket exists to fix.

### 6. `answer_source` is derived from the channel, not supplied independently

`dashboard`/`cli`/`chat` imply `human`; `self-approved` implies `agent-default`. Deriving it removes the possibility of an incoherent pair (e.g. `dashboard` + `agent-default`) and means no call site has to remember to pass both. It stays a separate field because it is the field the analysis actually groups by, and because a future channel might not map so cleanly.

### 7. `concertino answer` gains an explicit channel selector defaulting to `cli`

The chat fallback becomes `concertino answer <ticket> <value> --channel=chat`. Defaulting to `cli` keeps every existing invocation working unchanged and correctly labelled.

*Why not a separate `concertino answer-chat` command:* it would duplicate the whole argument surface (`--sub`/`--total`/`--out`) for one field's difference.

*Why not infer the channel:* a process cannot tell whether the value its operator typed originated in a chat transcript.

An unrecognized value is refused *before* any write, so a typo never silently records a valid answer under a bogus channel.

### 8. `orchestrator.md`'s chat fallback points at the command; a manual fallback remains documented

The raw hand-composed `emit-event.sh escalation.answered` instruction is replaced by the `--channel=chat` invocation. `escalation-trust-offramp`'s requirement names "the documented manual `escalation.answered` fallback after a chat reply" as an authoritative resolution mechanism — that requirement stays true because the role still documents *a* manual chat fallback; only its mechanism becomes a guarded command instead of a hand-assembled event line. This is why that capability is not given a spec delta.

### 9. Consumers pair by id with an id-less fallback, rather than being versioned

`metricsFor()` and `reducer.js` branch on the presence of `escalation_id`. A log-format version field was considered and rejected: the presence of the field is itself the discriminator, and a mixed log (a run straddling an upgrade) must work either way, which a per-log version could not express.

## Risks / Trade-offs

- **CON-189 touches the same emitter file** → It owns the *verdict* event path; this change touches only the escalation raise/resolution path and the `read_raised_field` helper. Kept deliberately out of shared surfaces beyond that helper. Flagged to that lane in the delivery report rather than pre-refactored here.
- **Render drift between `core/` and `scripts/concertino/`** → Both must change in one commit; `test/scripts/rendered-scripts-drift.test.sh` fails loudly otherwise, and is part of the gate run.
- **Downstream consumers (helio) go stale until a deliberate `concertino sync`** → Out of scope by instruction; reported, not run. Until then helio keeps emitting id-less events, which the id-less fallback path handles by design.
- **An id-bearing raise followed by an id-less resolution** (a straddling upgrade: raised by an old rendered script, resolved by a new one, or vice versa) → The id-less fallback closes the most-recently-opened id-less entry, so a straddling pair degrades to today's behavior rather than dropping the resolution.
- **Two dashboards racing to answer** → Unchanged: `writeAnswer`'s `O_EXCL` still decides, and only the winning write emits an event.
- **`answer_source` is derived, so it carries no independent information today** → Accepted: it is the field the analysis groups by, and a future channel may need to set it independently.

## Migration Plan

No data migration — historical events are never rewritten. Rollout is a single commit containing the `core/` edits and their re-render together; rollback is reverting that commit, after which consumers fall back to id-less pairing for the events written in the interim (which remain readable, exactly as pre-change events do).
