## ADDED Requirements

### Requirement: A non-interactive Codex launch carries the delivery instructions in its first message unconditionally
The constructed command SHALL NOT rely on Codex expanding a leading-slash
`/concertino-deliver` string from a non-interactive initial `[PROMPT]`
argument, when the dashboard spawns a Codex session for ticket delivery (via
`launcher.launch()` or `launcher.launchSpec()`, both routing through
`submitTicket()`). Instead, the initial prompt argument SHALL contain the
literal content of this tool's `adapters/codex/prompt.md` (the same content
`concertino sync` renders verbatim into a project's
`.codex/prompts/concertino-deliver.md`), followed by the ticket id and any
trailing `--agent-merge`/`--no-agent-merge`/`fast`/`slow` token exactly as
extracted by `parseTicketInput`. This SHALL hold regardless of whether the
Codex CLI in use does or does not expand slash commands from a
non-interactive spawn.

#### Scenario: Bare ticket launch
- **WHEN** a Codex launch is submitted for ticket `CON-17` with no trailing
  flag or speed token
- **THEN** the constructed command's initial prompt argument contains the
  full text of `adapters/codex/prompt.md` followed by `CON-17`

#### Scenario: Ticket with agent-merge flag
- **WHEN** a Codex launch is submitted for `CON-17 --agent-merge`
- **THEN** the constructed command's initial prompt argument contains the
  full text of `adapters/codex/prompt.md` followed by `CON-17 --agent-merge`

#### Scenario: Ticket with speed token
- **WHEN** a Codex launch is submitted for `CON-17 fast`
- **THEN** the constructed command's initial prompt argument contains the
  full text of `adapters/codex/prompt.md` followed by `CON-17 fast`

### Requirement: A recognized-but-non-default codex launch command is never rewritten
The content-inlining fix SHALL apply only to the default
`codex "/concertino-deliver {{TICKET}}"` template (and its
flag/speed-token-carrying variants produced by the existing
`withAgentMergeFlag`/`withSpeedFlag` insertion). When a constructed command
resolves to the `codex` harness (via `harnessOfCommand()`) but its trailing
argument does not match the expected
`"/concertino-deliver <request text>"` quoted-segment shape — i.e. an
operator-supplied `dashboard.launchCommand` override — the inlining step
SHALL be a no-op: the command SHALL be passed to `session.spawn()`
byte-for-byte unchanged, exactly as every other per-command decoration in
this codebase already treats an operator override.

#### Scenario: Operator override is left untouched
- **WHEN** an operator's `dashboard.launchCommand` is set to a custom codex
  command that does not contain a `"/concertino-deliver <request text>"`
  quoted segment (e.g. `codex -c foo "some other prompt entirely"`)
- **THEN** the constructed command reaching `session.spawn()` is
  byte-for-byte identical to the operator's configured command — the
  inlining step does not modify it, throw, or otherwise attempt to guess a
  request-text extraction

### Requirement: The inlined Codex prompt argument survives shell hand-off unmodified
The inlined prompt argument SHALL be quoted so that no character sequence
within it is interpreted by the shell as command substitution, variable
expansion, or argument-boundary splitting, even though it may contain
backticks, `$`, and single/double quote characters from Markdown formatting
— `session.spawn()` hands the constructed command string to `tmux
respawn-window`, which executes it through `sh`. The Codex process SHALL
receive the argument byte-for-byte as constructed.

#### Scenario: Backtick-containing content survives a shell round-trip
- **WHEN** the constructed Codex launch command (containing the inlined
  prompt body, which includes backtick-delimited inline code spans) is
  executed via `sh -c`
- **THEN** the process that would have been `codex` receives the argument
  exactly as constructed, with no backtick-triggered command substitution
  having occurred

### Requirement: Claude Code's launch shape is unaffected
The Claude Code launch command construction SHALL remain unchanged by this
capability — it continues to pass `"/concertino-deliver <ticket>[ <flag>]"`
as the initial prompt, relying on Claude Code's own confirmed-working
slash-command expansion.

#### Scenario: Claude Code launch command is unchanged
- **WHEN** a Claude Code launch is submitted for ticket `CON-17`
- **THEN** the constructed command is `claude "/concertino-deliver CON-17"`,
  byte-identical to its pre-existing form

### Requirement: OpenCode's launch shape is fixed identically if and only if it shares the same gap
Whether OpenCode's launch command construction SHALL receive the same
content-inlining and shell-safety fix as Codex's is decided by
execution-time verification of whether `opencode --prompt
"/concertino-deliver <ticket>"`'s `--prompt` flag, on its interactive-TUI
launch subcommand, expands a leading-slash command name from a
non-interactive spawn. If verification confirms the same gap exists,
OpenCode's launch command construction SHALL receive the identical fix
(inlined `adapters/opencode/prompt.md` content, shell-safely quoted,
ticket/flag appended) as Codex's. If verification confirms `--prompt`
already expands the command correctly, OpenCode's launch command
construction SHALL remain unchanged, and the supporting evidence SHALL be
recorded in the change's task notes.

#### Scenario: OpenCode shares the gap
- **WHEN** execution-time verification shows `opencode --prompt
  "/concertino-deliver CON-1"` does not expand the slash command (the
  scrollback shows the model treating the literal string as unrecognized
  text, never reading `.opencode/roles`-equivalent files)
- **THEN** OpenCode's launch command construction is fixed the same way as
  Codex's: the initial `--prompt` argument contains the inlined, shell-safely
  quoted content of `adapters/opencode/prompt.md` followed by the ticket and
  any trailing flag/speed token

#### Scenario: OpenCode does not share the gap
- **WHEN** execution-time verification shows `opencode --prompt
  "/concertino-deliver CON-1"` does expand the slash command correctly (the
  scrollback references the prompt's own wording, e.g. running
  `setup-worktree.sh` first)
- **THEN** OpenCode's launch command construction is left unchanged, and the
  verification evidence is recorded in the change's task notes rather than
  applying the Codex fix unnecessarily
