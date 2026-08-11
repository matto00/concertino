'use strict';

// What happens when the `n` prompt is submitted, pulled out of watch.js's
// terminal-driving loop so it can be unit tested without a tty: given the
// typed value, the configured launchCommand template and something that can
// spawn a session, decide whether to spawn and what to report.
//
// Validation happens before the ticket ever reaches session.spawn. The
// launchCommand template puts the ticket inside a shell string (by default
// `claude "/concertino-deliver {{TICKET}}"`), and `sh` still expands `$(...)`
// and friends even inside double quotes — so anything that isn't
// ticket-shaped must never be substituted in at all.
const path = require('path');
const { looksLikeTicket } = require('./ticket');
const { harnessOfCommand } = require('./harness');
const { ADAPTERS, read } = require('../cli/shared');
const { shQuote } = require('./shquote');

// CON-79: Codex (and OpenCode) do not expand a leading-slash
// `/concertino-deliver <ticket>` string when it is passed as the initial
// non-interactive prompt — that expansion only happens inside each CLI's own
// interactive TUI, from its own rendered `.codex/prompts/` /
// `.opencode/commands/` file. Claude Code's CLI is the one harness confirmed
// to expand a leading-slash initial prompt outside a TUI (this very delivery
// depends on it), so it stays out of this set. See design.md's Decisions
// 1-4a for the full reasoning (choke-point placement, content source,
// quoting, and the operator-override no-op fallback).
const PROMPT_INLINE_HARNESSES = new Set(['codex', 'opencode']);

// The exact default-template shape submitTicket's own {{TICKET}} + flag/speed
// substitution (below) always produces as the LAST thing in the constructed
// command: a `"/concertino-deliver <request text>"` quoted segment anchored
// at the string's end. Anchoring at `$` — not just anywhere in the string —
// is what lets this reliably NOT match a recognized-but-non-default operator
// `dashboard.launchCommand` override (design.md Decision 4a): an override's
// own trailing argument, whatever it is, either matches this exact shape (and
// gets inlined the same as the default template would) or does not (and is
// left untouched).
const TRAILING_PROMPT_RE = /"\/concertino-deliver ([^"]*)"$/;

// Static per-harness prompt body to inline into the initial-prompt argument,
// read once from this tool's own bundled adapters/ dir (never the target
// project's rendered copy — design.md Decision 2) and memoized so a spawn
// never re-reads disk.
const promptBodyCache = new Map();
function inlinedPromptBody(harness) {
  if (promptBodyCache.has(harness)) return promptBodyCache.get(harness);
  let body;
  if (harness === 'opencode') {
    // adapters/opencode/prompt.md is OpenCode's own command-file shape:
    // YAML frontmatter (metadata for OpenCode's command list, never sent to
    // the model) followed by the body that actually becomes the message
    // when the command runs. Strip the frontmatter — inlining it verbatim
    // would put YAML key/value chrome in front of the model's first message
    // for no reason (adapters/codex/prompt.md has no frontmatter to begin
    // with, so this step is a no-op there).
    //
    // Unlike adapters/codex/prompt.md, this file also carries
    // `{{project}}`/`{{idExample}}` tokens `concertino sync` resolves from
    // project config — config submitTicket() deliberately has no access to
    // (design.md Decision 2 keeps it a pure function of its existing
    // arguments, same reasoning applied here). Left un-substituted: the one
    // visible effect is the body's own illustrative "(e.g. `{{idExample}}`)"
    // aside rendering literally instead of a concrete example — the actual
    // ticket id is still appended, concrete, right after the body, exactly
    // as for Codex.
    body = read(path.join(ADAPTERS, 'opencode', 'prompt.md'))
      .replace(/^---\n[\s\S]*?\n---\n\n?/, '');
  } else {
    body = read(path.join(ADAPTERS, harness, 'prompt.md'));
  }
  promptBodyCache.set(harness, body);
  return body;
}

// Replaces a constructed command's trailing `"/concertino-deliver <request
// text>"` argument with the harness's full prompt body plus that same
// request text, single-quoted so backticks/`$`/quotes inside the prompt body
// survive the `sh` hand-off untouched (design.md Decision 3). A genuine no-op
// — the command is returned byte-for-byte unchanged — for any harness not in
// PROMPT_INLINE_HARNESSES, and for a recognized-harness command whose
// trailing argument does not match the exact default shape (an operator
// `dashboard.launchCommand` override — design.md Decision 4a). Never throws.
function inlinePromptIfNeeded(command) {
  const harness = harnessOfCommand(command);
  if (!harness || !PROMPT_INLINE_HARNESSES.has(harness)) return command;
  const m = TRAILING_PROMPT_RE.exec(command);
  if (!m) return command; // non-default operator override — no-op, never guessed
  const inlined = inlinedPromptBody(harness) + '\n\n' + m[1];
  return command.slice(0, m.index) + shQuote(inlined);
}

// The only two flags the `n` prompt accepts, trailing the ticket id, separated
// by whitespace — the same per-run agent-merge override `/concertino-deliver`
// accepts on the Claude Code side (see adapters/claude-code/command.md /
// core/roles/orchestrator.md's AGENT_MERGE_OVERRIDE). Anything else typed
// after the ticket — including a shape that merely LOOKS like one of these
// two — is rejected outright rather than passed through: this is an allowlist
// of exact strings, not a permissive parse.
const AGENT_MERGE_FLAGS = new Set(['--agent-merge', '--no-agent-merge']);

// CON-22: the speed token — independent of AGENT_MERGE_FLAGS (its own set,
// its own trailing slot). This ships speed-only OR agent-merge-only parsing
// (not yet combined in one typed value — see design.md Decision 6's Open
// Questions); `parseTicketInput` below accepts exactly one trailing token
// drawn from either set, never both at once.
const SPEED_FLAGS = new Set(['fast', 'slow']);

// Splits "TICKET", "TICKET --agent-merge"/"TICKET --no-agent-merge", or
// "TICKET fast"/"TICKET slow" into its parts. Returns null for anything else
// — including extra whitespace-separated tokens, a flag that isn't one of
// the exact strings above, or a ticket portion that doesn't itself look like
// a ticket id. Never partially accepts: the whole typed value is well-formed,
// or none of it is used.
function parseTicketInput(value) {
  if (typeof value !== 'string') return null;
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return looksLikeTicket(parts[0]) ? { ticket: parts[0], flag: null, speed: null } : null;
  }
  if (parts.length === 2 && looksLikeTicket(parts[0])) {
    if (AGENT_MERGE_FLAGS.has(parts[1])) return { ticket: parts[0], flag: parts[1], speed: null };
    if (SPEED_FLAGS.has(parts[1])) return { ticket: parts[0], flag: null, speed: parts[1] };
  }
  return null;
}

// `env` (optional, CON-65) is a { NAME: value } map of per-window
// environment for the spawned harness process — threaded through verbatim
// to session.spawn, which owns the quoting/injection mechanics. Omitted (the
// original three-argument signature, every pre-existing call site) it
// changes nothing beyond the unconditional CONCERTINO_TICKET injection below.
function submitTicket(ticket, launchCommand, session, env) {
  const parsed = parseTicketInput(ticket);
  if (!parsed) {
    return { spawned: false, error: 'not a ticket id' };
  }
  // track-per-run-cost-spend, design.md Decision 5 / specs/run-cost-telemetry:
  // every spawn — regardless of launch path (the `n` prompt, queue tick,
  // force-start, restart, address-failure all funnel through this one
  // function) — gets CONCERTINO_TICKET set in its process environment, so
  // report-cost.sh (any Claude Code session/subagent this ticket ever spawns)
  // can identify which ticket it's reporting cost for without ever reading
  // `cwd` (see that requirement's own reasoning). Merged FIRST so a
  // caller-supplied `env` (e.g. CON-65's provider-routing env) always wins on
  // any key collision — none exists between CONCERTINO_TICKET and any
  // pre-existing injected key today, but the precedence is deliberate, not
  // incidental.
  const mergedEnv = Object.assign({ CONCERTINO_TICKET: parsed.ticket }, env || {});
  // The flag/speed (if any) lands INSIDE the substituted {{TICKET}} value —
  // never appended after launchCommand's own closing quote — so it ends up
  // inside the quoted `/concertino-deliver` argument exactly like the ticket
  // id itself (e.g. `claude "/concertino-deliver CON-17 --agent-merge"` or
  // `claude "/concertino-deliver CON-17 fast"`). Appending it outside the
  // quotes would mean `$ARGUMENTS` on the Claude Code side never sees it at
  // all. At most one of flag/speed is ever set (parseTicketInput's own
  // one-trailing-token-only contract), so this never has to decide an order
  // between the two.
  const trailing = parsed.flag || parsed.speed;
  const substituted = trailing ? parsed.ticket + ' ' + trailing : parsed.ticket;
  const shortCommand = launchCommand.split('{{TICKET}}').join(substituted);
  // CON-79: for codex/opencode, replace the short (still-unexpanded-outside-
  // a-TUI) `"/concertino-deliver <request text>"` argument with the harness's
  // full prompt content — the LAST step before session.spawn(), after every
  // validation/substitution above (see inlinePromptIfNeeded's own doc comment
  // and design.md Decisions 1-4a).
  const command = inlinePromptIfNeeded(shortCommand);
  try {
    session.spawn(parsed.ticket, command, mergedEnv);
    return { spawned: true, error: null };
  } catch (e) {
    // spawn() throws deliberately rather than leave a half-made window.
    // Report it the same way a validation failure is reported: on the
    // prompt, with the prompt left open, rather than taking the dashboard
    // down over one bad launch.
    return {
      spawned: false,
      error: 'could not start ' + parsed.ticket + ': ' +
        String((e && e.message) || e).split('\n')[0],
    };
  }
}

module.exports = { submitTicket, parseTicketInput };
