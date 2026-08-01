## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/ticket-draft/spec.md` in full.
- Confirmed `lib/ui/ticket.js`'s actual `TICKET_RE` and `looksLikeTicket`
  (lines 23-27) and tested it directly with `node -e`:
  ```
  looksLikeTicket('CON-21')              -> true
  looksLikeTicket('CON-21 fast')         -> false
  looksLikeTicket('CON-21 --agent-merge')-> false
  ```
  `TICKET_RE = /^[A-Za-z#][A-Za-z0-9_-]*[0-9]$/` is a whole-string anchor —
  it never matches any input containing whitespace.
- Read `lib/ui/prompt.js` in full: `parseTicketInput` (lines 37-48) splits on
  whitespace and calls `looksLikeTicket` only on the **first token**, then
  separately validates a second token against `AGENT_MERGE_FLAGS`/
  `SPEED_FLAGS`. This is how `CON-21 fast` and `CON-21 --agent-merge`
  actually work today.
- Read `lib/ui/screens/fleet.js`'s current `promptKey` (lines 981-1002 verified
  by direct read) — today it dispatches `{ type: 'submit-prompt', value }`
  for any non-empty trimmed value, unconditionally; it does not itself gate
  on ticket shape today. The gate happens downstream, in `watch.js:1515-1524`
  (`case 'submit-prompt'`), which calls `submitTicket(action.value, ...)` →
  `parseTicketInput` → `looksLikeTicket`.
- Confirmed there is no existing test exercising `promptKey`'s dispatch
  logic (`grep -rn "promptKey" test/` returns no hits) — only
  `parseTicketInput`/`submitTicket` are unit-tested directly
  (`test/prompt.test.js`).
- Confirmed `lib/ui/router.js`'s screen contract (`render(state, opts)` /
  `handleKey(key, state)`) and `lib/ui/screens/escalation.js`'s
  `reply-type`/`open-reply`/`reply-backspace` sub-mode (lines 256-271) — the
  precedent cited in Decision 3 checks out.
- Confirmed `refreshLaunchPad()` at `watch.js:646` and `launchPadStatus` at
  `linear.js:397` exist as the design describes.
- Diffed the `createTicket` mutation signature across artifacts:
  - `proposal.md:67-68`: `createTicket({ teamKey, apiKey, title,
    description, acceptanceCriteria })`
  - `design.md`'s Decision 1 code snippet: `createTicket({ apiKey, teamId,
    title, description })`
  - `tasks.md` 1.1: `createTicket({ apiKey, teamId, title, description })`
  — confirmed via `grep -n "acceptanceCriteria" design.md tasks.md
  proposal.md` that `acceptanceCriteria` appears only in the proposal's
  signature and nowhere in design.md's or tasks.md's actual function
  contract.

### Verdict: REFUTE

### Change Requests

1. **`n`'s branch point breaks the existing flag/speed forms (CON-22).**
   `design.md` Decision 4 and `tasks.md` 3.1 both instruct: in
   `promptKey`, "if `looksLikeTicket(value)` ... dispatch today's
   `submit-prompt` action ... otherwise dispatch `open-ticket-draft`."
   Taken literally (raw `looksLikeTicket` applied to the *whole* prompt
   value, which is all `promptKey` has access to), this misclassifies
   `CON-21 fast` and `CON-21 --agent-merge` as free text, since
   `looksLikeTicket` requires a whole-string match and both contain
   whitespace — confirmed above. Today these inputs reach `submitTicket`
   unconditionally and launch correctly via `parseTicketInput`. Under this
   design they would instead open the ticket-draft flow with the seed
   `"CON-21 fast"`, silently regressing the existing speed/agent-merge
   feature — directly contradicting the proposal's own claim ("Ticket-shaped
   input ... behaves exactly as today — unchanged fast path, no regression
   risk"). Decision 4's own text asserts the check is "via the same
   `parseTicketInput` `submitTicket` already uses" in the same breath as
   saying the check is `looksLikeTicket(value)` — these are not the same
   predicate (`parseTicketInput` splits on whitespace and validates the
   first token + an optional flag token; `looksLikeTicket` alone does not),
   so the design document is internally contradictory about its own core
   mechanism. **Required fix:** state explicitly that the branch condition
   is `parseTicketInput(value) !== null` (still "one definition" — it is
   built on `looksLikeTicket`), not raw `looksLikeTicket(value)` on the full
   string; add an explicit task/test case in `tasks.md` 3.3 covering
   `CON-21 fast` / `CON-21 --agent-merge` through the new `promptKey`
   dispatch path, since no existing test currently exercises `promptKey` at
   all and this regression would otherwise ship silently.

2. **The human-edited acceptance-criteria field has no destination in the
   create mutation — silent data loss.** `design.md`'s Decision 1 code
   snippet and `tasks.md` 1.1 both define `createTicket` as
   `{ apiKey, teamId, title, description }` — no `acceptanceCriteria`
   parameter, while `proposal.md`'s Impact section lists a *different*
   signature that does include `acceptanceCriteria` (and uses `teamKey`
   instead of `teamId`, a second, smaller inconsistency). `tasks.md` 5.1
   says confirm "call[s] `linear.createTicket` (1.1) with the draft's
   current field values" (plural — implying all three fields), but 1.1's
   own signature only accepts two of the three. Linear's `issueCreate`
   mutation has no separate "acceptance criteria" field; if this is meant to
   be folded into the markdown `description` body before the call, that
   composition step is never stated anywhere. As written, the field the
   human specifically reviewed and edited — the exact thing `ticket.md`'s
   "Why the drafting step matters" section says is the point of this
   change — would vanish on creation. **Required fix:** reconcile
   `proposal.md`/`design.md`/`tasks.md` on one `createTicket` signature, and
   explicitly state where `acceptanceCriteria` goes (most likely: composed
   into the markdown `description` sent to `issueCreate`, with the exact
   composition format specified, e.g. an "## Acceptance Criteria" section
   appended). Also specify the wire type of the drafted `acceptanceCriteria`
   field itself (array of strings vs. a single markdown blob) — this is
   currently unspecified in `design.md`, `tasks.md`, and
   `specs/ticket-draft/spec.md` alike, and it determines how Decision 3's
   single-buffer per-field edit mode (borrowed from `escalation.js`'s
   `reply` sub-mode) would even represent that field for editing.

### Non-blocking notes

- `design.md`'s claimed line ranges for existing code (`fleet.js:981-994`,
  `watch.js:1496-1524`, `prompt.js:50-80`, `ticket.js:23-27`) all check out
  against the current tree — good grounding elsewhere in the doc.
- Once Change Request 1 is resolved, worth also having `tasks.md` 3.3
  explicitly cover the empty-flag-but-malformed case (e.g. `CON-21 nonsense`)
  to confirm it still falls through to today's "not a ticket id" error
  rather than opening the draft flow with a seed that looks like it was
  meant to target an existing ticket.
