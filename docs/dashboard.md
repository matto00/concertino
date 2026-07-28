# The dashboard — `concertino watch`

A terminal fleet view for watching orchestrator runs at a high level.

```bash
concertino watch
```

Requires **tmux**. Runs live in a tmux session (one window per ticket), so they
survive the dashboard crashing, an ssh drop, or a closed laptop.

## Keys

| Key | Action |
| --- | --- |
| `↵` | Attach to the selected run — or, on a row with a live escalation, open the escalation screen. `Ctrl-b d` detaches back to the dashboard |
| `j` / `k` | Move the selection |
| `n` | Start a new run — type a ticket id, `↵` to launch, `esc` to cancel |
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

## The ticket cache — built, not yet wired to any screen

**Nothing in `concertino watch` reads this yet.** The launch pad's data layer —
a read-only Linear client and an on-disk ticket cache — is in place, but no
screen consumes it and no key opens it. Enabling `dashboard.launchPad.enabled`
today changes nothing visible. This section documents the layer so the eventual
screen has a contract to build against, and so the cache file is not a mystery
if you find one on disk.

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

### Comments are capped

A description is written once; a comment thread grows without limit. Comments are
the only unbounded axis in the payload, so the fetch takes the first
`COMMENT_LIMIT` (50) per ticket and records `commentCount` and
`commentsTruncated`. A viewer must say "showing 50 of 214" — a silently short
thread reads as a complete one.

For scale: the `Concertino` team's six open tickets carry ~1.5–3.5 KB of
description each and **zero** comments, so its cache is around 10 KB. A busy team
is the case the cap exists for.

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

Read-only throughout. Concertino never writes ticket state from the dashboard;
the orchestrator already owns that transition.
