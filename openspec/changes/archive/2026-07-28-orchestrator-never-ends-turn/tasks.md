## 1. `core/roles/orchestrator.md` — explain the distinction and repeat it at each spawn point

- [x] 1.1 Extend the neutral prose around the "Harness resume model" section
      (the surrounding text in `core/roles/orchestrator.md` itself, not the
      `{{block:harnessResume}}` placeholder's fill-in) to introduce the
      turn-boundary rule and why it's asymmetric between a top-level session
      and a nested sub-agent.
- [x] 1.2 Add a short, concrete reminder next to the Phase 1 skeptic
      design-gate spawn instruction: wait for the skeptic's verdict inside
      this turn before proceeding; if the harness can't wait inline, poll for
      the skeptic's report file or escalate.
- [x] 1.3 Add the same reminder next to the Phase 2 Cycle 1 executor spawn
      and evaluator spawn instructions.
- [x] 1.4 Add the same reminder next to the Phase 2 Cycle 2+ executor resume
      and evaluator resume instructions.
- [x] 1.5 Add the same reminder next to the final skeptic-gate spawn
      instruction and its REFUTE-path executor resume.
- [x] 1.6 Re-read the whole role file once done: confirm the rule is legible
      even if a reader only ever sees one spawn instruction in isolation
      (post-compaction), not just when read start-to-finish.

## 2. `bin/concertino` — fix the actual rendered text

- [x] 2.1 Update the `claude-code` branch of the `harnessResume` case in
      `bin/concertino`'s `block()` function to state the same explained
      distinction (this is literally what ends up in
      `.claude/agents/concertino-orchestrator.md`, not the neutral template's
      own prose).
- [x] 2.2 Regenerate the local rendered agents (`node bin/concertino sync`,
      or equivalent) and spot-check that `.claude/agents/concertino-
      orchestrator.md`'s "Harness resume model" section reads correctly.

## 3. Codex adapter — check for the same gap

- [x] 3.1 Read `adapters/codex/header.md` and `adapters/codex/prompt.md` and
      the `codex` branch of the `harnessResume` case in `bin/concertino`;
      confirm whether the default sequential single-thread flow has a
      spawn/suspend boundary at all.
- [x] 3.2 If (as expected) the default flow has no such boundary, state that
      explicitly rather than leaving it implicit, and document the one place
      an equivalent risk could appear: the optional
      `.codex/agents/*.toml` + `spawn_agents_on_csv` worker-dispatch path.
- [x] 3.3 Add a short caution to `adapters/codex/header.md` (or the toml
      template's generated comment, whichever a Codex reader actually sees)
      covering that optional path.

## 4. `docs/harness-capabilities.md` — record the constraint

- [x] 4.1 Add a section documenting the never-end-your-turn constraint as a
      harness-behavior fact: a suspended agent is not resumed by an external
      event and its children do not survive its turn ending, so waiting is
      free for a top-level session and fatal for the same role dispatched as
      a sub-agent.
- [x] 4.2 Cross-reference the Codex finding from task 3 here, so the doc's
      Codex section and the adapter's own text agree.

## 5. Verification

- [x] 5.1 Run `npm test` (the project's only automated gate) — expect no
      failures; this change touches only prose, but the gate must still be
      green before commit.
- [x] 5.2 Re-read `core/roles/orchestrator.md` end-to-end as if seeing it for
      the first time: would a fresh model actually keep going through every
      spawn point without stopping to "wait for a notification"? This is the
      real acceptance bar per the ticket — not a grep for keywords.
