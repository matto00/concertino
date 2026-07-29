# The dashboard — `concertino watch`

A terminal fleet view for watching orchestrator runs at a high level.

```bash
concertino watch
```

Requires **tmux**. Runs live in a tmux session (one window per ticket), so they
survive the dashboard crashing, an ssh drop, or a closed laptop.

## What it looks like

Every screen draws its panels through one shared layout module
(`lib/ui/layout.js`): bordered boxes, a title woven into the top border, and
one column of horizontal padding. The fleet view — four bordered sections,
`NEEDS YOU` always kept, never trimmed even when the terminal is short:

```
concertino · helio  4 runs · 1 needs you

┌ NEEDS YOU ───────────────────────────────────────────────────────────────────────────────────────┐
│   ▸ HEL-338   spec-delta-validation                                                              │
│       add zod@3.23 as a runtime dependency?   approve / deny                                     │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
┌ RUNNING ─────────────────────────────────────────────────────────────────────────────────────────┐
│     HEL-501   live-one                                                                           │
│       ▪▪▪▪▪▪▪▪▪▪░░░░░░░░░░  Execution     cycle 1   gates 1/2   23m                              │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
┌ FAILED ──────────────────────────────────────────────────────────────────────────────────────────┐
│     HEL-502   broke                                                                              │
│       ░░░░░░░░░░░░░░░░░░░░  phase unknown   escalated   1m                                       │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
┌ DONE ────────────────────────────────────────────────────────────────────────────────────────────┐
│     HEL-503   shipped                                                                            │
│       ░░░░░░░░░░░░░░░░░░░░  phase unknown   delivered   1m                                       │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
  ↵ attach   l details   j/k move   n new run   N launch pad   q quit
```

The launch pad is the one screen with a real pane-switch key (`Tab` or the
left/right arrows) — the pane currently receiving keystrokes gets a visibly
heavier border (`┏━┓┃┗━┛`, bold/cyan on a colour terminal), not just a colour
difference, so focus still reads with colour turned off. `TICKETS` has focus
below; `EPICS` is plain:

```
NEW RUN · helio                                                 5 open · fetched 12m ago · r refresh

┌ EPICS ─────────────────────────┐ ┏ Pipeline v2 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
│  ▸ Pipeline v2       8 open    │ ┃  ▸ [x] HEL-338   spec-delta-validation            Todo        ┃
│    Panel system      5 open    │ ┃    [x] HEL-341   csv-connector-retry              Todo        ┃
│    Auth hardening    3 open    │ ┃    [ ] HEL-347   sql-source-introspect            Todo        ┃
│    Connector SDK     12 open   │ ┃    [x] HEL-349   pipeline-shape-presets           Todo        ┃
│    ─ unassigned ─    6 open    │ ┃    [ ] HEL-352   scaffold-step-registry           ▲ running   ┃
└────────────────────────────────┘ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

  3 selected · parallel ×2
  space select   ↵ read   a all   s sequential   p parallel   L launch   esc back
```

The fleet view's four sections and the drill-down's timeline/gates/evidence
panels all use the plain border — neither screen has a keypress that routes
to one section instead of another, so there is nothing for a "focused" style
to be distinguished from. A selected row inside the launch pad's unfocused
pane (e.g. `Pipeline v2` above) stays visible but recedes — dimmed, never
bold — so the two panes' selections read as clearly different states, not as
"both panes are somehow active."

### The drill-down's TICKET panel

Drilling into a run (`l` from the fleet view) shows the ticket's title in the
header — right under the ticket id/change name row — and its description in a
bounded `TICKET` panel, between the phase pipeline and the TIMELINE/GATES/
EVIDENCE row. Markdown is rendered as plain text (headings, list markers,
emphasis, inline code and link syntax stripped), not shown as raw markup.

Text is resolved from whichever of two sources survives the run, in
preference order:

1. The **persisted `ticket.md`** at `.concertino/runs/<TICKET_ID>/evidence/
   ticket.md` in the main checkout — a snapshot of exactly what the run
   worked from, written during Planning and durable past `cleanup.sh
   --phase4` destroying the worktree.
2. The **launch pad cache** (`.concertino/cache/linear.json`), matched by
   ticket identifier, for a run whose `ticket.md` was never persisted (e.g. a
   run from before this feature shipped).

If neither source has anything, both the header and the panel show the
honest fallback `ticket text unavailable`, the same styling this screen's
other degradation strings (`no evidence recorded`, `no gate results
recorded`) already use — never an empty frame.

The panel is capped to a fixed 5 content rows, independent of terminal height
or how long TIMELINE/GATES/EVIDENCE's own content is: a longer description
never grows the panel or pushes the other panels off screen. When the
description overflows the cap, only the leading rows are shown, followed by
a dimmed `… N more lines` row — the same "count what's hidden" convention
TIMELINE already uses for events beyond its own cap (`… N earlier events`).

## Keys

| Key | Action |
| --- | --- |
| `↵` | Attach to the selected run — or, on a row with a live escalation, open the escalation screen. `Ctrl-b d` detaches back to the dashboard |
| `j` / `k` | Move the selection |
| `n` | Start a new run — type a ticket id, `↵` to launch, `esc` to cancel |
| `N` | Open the launch pad — browse epics/tickets, pick a batch, launch it. Always bound; if the feature gate is off it explains why rather than doing nothing (see below) |
| `g` | Reply to the oldest live escalation across the whole fleet, from **whatever screen you're on** — see "The cross-screen escalation banner" below |
| `q` | Quit the dashboard (runs keep going) |

On the escalation screen: a letter key per option (`a` approve, `d` deny, ...,
derived from each option's first letter), `t` to type a free-text reply, `↵` to
attach instead, `esc` to go back to the fleet. A **stale** escalation — the run
that raised it has already ended or its window died — shows no answer keys at
all; nobody is waiting on it.

## Starting runs

A run only appears here if it lives in the dashboard's tmux session. Launching
`/concertino-deliver` in an ordinary terminal gives you a run the dashboard
cannot see or attach to — so start runs with `n`, which opens the window inside
the session for you. If the launch fails, the prompt says so and stays open
rather than taking the dashboard down with it.

## What it knows, and how much to trust it

Three tiers of telemetry, and the dashboard degrades down them rather than
pretending:

| Shown | Means |
| --- | --- |
| Phase, cycle, gates, verdicts | Fully instrumented — the agent is emitting events |
| `phase unknown`, gates present | Only the procedure scripts are reporting |
| `no telemetry · idle 11m` | Nothing but the tmux process itself |

A run you cannot see into looks conspicuously uninstrumented, never healthy.

`idle` is tmux's own last-activity time for the window, so it is true on the
first frame and survives restarting the dashboard — `idle 11m` means the run has
produced nothing for 11 minutes, not that you have been watching for 11.

Runs are grouped by outcome. `FAILED` is separate from `DONE` and coloured red:
a run that ended `escalated` (a circuit breaker giving up) or whose window died
must never read like one that shipped. A dead window has no end event, so it
shows `window exited` rather than an elapsed time that keeps growing.

The finished sections show only the most recent few, with `… and N more` for the
rest, and the whole view is capped to the terminal height. `NEEDS YOU` is never
trimmed.

## Configuration

```json
"dashboard": {
  "tmuxSession": "concertino",
  "launchCommand": "claude \"/concertino-deliver {{TICKET}}\"",
  "maxConcurrent": 2,
  "escalationTimeoutMinutes": 8,
  "retentionDays": 30,
  "launchPad": { "enabled": false }
}
```

`launchCommand` is what `n` runs; `{{TICKET}}` is replaced with what you typed.
It defaults from `harnesses` — `claude "/concertino-deliver {{TICKET}}"`, or the
`codex` equivalent for a codex-only project — so most projects never set it.

`escalationTimeoutMinutes` bounds how long `emit-event.sh --await` blocks before
giving up and letting the orchestrator fall back to presenting the escalation in
chat. `concertino sync` renders it into `CONCERTINO_ESCALATION_TIMEOUT_MIN` in
`.concertino.env`. The default is deliberately short (**8 minutes**, not the
hour it might sound like it should be): `--await` runs inside a single harness
command call, and Claude Code caps a Bash call at roughly 10 minutes — a longer
timeout risks the harness killing the wait before `--await` gets to log
`escalation.timeout` and return control cleanly. Lower it further for a fleet
you expect to check in on constantly; there is little reason to raise it.

`retentionDays` bounds how long a **terminal** run's event log under
`.concertino/runs/<TICKET>/` is kept before it becomes eligible for pruning.
The default is **30 days**. A run that has not yet emitted a `run.end` event
is never pruned, regardless of age — pruning is conservative by
construction, not merely by tuning the cutoff (see "Retention", below).

`dashboard` is distinct from `ui`, which describes whether the *project under
test* has a user interface and how the evaluator reviews it.

## Where the data lives

```
.concertino/runs/<TICKET>/
  events.jsonl    append-only event log — survives cleanup
```

An escalation appears on the dashboard as a `NEEDS YOU` row, and you can now
**answer it from here**: `↵` on the row opens the escalation screen, which
renders the question, its options and who raised it. The orchestrator raises
escalations with `emit-event.sh escalation --await`, which blocks — the agent
is genuinely waiting on this bash call — until the dashboard writes
`.concertino/runs/<TICKET>/answer.json`, at which point `--await` returns the
decision, logs `escalation.answered` itself, and the row clears on the next
poll. Two dashboards can safely race to answer the same escalation: the write
uses `O_EXCL`, so the first one wins and the second is told "already answered"
rather than silently overwriting it.

If `--await` times out (`escalationTimeoutMinutes`, see below) before anyone
answers, it logs `escalation.timeout` and exits non-zero — which clears the row
the same way an answer would, since the dashboard is no longer what the agent
is waiting on. **A timeout is never an approval**: the orchestrator falls back
to presenting the `ESCALATION` block in chat exactly as it always did, and
records `escalation.answered` itself once that exchange settles it. (A
different case, `escalationStale`, covers a run that ended or whose window died
while still holding an un-timed-out escalation — that row shows `[stale]` and
offers no answer keys, because nobody is waiting on it either.)

The log lives in the main checkout, not the worktree, so a run's history
survives `cleanup.sh --phase4` removing the worktree. Tail it directly:

```bash
tail -f .concertino/runs/HEL-334/events.jsonl | jq .
```

### Retention

Nothing removes `.concertino/runs/<TICKET>/` on its own — logs accumulate for
the life of the project unless pruned. Pruning is deliberately blunt and
conservative: a run's log is only eligible once it is **both** terminal (its
log contains a `run.end` event) **and** older than `dashboard.retentionDays`
(default 30). A run that has never emitted `run.end` — still running, or
crashed before it got the chance — is never removed, however old its log
gets; that is the safe failure mode, not an oversight.

Run it explicitly whenever you like:

```bash
concertino prune             # removes eligible run directories, reports what it removed
concertino prune --dry-run   # reports what would be removed, touches nothing
```

`concertino watch` also runs the same prune pass once, best-effort, at
startup — before the poll loop begins, never on the per-second poll itself —
so a fleet you check in on regularly stays bounded without a separate cron
job. A pruning failure there (permissions, races) is swallowed; it never
blocks the dashboard from starting. Pruning removes the whole
`.concertino/runs/<TICKET>/` directory, not just `events.jsonl`, so a pruned
ticket reads as "never ran" rather than as a run with a suspiciously empty
log.

### Window reaping

Retention prunes logs; **reaping** is its independent tmux-window
counterpart — neither assumes the other has run. On every `concertino watch`
poll, the dashboard automatically closes ("reaps") the tmux window of any run
for which **both** hold: the run's event log contains a terminal `run.end`
event, **and** tmux itself already reports the window's pane as dead. This is
the conservative policy: it can never truncate live work, because it only
ever acts on a window tmux already reports as finished. Unlike retention,
reaping is not configurable and has no age cutoff — it runs unconditionally,
every poll, at the same cadence as the rest of the dashboard's render.

A run whose window is dead but whose log has **no** `run.end` event — a
crash, an OOM kill, `kill -9`, a harness that exited before Phase 4 — is
**never reaped**, no matter how long the dead window sits there. That window
is `lib/ui/reducer.js`'s only source of evidence that the run existed and
failed; destroying it would let the run fall through to `unknown` instead of
`failed`, which the project treats as a hard failure mode ("absent data must
never render as healthy data"), not an edge case to optimise away.

A run that has emitted `run.end` but is still alive (finishing up Phase 4's
tail — updating the ticket, posting a closing comment, a hygiene check) is
left alone too: reaping only ever acts once tmux's own liveness bit agrees
the window is done, never on `run.end` alone.

Before a window is closed, its full scrollback (`tmux capture-pane -p -S -`,
from the start of history) is captured to
`.concertino/runs/<TICKET>/session-scrollback.txt` — the same per-ticket run
directory `events.jsonl`/`answer.json` already live in, so it is discovered,
gitignored, and pruned by retention alongside them with no extra code. A
capture or write failure never blocks the window from closing; the courtesy
save is best-effort, exactly like retention's own startup prune.

`__concertino__` (the session's placeholder window) and any
`concertino-smoke-<pid>`-style isolated test session are never reaped —
neither is ever part of the window set reaping considers.

## The cross-screen escalation banner

An escalation is a **fleet-wide** concern, not just a property of the run
that raised it — a blocked `main` fast-forward (below) is the clearest case:
every *other* run now branches from a stale base until someone answers. So
any live escalation also renders as a persistent one- or two-line banner
above whatever screen is currently on top — the fleet, a drilldown, the
launch pad, even a *different* run's own escalation screen. It is suppressed
only on the one screen that would otherwise duplicate it: the raising run's
own dedicated escalation screen.

Press `g` from anywhere to open a reply box for the banner's escalation
(always the **oldest** live one, if several are live — the banner also
states how many more there are) without leaving the screen you're on;
`esc` cancels without writing anything, `↵` submits through the same
`answer.json` writer the dedicated escalation screen uses. The banner
disappears the moment that escalation is answered or times out, on the very
next poll — the same event (`escalation.answered` / `escalation.timeout`)
that already clears the row on the fleet.

## Local `main`, fast-forwarded automatically after every merge

Phase 4 cleanup (`cleanup.sh --phase4`) now also fetches the configured base
remote/branch and fast-forwards local `main` to match it — the one moment
the workflow already knows a merge just happened. A clean, unambiguous
fast-forward (nobody has `main` checked out, or it's checked out somewhere
clean) happens silently, followed by a best-effort `concertino sync`
re-render so rendered artifacts (`.claude/agents/`, `scripts/concertino/`)
can't go stale unnoticed. A dirty tree or a diverged local `main` is never
touched — `cleanup.sh` raises a blocking escalation instead (`retry` after
you've resolved it out of band, or `skip` to leave it for later), visible via
the banner above from every screen. `concertino doctor` separately warns when
local `main` is behind its remote, naming this step as the usual cause.

## The launch pad — epic browser, ticket viewer, launch plan, queue

`N` from the fleet view opens the launch pad: epics on the left, that epic's
open tickets on the right with an inline status column (`Todo` / `In Progress`
/ `▲ running` — the last one backed by the live fleet, not Linear, so it is
accurate even against an hour-old cache). `space` toggles a ticket into the
batch, `↵` opens it for reading (full description and comments, already
local), `s`/`p` pick sequential or parallel, and `L` opens the **launch
plan** — the confirm gate — once at least one ticket is selected.

The launch plan shows every ticket's pre-flight ports (derived from the
ticket number, the same arithmetic `setup-worktree.sh` uses, so no run has to
start first), the concurrency cap (`c` cycles it — bounded, never "parallel =
all of them"), and an already-active warning counted across the **whole
fleet**, not just this batch. `↵` confirms and hands the batch to the queue
runner, which holds `dashboard.maxConcurrent` and starts the next ticket the
moment a run ends or its window dies. Sequential is `maxConcurrent: 1` — the
same code path, not a second one. The queue lives in the dashboard's own
memory, not on disk: a restart mid-batch forgets anything still queued, but
every ticket already launched is unaffected (tmux + the event log already
make that durable, exactly as for a ticket started with `n`).

This section documents the on-disk cache underneath all of that, so the cache
file is not a mystery if you find one on disk.

```
.concertino/cache/
  linear.json     { fetchedAt, tickets: [...], epics: [...] }
```

### Why a cache at all

The launch pad fetches **once, in bulk** — every open ticket with its full
description and comment thread — rather than querying per keystroke. In order of
importance:

- **It makes a ticket viewer possible.** With descriptions and comments already
  local, opening a ticket to read it is instant. Reading the ticket properly is
  exactly what you want to do before handing it to an autonomous agent, and
  fetching that lazily would make the browser feel like a web page instead of a
  file.
- **Instant, offline browsing.** Filtering and navigation are local reads.
- **One visible staleness point.** The header shows `fetched 12m ago` and `r`
  refetches. No background polling quietly burning API quota.

The cache is **never** the source of truth for whether a ticket is already being
worked on. That comes from the live event log and tmux, which is why a status
column can say `▲ running` against a cache fetched an hour ago.

### Sensitivity

`.concertino/cache/` holds full ticket descriptions and comment threads —
frequently more sensitive than anything else in the repo. It **must** be
gitignored. Concertino's own `.gitignore` covers it via the `.concertino/` entry;
if you narrow that entry in your project, add `.concertino/cache/` explicitly.

### A cold cache is not an error

Missing file, malformed JSON, a write truncated by a crash — all read as
`{ fetchedAt: null, tickets: [], epics: [] }`. There is no error channel, because
every caller would handle the error by showing the empty state. That is exactly
how `lib/ui/store.js` treats a malformed event log. Writes go through a temp file
and a rename, so a crash mid-write leaves the previous cache intact rather than a
half one.

### What "open" means

Linear state types are `backlog`, `unstarted`, `started`, `completed` and
`canceled`. The launch pad's `OPEN_STATE_TYPES` is the first three.

`started` is the load-bearing inclusion. The launch pad shows an inline status
column precisely so a ticket already *In Progress* in Linear is visible at
selection time rather than only on the confirm screen — and you cannot warn about
a ticket you never fetched. `completed` and `canceled` are excluded because there
is nothing left to deliver.

### The fetch is bounded by ticket count, not comments

Measurement against real data found `COMMENT_LIMIT` was aimed at the wrong
thing: across a real 267-ticket / 740.1 KB fetch (Helio Platform), descriptions
were 79% of the payload and comments were 0.6% — the busiest thread in the
entire backlog had **one** comment. Ticket count was the axis that was actually
unbounded (paging continued until Linear ran out, capped only by `MAX_PAGES`'s
10,000-ticket hang-guard).

So `lib/ui/linear.js` now caps a fetch at `MAX_TICKETS` (500) — double the
largest team measured, so it doesn't engage for any team seen so far, and
~1.4 MB at the worst case (500 tickets * ~2.8 KB/ticket). When a fetch would
exceed it, `fetchTickets` stops paging, slices to exactly 500 tickets, and
reports `truncated: true`; the launch pad's header shows a
`(truncated — more available)` marker next to the open-ticket count rather
than silently returning a short list. `truncated` round-trips through the
on-disk cache like every other field.

`COMMENT_LIMIT` (50 comments/ticket) stays as cheap insurance against a single
pathological thread — a comment thread the busiest ticket ever measured
doesn't come close to needing — not as the mechanism that keeps the cache
small. The fetch still takes only the first `COMMENT_LIMIT` comments and
records `commentCount` / `commentsTruncated`, so a viewer can say "showing 50
of 214" rather than silently pretending a thread is complete.

For scale: the `Concertino` team's seven open tickets carry ~1.5–3.5 KB of
description each and **zero** comments, so its cache is around 15.5 KB.

### Excluding backlog tickets

A team's `backlog` state can dwarf its active work — in the same measurement,
266 of Helio Platform's 267 open tickets were `backlog`. A project like that
can set `dashboard.launchPad.backlog: false` to fetch only `unstarted` and
`started` tickets, leaving `backlog` out of both the query and the cache
entirely. This is the bigger lever on cache size for a real team — bigger than
`MAX_TICKETS` — because it changes which tickets exist to be counted, not how
many of them fit under the cap. Default (absent, or anything but exactly
`false`) preserves today's behaviour: backlog, unstarted and started tickets
are all fetched, unchanged.

### Configuration

The launch pad is gated on **all three** of `dashboard.launchPad.enabled`,
`ticketProvider.kind === "linear"`, and a non-empty `LINEAR_API_KEY`. The gate
reports *which* condition failed, so the UI can explain itself rather than
silently hiding.

Which team to fetch comes from `ticketProvider.teamKey`:

```json
"ticketProvider": { "kind": "linear", "teamKey": "CON", "idExample": "CON-1" }
```

`LINEAR_TEAM_KEY` overrides it. If neither is set the key is guessed from the
`idExample` prefix, which is a **guess** and labelled as one — `idExample` is a
sample id for agent prose and is often a placeholder, and a wrong team key
fetches cleanly and returns nothing.

`dashboard.launchPad.backlog: false` excludes backlog-state tickets from the
fetch (see "Excluding backlog tickets" above); omit it, or leave it anything
but exactly `false`, to keep today's default of fetching backlog, unstarted
and started tickets. The fetch itself is capped at `MAX_TICKETS` (500,
see "The fetch is bounded by ticket count, not comments" above) — not
configurable, the same plain-constant precedent as `COMMENT_LIMIT` — with a
`(truncated — more available)` marker on the launch pad's header when the cap
cuts a fetch short.

Read-only throughout. Concertino never writes ticket state from the dashboard;
the orchestrator already owns that transition.
