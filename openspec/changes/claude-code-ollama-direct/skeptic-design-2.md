## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Re-read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
  `specs/model-providers/spec.md` fresh (full text, not diffed against
  round 1's report), plus round 1's `skeptic-design-1.md` as a claims list
  to re-verify against ground truth, not as fact.

- **Round-1 Change Request 1 (design.md's Risk section misstated current
  `collectConfigIssues` behavior) — confirmed resolved.** design.md's
  Risks/Trade-offs section (lines 146) now reads: *"Verified against current
  code: `collectConfigIssues` does **not** fail this today —
  `lib/config.js`'s `else if (ollama.gateway)` branch calls `ok()` with a dim
  `"(no baseUrl set)"` note... This change must **add** a new failure for
  it... it is not preserving an existing check, it is closing a gap."*
  Checked this against the live code at `lib/config.js:561-568`: the `fail()`
  only fires on `ollamaHarnesses.includes('claude-code') && !ollama.gateway`
  (gateway key absent); the `else if (ollama.gateway)` branch calls `ok()`
  unconditionally, including when `baseUrl` is missing (dim note only, no
  failure). design.md's corrected framing now matches the code exactly.
  tasks.md 2.3 and spec.md's "validation fails when gateway is configured
  but incomplete" scenario (lines 116-121) already correctly scope this as
  new behavior to add. Resolved.

- **Round-1 Change Request 2 (`lib/ui/controllers/launchpad.js`'s stale
  gateway doc comments missing from proposal.md/tasks.md) — partially
  resolved, one location still missing.** proposal.md's Impact section
  (line 29) now names `lib/ui/controllers/launchpad.js` and its three
  spots (`cycle-harness ~line 295`, `cycle-provider ~lines 420-421`,
  `cycle-row-provider ~line 508`); tasks.md adds item 3.8 with the same
  three locations. I re-grepped the live file for every `gateway` mention
  to check completeness:

  ```
  lib/ui/controllers/launchpad.js:295:  // harness-dependent (claude-code needs a gateway; see
  lib/ui/controllers/launchpad.js:420:  // (claude-code without a gateway cannot go local) — drop it rather than
  lib/ui/controllers/launchpad.js:442:  // that validity, so claude-code without a gateway offers nothing and
  lib/ui/controllers/launchpad.js:508:  // label path's own refusals (claude-code needs a gateway; 'default'
  ```

  There are **four** stale-invariant comments in this file, not three. Line
  442 is the doc-comment header of the literal `case 'cycle-provider':`
  block (lowercase-`p`, batch-provider cycle — confirmed by reading
  `lib/ui/controllers/launchpad.js:439-457`): *"Lowercase p — cycles the
  BATCH provider through what the batch's current harness can actually
  reach (harnessCmd.providerChoices owns that validity, so claude-code
  without a gateway offers nothing and this is a no-op)."* This assertion
  becomes false the moment `providerChoices` starts returning `ollama` for
  a claude-code batch on the direct route (Decision 3) — the exact same
  category of staleness Change Request 2 was raised to fix — but it is not
  among the three locations proposal.md's Impact section or tasks.md 3.8
  name, and tasks.md 3.8's wording ("update the three doc comments...") will
  read as an exhaustive list to whoever executes it.

  Secondary, non-blocking observation: proposal.md/tasks.md label line 295
  as inside `cycle-harness`, but the literal enclosing switch case at that
  line is `case 'open-launchplan':` (confirmed: `grep -n "^    case '"`
  shows `cycle-harness` starts at line 391; line 295 is well inside
  `open-launchplan`, 205-368, building the initial `ticketProvider` map).
  This mislabeling predates round 1 (it was already in
  `skeptic-design-1.md`) and the `~line 295` locator itself is precise
  enough that an implementer will still find and fix the right comment, so
  I am not blocking on it — but the function-name labels in proposal.md/
  tasks.md 3.8 are technically wrong for two of the four (295 is
  `open-launchplan`, not `cycle-harness`; 420-421 is inside the literal
  `cycle-harness` case body, not `cycle-provider`). Worth tidying alongside
  the fix for the missing fourth location, not worth a second round on its
  own.

- Spot-checked the rest of the design against ground truth for anything new
  since round 1: `lib/config.js:561-568` (collectConfigIssues, confirmed
  above), `lib/ui/controllers/launchpad.js`'s full `gateway` grep (above,
  the source of the new finding), `docs/config-reference.md`'s remaining
  gateway prose (lines 292, 324-348) — covered by tasks.md 6.2's "and any
  other prose describing claude-code's Ollama routing as gateway-only",
  which is appropriately broad for that file. No other new gaps found
  beyond the one above; the rest of round 1's non-blocking notes still
  hold (route-derivation via gateway presence rather than a new enum
  remains sound, `providerDefaultFor` correctly needs no code change,
  wire-format verification is still correctly sequenced first in tasks.md
  before Decision 4's placeholder-token assumption is finalized).

### Verdict: REFUTE

### Change Requests

1. **`lib/ui/controllers/launchpad.js:442`'s doc comment is a fourth stale
   "claude-code needs a gateway"-style assertion, missing from proposal.md's
   Impact section and tasks.md 3.8.** The `cycle-provider` case's header
   comment (lines 439-446) states *"claude-code without a gateway offers
   nothing and this is a no-op"* — this becomes incorrect once the direct
   route ships (a claude-code batch with `baseUrl` and no `gateway` will
   offer `ollama` via `providerChoices`). Add this fourth location to
   proposal.md's Impact section bullet for `lib/ui/controllers/launchpad.js`
   and to tasks.md's item 3.8 (comment-only fix, no logic change — same as
   the other three), so the executor's scope for this file is actually
   exhaustive rather than missing one of four instances. While fixing this,
   optionally correct the two mislabeled function-name locators noted above
   (295 → `open-launchplan`, not `cycle-harness`; 420-421 → inside the
   literal `cycle-harness` case body, not `cycle-provider`) — non-blocking,
   but free to fix alongside the required change.

### Non-blocking notes

- Both round-1 change requests are otherwise cleanly resolved with accurate,
  code-grounded rewrites — design.md's Risk section now correctly matches
  `lib/config.js`'s actual behavior, and proposal.md/tasks.md now name the
  file (just not the complete set of locations within it).
