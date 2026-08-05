## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/model-providers/spec.md`, and (base) `openspec/specs/model-providers/spec.md`
  in full.
- Cross-checked every "what is wrong today" / "Decision N" claim about current
  behavior against the actual source:
  - `lib/config.js:193-199` — `isOllamaRouted` unconditionally excludes
    `claude-code` (`if (harness === 'claude-code') return false;`). Matches
    ticket item 1 / proposal claim.
  - `lib/config.js:561-568` — `collectConfigIssues`'s Providers section fails
    validation only when `claude-code` is in `ollama.harnesses` **and**
    `!ollama.gateway` (gateway key entirely absent). Matches the design's
    Decision 2/Migration Plan description of today's hard requirement.
  - `lib/ui/harness.js:174-187` (`resolveTicketProvider`) and `:257-265`
    (`providerChoices`) — both gate `claude-code` on
    `ollama.gateway && ollama.gateway.baseUrl`, exactly as Decision 3
    describes "today". The proposed relaxed guards in Decision 3 are
    logically sound (traced by hand: absent-gateway → true via the new
    `!(ollama.gateway)` clause; gateway-present-no-baseUrl → still false;
    gateway-present-with-baseUrl → still true).
  - `lib/cli/render.js:198-203` (`renderEnv`) — `ANTHROPIC_BASE_URL` is
    emitted only when `ollama.gateway` is truthy. Matches ticket item 3.
    `renderSpeedsJson` (`:241-256`) confirmed to currently emit only
    `harnesses`/`models` under `providers.ollama` — no `gateway` flag today,
    consistent with Decision 5's claim that resolve-speed.sh has no way to
    make the route decision without a new `gatewayConfigured` field.
  - `scripts/concertino/resolve-speed.sh:105` — confirmed the literal
    `[ "$HARNESS" != "claude-code" ]` guard tasks.md 4.2 targets.
  - `lib/cli/doctor.js:194-225` (`checkOllamaProvider`) — confirmed shape
    Decision 6 builds on top of.
  - `config/concertino.schema.json:188-195` — confirmed the exact
    `gateway.description` text task 6.1 plans to change.
  - Confirmed the base (pre-change) `openspec/specs/model-providers/spec.md`
    already contains the doctor per-model pulled/tools/thinking-capability
    requirements verbatim — these are NOT new scope this ticket is
    introducing; the delta's MODIFIED section correctly carries them forward
    unchanged plus the new route-reporting scenarios. Not scope drift.
- Traced every AC in `ticket.md` to a design decision + task: launch-plan
  `P`/`p` offering `local` (Decision 3 / tasks 3.3-3.4), per-role direct vs.
  gateway model resolution (Decision 2 / spec.md's modified "Per-role model
  resolution" requirement / tasks 2.1), doctor route reporting (Decision 6 /
  tasks 5.1), and "measure a real run" (tasks section 1, sequenced first and
  explicitly gating Decision 4's placeholder-token assumption before any
  code lands — good practice, not hand-waving).
- Searched the whole tree for every `isOllamaRouted`/`ollama.gateway`/
  `ollama.harnesses` reference to check the Impact section's call-site list
  for completeness (`grep -rn` across `lib`, `bin`, `scripts`, excluding
  tests) — see Change Request 2 below for what it turned up that isn't in
  the plan.

### Verdict: REFUTE

### Change Requests

1. **`design.md`'s Risk/Trade-offs section misstates current behavior.**
   The second risk item claims: *"A project could configure `gateway` with
   no `baseUrl` on it, an ambiguous half-state." → "`collectConfigIssues`'s
   existing `fail()` still fires for this... the error path itself is
   preserved, not removed."* This is not what the code does today.
   `lib/config.js:561-568` only `fail()`s when `!ollama.gateway` (gateway
   key absent entirely); when `ollama.gateway` is present but has no
   `baseUrl`, the current `else if (ollama.gateway)` branch calls `ok()`
   with a dim `"(no baseUrl set)"` note — it passes validation today, it
   does not fail. The new spec delta's "validation fails when gateway is
   configured but incomplete" scenario (spec.md lines 116-121) is therefore
   **new** behavior this change must add, not existing behavior being
   preserved (tasks.md 2.3 already scopes it correctly as new — only
   design.md's framing is wrong). Fix: correct the Risk section's wording so
   the executor doesn't read it as "no work needed here, already handled."

2. **Missing call site: `lib/ui/controllers/launchpad.js` has three stale
   doc comments that become factually wrong after this change, and neither
   `proposal.md`'s Impact section nor `tasks.md` names this file.**
   - Line 295: `"provider validity is harness-dependent (claude-code needs a
     gateway; see resolveTicketProvider's own null cases)."`
   - Lines 420-421: `"An explicit batch provider may not be reachable from
     the NEW harness (claude-code without a gateway cannot go local)"`
   - Line 508: `"mirroring the label path's own refusals (claude-code needs
     a gateway; ...)"`
   All three functions (`cycle-harness`, `cycle-provider`,
   `cycle-row-provider`) correctly delegate validity to
   `harnessCmd.providerChoices`/`resolveTicketProvider`, so **no behavioral
   change is needed at these call sites** — but the comments assert an
   invariant ("claude-code needs a gateway") that will no longer be true
   once Decision 3 ships, and will mislead the next person who reads them.
   `proposal.md`'s Impact section already calls out doc-comment updates in
   `lib/ui/harness.js` (task 3.6) for the identical reason — this is the
   same category of gap, just in a file the Impact section didn't enumerate.
   Fix: add `lib/ui/controllers/launchpad.js` to proposal.md's Impact list
   and add a tasks.md line item (comment-only fix, no logic change) to
   update these three comments once the route becomes gateway-conditional
   rather than claude-code-unconditional.

### Non-blocking notes

- The rest of the design is unusually well-grounded: every "what is wrong
  today" claim traced cleanly to the actual code, the route-derivation
  approach (Decision 1: gateway presence, not a new enum) correctly avoids
  a contradictory config state, and sequencing the wire-format verification
  (tasks section 1) before finalizing the placeholder-token decision
  (Decision 4) is exactly the right order — no objection to that structure.
- `providerDefaultFor` in `launchpad.js` (lines 251-255, 415-417) needs no
  code change — it already keys off bare `ollama.harnesses` membership with
  no gateway check, which becomes *more* correct (not less) once the direct
  route is legal, since a claude-code project on the direct route should
  show `providerDefault: 'ollama'` exactly like every other harness.
