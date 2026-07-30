## MODIFIED Requirements

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

The truncation point SHALL NOT split a multi-byte UTF-8 character: when the byte budget lands
inside a multi-byte sequence, the inline `context` value SHALL be backed off to the end of the
last whole character before that point, regardless of the calling shell's locale. The visible
marker's reported byte count SHALL be the actual byte length of the (possibly further
backed-off) inline `context` value shown, never the byte budget that was requested before any
such back-off.

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

#### Scenario: A multi-byte character straddling the truncation boundary is never split
- **WHEN** oversized `context=` contains a multi-byte UTF-8 character (e.g. an emoji or an
  accented letter) positioned so the byte budget would otherwise cut inside its byte sequence
- **THEN** the emitted line is still valid JSON, the inline `context` field decodes to text
  ending on a whole character (no lone continuation byte, no replacement character), and the
  marker's reported byte count matches the actual byte length of the inline `context` value
