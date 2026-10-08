# Fleet pane v2: driver identity, structure, answerable escalations

Status: draft · 2026-10-07 · supersedes the liveness and layout sections of
`2026-10-06-fleet-pane-design.md`; everything else there still holds.

## Why

v1 works end to end but, in use against the sandbox (`~/Development/concertino-sandbox`):

- Every lane reads `external`, including the driver's own. The pane only links a lane to
  this session when the driver's `Agent` prompt contains ``TICKET_ID=`X` `` and the call is
  still in the main transcript. The fleet-driver skill never asks for that shape, `/compact`
  drops the calls, and a plugin-namespaced agent type never matches. `external` then means
  nothing: it covers "mine but unmatched", "another driver's" and "no driver at all".
- Lanes that need the person vanish: an unmatched lane hides 30 min after its last event,
  and an open escalation emits nothing while it waits.
- The pane is text jammed in a panel: fixed-width columns clip at dock width, the header is
  hardcoded "Fleet · concertino", rules are drawn as text, and escalation options print as
  `a) … b) …` with nothing to press.
- Several fields are wrong or empty: `ticket_doc` is always null, cost never shows for
  driver lanes, a multi-part escalation has an empty `question`, `currentAgent` is shown on
  done runs, `escalationStale` is always true.

## Driver identity (replaces correlation-only liveness)

Every orchestrator and its sub-agents run Bash with `CLAUDE_CODE_SESSION_ID` set to the
**driver session's** id (verified: a subagent's shell carries its parent session's id). The
pane reads its own with `$.session.id()`.

- `emit-event.sh` adds `"session":"<id>"` to every event when `CLAUDE_CODE_SESSION_ID` is
  set. Every event, not only `run.start`: a run re-driven by a different session changes
  owner on its next event.
- The reducer keeps `run.driverSession`: the newest event's `session`, else null.
- `concertino fleet --json` carries `driverSession` per run and `project` (config
  `project.name`, else the root's basename) on the snapshot.

The pane derives two independent facts per lane:

| `driver` | meaning |
|---|---|
| `here` | `run.driverSession === $.session.id()` |
| `other` | a different session id |
| `none` | no session recorded (TUI/tmux run, manual scripts, pre-v2 logs) |

| `agent` (only for `here`) | meaning |
|---|---|
| `running` | a matched orchestrator agent is `pending`/`running` |
| `waiting` | matched and `waiting`/`idle` (normal mid-escalation) |
| `stalled` | matched and `completed`/`failed`/`killed`, or matched earlier and now dropped from `$.agent.list()`, while the run has no `run.end` |
| `unseen` | driven here but no orchestrator agent matched (e.g. after a process restart) |

`run.driverSession` is authoritative when present (a run re-driven elsewhere changes owner).
Only a log without one falls back to the agent match below: a matched orchestrator in this
session's own agent list means `here`, else `none`.

Matching an orchestrator agent, in order: (1) `$.agent.list()` entries whose `type` is
`concertino-orchestrator` or ends in `:concertino-orchestrator`, and whose `name` or
`description` contains the ticket id as a word (case-insensitive); (2) the v1 transcript
`TICKET_ID=` fallback. A match is remembered in state by ticket so a later drop from the
list reads `stalled`, not `unseen`.

`Liveness`/`external` is removed. A done run has no agent fact.

## Visibility

Shown by default: any `needs-you` lane; any lane with `driver: here` that has not ended;
other sessions' and driverless lanes whose newest event is under 30 min old (the rest are counted
as "+N quiet"); done and failed lanes that finished under 30 min ago. Older done and failed lanes
collapse behind a "▸ Done · N" / "▸ Failed · N" toggle that expands in place. `/fleet all` shows
everything. The pane auto-opens, and polls every 2 s, only while a shown lane is live.

## Layout

One width-aware tree, no text rules (Box borders instead), no fixed padEnd columns.

**Header**: project name (bold) · `fleet` (dim) · count chips: needs you (warning),
running (success), waiting/idle (subtle), failed (error). Chips with zero are omitted.

**Lane groups**, in this order, each with a dim group label: *Needs you*, *Driven here*,
*Other sessions*, *No driver session*, *Failed*, *Done*. A row is: status dot (colour
by state) · ticket (Button, hotkey 1–9) · title (flex, truncates first) · `Phase cN` ·
age. Below 48 columns the title drops; below 32 the phase drops. The selected row is
marked by the Button's selected styling plus `▸`.

**Detail** for the selected lane:
1. Title row: ticket, title, PR link (if any).
2. Meta row (dim): branch · driver/agent fact in words ("driven here · orchestrator
   running", "driven by another session", "no driver session recorded") · cost · elapsed.
3. Phase stepper: six labelled cells, done (success), current (warning if needs-you, accent
   otherwise), pending (dim). Cells shorten to initials below 60 columns.
4. Escalation card (when open), see below.
5. Gates: one chip per gate, pass/fail coloured, failing gate's first error under it.
6. Ticket: Linear meta + description, or the local ticket doc (as v1).
7. Recent: the last 6 timeline events, humanised ("skeptic: ESCALATION (design)",
   "evidence: design.md"), consecutive evidence writes folded into one line.
8. Comments (Linear only, as v1).

## Escalation card

- Header: role and gate in words ("Skeptic needs a design call"), age.
- `context`, when present, as wrapped dim text.
- Each sub-question (or the single question with its options) numbered; options are
  Buttons with the `a)`/`b)`/`1.` prefixes stripped. Pressing one marks it chosen (state
  atom keyed by escalation id); pressing again clears it. Free-text questions (no options)
  get an `Input`.
- An `Input` "Add a note" (optional).
- `Draft answer` Button: fills the prompt box (`$.prompt.fill`, mode `replace`) with a
  message to the driver: `Answer SBX-4's skeptic escalation (<id>):`, one
  `N. <question> → <pick>` line per question, an optional `Note:` line, and
  ``Record it with `concertino answer` and resume the SBX-4 orchestrator.`` The person reviews and presses Enter; the driver runs `concertino answer`
  and resumes the orchestrator. Nothing is written by the pane. Enabled once every question
  has an answer; otherwise a dim "N of M answered".
- `pendingAnswer` from `answer.json` shows "answered, waiting for the orchestrator" and
  hides the buttons.

The mod stays read-only on disk; `prompt.fill` is the only new capability.

## Driver skill

- The fleet-driver skill ships with the plugin (`skills/concertino-fleet-driver/`), so a
  driver in any project can load it.
- §11 shows the dispatch call verbatim: `subagent_type: "concertino-orchestrator"`,
  `name: "<TICKET>"`, `description: "<TICKET> orchestrator"`, prompt starting
  ``TICKET_ID=`<TICKET>`.`` (the `/concertino-deliver` shape).

## Data fixes in scope

- `ticket_doc`: find `ticket.md` anywhere under the run's `evidence/` (as
  `lib/ui/ticket-text.js` does).
- Escalation: `question` falls back to the first sub-question; `context` is carried; toast
  text never ends empty.
- `currentAgent` null once a run has ended; `escalationStale` dropped from the snapshot.
- `TIMELINE_FIELDS` gains the answer fields; the PR link is read from the whole log, not the
  last 20 events.

## Out of scope (filed separately)

`set-ticket-state.sh` pushing on every state change; `concertino init` writing no
`.gitignore`; configured lint/test gates never emitting `gate.result`; lower-case ticket ids
creating phantom runs; cost for non-TUI runs (`report-cost.sh` needing `CONCERTINO_TICKET`).

## Testing

- `test/scripts/emit-event.test.sh`: `session` present iff `CLAUDE_CODE_SESSION_ID` set.
- `test/cli-fleet.test.js`: `driverSession`, `project`, ticket doc under nested evidence,
  escalation fallback, done-run `currentAgent`.
- `hooks/fleet-pane/*.test.ts`: driver/agent derivation table, stalled-after-drop, visibility
  rules, grouping, width breakpoints, option prefix stripping, draft text, `prompt.fill` call.
- Manual: the sandbox driver session with the stub orchestrator, terminal and desktop.
