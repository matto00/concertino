## ADDED Requirements

### Requirement: gather-escalation-context.sh formats structured context per escalation kind
`core/scripts/gather-escalation-context.sh <KIND> [k=v ...]` SHALL accept one of five kinds —
`dependency`, `api-change`, `budget`, `blocker`, `contradiction` — and the kind's specific
`k=v` fields, and print a structured, human-readable plain-text context block to stdout,
exiting 0. Each kind SHALL require the fields the ticket enumerates: `dependency` requires
`package`, `version`, `purpose`, `file` (with optional `alternative`, defaulting to "none
identified" when omitted); `api-change` requires `current`, `proposed`, `callsites`; `budget`
requires `counter`, `last_verdict`, `change_request`; `blocker` requires `command`,
`exit_code`, `output`; `contradiction` requires `requirement_a`, `requirement_b`. A missing
required field for the given kind, or a kind not in that set, SHALL print `FAIL <reason>` to
stderr, exit non-zero, and print nothing to stdout.

#### Scenario: A dependency escalation's context includes every field the ticket names
- **WHEN** `gather-escalation-context.sh dependency package=zod version=3.23.0 purpose="parse
  ticket payloads" file=lib/ui/ticket.js` is run (no `alternative` given)
- **THEN** it exits 0 and its stdout mentions the package, the version, the purpose, the file,
  and a stated default for the omitted alternative (e.g. "none identified")

#### Scenario: A budget escalation's context includes the surviving change request
- **WHEN** `gather-escalation-context.sh budget counter=3 last_verdict=FAIL
  change_request="add a callsite check in reducer.js"` is run
- **THEN** it exits 0 and its stdout includes the cycle counter, the last verdict, and the
  specific change request text verbatim

#### Scenario: A missing required field fails without printing partial context
- **WHEN** `gather-escalation-context.sh dependency package=zod` is run (missing `version`,
  `purpose`, `file`)
- **THEN** it prints `FAIL` and a message naming the missing field to stderr, exits non-zero,
  and prints nothing to stdout

#### Scenario: An unrecognized kind fails immediately
- **WHEN** `gather-escalation-context.sh not-a-real-kind foo=bar` is run
- **THEN** it prints `FAIL` and a message naming the unrecognized kind to stderr, exits
  non-zero, and prints nothing to stdout

### Requirement: emit-event.sh carries a context field on escalation.raised when it fits the byte cap
`core/scripts/emit-event.sh escalation --await`, when called with a `context=` field, SHALL
include it verbatim on the `escalation.raised` event whenever the resulting line is within the
existing `MAX_LINE` (4000-byte) cap, with no truncation marker and no `context_ref` field.
Calls made without a `context=` field SHALL behave exactly as before this change, with no
`context` key present on the emitted event at all.

#### Scenario: A small context rides inline unchanged
- **WHEN** `emit-event.sh escalation --await ticket=T-1 question=q options=a,b
  context="package zod@3.23.0, imported by lib/ui/ticket.js"` is run and answered
- **THEN** the `escalation.raised` event's `context` field equals that string exactly, and
  the event has no `context_truncated` or `context_ref` field

#### Scenario: An escalation raised without context is unaffected
- **WHEN** `emit-event.sh escalation --await ticket=T-2 question=q options=a,b` is run (no
  `context=`) and answered
- **THEN** the `escalation.raised` event has no `context` key at all, matching pre-change
  behavior exactly

### Requirement: Oversized context is truncated visibly and the full text is persisted via persist-evidence.sh
`emit-event.sh` SHALL NOT silently drop or silently clip a `context=` field that would push
the `escalation.raised` line's byte length past `MAX_LINE`. It SHALL instead:
write the full context to a temporary file; persist it via `persist-evidence.sh <TICKET_ID>
<tmpfile>` (the same mechanism and destination directory
`evidence-telemetry` already established, named uniquely per raise so successive escalations
on one ticket never overwrite each other's persisted context); truncate the inline `context`
value to fit the remaining byte budget and append a visible marker stating how much was cut
and where the full text lives; and set `context_truncated=true` plus `context_ref=<persisted
path>` on the event. If persisting fails, the event SHALL still carry the truncated inline
`context` and `context_truncated=true`, but SHALL omit `context_ref` entirely rather than
emit a ref that does not resolve.

#### Scenario: Oversized context is truncated with a visible marker and a resolvable ref
- **WHEN** `emit-event.sh escalation --await` is called with a `context=` value large enough
  that the full `escalation.raised` line would exceed 4000 bytes
- **THEN** the emitted line is within the 4000-byte cap, its `context` field is shorter than
  the input and ends with a marker stating it was truncated, `context_truncated` is `true`,
  and `context_ref` points to a file that exists and whose content is the full, untruncated
  context

#### Scenario: The persisted context survives the worktree being removed
- **WHEN** an oversized context has been persisted via a `context_ref`, and the worktree it
  was raised from is later removed (as `cleanup.sh --phase4` does)
- **THEN** the path in `context_ref` still exists and is readable, exactly as
  `evidence-telemetry`'s existing durability guarantee for evidence and verdict refs

#### Scenario: A failed persist still yields a usable (truncated) inline context, never a dangling ref
- **WHEN** `persist-evidence.sh` fails while `emit-event.sh` is handling an oversized
  `context=` value (e.g. the destination is unwritable)
- **THEN** the emitted event still carries a truncated `context` and `context_truncated=true`,
  but carries no `context_ref` field

#### Scenario: The question and options themselves are never sacrificed to fit an oversized context
- **WHEN** `context=` is oversized but `question=` and `options=` are of normal size
- **THEN** the emitted `escalation.raised` event still carries the original `question` and
  `options` fields unchanged — only `context` is shortened to make room

### Requirement: The orchestrator role gathers escalation context via the script before raising
`core/roles/orchestrator.md`'s "How to raise one" procedure SHALL instruct the orchestrator to
run `gather-escalation-context.sh` for the escalation's kind and pass its output as `context=`
on the existing `emit-event.sh escalation --await` call, immediately before that call — adding
no new decision point beyond identifying which of the five kinds already in the "Always
reaches the human" table applies. It SHALL also state the fallback when gathering context is
not applicable or fails: raise the escalation without `context=` rather than skip raising it.

#### Scenario: A reader finds the context-gathering step directly above the raise call
- **WHEN** a reader reaches the "How to raise one" section of the rendered orchestrator role
- **THEN** they find an instruction to call `gather-escalation-context.sh` for the relevant
  kind and pass its output as `context=` on the `emit-event.sh escalation --await` call that
  follows it

#### Scenario: A reader finds the documented fallback for ungatherable context
- **WHEN** a reader looks for what to do if context-gathering does not apply or fails
- **THEN** the role doc states that the escalation is still raised, without `context=`, rather
  than being blocked on gathering context first

### Requirement: The escalation screen renders context above the options, degrading honestly when absent
`lib/ui/reducer.js`'s `escalation.raised` handling SHALL carry `context` (or `null`),
`contextTruncated` (boolean, from `context_truncated`), and `contextRef` (or `null`, from
`context_ref`) onto `run.escalation`. `lib/ui/screens/escalation.js` SHALL render the context
text between the question and the options when `run.escalation.context` is present, including
a note with the `contextRef` path when `contextTruncated` is true. When there is no context,
the screen SHALL render exactly as before this change — no empty "context" frame or label.

#### Scenario: An escalation with context renders it above the options
- **WHEN** the escalation screen renders a run whose `escalation.raised` event carried a
  `context` field
- **THEN** the rendered output shows that context text positioned between the question and
  the option list

#### Scenario: A truncated context's screen note points at the full-text ref
- **WHEN** the escalation screen renders a run whose escalation has `contextTruncated: true`
  and a `contextRef`
- **THEN** the rendered output includes a note naming the ref path, distinct from the
  truncated context text itself

#### Scenario: An escalation with no context degrades honestly
- **WHEN** the escalation screen renders a run whose `escalation.raised` event carried no
  `context` field
- **THEN** the rendered output contains no context block, label, or empty frame — identical
  to the screen's pre-change output for that run
