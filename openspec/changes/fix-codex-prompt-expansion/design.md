## Context

`lib/ui/harness.js`'s `LAUNCH_TEMPLATES` gives each implemented harness a
one-line invocation shape with a `{{TICKET}}` placeholder:

```
'claude-code': 'claude "/concertino-deliver {{TICKET}}"',
codex:         'codex "/concertino-deliver {{TICKET}}"',
opencode:      'opencode --prompt "/concertino-deliver {{TICKET}}"',
```

`lib/ui/prompt.js`'s `submitTicket()` is the single choke point every spawn
path (`launcher.launch()`, `launcher.launchSpec()` — themselves called from
the `n` prompt, the fleet queue tick, force-start, drilldown restart, and
draft-then-launch) funnels through before `session.spawn()` hands the
resulting string to `tmux respawn-window`, which runs it through `sh`.
`submitTicket` validates the ticket id (`looksLikeTicket`) BEFORE it ever
touches the command string, then does a plain
`launchCommand.split('{{TICKET}}').join(substituted)` — this is what makes
`claude "/concertino-deliver CON-17 --agent-merge"` real today.

For Claude Code, the literal string `/concertino-deliver CON-17` is a slash
command the Claude Code CLI expands from `.claude/commands/concertino-deliver.md`
even as the initial non-interactive prompt — confirmed working, since every
run of this workflow (this delivery included) depends on it.

For Codex, the literal string `/concertino-deliver CON-17` is NOT expanded
when passed as the initial positional `[PROMPT]` argument to a
non-interactive `codex` invocation — confirmed broken by two real runs
(CON-59, CON-75): the model received the raw text, tried to resolve it as a
shell/CLI command, never opened `AGENTS.md` or any `.codex/roles/*` file, and
never ran `setup-worktree.sh`.

For OpenCode, `opencode --prompt "/concertino-deliver CON-17"` launches the
interactive TUI (not the separate `opencode run` headless subcommand) with
this text pre-loaded as the initial prompt. `opencode --help`'s `--prompt`
description is just "prompt to use" — no documented command-name-expansion
semantics. By contrast, `opencode run` (a genuinely different, headless
subcommand) has a dedicated `--command <name>` flag whose help text reads
"the command to run, use message for args" — i.e. OpenCode's own CLI
surface only offers command-name-to-file expansion through that explicit,
separate flag on a different subcommand. `--prompt` on the TUI launch has no
equivalent. This is strong (though not yet execution-confirmed) evidence
`--prompt` has the identical bug: a raw-text field, not a command-name
lookup.

## Goals / Non-Goals

**Goals:**
- Every non-interactive Codex launch carries the actual delivery
  instructions in its first message, unconditionally — never dependent on
  whether that Codex build/version happens to expand a leading-slash
  positional prompt.
- The same guarantee for OpenCode, once execution-phase verification
  confirms `--prompt` has the same gap (see Open Questions).
- Claude Code's launch shape is untouched — it already works.
- The fix does not weaken `submitTicket`'s existing shell-injection
  protections (`prompt.test.js`'s injection regression tests must keep
  passing unmodified).
- No new per-spawn filesystem dependency on the TARGET project (the one
  being delivered against) — the content inlined is the tool's own static,
  unparameterized adapter source, not a per-project rendered file.

**AC #2 ("A run reaches `run.start` and appears on the dashboard") — closed
with real, observed evidence (skeptic final-gate round 1 change request
1(a); the human explicitly declined the scope-narrowing alternative (1(b))
this design doc carried through cycle 2 — that language is superseded and
removed here):**

The remaining open link in the reasoning chain — does a real Codex model,
given this fix's correctly-inlined prompt, actually invoke
`setup-worktree.sh` as a tool call and produce a real `run.start` — was
closed directly rather than argued around, using the exact mechanism the
skeptic identified as untried:

- **A minimal stub MCP server** (`get_issue`/`save_issue`, returning a
  canned synthetic ticket) was registered for a single `codex` invocation
  via a runtime `-c mcp_servers.mcp__linear.command=... -c
  mcp_servers.mcp__linear.args=[...]` override — no MCP-server entry was
  persisted to any config file anywhere (confirmed directly: `codex mcp
  list` shows no configured servers, both immediately after the run and
  again on re-check for this correction). `~/.codex/config.toml` was NOT
  left byte-for-byte unchanged, though — opening a new directory is a
  distinct, incidental Codex CLI behavior that unconditionally records a
  `[projects."<path>"] trust_level = "trusted"` entry per directory it is
  run in, independent of any MCP configuration; this added exactly one such
  entry for the scratch clone's `/tmp` path. That entry was left in place —
  it references a now-deleted, non-reusable `/tmp` path, is not an
  MCP-server registration, and per this repo's file-system-permissions
  rule, editing a home-directory system file requires the human's explicit
  "Approved" (not given for this) rather than being cleaned up
  unilaterally. Naming the server `mcp__linear` with tools `get_issue`/`save_issue`
  causes Codex's own `mcp__<server>__<tool>` naming convention to expose
  them as `mcp__linear__get_issue`/`mcp__linear__save_issue` — the EXACT
  literal names `core/roles/orchestrator.md`'s Setup step 1 instructs the
  model to call. Confirmed via `codex exec` before the real run: the model
  listed exactly `mcp__linear__get_issue`/`mcp__linear__save_issue` among
  its available tools and successfully called `get_issue`, receiving the
  canned payload back verbatim.
- **An isolated scratch clone** (`git clone` of this repo into a throwaway
  `/tmp` directory, synced with `concertino sync` there — no relationship
  to this delivery's own `con-79` worktree, removing the collision risk
  that stopped cycle 2 short) was the launch target, in its own isolated
  tmux session.
- **The real production path** — `lib/ui/launcher.js`'s
  `createLauncher({root, session, cfg, config}).launch('CON-STUB-1',
  baseCommand)` → `submitTicket()` → `session.spawn()` — constructed the
  actual launch command, with the MCP override flags inserted before
  `{{TICKET}}` (same position/mechanism as provider flags — verified via a
  shell round-trip through a stub `codex` binary before the real run:
  `argv` arrived byte-identical to what was constructed).
- **Observed, not inferred:** the real ChatGPT-subscription model
  (`gpt-5.6-luna`) called `mcp__linear__get_issue` (got the canned ticket),
  called `mcp__linear__save_issue` (status → In Progress, against the
  stub — no real Linear ticket touched), then actually ran
  `scripts/concertino/setup-worktree.sh "CON-STUB-1"
  "task/stub-mcp-verification/CON-STUB-1" "default"` as a real tool call
  (retried once past a sandbox git-ref-lock permission prompt, then
  succeeded — an environment/approval-flow detail, not a defect in this
  fix), printed the full `READY` contract, and `assert-phase.sh setup`
  returned `PASS setup`. The scratch clone's own
  `.concertino/runs/CON-STUB-1/events.jsonl` contains a genuine
  `run.start` line:
  ```json
  {"kind":"run.start","project":"con79-verify-clone","ticket":"CON-STUB-1",
   "branch":"task/stub-mcp-verification/CON-STUB-1","harness":"codex",
   "speed":"default","provider":"default", ...}
  ```
  followed by a real `gate.result` (`phase:setup`, `pass`) and the model
  continuing unprompted into a real `phase.enter` (`Planning`) — the run
  proceeded past Setup entirely on its own initiative. The session was
  then deliberately stopped (evidence captured) and the scratch clone
  deleted; `lib/ui/reducer.js`'s `applyEvent()` `case 'run.start':` reads
  exactly the fields this real event carries (`branch`, `worktree`,
  `dev_port`, `backend_port`, `harness`, `speed`, `provider`, `models`),
  confirming a dashboard pointed at this project would render this run
  correctly — the same fold function every other harness's `run.start`
  already goes through.
- Full transcript excerpts, the exact stub-server/override mechanism, and
  the scratch-clone path are recorded in `tasks.md` 3.2 (cycle 3 entry).

**Non-Goals:**
- Switching OpenCode's launch to the headless `opencode run` subcommand.
  Concertino deliberately spawns the actual interactive TUI inside a tmux
  window so a human can `tmux attach` and watch/interject
  (`lib/ui/session.js`'s own design comment: "tmux ... never re-render a
  harness's own UI"). `opencode run`'s re-attach semantics are unverified
  and switching subcommands is a materially bigger behavioral change than
  this ticket's scope.
- Switching Codex's launch to `codex exec` (which documents stdin-prompt
  support). Same reasoning — today's bare `codex [PROMPT]` is already the
  interactive/agentic mode CON-75's own scrollback shows running inside
  tmux; changing subcommands is out of scope.
- Reading the TARGET project's own rendered `.codex/prompts/concertino-deliver.md`
  / `.opencode/commands/concertino-deliver.md` at spawn time. See Decision 2.
- Combining this fix with the `--inline`/agent-merge/speed trailing-token
  parsing already in `prompt.js` — those keep working exactly as today;
  this change only affects what the FINAL constructed command string looks
  like for codex/opencode, not how the ticket/flag/speed token is parsed out
  of the `n` prompt's typed value.

## Decisions

### Decision 1 — expand at the `submitTicket()` choke point, not in `LAUNCH_TEMPLATES` itself

`LAUNCH_TEMPLATES` stays a short, human-readable, `{{TICKET}}`-placeholder
map exactly as today. It is read/displayed in several UI-facing spots
(launch plan preview, `plan.launchCommand.split('{{TICKET}}')` example
command, `withAgentMergeFlag`/`withSpeedFlag`'s token-insertion-after-`{{TICKET}}`
logic, per-ticket harness-label swap in `commandForTicket`) that all operate
on — and their own tests all pin — this short recognizable shape. Rewriting
`LAUNCH_TEMPLATES.codex` itself to the multi-KB inlined form would break
every one of those call sites and turn the launch-plan UI into an
unreadable wall of text for an operator inspecting/editing a planned launch.

Instead, the expansion from short form to full content happens as the LAST
step, inside `submitTicket()` (`lib/ui/prompt.js`), immediately after the
existing `{{TICKET}}` substitution and immediately before `session.spawn()`
is called — the one point every spawn path (`n` prompt, fleet queue tick,
force-start, drilldown restart, draft-then-launch, per-row queue specs) is
already proven to funnel through (`launcher.launch()`/`launcher.launchSpec()`
both call `submitTicket` with no other route to `session.spawn`).

Concretely: after computing today's `substituted` (`parsed.ticket [+ ' ' +
trailing]`) and `launchCommand.split('{{TICKET}}').join(substituted)` (the
short command, exactly as today), a new step inspects the resulting command
via the existing `harnessOfCommand()` helper. When the resolved harness is
in a new `PROMPT_INLINE_HARNESSES` set (`{'codex'}` initially — see Open
Questions for `'opencode'`), the trailing `"/concertino-deliver <request
text>"` quoted argument is replaced with a safely-quoted argument built from
that harness's static prompt body plus the extracted `<request text>`
(`CON-17`, or `CON-17 --agent-merge`, or `CON-17 fast`, byte-identical to
what would otherwise have been substituted). Every harness NOT in that set
(`claude-code`, and `opencode` unless/until added) is untouched — same
string as today.

### Decision 2 — source the inlined content from the tool's own `adapters/<harness>/prompt.md`, not the target project's rendered copy

The ticket's own "Likely fix" suggests reading `.codex/prompts/concertino-deliver.md`
(the TARGET project's rendered copy) at spawn time. This repo's render
pipeline (`lib/cli/emit.js`'s `emitCodex`/`emitOpencode`) writes that file
via a byte-for-byte `copy()` of `adapters/codex/prompt.md` — no
`{{project}}` or other substitution happens for this particular file (unlike
`header.md`, `command.md`, or the role bodies). The two are guaranteed
identical for any project synced with the currently-running `concertino`
version.

Reading the target project's copy would require threading the project root
through `harness.js`'s exported functions and `prompt.js`'s `submitTicket` —
none of which currently receive it (`launcher.js`'s `createLauncher({root,
...})` has `root`, but `submitTicket(ticket, launchCommand, session, env)`
does not, and is exercised directly by its own unit tests with no project
directory at all). Reading this tool's own bundled `adapters/codex/prompt.md`
(via the existing `ADAPTERS`/`read` exports from `lib/cli/shared.js`,
already used by `emit.js` in this same repo) needs no new parameter on any
existing call site and keeps `submitTicket` a pure function of its existing
arguments plus the tool's own static assets.

Trade-off: a project that hand-edited its OWN rendered
`.codex/prompts/concertino-deliver.md` post-sync would not see that edit
reflected in the launch. Nothing else in the render pipeline treats that
file as a supported customization point either — `concertino sync`
unconditionally overwrites it (and every other rendered file) verbatim on
every run — so this is consistent with how the rest of the tool already
behaves, not a new limitation.

### Decision 3 — single-quote the inlined argument; do not reuse double quotes

`adapters/codex/prompt.md` contains 88 backtick characters (inline-code
Markdown spans) and 9 apostrophes; `sh` performs command substitution on
backticks and `$(...)` INSIDE double quotes but not inside single quotes.
Wrapping the inlined content in double quotes (today's shape) would let the
shell try to execute fragments like `` `.codex/roles/concertino-orchestrator.md` ``
as a command substitution before `codex` ever started — silently corrupting
the prompt at best, arbitrary command execution at worst if a future edit to
the adapter body ever introduced a `$(...)`.

A new small helper (e.g. `shQuote(str)`) wraps the inlined text in single
quotes, escaping any embedded single quote as `'\''` — the standard POSIX
technique already used, inline, by `lib/ui/session.js`'s own env-injection
code (`"'" + String(value).replace(/'/g, "'\"'\"'") + "'"`). Extracting a
shared helper (or at minimum mirroring the exact same escape) avoids a
second, subtly-different implementation of the same safety-critical string
operation.

### Decision 4a — a non-default codex/opencode command (operator override) is left untouched, never regex-guessed

`dashboard.launchCommand` (`config/concertino.schema.json`) is a fully
free-form operator override string, constrained only by which recognized
binary name it starts with — `harnessOfCommand()` resolves harness from that
first whitespace-split token alone, so it cannot distinguish "the default
`codex "/concertino-deliver {{TICKET}}"` template" from an arbitrary
operator command that merely happens to start with `codex` (e.g. `codex -c
foo "some other prompt entirely"`). Every other per-command decoration this
codebase already has treats this the same way: `commandForTicket`'s
harness-label swap and `launchSpecForTicket`/`launchSpecForChoices`'s
provider-flag decoration all refuse to touch an operator override
(`lib/ui/launcher.js`'s `specFor()`: "an override has no slots this layer
can safely rewrite").

The new inlining step (Decision 1) follows the same rule, using the same
mechanism `withSpeedFlag`/`parseLaunchCommand` already establish
(`lib/ui/screens/launchplan.js`'s existing "no `{{TICKET}}` match → return
the input unchanged" convention): the trailing-argument extraction is a
regex match against the EXACT default shape
(`"/concertino-deliver <request text>"` as the command's final quoted
segment). When the constructed command does not match that shape — which
happens if and only if `launchCommand` was not (a transformation of) the
default `LAUNCH_TEMPLATES` entry, i.e. an operator override — the inlining
step is a no-op and the command is passed to `session.spawn()` byte-for-byte
unchanged, exactly as it is today for every harness. An operator who
hand-writes a custom codex launch command is knowingly opting out of the
default template (and everything built on top of it, including this fix) —
the same trade-off `dashboard.launchCommand` already makes for harness-label
and provider dispatch.

### Decision 4 — preserve today's flag/speed insertion point exactly

`withAgentMergeFlag`/`withSpeedFlag` (`lib/ui/screens/launchplan.js`) and
`submitTicket`'s own trailing-token handling insert `--agent-merge` /
`--no-agent-merge` / `fast` / `slow` immediately after the ticket id, INSIDE
the short quoted `/concertino-deliver` argument — this happens entirely
BEFORE the new inlining step (Decision 1), on the unchanged short command
string, so none of that logic needs to change. The inlining step then reads
whatever text ended up inside that short quoted argument (`CON-17
--agent-merge`) via a targeted regex and appends it, unmodified, after the
adapter body — so the executor sees the exact same trailing request text at
the end of the long form it would have received (as `$ARGUMENTS`-equivalent)
in the short form.

## Risks / Trade-offs

- [Codex or OpenCode's CLI changes its `[PROMPT]`/`--prompt` semantics in a
  future version and starts expanding slash commands after all] → the fix
  is harmless either way: the model still receives the full instructions
  plus the ticket, just spelled out instead of expanded. No behavioral
  regression from over-fixing.
- [A future change to `adapters/codex/prompt.md` accidentally introduces a
  sequence single-quote-escaping doesn't protect against, e.g. a NUL byte
  or extremely long line hitting a shell/tmux argument-length limit] →
  covered by Decision 3's dedicated regression test (round-trip through an
  actual `sh -c`, not just a string-equality assertion) and by the fact the
  file's content is auditable, static, and already reviewed as part of this
  same change; `tmux respawn-window`'s argument-length ceiling is well
  above this file's size (~4.1KB).
- [A recognized-but-non-default codex/opencode `dashboard.launchCommand`
  operator override silently bypasses this fix] → intentional per Decision
  4a, mirroring existing precedent for harness-label/provider decoration; an
  operator who overrides the launch command already opts out of every other
  automatic per-command decoration this codebase applies.
- [OpenCode's `--prompt` turns out NOT to have this bug, and this fix
  applies inlining to it anyway] → mitigated by making the execution-time
  investigation (Open Questions) a gating step before extending
  `PROMPT_INLINE_HARNESSES` to include `'opencode'` — the fix is not applied
  speculatively.

## Migration Plan

No data migration. This is a pure code change to the dashboard's own launch
construction, applied for every future spawn once merged — no per-project
config or re-sync is required (the inlined content comes from this tool's
own `adapters/` directory, always current). Rollback is a plain revert.

## Open Questions

- **Does OpenCode's `--prompt` actually fail to expand `/concertino-deliver`?**
  Not executable from a non-interactive shell without a live model/auth
  session, so this is left to the execution phase: spawn `opencode --prompt
  "/concertino-deliver CON-1"` inside a real (or scripted, capturable) tmux
  window and inspect the scrollback for the same signature as CON-75's
  Codex failure (never opens `.opencode/roles`-equivalent files, tries to
  resolve the text as something else) vs. genuine expansion (references the
  prompt's own wording). If confirmed broken, add `'opencode'` to
  `PROMPT_INLINE_HARNESSES` and its own `adapters/opencode/prompt.md`
  entry in the content-source map, plus the corresponding tests. If
  confirmed already working, leave `opencode` out of the set and record the
  evidence in the task/PR notes so this isn't re-litigated blind next time.
