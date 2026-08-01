## Skeptic Report — design gate (round 3)

### What I verified (with evidence)

- Re-read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
  `specs/ticket-draft/spec.md` in full, fresh, plus round 1 and round 2's
  reports (treated as claims to re-verify, not as ground truth).

**Round 2's Change Request 1 (`specs/ticket-draft/spec.md` still asserting
raw `looksLikeTicket` as the branch predicate) — confirmed resolved in the
spec file itself.**
- `specs/ticket-draft/spec.md:3-11` now states the classification is
  `parseTicketInput(value) !== null`, explicitly says raw
  `looksLikeTicket(value)` "MUST NOT be used as the branch condition," and
  gives the correct reason (no whitespace tolerance, doesn't match
  `"CON-21 fast"`/`"CON-21 --agent-merge"`).
- The two scenarios (lines 13-25) are now consistent with each other and
  with `design.md` Decision 4 / `tasks.md` 3.1/3.3: ticket-shaped input is
  whatever `parseTicketInput` accepts; everything it rejects — including
  `"CON-21 nonsense"` — opens the draft flow.
- Re-ran the direct predicate check against the current tree to confirm the
  underlying fact the spec now correctly states, reproduced twice for
  stability:
  ```
  node -e "const { looksLikeTicket } = require('./lib/ui/ticket.js');
  const { parseTicketInput } = require('./lib/ui/prompt.js');
  ['CON-21','CON-21 fast','CON-21 --agent-merge'].forEach(v =>
  console.log(JSON.stringify(v), 'looksLikeTicket->', looksLikeTicket(v),
  'parseTicketInput->', JSON.stringify(parseTicketInput(v))));"
  "CON-21" looksLikeTicket-> true parseTicketInput-> {"ticket":"CON-21","flag":null,"speed":null}
  "CON-21 fast" looksLikeTicket-> false parseTicketInput-> {"ticket":"CON-21","flag":null,"speed":"fast"}
  "CON-21 --agent-merge" looksLikeTicket-> false parseTicketInput-> {"ticket":"CON-21","flag":"--agent-merge","speed":null}
  ```
  Matches `design.md` Decision 4's claim exactly (both runs identical, no
  flakiness).
- Confirmed CR2 (round 1) remains resolved: `grep -n "teamId\|createTicket("
  proposal.md design.md tasks.md specs/ticket-draft/spec.md` shows a single
  consistent `createTicket({ apiKey, teamKey, title, description })`
  signature across `proposal.md:69`, `design.md:65`, `tasks.md:3` — no
  `teamId` remnants, no drift.

**New finding this round: `design.md`'s own Goals section (not previously
checked by round 1 or round 2, both of which grepped Decision 4 and
spec.md but not Goals) still states the disproven predicate as the branch
condition, contradicting the same document's Decision 4 three sections
later.**
- `design.md:29-30`: "`n` accepts free text as well as a ticket id, using
  the existing `looksLikeTicket` predicate as the sole branch condition."
- `design.md:168,183-190` (Decision 4): "the branch condition added to
  `promptKey` is `parseTicketInput(value) !== null` ... not a bare call to
  `looksLikeTicket`."
- These two statements in the same file directly contradict each other on
  the exact mechanism that consumed rounds 1 and 2. Taken literally, the
  Goals bullet reasserts the identical broken claim Decision 4 exists to
  refute: a raw `looksLikeTicket(value)` call as "the sole branch
  condition" would misclassify `"CON-21 fast"`/`"CON-21 --agent-merge"` as
  free text (confirmed above), regressing CON-22's existing forms.
- Checked whether this is harmless because Decision 4/tasks.md 3.1 are the
  operative instructions an implementer would actually follow: plausible,
  but not a reason to leave a self-contradicting summary in the document of
  record, especially on the one predicate this design has already needed
  two correction rounds to get right everywhere. A reader skimming Goals in
  isolation (a real use of a Goals section) is told the wrong thing.
- Confirmed via `grep -n "looksLikeTicket\|parseTicketInput" proposal.md
  design.md tasks.md specs/ticket-draft/spec.md` that this is the only
  remaining stale occurrence — `proposal.md`, `tasks.md`, and
  `specs/ticket-draft/spec.md` are all consistent with Decision 4 already;
  only `design.md`'s own Goals bullet (line 29-30) is out of step with the
  rest of the same file.

### Verdict: REFUTE

### Change Requests

1. **`design.md`'s Goals section still states the disproven predicate,
   contradicting the same document's Decision 4.** File: `design.md:29-30`.
   Fix the bullet to match Decision 4's actual mechanism, e.g.: "`n`
   accepts free text as well as a ticket id, using
   `parseTicketInput(value) !== null` (built on the existing
   `looksLikeTicket` predicate, per Decision 4) as the branch condition."
   This is the last artifact location still asserting the round 1/round 2
   defect; every other artifact (`proposal.md`, `tasks.md`,
   `specs/ticket-draft/spec.md`, and `design.md`'s own Decision 4) is
   already correct and consistent.

### Non-blocking notes

- `tasks.md`'s section 3 heading ("## 3. `n` prompt branch on
  `looksLikeTicket`", line 31) is imprecise shorthand — the actual task
  text immediately below it (3.1) correctly specifies
  `parseTicketInput(value) !== null` and explicitly warns against a bare
  `looksLikeTicket` call, so this doesn't mislead an implementer reading
  the task, but it would read more cleanly as "`n` prompt branch on
  `parseTicketInput`" once CR1 above is fixed, for the same reason CR1
  matters: don't leave the wrong predicate name attached to this feature
  anywhere in the document set.
- Everything else checked out: `createTicket` signature consistent
  everywhere (CR2 from round 1, still fixed); acceptance-criteria
  composition format consistent between `design.md` Decision 1 and
  `tasks.md` 5.1; `specs/ticket-draft/spec.md`'s other five requirements
  (provider gating, headless drafting, draft review/abandon, confirm
  creates+launches+refreshes, creation-only write scope) all trace cleanly
  to a corresponding design decision and task with no contradictions found.
