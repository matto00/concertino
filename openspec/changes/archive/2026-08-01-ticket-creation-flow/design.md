## Context

The `n` new-run prompt (fleet screen, `lib/ui/screens/fleet.js:981-994`
`promptKey`, dispatched through `lib/ui/watch.js:1496-1524`) today captures a
single-line text buffer and, on submit, calls `submitTicket(value,
launchCommand, session)` (`lib/ui/prompt.js:50-80`). `submitTicket` rejects
(`{spawned:false, error}`) anything not matched by `looksLikeTicket`
(`lib/ui/ticket.js:23-27`, `TICKET_RE = /^[A-Za-z#][A-Za-z0-9_-]*[0-9]$/`).
Free text typed at this prompt today is simply an error.

Two constraints shape this design:

1. **`lib/ui/linear.js` is read-only today, deliberately** — its header
   states "Concertino never writes ticket state from the TUI, because the
   orchestrator already owns that transition." Ticket *creation* is a
   different act than a *status transition* (the orchestrator still owns
   every transition after creation), and the human confirmed at planning
   that a narrowly-scoped create-only mutation is acceptable — see Decision 1.
2. **The TUI (`lib/ui/watch.js`) is a plain Node CLI process** with no access
   to the `Agent` tool (that only exists inside a running Claude Code agent
   turn). There is no existing headless-invocation plumbing anywhere in this
   codebase — only interactive tmux window spawning (`session.js`) and plain
   `execSync` calls for git/npm/openspec. Drafting a ticket from free text
   needs new plumbing end to end — see Decision 2.

## Goals / Non-Goals

**Goals:**
- `n` accepts free text as well as a ticket id, using
  `parseTicketInput(value) !== null` (built on the existing
  `looksLikeTicket` predicate, per Decision 4) as the branch condition.
- A drafted ticket (title, description, acceptance criteria) is shown for
  human review, is editable, and can be abandoned with zero side effects.
- On confirm, the ticket is created in Linear and the run launches against
  the real id via the existing, unmodified `submitTicket` path.
- The launch pad's ticket cache reflects the new ticket without a manual
  refresh.

**Non-Goals:**
- `github`/`manual` ticket provider support (this flow is gated to
  `ticketProvider.kind === 'linear'` only, matching the launch pad's
  existing provider gate).
- The standalone `concertino-create-ticket` CLI command from `ROADMAP.md`
  (logic is factored so it can be reused later; the command itself is not
  built here).
- Multi-ticket drafting (one intention → one ticket, matching `n`'s existing
  one-ticket-per-launch model).
- A cold-skeptic review gate on the draft before creation (noted in the
  ticket as "worth considering"; deferred as a documented future
  enhancement — the human review-and-edit step is the v1 quality gate).
- Any change to who owns ticket *status* transitions — that remains the
  orchestrator's exclusive responsibility; this change only ever calls a
  create mutation, never a state-transition mutation.

## Decisions

### Decision 1: Add a narrowly-scoped `createTicket` mutation to `lib/ui/linear.js`

`lib/ui/linear.js` already owns the `httpsTransport`/`postRaw` GraphQL
plumbing (lines 118-187) used by its read-only `QUERY`/`TEAM_QUERY`. Add one
new exported function, whose signature is the single source of truth for
every other artifact in this change (proposal/tasks reference this exact
shape — no artifact defines a competing signature):

```js
async function createTicket({ apiKey, teamKey, title, description }) {
  // GraphQL `issueCreate` mutation, using the same postRaw/httpsTransport
  // helpers as fetchTickets. `description` is the FINAL, fully composed
  // markdown body — the caller (draft-confirm handler, Decision 3) is
  // responsible for folding the human-edited acceptance-criteria field into
  // this string before calling createTicket; this function has no separate
  // acceptance-criteria parameter and does no composition of its own.
  // Returns { id, identifier, url } on success, throws on any GraphQL error
  // (surfaced to the draft screen as an inline error, draft is preserved so
  // the human can retry or edit).
}
```

`acceptanceCriteria` is never a mutation parameter. It is a single
free-text (markdown) field on the draft, edited independently on the
draft-review screen (Decision 3), and composed into `description` by the
confirm handler as:

```
<description>

## Acceptance Criteria
<acceptanceCriteria>
```

— the same `## Acceptance Criteria` heading convention the orchestrator's
own Setup phase already uses when writing `ticket.md` (see
`core/roles/orchestrator.md`'s Planning step 2), so a ticket created through
this flow has the same shape as a ticket delivered through the rest of this
project's own tooling. This composition happens once, at confirm time
(Decision 3 / Decision 5), not inside `linear.js` — `linear.js` stays a thin
transport layer with no knowledge of ticket-body structure.

This is the TUI's first write to Linear. It is deliberately narrow: it only
ever calls `issueCreate`, never `issueUpdate`/state-transition mutations —
those remain exclusively the orchestrator's responsibility (via its Linear
MCP tools), unchanged by this design. The header comment in `linear.js` is
updated to state this exception explicitly rather than silently widen the
file's invariant.

**Alternative considered:** shell out to the Linear MCP tools the way the
orchestrator does. Rejected — those tools are only available inside a
running Claude Code agent turn (see Decision 2's same constraint); the TUI
process has no such context. A direct GraphQL call via existing plumbing is
the only option available to a plain Node process.

### Decision 2: Headless Claude Code invocation for drafting, v1 scoped to Claude Code only

New helper in `lib/ui/watch.js` (or a new `lib/ui/draft.js` module) spawns:

```
claude -p "<drafting prompt, includes the free-text seed>" --output-format json
```

via `child_process.execFile` (not tmux — this call is not interactive; the
TUI needs its stdout, not a window the human attaches to). The prompt asks
for a JSON object `{ title, description, acceptanceCriteria }`; the response
is parsed and, on success, populates the new draft-review screen with those
three fields. Any parse failure or non-zero exit shows an inline error on
the original `n` prompt and does not open the draft screen (no partial
state).

Scoped to the Claude Code harness only for v1, per the human's confirmation
at planning — this repo's primary target harness, matching the same
harness-specific limitation already documented for Codex elsewhere (see
`core/roles/orchestrator.md`'s "Per-spawn model overrides (Claude Code
only)" section as existing precedent for a harness-scoped feature with a
stated, non-silent limitation).

**Alternative considered:** build a harness-agnostic abstraction (Claude
Code / Codex / other) from day one. Rejected per the human's explicit
confirmation — no existing multi-harness abstraction for headless,
structured-output invocation exists yet to build on, and speculatively
designing one before a second harness needs it risks the wrong abstraction.
This is called out as a named limitation, not a silent gap, matching this
project's existing convention for harness-scoped features.

### Decision 3: New `ticketdraft` screen, modeled on `escalation.js`'s wizard

Add `lib/ui/screens/ticketdraft.js`, following the same `render(state, opts)`
/ `handleKey(key, state)` contract every screen uses (`router.js:23-34`),
registered under a new `mode: 'ticketdraft'`. Three editable fields — `title`
(single-line string), `description` (multi-line markdown string), and
`acceptanceCriteria` (multi-line markdown string, not a structured array —
same free-text-blob representation as `description`, so both are edited with
the identical text-buffer sub-mode; the headless drafting prompt, Decision 2,
is instructed to return `acceptanceCriteria` as one markdown string, e.g. a
bullet list rendered as text, not a JSON array) — with per-field edit mode
borrowed from `escalation.js`'s `reply` sub-mode (`open-reply`/`reply-type`/
`reply-backspace` actions) rather than `launchplan.js`'s single-keystroke
toggles, since these are free-text fields, not enum toggles. One confirm
action (composes the final body per Decision 1, creates the ticket, then
calls `submitTicket` with the real id, then triggers `refreshLaunchPad()`),
one cancel action (discards the draft, returns to the fleet screen, no side
effects — this is the "abandon without creating anything" acceptance
criterion).

**Alternative considered:** reuse `launchplan.js`'s screen directly by
generalizing its field model to support free text. Rejected — `launchplan`'s
fields are all single-token enum toggles (`c`/`h`/`m`/`s` keys cycling fixed
values); retrofitting free-text editing onto it would complicate an existing,
working screen rather than adding a small, single-purpose one.

### Decision 4: `n`'s branch point is `parseTicketInput(value) !== null`, not raw `looksLikeTicket`

`promptKey`'s existing submit branch (`fleet.js:981-994`) currently
dispatches `{ type: 'submit-prompt', value }` unconditionally for any
non-empty trimmed value; the ticket-shape gate lives downstream, in
`watch.js`'s `submit-prompt` case, via `submitTicket` → `parseTicketInput` →
`looksLikeTicket`. `parseTicketInput` (`prompt.js:37-48`) splits the whole
value on whitespace and validates the first token against `looksLikeTicket`,
then optionally validates a second token against the agent-merge/speed
flags — it is **not** the same predicate as calling `looksLikeTicket` on the
raw, un-split value: `looksLikeTicket('CON-21 fast')` is `false` (whole-string
anchor, no whitespace tolerance) even though `parseTicketInput('CON-21
fast')` succeeds and is exactly how `n CON-21 fast` launches correctly
today.

So the branch condition added to `promptKey` is `parseTicketInput(value) !==
null`, imported from `prompt.js` (the same module `submitTicket` already
lives in) — not a bare call to `looksLikeTicket`. This is still "one
definition, not a fourth": `parseTicketInput` itself is built on
`looksLikeTicket` and is not duplicated, only reused a second time, from a
second call site. Ticket-shaped input (including `CON-21 fast` / `CON-21
--agent-merge`) dispatches today's `submit-prompt` action unchanged; only
input `parseTicketInput` itself rejects opens the ticket-draft flow via a new
`open-ticket-draft` action carrying the raw text as the seed.

### Decision 5: Cache refresh via full `refreshLaunchPad()` re-fetch, not a manual splice

On successful creation, call the existing `refreshLaunchPad()`
(`watch.js:646-696`) rather than hand-splicing a synthesized ticket record
into `lp.cache.tickets`. This is simpler and correctness-safe (reuses
`linear.js`'s own `normalise`/`deriveEpics` derivation instead of
duplicating it by hand) at the cost of a full re-fetch (up to 500 tickets)
on every ticket creation. Ticket creation is a low-frequency, human-initiated
action (not a hot loop), so this cost is acceptable.

**Alternative considered:** splice a synthesized record into the cache
directly, skipping the network round-trip. Rejected for v1 — it requires
hand-maintaining sort order and epic derivation consistent with
`linear.js`'s existing logic, which is exactly the kind of duplicated
derivation this design otherwise avoids (Decision 1's plumbing reuse
principle applies here too).

## Risks / Trade-offs

- **[Risk]** The headless `claude -p` invocation can be slow (multi-second
  LLM round trip) with the human waiting inside the TUI's raw-mode input
  loop. → **Mitigation:** the fleet screen shows a "drafting…" state
  (analogous to `launchPad.refreshing`) while the child process runs; the
  raw-mode key loop remains responsive to cancel (`\x1b`) during the wait by
  tracking the child process handle and killing it on cancel.
- **[Risk]** A malformed or missing `--output-format json` response (harness
  version drift, prompt produces non-JSON) silently breaks drafting. →
  **Mitigation:** strict JSON parse with a caught failure path that shows a
  plain-text error on the `n` prompt itself, never opens the draft screen
  with partial/garbage data.
- **[Risk]** The new Linear write path is a precedent — a future change could
  widen it into status-transition writes without re-litigating the original
  invariant. → **Mitigation:** `createTicket` is the only mutation added;
  the updated `linear.js` header comment explicitly calls out this as a
  narrow, deliberate exception, not a lifted invariant, so a future skeptic
  reviewing an unrelated change has the documented boundary to point at.
- **[Risk]** `refreshLaunchPad()`'s full re-fetch after every creation adds
  Linear API load. → **Mitigation:** acceptable per Decision 5 given
  creation's low frequency; revisit if usage patterns change.

## Migration Plan

No data migration. Purely additive: one new screen, one new mutation
function, one new branch in an existing keystroke handler. Existing `n`
ticket-id behavior is unchanged and covered by existing tests
(`test/prompt.test.js`, `test/ticket.test.js`) — no regression risk to the
fast path. Rollback is a plain revert (no persisted state format changes).

## Open Questions

None outstanding — the three architectural decisions flagged at planning
(Linear write scope, headless-invocation approach, CLI-command scope) were
confirmed by the human before this design was written (see Decisions 1, 2,
and the proposal's Impact section respectively).
