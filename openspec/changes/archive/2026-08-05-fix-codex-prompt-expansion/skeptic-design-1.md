## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
  `specs/delivery-prompt-expansion/spec.md` in full.
- Fetched the live Linear ticket CON-79 and confirmed the ticket.md in the
  change dir matches it verbatim.
- Read `lib/ui/harness.js` — confirmed `LAUNCH_TEMPLATES` today is exactly
  `codex: 'codex "/concertino-deliver {{TICKET}}"'` (line 29) and that
  `harnessOfCommand()` (line 103) resolves harness from the first
  whitespace-split token of the command string only, mapped through
  `canonicalHarness()` — it does not and cannot distinguish "the default
  template" from "an operator's custom override that happens to start with
  the same binary name."
- Read `lib/ui/prompt.js` — confirmed `submitTicket()` is the single
  `{{TICKET}}`-substitution choke point the design targets, and that it
  receives only `(ticket, launchCommand, session, env)` — no signal
  distinguishing a config-resolved default template from an operator
  override.
- Read `lib/ui/launcher.js` — confirmed the codebase's own established
  precedent for exactly this ambiguity: `specFor()` (line 81-85) and its
  surrounding comment (line 63-64, 78-80) state an operator
  `dashboard.launchCommand` override "pins the command outright" and
  "suppresses provider decoration ... an override has no slots this layer
  can safely rewrite" — i.e. every other per-command decoration in this
  codebase (harness-label swap, provider flags/env) explicitly refuses to
  touch an operator override. Confirmed via `config/concertino.schema.json`
  line 124 that `dashboard.launchCommand` is a fully free-form operator
  string with no shape constraint beyond starting with a recognized binary.
- Read `lib/ui/session.js` — confirmed the `shQuote`-equivalent escaping
  precedent design.md Decision 3 cites (`"'" + String(value).replace(/'/g,
  "'\"'\"'") + "'"`, line 131) is real and matches the design's proposed
  reuse.
- Read `lib/cli/emit.js` and `lib/cli/shared.js` — confirmed Decision 2's
  claim: `emitCodex` writes `.codex/prompts/concertino-deliver.md` via a
  byte-for-byte `copy()` of `adapters/codex/prompt.md` (emit.js:184), no
  `{{project}}` substitution for this file, and `ADAPTERS`/`read` are
  genuinely exported from `lib/cli/shared.js` and resolve relative to the
  tool's own repo root (`REPO = path.resolve(__dirname, '..', '..')`),
  independent of the target project — Decision 2's reasoning holds.
- Read `adapters/codex/prompt.md` and counted its actual content:
  `python3 -c "..."` → 88 backtick characters, 9 apostrophes, 0 `$`
  characters, 4196 bytes. Design.md's "26 backtick characters" claim
  (line 151) is off by more than 3x (actual is 88); its "~2KB" file-size
  estimate (Risks section, line 196) is roughly half the actual 4.1KB. Both
  are factual inaccuracies in the design's own stated evidence, though
  neither undermines the underlying decision (more backticks strengthens
  the case for single-quoting; 4.1KB is still far under any shell/tmux
  argument-length ceiling).
- Read `test/harness.test.js` — confirmed today's short-template-pinning
  tests (`LAUNCH_TEMPLATES.codex`, `commandForTicket`, `launchSpecForTicket`,
  `launchSpecForChoices`) all assert the unmodified short `{{TICKET}}` form,
  consistent with Decision 1's claim that `LAUNCH_TEMPLATES` itself stays
  untouched. Also confirmed the one existing "custom command" test
  (`launchSpecForTicket: custom (unrecognised) commands are never
  decorated`, line 265) only covers a command whose harness is
  *unrecognized* (`harnessOfCommand` returns `null`) — not the gap below,
  where the harness IS recognized (`codex`) but the command content is
  custom.
- Read `docs/dashboard.md` and `openspec/.../specs/delivery-prompt-expansion/spec.md`
  in full — confirmed the spec's four scenarios (bare ticket, agent-merge
  flag, speed token, Claude Code unchanged) all assume the exact default
  `codex "/concertino-deliver {{TICKET}}[...]"` template shape; none covers
  an operator-supplied `dashboard.launchCommand` override for codex.
- Read `workflow-state.md` / `.openspec.yaml`: `SKEPTIC_CYCLE: 0` — this is
  round 1, no prior skeptic report exists for this change.

### Verdict: REFUTE

### Change Requests

1. **Undefined behavior for a recognized-but-non-default codex
   `dashboard.launchCommand` override.** Decision 1 (design.md) and Task 2.4
   (tasks.md) both assume the constructed command, once
   `harnessOfCommand()` resolves it to `'codex'`, always ends in a
   `"/concertino-deliver <request text>"` quoted argument that a "targeted
   regex" can extract text from. This is only guaranteed for the default
   template. `dashboard.launchCommand` (`config/concertino.schema.json:124`)
   is a fully free-form operator string constrained only by which binary
   name it starts with; `harnessOfCommand()` resolves harness from that
   first token alone. An operator could set, e.g., `codex "some other
   prompt entirely"` or `codex -c foo "/concertino-deliver {{TICKET}}
   extra-stuff"`, and `harnessOfCommand()` would still resolve `'codex'`,
   routing it into the new inlining step with no defined fallback for a
   non-matching regex. Every other per-command decoration this codebase
   already has (harness-label swap in `commandForTicket`, provider flags in
   `launchSpecForTicket`/`launchSpecForChoices`) explicitly refuses to touch
   an operator override (`lib/ui/launcher.js:63-64,78-80`: "an override has
   no slots this layer can safely rewrite") — the design should either (a)
   adopt the same rule and exempt operator overrides from the new inlining
   step, or (b) explicitly define a safe no-match fallback (e.g., leave the
   command byte-for-byte unchanged when the regex doesn't find the expected
   quoted segment, mirroring `withSpeedFlag`'s/`parseLaunchCommand`'s own
   existing "no `{{TICKET}}` match → no-op" convention at
   `lib/ui/screens/launchplan.js:117`). As written, a competent implementer
   could reasonably pick either behavior, or worse, let an unhandled
   regex-match failure corrupt/malform a custom operator command. This is a
   real, currently-supported configuration shape (the schema documents it,
   and the codebase has standing precedent for handling it specially) — add
   an explicit decision to design.md, and a corresponding scenario + task 4
   test, before implementation.

### Non-blocking notes

- design.md's backtick count ("26 backtick characters", line 151) is
  inaccurate — the actual file has 88. Worth a quick correction since it's
  cited as load-bearing evidence for Decision 3, even though the correction
  only strengthens the argument.
- design.md's Risks section estimates the inlined file at "~2KB"; it is
  actually ~4.1KB. Doesn't change the conclusion (still far under any
  shell/tmux argument-length limit) but is worth fixing for accuracy.
