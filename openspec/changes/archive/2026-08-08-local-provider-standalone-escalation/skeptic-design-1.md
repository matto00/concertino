## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **Ticket ACs and traceability.** Read `ticket.md`: two ACs — (1) under `local`,
  `standalone` names an executable action, (2) `linear`/`github` rendered output
  unchanged or the change is deliberate/covered. Both are addressed:
  `proposal.md`/`design.md`/`tasks.md` add a `{{block:standaloneTicket}}` seam
  (task 2.1/2.2), and task 4.2 requires a byte-identical assertion for
  `linear`/`github` renders.

- **The cited line number is accurate.** `grep -n "standalone" core/roles/orchestrator.md`
  confirms line 479 is exactly the bullet the ticket/design point at:
  ```
  479:   - **`standalone`** — file a new Linear ticket (`mcp__linear__save_issue`,
  ```
  and it's the only place the triage action's prose lives (line 692's mention is
  a reference to "this sub-procedure," not a duplicate) — the "single source of
  truth" premise for the block-seam approach holds.

- **The `{{block:...}}` mechanism exists and supports multi-line, indented
  output.** `lib/cli/render.js:175` does a plain regex substitution
  (`/\{\{block:([a-zA-Z]+)\}\}/g`); the existing `case 'hygiene'` (line 119)
  already builds a multi-line, hand-indented string via `lines.push(...)` /
  `lines.join('\n')`, and `case 'ticketProvider'` (line 139) already does exactly
  the per-`ticketProvider.kind` dispatch this design proposes for
  `standaloneTicket`. The proposed `standaloneTicket` case is not a novel
  mechanism — it's the same pattern used twice already.

- **`local`'s existing `ticketProvider` block already documents the frontmatter
  shape this design reuses** (`title:`, `state:`) — read `lib/cli/render.js:139-144`
  and `lib/ui/tickets/local.js`'s `parseTicket`: `state` must be one of
  `backlog|unstarted|started|completed|canceled`, `title` required, `id:` optional
  and must equal the filename stem if present. The design's proposed frontmatter
  (`title:`, `state: backlog`, no `id:`) parses cleanly against this reader.

- **The precedent script (`next-report-number.sh`) is real and matches the
  described scan/`READY`/`FAIL` contract** — read it in full; the design's
  characterization of it (disk-scan not run-local counter, leading-zero-safe
  arithmetic, safety re-check on the computed target) is accurate.

- **`openspec validate` actually passes.** Ran (inside the worktree):
  ```
  $ openspec validate local-provider-standalone-escalation --strict
  Change 'local-provider-standalone-escalation' is valid
  ```
  The spec delta's `## RENAMED Requirements` + `## MODIFIED Requirements`
  combination is accepted by the real tool, and the `FROM:`/`TO:` headers in
  `specs/followup-triage/spec.md` match the exact current requirement heading in
  `openspec/specs/followup-triage/spec.md` verbatim
  (`### Requirement: A standalone verdict files a concrete Linear ticket`).

- **The CON-52 precedent cited for the `core/` → `scripts/concertino/*` mirror
  requirement is real** — `CONTRIBUTING.md` describes it exactly as the design
  does (drifted comment between `core/scripts/cleanup.sh` and its rendered copy,
  caught by `concertino doctor`'s byte-compare).

- **No per-harness duplication of the standalone bullet** — `grep -rl standalone
  adapters/` returns nothing; `core/roles/orchestrator.md` is confirmed as the
  sole template source for all three harnesses, so a single block-seam edit is
  sufficient (no risk of missing an adapter-local copy).

- **Non-goals are honestly scoped.** The CON-62 harness-override note (line
  ~136) is explicitly left untouched per the ticket's own "Related, deliberately
  not filed" section, and `linear`/`github`'s `standalone` behavior (still
  literally saying "Linear ticket" under `github`) is explicitly kept unchanged
  — consistent with AC #2's "or the change is deliberate and covered" escape
  hatch, not silent scope-narrowing.

### Two rationale inaccuracies found (non-blocking, but worth fixing before Execution)

Both are in `design.md` Decision 2's parenthetical justification for the new
`<prefix>` regex, not in the actual instructions (`tasks.md` 1.1 and
`specs/followup-triage/spec.md` state the regex directly and unambiguously, so
neither blocks implementation) — but the false premises are worth correcting so
a later reader doesn't inherit them:

1. **`design.md:65-68`** claims the new prefix regex `^[A-Za-z][A-Za-z0-9]*$` is
   "the same shape ... `set-ticket-state.sh` already enforces for a ticket id's
   leading component." Read `core/scripts/set-ticket-state.sh`: it enforces
   `^[A-Za-z#][A-Za-z0-9_-]*[0-9]$` (the *full* `TICKET_RE` shape, byte-identical
   to `lib/ui/ticket.js`'s `TICKET_RE`) against the *whole* `<TICKET_ID>` — it has
   no concept of a "leading component" or prefix at all, and its regex is
   materially different (permits leading `#`, embedded `_`/`-`, requires a
   trailing digit) from the one this design proposes. There is no existing
   precedent being "mirrored" here for the prefix shape specifically — it's a
   genuinely new validation this change introduces. Not a functional problem
   (task 1.1's own stated regex is fine on its own merits), but the false
   "mirrors X" claim should not survive into the merged design doc.

2. **`design.md:66-68`** additionally asserts a derived prefix "can never itself
   end in a digit" — false in general for the real `TICKET_RE` grammar
   `test/ticket.test.js` documents as accepted (e.g. a hypothetical `AB2-91`
   would strip to prefix `AB2`, which does end in a digit; `ABC123` has no
   trailing `-<digits>` to strip at all, leaving prefix derivation undefined for
   that accepted shape). The regex actually specified,
   `^[A-Za-z][A-Za-z0-9]*$`, correctly *permits* a trailing digit despite the
   prose claiming it can't happen — so, again, no functional bug, just an
   internal inconsistency in the stated reasoning. Given every ticket this
   project's own local/Linear tickets actually use follows the plain
   `<PREFIX>-<N>` shape in practice (confirmed by `teamKeyFromConfig`'s own
   `^([A-Za-z][A-Za-z0-9]*)-\d+$` assumption in `lib/ui/tickets/local.js`), and
   `design.md`'s own Risks section separately covers "malformed `$TICKET_ID`" by
   having `next-ticket-id.sh` fail loudly rather than write a garbage file, the
   practical edge case is actually handled — just not by the reasoning as
   literally written.

### Verdict: CONFIRM

The plan traces both ACs to concrete, testable artifacts; reuses an established,
proven rendering mechanism (`{{block:}}` seam) and an established, proven script
contract (`next-report-number.sh`'s scan/`READY`/`FAIL` shape) rather than
inventing new patterns; keeps `linear`/`github` behavior explicitly unchanged and
tested for byte-identity; scopes out the two adjacent-but-different issues
(CON-62's note, GitHub's own "Linear ticket" mismatch) with a stated, honest
rationale rather than silently dropping them; and the spec delta already
validates cleanly against the real `openspec` CLI. The two rationale
inaccuracies above are real but self-contained to prose justification that
doesn't feed into any task's concrete instructions — they don't block
Execution, but should be corrected in `design.md` while the change dir is still
editable (either during Execution's task 3.1 "confirm spec delta reflects final
wording" pass, or as a drive-by design.md fix) so the shipped record doesn't
carry a false "mirrors set-ticket-state.sh" claim.

### Change Requests

(none — CONFIRM)

### Non-blocking notes

1. `design.md:64-69` — rewrite the `<prefix>` regex justification to state
   plainly that `^[A-Za-z][A-Za-z0-9]*$` is a *new* validation for this script
   (not a mirror of `set-ticket-state.sh`'s full-`TICKET_RE` check), and drop the
   "can never itself end in a digit" claim, which the regex itself contradicts.
2. Consider adding one explicit sentence to the orchestrator's new `local`
   `standaloneTicket` prose (or to `design.md`) for the degenerate case where
   `$TICKET_ID` has no `-<digits>` suffix to strip (e.g. a malformed or
   unconventional id) — currently this is only implicitly covered by
   `next-ticket-id.sh`'s prefix-shape validation failing loudly, which is a
   correct behavior but not one a reader of the *rendered* orchestrator prose
   would necessarily infer without reading the script itself.
