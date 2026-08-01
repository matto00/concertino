## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- Re-read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
  `specs/ticket-draft/spec.md` in full, fresh (not from round 1's narrative).
- Re-read round 1's report (`skeptic-design-1.md`) as a claim to verify
  against the current artifacts, not as ground truth.

**Round 1, Change Request 2 (createTicket signature / acceptanceCriteria
destination) — confirmed resolved.**
- `grep -n "teamId\|createTicket(" proposal.md design.md tasks.md
  specs/ticket-draft/spec.md` shows a single consistent signature,
  `createTicket({ apiKey, teamKey, title, description })`, in
  `proposal.md:69`, `design.md:65`, and `tasks.md:3` — no `teamId`
  remnants anywhere.
- `design.md`'s Decision 1 (lines 78-96) and `tasks.md` 5.1 (lines 74-78)
  both now state the exact composition:
  `description + "\n\n## Acceptance Criteria\n" + acceptanceCriteria`,
  matching the orchestrator's own `## Acceptance Criteria` heading
  convention.
- `design.md`'s Decision 3 (lines 148-151) states the wire type
  explicitly: `acceptanceCriteria` is a multi-line markdown string, not a
  structured array, matching `description`'s representation.

**Round 1, Change Request 1 (branch predicate for `n`) — resolved in
proposal.md/design.md/tasks.md, but NOT in specs/ticket-draft/spec.md,
which now contradicts the fix.**
- `design.md` Decision 4 (lines 168-191) now explicitly states the branch
  condition is `parseTicketInput(value) !== null`, not raw
  `looksLikeTicket(value)`, and explains why the two differ (whitespace
  tolerance). `tasks.md` 3.1 (lines 33-40) and 3.3 (lines 46-54) match,
  and 3.3 adds explicit test cases for `"CON-21 fast"` and
  `"CON-21 --agent-merge"` through the new `promptKey` dispatch path.
  `proposal.md` (lines 12-17) also states `parseTicketInput(value) !==
  null`. These three artifacts are now internally consistent and correct.
- `specs/ticket-draft/spec.md` (lines 3-19) was **not** updated and still
  asserts the disproven predicate:
  ```
  ### Requirement: `n` accepts free text as well as a ticket id
  The new-run prompt SHALL classify submitted input using the existing
  `looksLikeTicket` predicate as the sole classification, with no second or
  duplicate ticket-shape check introduced elsewhere.

  #### Scenario: Ticket-shaped input behaves unchanged
  - **WHEN** the human submits input at the `n` prompt that `looksLikeTicket`
    matches (e.g. `CON-21`, `CON-21 fast`, `CON-21 --agent-merge`)
  - **THEN** the existing `submitTicket` launch path runs exactly as before,
    with no ticket-draft flow involved
  ```
  I re-ran the direct test from round 1 against the current tree to
  confirm this claim is still factually false, reproduced twice:
  ```
  node -e "const { looksLikeTicket } = require('./lib/ui/ticket.js');
  ['CON-21','CON-21 fast','CON-21 --agent-merge'].forEach(v =>
  console.log(JSON.stringify(v), '->', looksLikeTicket(v)));"
  "CON-21" -> true
  "CON-21 fast" -> false
  "CON-21 --agent-merge" -> false
  ```
  `looksLikeTicket` does not match `"CON-21 fast"` or `"CON-21
  --agent-merge"` — the spec.md scenario's own worked example is wrong.
  The mirror requirement, "Free text opens the draft flow" (lines 14-18),
  has the same defect in reverse: per its literal text, any input
  `looksLikeTicket` doesn't match — including `"CON-21 fast"` — opens the
  draft flow, which directly contradicts the "Ticket-shaped input behaves
  unchanged" scenario immediately above it (which claims that exact input
  is ticket-shaped) and contradicts `design.md`/`tasks.md`'s actual,
  correct behavior.
- Confirmed via `grep -rl "looksLikeTicket\|submitTicket\|promptKey"
  openspec/specs/*/spec.md` that no pre-existing capability spec covers
  this predicate, so `specs/ticket-draft/spec.md` is the only artifact of
  record for this requirement's acceptance contract — there is no other
  spec that gets this right to fall back on.

### Verdict: REFUTE

### Change Requests

1. **`specs/ticket-draft/spec.md` still asserts the disproven
   `looksLikeTicket`-only predicate that round 1 required fixing —
   `proposal.md`/`design.md`/`tasks.md` were corrected, the spec delta
   was not.** File: `specs/ticket-draft/spec.md:3-19`. The requirement
   text and both its scenarios need to state the actual classification —
   `parseTicketInput(value) !== null` (built on `looksLikeTicket`, reused
   from a second call site in `promptKey`, per `design.md` Decision 4) —
   and the worked examples must be corrected: `"CON-21 fast"` and
   `"CON-21 --agent-merge"` are matched by `parseTicketInput`, not by a
   bare `looksLikeTicket` call, so the scenario text needs to say so
   explicitly rather than implying they're interchangeable. Left as-is,
   this spec delta is the authoritative acceptance contract for the
   change (no other spec covers this behavior) and, read literally,
   directs an implementer straight back into the exact regression round
   1 caught — a raw `looksLikeTicket` check in `promptKey` that breaks
   the existing `TICKET speed`/`TICKET --agent-merge` forms. This is not
   a new design problem, it's the same one, left unresolved in one of the
   four artifacts that need to agree.

### Non-blocking notes

- Everything else from round 1 (CR2, and the non-blocking note about
  `tasks.md` 3.3 covering `"CON-21 nonsense"`) is now fully and correctly
  addressed — `tasks.md` 3.3 (lines 46-54) explicitly covers the
  malformed-but-ticket-adjacent case.
- Once CR1 is fixed, worth a final pass specifically diffing
  `specs/ticket-draft/spec.md` against `design.md`'s Decision 4 language
  to make sure the two don't just both mention `parseTicketInput` but
  actually agree on the same "why they differ" explanation, since that's
  where the previous drift crept in.
