# Fleet pane: a Claude Code mod for driver sessions

**Date:** 2026-10-06
**Status:** approved design, awaiting implementation plan

## Intent

The concertino watch TUI assumes runs live in tmux windows it spawned. In
practice Matt drives batches of tickets from a Claude Code session instead
(the `concertino-fleet-driver` skill): one `Agent(concertino-orchestrator)`
per ticket, coordinated by the session itself. The TUI cannot see those lanes'
liveness and sits in a separate terminal, so it goes unused.

This design puts the fleet view *inside* the driver session as a Claude Code
mod (a plugin of function hooks): a docked pane listing the active lanes, with
a detail view for the selected lane (ticket, phase, escalation, timeline, PR).

**v1 is inspect-only.** Answering escalations, steering lanes and starting
tickets stay as prompts typed to the driver. Those are candidate follow-ups,
not part of this spec.

Success: while a driver session runs several orchestrators, the pane shows each
lane's phase, cycle, gates, agent liveness and any pending escalation without
Matt asking the driver for status, and opening an orchestrator's transcript
from the tasks list shows that lane's detail automatically.

Not goals: feature parity with the TUI (launch pad, metrics, compare, kill /
restart), cross-repo lanes, keeping the TUI and the pane in lockstep (the TUI
is slated to be scrapped or re-imagined).

## Architecture

Two components, one seam: a read-only CLI snapshot and a mod that polls it.

```
┌─ concertino CLI ─────────────────┐      ┌─ Claude Code mod (repo root is the plugin) ─────────┐
│ concertino fleet --json [--all]  │◄─────│ $.process.run every 2 s, cwd = $.session.root()      │
│  store.readAll + reduce()        │ JSON │ + $.session.messages() → Agent toolUses whose prompt │
│  + evidence/ticket.md excerpt    │─────►│   has TICKET_ID=<T> → agentId                        │
│  + answer.json state             │      │ + $.agent.list() → status per agentId                │
└──────────────────────────────────┘      │ = lanes[] in $.state → Pane, status line, toast      │
                                          └──────────────────────────────────────────────────────┘
```

The reducer (`lib/ui/reducer.js` `reduce()`) already folds `events.jsonl`
into a `Run`; the CLI reuses it rather than the mod re-implementing it. The mod
cannot import it directly: hooks modules are ES modules in a sandbox without
Node, and an installed copy of the plugin is not the concertino checkout.
Shelling out to `concertino` works wherever the driver works, since the driver
already calls `concertino answer` there.

Polling is the only option: the mod API has no file watcher. 2 s is close
enough to the TUI's 1 s for a human reading a pane.

### `concertino fleet`

New subcommand, `lib/cli/fleet.js`, dispatched from `bin/concertino` and
listed in `lib/cli/help.js`.

- Root: `--out=DIR` or the cwd, resolved to the main checkout with
  `git rev-parse --git-common-dir` (as `emit-event.sh` does), so running it
  from a worktree still finds `.concertino/runs`.
- Folds `reduce(store.readAll(root), [], now)` with **no tmux windows**: the
  reducer then reports a live run as `unknown` (or `needs-you` with an open
  escalation). Liveness is the mod's job.
- Default output is a one-line-per-run table (ticket, status, phase, cycle,
  gates, elapsed) so the driver model can look too. `--json` prints:

  ```json
  {
    "generatedAt": 1759766400000,
    "root": "/abs/main/checkout",
    "runs": [
      {
        "...": "every field of the reducer's Run object",
        "ticket_doc": { "title": "…", "excerpt": "…" },
        "pendingAnswer": { "answer": "b" } | { "subAnswers": [...], "total": 3, "complete": false } | null,
        "timeline": [ { "t": 1759766000000, "kind": "phase.enter", "phase": "Evaluation", "cycle": 2 }, "…" ]
      }
    ]
  }
  ```

  - `ticket_doc.title` is the first markdown heading of
    `runs/<T>/evidence/ticket.md`, `excerpt` the first ~1 KB after it; both
    `null` when the file is missing.
  - `pendingAnswer` is `answer.json` parsed through `store.readAnswerFileRaw`;
    `null` when absent.
  - `timeline` is the last 20 events of the run, each `{t, kind}` plus the
    kind's own fields (`phase`, `cycle`, `agent`, `role`, `verdict`, `gate`,
    `status`, `url`, `label`).
  - By default only non-terminal runs (`status !== 'done'`); `--all` includes
    them.
- Exit 0 with `runs: []` when `.concertino/runs` does not exist. Non-zero only
  for a bad argument or an unreadable root. Writes nothing except the
  ticket-detail cache (`.concertino/cache/fleet-tickets.json`) when `--tickets`
  is given.

### The mod

Repo root is the plugin (`.claude-plugin/plugin.json`, `marketplace.json`
with `source: "./"` exist already and ship nothing). Added files:

```
hooks/hooks.json                 { "modules": ["./fleet-pane/register.tsx"] }
hooks/fleet-pane/register.tsx    hooks: session.start, command.run, ui.render; the poll
hooks/fleet-pane/snapshot.ts     run the CLI, parse, fingerprint
hooks/fleet-pane/lanes.ts        pure: snapshot + AgentInfo[] + SessionMessage[] → Lane[]
hooks/fleet-pane/render.tsx      pure: Lane[] + selection + view → tree
types/index.d.ts                 PluginState contract under 'concertino'
```

`plugin.json` gains `"types": "./types/index.d.ts"`; `package.json` `files`
gains `hooks/` and `types/`.

**State** (`$.state['concertino']`, declared in the contract):

```ts
interface PluginState {
  concertino: {
    fleet: { lanes: Lane[]; error: string | null; fingerprint: string; generatedAt: number }
    selected: string | null          // ticket id
    seenEscalations: string[]        // escalation_id values already toasted
  }
}
```

**Lane** (`lanes.ts`):

```ts
type Lane = {
  run: Run                                   // the snapshot's run, as-is
  agentId?: string                           // from the driver's Agent call
  agentStatus?: AgentStatus                  // from $.agent.list()
  liveness: 'running' | 'external' | 'stalled' | 'ended'
  currentAgent?: 'executor' | 'evaluator' | 'skeptic' | 'auditor'  // last agent.spawn/resume
}
```

- Correlation: scan `$.session.messages()` (main transcript) for `toolUses`
  with `tool === 'Agent'`, `input.subagent_type === 'concertino-orchestrator'`
  and an `agentId`, whose `input.prompt` matches
  `/\bTICKET_ID\s*[=:]\s*`?([A-Za-z][A-Za-z0-9]*-\d+)/` (so `TICKET_ID=HEL-1027.`,
  ``TICKET_ID=`HEL-1027`.`` and `TICKET_ID: HEL-1027` all match); tickets
  compare case-insensitively (run dirs can be lower-case); the newest match per
  ticket wins. Then
  `$.agent.list()` supplies `status`. No match → `external` (run started by
  the TUI, another session, or before this session began).
- `stalled`: matched agent `completed` / `failed` / `killed` while the run has
  no terminal `run.end` — the "lane returned but did not finish" case §10 of
  the fleet-driver skill warns about.
- Ordering: `needs-you`, then `running` / `unknown`, then `failed`; `done` is
  excluded (the CLI default already drops it).
- Correlation is decoration: a denied `messages()` or empty `agent.list()`
  still renders every lane, all `external`.

**Poll** (`register.tsx` + `snapshot.ts`):

- `session.start`: register `/fleet` and arm the poll. The pane is not opened
  at start: `refresh` opens it unasked (`$.ui.open({ id: 'fleet', title: 'Fleet' })`,
  docks from 144 columns) the first time a snapshot has at least one run;
  `/fleet` opens it at any width, any time. The poll is chained with
  `$.clock.after`: 2 s while the last snapshot had a run, 15 s when it had none
  or the CLI failed.
- `refresh`: `$.process.run(['concertino', 'fleet', '--json'], { cwd: await $.session.root(), timeoutMs: 5000 })`.
  Build lanes, compute a fingerprint (ticket, status, phase, cycle, gate
  count, liveness, escalation id, last timeline `t`, pendingAnswer presence,
  per lane) and `update()` state only when it changed, so the pane does not
  redraw every tick. On failure, set `error` (exit code + stderr tail), keep
  the last lanes, clear the status line. A `refresh` never throws out of the
  timer.
- Status line: `fleet: 2 running · 1 idle · 1 needs you`: `running` counts
  lanes whose agent is live, `idle` the rest that are neither running, needs-you
  nor failed (zero parts omitted except `running`); `undefined` with no lanes or
  on error. A row's status shows `running` when the CLI said `unknown` but the
  lane's agent is live (display status).
- Toast `CON-231 needs you: <question, truncated>` once per new
  `escalation_id`, recorded in `seenEscalations`.

**Pane** (`render.tsx`, sized to `e.props.bodyColumns`):

```
 Fleet · concertino                              2 running · 1 needs you
 ────────────────────────────────────────────────────────────────────────
 ▶ CON-231  needs-you  Evaluation c2  ■■■■□□ 4/6   12m   skeptic
   CON-228  running    Execution  c1  ■■■□□□ 3/6   48m   executor
   CON-219  running    Planning   c1  ■□□□□□ 1/6    3m   external
 ────────────────────────────────────────────────────────────────────────
 CON-231  Add follow-up survival report              feature/followup-survival
 Phase Evaluation · cycle 2 · agent running · worktree .concertino/worktrees/…

 ESCALATION (skeptic, 4m ago)
   Should the vacuity class include unverifiable-by-design gates?
   a) include   b) exclude   c) separate class
   answered: b (cli)                       ← only once answer.json exists

 TICKET
   first ~8 lines of ticket_doc.excerpt, wrapped to bodyColumns

 TIMELINE
   14:02 phase.enter Evaluation c2
   14:05 agent.spawn skeptic
   14:06 verdict skeptic ESCALATION design      (last 8)

 PR  https://github.com/…/pull/148          cost $1.84
```

- Lane rows are `plain` `Button`s; `onPress` sets `selected`. Hotkeys `1`–`9`
  select by row while the pane holds the keyboard. The list alone is drawn
  when `placement === 'inline'`.
- **Follows the transcript:** when `e.props.view.agentId` matches a lane, the
  detail shows that lane regardless of `selected`; back on the main view it
  returns to `selected` (or the first lane).
- Phase bar: six cells over `PHASE_ORDER` (Setup … Cleanup), filled up to
  `run.phase`. Gates: passed/total from `run.gates`.
- Colours: `needs-you` yellow, `failed` red, `running` default, `unknown` /
  `external` / `stalled` dim (`stalled` also labelled, except on a `needs-you`
  row, where the orchestrator's pause is expected). Every line truncated
  to `bodyColumns`.
- Sub-questions (`escalation.subQuestions`) render as numbered question
  blocks, each with its own lettered options. Letters are display only.
- Empty states, dim: `No concertino runs under <root>/.concertino/runs`;
  `concertino: <stderr tail>` on a CLI failure, above the stale lanes.
- `/fleet` opens or focuses the pane, replying `Fleet pane opened.` or, when
  the surface cannot place it, `Fleet pane not shown: <reason>`; `/fleet off` closes it. Closing the pane
  (either way) leaves the poll and status line running.

The mod is strictly read-only: no `fs.write`, no `tool.call`, `prompt.*` or
other gating hooks. `claude plugin validate .` should list none.

### Visibility

The pane hides stale lanes by default. A lane is shown when it belongs to this
session (liveness `running` or `stalled`) or when its newest timeline event is
under 30 minutes old (`RECENT_MS`). `ended` lanes follow the same rule, so a
lane that just failed stays for 30 minutes and then drops. Everything else is
hidden, not discarded: `fleet.lanes` always holds every lane, so toggling needs
no re-poll.

`/fleet all` toggles the `showAll` atom and replies `Fleet pane: showing all
lanes.` or `Fleet pane: showing live lanes only.` The header's summary counts
only the visible lanes and ends with ` · all` when showing everything, else
` · N hidden` when N > 0. If every lane is hidden the pane draws `No live lanes ·
N hidden (/fleet all)`. The status line summarises the shown set; the first-run
auto-open and the 2 s poll cadence both require at least one shown lane, so a
repo of only stale runs idles at 15 s. The fingerprint includes the hidden count
so the pane redraws when a lane crosses the 30-minute line. A selected ticket
that is not visible falls back to the first visible lane.

### Ticket detail from Linear (v1.1)

The detail view shows the ticket as Linear has it — description, metadata and
comments — not the `ticket.md` excerpt a run persisted at Planning time. The
excerpt remains the fallback when Linear data is unavailable.

**Seam.** The CLI stays the only process that talks to Linear. The mod passes
the tickets of its currently shown lanes on every poll:

```
concertino fleet --json --tickets=CON-231,CON-228
```

Each run in the snapshot gains:

```json
"ticket_meta": {
  "fetchedAt": 1759766400000,
  "identifier": "CON-231", "title": "…", "description": "…", "url": "…",
  "state": { "name": "In Progress", "type": "started" },
  "assignee": "Matt", "priority": 2, "estimate": 3, "labels": ["…"],
  "comments": [ { "id": "…", "author": "Matt", "body": "…", "createdAt": 1759766000000 } ],
  "commentsTruncated": false
} | null,
"ticket_meta_error": "linear: HTTP 429 — …" | null
```

- Fields are exactly `normaliseTicket`'s output (`lib/ui/linear.js`) minus the
  epic/launch-pad fields, plus `fetchedAt`. Comments are the newest 50, as the
  bulk query already returns them.
- Only `ticketProvider.kind === 'linear'` (after alias resolution) fetches;
  any other provider is silent (`ticket_meta` is the cached value or null, and
  `ticket_meta_error` is null), while a linear repo without `LINEAR_API_KEY`
  yields `ticket_meta` = the cached entry if any, else null, plus a one-line
  `ticket_meta_error` naming why. The
  config is read from `--config`, else the main checkout, else the cwd, so a
  worktree cwd finds it. The snapshot itself never fails because of Linear.

**Fetching and cache.** A new single-issue query `ISSUE_DETAIL_QUERY` /
`fetchTicketDetail({ apiKey, id, transport })` in `lib/ui/linear.js` returns
one issue in the bulk query's shape. A new per-ticket cache
`.concertino/cache/fleet-tickets.json` (`lib/ui/fleet-ticket-cache.js`):

```json
{ "schemaVersion": 1, "tickets": { "CON-231": { "fetchedAt": …, "...": "ticket_meta fields" } } }
```

written atomically (temp file + rename, as `cache.js` does). The TUI's
`tickets.json` is a whole-team snapshot with one timestamp and manual refresh —
the wrong shape for a 2 s poll — so it is neither read nor written here.

Per invocation, for each requested ticket in `--tickets`: serve the cached
entry when it is younger than `FLEET_TICKET_TTL_MS` (20 000 ms; env
`CONCERTINO_FLEET_TICKET_TTL_MS` overrides), otherwise fetch and rewrite the
entry. Tickets not requested are served from cache if present, never fetched.
Entries are stored under the requested id (and the canonical identifier when
it differs), so `con-174` is found again on the next poll.

Errors are classified. *Invocation errors* (HTTP 429, key rejected, timeout,
network failure, exhausted budget) stop further fetches in that invocation and
are reported in `ticket_meta_error` on every requested run; already-cached
entries are served and a stale entry is kept. HTTP 429 additionally stores
`retryUntil = now + 60 s` on the ticket so the next polls do not retry it;
auth, network and timeout failures back off 30 s per ticket the same way.
*Per-ticket errors* (e.g. not found) are cached negatively
(`{ identifier, error, fetchedAt }`, skipped until the TTL expires), serve as
`ticket_meta: null` with that error on that run, and the next requested ticket
is still fetched. All fetches in one invocation share a 2.5 s budget
(`FLEET_LINEAR_BUDGET_MS`; each request gets the remaining time as its
timeout, and no fetch starts with under 200 ms left; running out of budget
is reported as `ticket_meta_error` on every requested run of that invocation,
not only the remaining ones), and the cache is written
after every fetch so a later failure or timeout keeps the earlier results.
Rate budget: three shown lanes at a 20 s TTL is ~540 requests/hour against
Linear's ~1 500/hour API-key limit; the pane still polls every 2 s and draws
whatever is cached.

**Mod.** `refresh` appends `--tickets=<shown lane tickets, comma-joined>` to
the CLI argv when the previous state had shown lanes (the first poll passes
none); with `/fleet all` on it also requests the detail lane (the selected
ticket) even when that lane is hidden from the list. `Run` gains `ticket_meta` and `ticket_meta_error`. The fingerprint
includes `ticket_meta.fetchedAt` and the id of the newest comment (by
`createdAt`) so a new comment redraws the pane.

**Detail layout.** Below the phase line, a metadata line:

```
In Progress · Matt · P2 · 3 pts · labels: agent-merge, follow-up · https://linear.app/…
```

(each part omitted when absent; `P0`–`P4` is Linear's priority number), with a
dim ` · fetched 2m ago` appended when the meta is older than 60 s. The
`TICKET` block becomes `DESCRIPTION`: the full Linear description rendered through the engine's `Markdown` element (`(no description)` when it is empty), not row-capped or link-stripped; when `ticket_meta` is null it draws the `ticket.md` excerpt as plain text as before (8 wrapped rows), and
`ticket_meta_error` (if any) dim beneath the header. A `COMMENTS (n)` block
closes the detail, after `PR`/cost: the newest 5 comments by `createdAt`
(Linear's order is not relied on), shown oldest to newest, each
`author · 14m ago` then the full body through `Markdown`, and `N more — <url>` when
more exist (`N+ more` and `COMMENTS (50+)` when `commentsTruncated` is set).

**Colour, links, Markdown (v1.2).** The pane is drawn in the Claude theme, by
theme key and never raw colour names: the title, section headings and ticket id
`claude`; run states `success` / `warning` / `error` / `inactive`; phase bar
filled `success`, empty `subtle`; the Linear state by its type, priority
`P0`-`P1` `error`, `P2` `warning`; timeline rows by verdict (`PASS`, `MERGE`,
`CONFIRM` `success`; `FAIL`, `BLOCKER`, `REFUTE` `error`), `pr` rows `merged`.
Ticket and PR URLs are `Link` elements, and description and comment bodies are
`Markdown` elements (scrollable with the pane). `/fleet` is registered
`immediate`, so it runs mid-turn; its handler reads no turn state.

**Toasts** fire only for shown lanes (a hidden stale lane's old escalation is
not news). The `/fleet all` toggle is one `update(fn)`.

## Error handling

| Failure | Behaviour |
|---|---|
| Linear unreachable / 429 / key rejected / timeout | `ticket_meta_error` set, cached `ticket_meta` kept; the pane shows the error dim under the detail header and falls back to the excerpt when nothing is cached |
| `concertino` not on PATH, non-zero exit, unparsable JSON | `error` set, previous lanes kept, status line cleared, pane shows the error dim |
| No `.concertino/runs` | CLI exits 0 with `runs: []`; pane shows the empty state |
| `$.session.messages()` denied / `$.agent.list()` empty | Lanes render as `external` |
| Hot reload / `/reload-plugins` | State is in `$.state`; `register` re-arms the interval and reopens the pane only if `$.ui.panes()` does not list it |
| Large `events.jsonl` | Folded by the CLI; JSON bounded by run count, `excerpt` ≤ 1 KB, `timeline` ≤ 20 per run, cached `ticket_meta` ≈ 10 KB per requested ticket (description + 50 comments) |
| Pane too narrow to dock | Engine holds it until the terminal widens or `/fleet` is typed; status line still updates |

## Testing

- `test/cli-fleet.test.js` (`node --test`, one file per `lib/` module as
  CONTRIBUTING requires): fixture `events.jsonl` sets under a temp root →
  snapshot shape, default vs `--all`, `ticket_doc` title/excerpt and `null`
  when missing, `pendingAnswer` single and multi-part, `timeline` cap and
  fields, missing runs dir → `runs: []` exit 0, worktree cwd resolves to the
  main checkout, malformed line tolerated as `store.readEvents` already does.
- `hooks/fleet-pane/lanes.test.ts`, `render.test.ts` (run by
  `claude plugin test .`): correlation (prompt `TICKET_ID=CON-1` → agentId;
  no match → `external`; `completed` + no `run.end` → `stalled`; newest Agent
  call wins), ordering, fingerprint stability (same snapshot → no `update`),
  render smoke for empty / lanes / error / `view.agentId` override / inline
  placement.
- `npm test` gains `claude plugin validate .` and `claude plugin test .`
  (skipped with a note when `claude` is not on PATH, so CI without it still
  passes).
- Manual: `claude --plugin-dir ~/Development/concertino` in a repo with live
  runs; `/fleet`; open an orchestrator from the tasks list and confirm the
  detail follows.
- v1.1 Linear: `test/fleet-ticket-cache.test.js` (TTL serve/refetch, atomic
  write, bad file → empty, env override) and `test/cli-fleet.test.js` additions
  with an injected transport (`--tickets` parsing, cached-vs-fetched, first
  failure stops further fetches, non-linear provider → `null` + error, missing
  key → `null` + error); kit tests: argv carries `--tickets=` for shown lanes
  only; render of the metadata line, description, comments, truncation line,
  excerpt fallback and the dim error.

## Shipping

- Delivered as two PRs that each stand alone: (1) `concertino fleet` with
  tests and a `help.js` line; (2) the mod, `package.json` `files`, and a
  "Fleet pane (Claude Code)" section in `docs/dashboard.md` with the install
  line `/plugin install concertino --marketplace <owner>/concertino`.
- One OpenSpec change `openspec/changes/fleet-pane/` adding the capability
  `fleet-snapshot-cli` (the CLI contract above) and the mod's behaviour; no
  change to existing specs.
- Ticket ids (`CON-nnn`) are assigned when filed; nothing here depends on them.

## Follow-ups deliberately left out of v1

- Answering escalations from the pane (`concertino answer` + a
  `$.session.append` note so the driver reacts next turn).
- Steering a lane (`$.session.send` to the orchestrator's `agentId`).
- Queueing a ticket from the pane (hand the driver a prompt).
- Cross-repo lanes (`TICKET@/abs/repo`).
