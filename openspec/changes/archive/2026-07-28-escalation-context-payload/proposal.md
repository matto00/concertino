## Why

An escalation today carries only a `question` and `options` — enough to *ask*, not enough
to *decide*. Answering from the dashboard's escalation screen still requires attaching to
the agent's session and reading back through the chat to reconstruct what prompted the
question, which defeats the point of a control plane built specifically so a human could
decide without attaching. The acceptance bar (per CON-11) is one question: could a human
decide from the escalation screen alone?

## What Changes

- Add a canonical procedure script, `gather-escalation-context.sh`, alongside the other
  `scripts/concertino/*.sh` procedures. Given an escalation kind (`dependency`,
  `api-change`, `budget`, `blocker`, `contradiction`) and the relevant `k=v` identifiers, it
  formats a structured, human-readable context block for that kind — a committed procedure
  rather than prose the orchestrator improvises at raise time.
- `emit-event.sh escalation --await` accepts a `context=` field and carries it on the
  `escalation.raised` event. Unlike other fields, `context` gets special handling for the
  4000-byte event-line cap: if the full event fits, `context` rides inline unchanged; if it
  doesn't, `context` is visibly truncated (a marker states how much was cut) and the full
  text is persisted via the existing `persist-evidence.sh` mechanism (same
  `<main checkout>/.concertino/runs/<TICKET>/evidence/` directory CON-10 introduced — no
  second persistence path), with the returned path added as `context_ref`. A silently
  clipped diff is worse than a short one, so truncation is always visible, never silent.
- The orchestrator role (`core/roles/orchestrator.md`) gathers context via the script at the
  point it already raises the escalation — no new decision point for the model. This is
  documentation-and-procedure, not new judgment: the same five kinds the ticket enumerates
  map onto the same five circuit-breaker/escalation triggers already in the role doc.
- The dashboard's reducer (`lib/ui/reducer.js`) carries `context`, `contextTruncated`, and
  `contextRef` from the `escalation.raised` event into `run.escalation`.
- The escalation screen (`lib/ui/screens/escalation.js`) renders context above the options
  when present, and a truncation note (with the ref path) when the context was cut. When
  there is no context (older events, or a kind that gathered none), the screen renders
  exactly as it does today — no empty "CONTEXT" frame.

## Capabilities

### New Capabilities
- `escalation-context`: structured context gathering, transport (with truncation/ref
  fallback), and dashboard rendering for escalations, so an escalation can be decided from
  the screen alone.

### Modified Capabilities
(none — `gate-telemetry`, `evidence-telemetry`, and `phase-telemetry` are unaffected; this
change only adds new, additive fields to `escalation.raised`, which no existing spec
currently governs)

## Impact

- `core/scripts/gather-escalation-context.sh` (new), mirrored byte-for-byte to
  `scripts/concertino/gather-escalation-context.sh` (the existing sync convention — see
  `core/scripts/emit-event.sh` / `scripts/concertino/emit-event.sh`).
- `core/scripts/emit-event.sh` (and its mirror) — additive `context` handling in the
  `escalation --await` path only; every other event kind and every existing escalation
  caller (one without a `context` field) is byte-for-byte unaffected.
- `core/roles/orchestrator.md` (and its rendered `.claude/agents/concertino-orchestrator.md`
  / equivalent) — "How to raise one" gains a context-gathering step before the existing
  `emit-event.sh escalation --await` call.
- `lib/ui/reducer.js`, `lib/ui/screens/escalation.js` — additive fields/rendering only; no
  change to `escalation.answered` / `escalation.timeout` handling or to any other screen.
- Tests: `test/scripts/gather-escalation-context.test.sh` (new), additions to
  `test/scripts/emit-event.test.sh`, and additions to `test/reducer.test.js` /
  `test/escalation.test.js` covering an escalation with context, one without, and one whose
  context is too large.
- No breaking changes: `context`/`context_ref`/`context_truncated` are optional additive
  fields on an existing event; nothing currently consumes `escalation.raised` in a way that
  would be broken by a new key appearing.
