## Why

Concertino launches Codex non-interactively as
`codex "/concertino-deliver {{TICKET}}"`. A leading-slash string is a Codex
**TUI slash command**, expanded from `.codex/prompts/concertino-deliver.md`
only when typed into an interactive session. Passed as the initial
positional prompt to a non-interactive `codex` invocation, it is never
expanded — the model receives the literal string `/concertino-deliver CON-75`
and has no delivery instructions at all. Two real runs (CON-59, CON-75)
reproduced this: the session tried to resolve the text as a shell/CLI
command, never opened `AGENTS.md` or any `.codex/roles/*` file, never ran
`setup-worktree.sh`, and neither produced a `.concertino/runs/<TICKET>/`
directory (so neither appeared on the dashboard — CON-77). This makes every
Codex launch silently a no-op today.

## What Changes

- Codex's launch template stops relying on slash-command expansion. At spawn
  time, the actual content of the rendered `.codex/prompts/concertino-deliver.md`
  (already written by `concertino sync`, byte-identical to `adapters/codex/prompt.md`)
  is read and passed as the initial prompt, with the ticket id (and optional
  trailing `--agent-merge`/`--no-agent-merge`/`fast`/`slow` token) appended so
  the model has both the full instructions and the concrete ticket to act on
  in its very first turn — unconditionally, regardless of whether the
  underlying model/CLI version ever expands slash commands from a
  non-interactive invocation.
- OpenCode's `opencode --prompt "/concertino-deliver {{TICKET}}"` is
  re-checked against the same assumption (its `--prompt` flag is documented
  as taking literal text, not a slash-command name to be expanded) and fixed
  the same way if it has the identical problem.
- Claude Code's launch shape (`claude "/concertino-deliver {{TICKET}}"`) is
  unaffected — Claude Code's CLI is documented to expand a leading-slash
  initial prompt against `.claude/commands/`, and this is the one harness
  where a real run (this very delivery) demonstrates the expansion working.
- A regression test pins whatever the new Codex (and, if applicable,
  OpenCode) launch string/content becomes, so this cannot silently regress
  to the un-expanded slash form again.

## Capabilities

### New Capabilities
- `delivery-prompt-expansion`: defines, per harness, how the initial
  non-interactive launch delivers the `/concertino-deliver` instructions to
  the model — either via a CLI-native slash-command expansion (Claude Code)
  or by inlining the rendered prompt file's content directly into the
  spawned command (Codex, and OpenCode if it has the same gap) — so a
  non-interactive spawn is guaranteed to carry the delivery instructions in
  its first message regardless of whether the underlying CLI expands slash
  commands outside a TUI session.

### Modified Capabilities
(none — `opencode-harness` and `harness-identity` govern harness
configuration/telemetry, not the shape of the initial launch prompt; no
existing spec asserts anything about what the Codex/OpenCode launch command
places in the model's first message, so there is no existing requirement to
delta.)

## Impact

- `lib/ui/harness.js` — `LAUNCH_TEMPLATES`, `launchTemplate`,
  `commandForTicket`, `harnessOfCommand`, `launchSpecForTicket`,
  `launchSpecForChoices`: the codex (and possibly opencode) template can no
  longer be a single static string with a `{{TICKET}}` placeholder if the
  fix requires inlining file content that varies by project (it does not —
  `adapters/codex/prompt.md` is copied verbatim, with no `{{project}}` or
  other substitution, so its rendered form is identical for every project
  and can be embedded/read once).
- `lib/ui/prompt.js` — `submitTicket`'s `{{TICKET}}` substitution and
  quoting-safety comments reference the current single-line template shape;
  need to keep working (or be adjusted) for a multi-line embedded prompt.
- `lib/ui/screens/launchplan.js` — `withAgentMergeFlag`/`withSpeedFlag`
  insert a token immediately after `{{TICKET}}` inside the quoted argument;
  must keep working against the new template shape.
- `test/harness.test.js` — pins today's (broken) template strings; needs new
  assertions pinning the fixed Codex (and OpenCode, if changed) launch
  command/content.
- `adapters/codex/prompt.md`, `lib/cli/emit.js` (`emitCodex`) — the existing
  render pipeline that writes `.codex/prompts/concertino-deliver.md`; the fix
  reads from this same source rather than duplicating its content.
