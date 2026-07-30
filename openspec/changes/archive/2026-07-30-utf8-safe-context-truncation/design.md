## Context

`emit-event.sh`'s `write_escalation_raised()` (added by CON-11) binary-searches for the
largest byte-prefix of an oversized `context=` string whose truncated line (prefix + visible
marker + `context_truncated`/`context_ref` fields) still fits the 4000-byte `MAX_LINE` cap.
The prefix itself is produced by `LC_ALL=C cut -b "1-${mid}"` — a pure byte-count cut, with no
awareness of UTF-8 character boundaries. When `mid` lands inside a multi-byte sequence, the
prefix ends with a partial (invalid) sequence, which can make the JSON string undecodable
depending on how strict the reading `JSON.parse` implementation is about invalid UTF-8 in a
string literal.

`assert-phase.sh`'s `fail()` has the same shape of bug in a different mechanism: `FIRST_ERROR="${msg:0:200}"`
relies on bash's own string-slicing being character-aware, which is true only when
`LC_CTYPE`/`LC_ALL` names a multibyte (typically UTF-8) locale. Confirmed on this dev machine
(`en_US.UTF-8`) — `${s:0:3}` on `"café"` correctly yields `"caf"`, 3 characters, not "caf" plus
half of "é". But nothing in `assert-phase.sh` sets or checks the locale, so the same line runs
byte-oriented in a `C`/`POSIX` locale (the default for many minimal containers/CI images) and
would split a multi-byte character there.

Both are instances of the pattern already fixed twice in `lib/ui/format.js`
(`truncate`/`padTo` counting UTF-16 units, then surrogate pairs) — count in the wrong unit for
the boundary you actually need.

## Goals / Non-Goals

**Goals:**
- Truncation in both scripts never emits a partial UTF-8 sequence, regardless of the calling
  shell's locale.
- The escalation-context marker's reported byte count is always the true byte length of what
  is actually shown inline (never overstated because of a further locale/character back-off).
- The fix is small, deterministic, and testable without relying on the test runner's own
  locale being UTF-8.

**Non-Goals:**
- Re-architecting the binary search or the persist-evidence-on-overflow mechanism — both stay
  exactly as CON-11 built them.
- Fixing `check-merge-readiness.sh`'s `cut -c1-200` truncations of `gh` command output for a
  local `fail()` message — that path never reaches `emit-event.sh`'s `first_error` field
  (confirmed by reading `check-merge-readiness.sh`'s `fail()`, which does not emit telemetry),
  so it is out of scope for this ticket. Left as a note for a future ticket if desired.
- Making `gather-escalation-context.sh` pre-trim the `blocker` kind's `output` field to "first
  lines" itself (the ticket's `## Notes` aside). That is an efficiency/ergonomics improvement
  to a *different* script (avoiding an unnecessary trip through the truncation path when a
  caller forgets to pre-trim) — orthogonal to this ticket's actual bug, which is that
  truncation, wherever it is exercised, must never split a character. Left as a note for a
  future ticket.

## Decisions

### Decision 1: A node helper for the byte-boundary back-off, not a pure-bash one

Node is already a hard requirement of this codebase and already invoked by `emit-event.sh`
itself (`now_ms()`'s fallback, the answer-file JSON parse). A small node one-liner that reads
the raw bytes, backs off past any incomplete trailing multi-byte sequence, and writes the
resulting byte-exact prefix to stdout is locale-independent by construction (it inspects raw
bytes, not shell string semantics) and mirrors the "iterate by code point" fix already applied
to `format.js`'s `truncate`.

Alternative considered: force `LC_ALL=en_US.UTF-8` (or equivalent) around the `cut` calls.
Rejected — this assumes that locale is installed on the machine running the script, which is
exactly the assumption CI/minimal-container environments violate; it would trade one
locale-dependent bug for another.

Algorithm (`utf8_safe_prefix`, given raw bytes and a byte budget `N`):
1. Clamp `end = min(N, total bytes)`.
2. While `end < total` and the byte at `end` is a UTF-8 continuation byte (`10xxxxxx`), the
   cut landed strictly inside a sequence that starts before `N` — but the byte AT position
   `end` being a continuation byte only tells us we're mid-sequence looking forward. The
   authoritative check is backward: find the start of the last character in `[0, end)` by
   walking backward past continuation bytes to the lead byte, compute that lead byte's
   expected sequence length, and if `lead_index + expected_length > end`, the sequence was
   cut short — back `end` off to `lead_index`.
3. Return bytes `[0, end)`.

This never removes more than one trailing (necessarily incomplete) character's worth of
bytes, and is a no-op whenever `N` already lands on a character boundary (including every
plain-ASCII case, which is why the existing `assert-phase.sh` test asserting an exact 200-byte
prefix for an all-ASCII message keeps passing unchanged).

### Decision 2: Report actual shown bytes in the marker, not the requested budget

Today the marker text is `" … [truncated, ${mid} of ${total} bytes shown]"` where `mid` is the
binary search's candidate byte budget — which, before this fix, always equals the prefix's
real length because `cut -b` never removes extra bytes. Once the prefix can be shorter than
`mid` (backed off to a character boundary), continuing to print `mid` would overstate what is
actually inline — a dishonest byte count, which the ticket's acceptance criteria explicitly
rules out. The fix measures the actual backed-off prefix's byte length (one more `wc -c` per
candidate — negligible against ~12 binary-search iterations over a 4000-byte budget) and uses
that value in the marker instead of `mid`.

### Decision 3: `assert-phase.sh` gets the same node helper, applied to a character (not byte) budget

`FIRST_ERROR`'s budget is 200 *characters*, not bytes (that's what `${msg:0:200}` was
attempting) — a different unit than `emit-event.sh`'s byte-count context budget. The fix
reuses the same "operate on raw bytes, never split a multi-byte sequence" primitive, but the
node helper is written to accept either a byte limit or decode-and-count-codepoints for a
character limit; for `assert-phase.sh` it counts Unicode code points (via
`Array.from(str)` / `for...of`, matching the pattern `visibleLength()` in `lib/ui/format.js`
already uses for the same reason) up to 200, then re-encodes, so behavior for ASCII input is
byte-for-byte identical to today (200 characters = 200 bytes when every character is ASCII),
and a multi-byte character landing exactly on the 200th slot is included or excluded whole,
never split.

## Risks / Trade-offs

- [Extra `wc -c`/node invocations per binary-search iteration] → negligible; the search space
  is ~12 iterations over a 4000-byte budget, run once per oversized escalation (a rare path),
  not a hot loop.
- [A backed-off prefix can be shorter than what a naive reading of "N of 4000 bytes" implies]
  → this is the intended fix (Decision 2) — the marker now says what is actually true.
- [`check-merge-readiness.sh`'s own truncation is left unfixed] → explicitly scoped out
  (Non-Goals); it does not feed `emit-event.sh` and is not part of the escalation-context
  contract this ticket touches.

## Migration Plan

No data migration. Both scripts are stateless procedure scripts; the fix ships as an ordinary
code change plus a `concertino sync` re-render of the two affected files under
`scripts/concertino/`. No rollback beyond reverting the commit.
