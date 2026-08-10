# The dashboard — `concertino watch`

A terminal fleet view for watching orchestrator runs at a high level.

```bash
concertino watch
```

Bare `concertino` (no subcommand) launches the same dashboard — `watch` is a
fully-supported, explicit alias for it.

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
2. The **launch pad cache** (`.concertino/cache/tickets.json`), matched by
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

### The run drill-down's other keys

Beyond the TICKET panel above, the drill-down has four panels — TICKET,
TIMELINE, GATES, EVIDENCE — and its own key set, distinct from the fleet
view's:

| Key | Action |
| --- | --- |
| `1`-`4` | Jump directly to a panel (TICKET / TIMELINE / GATES / EVIDENCE) |
| `Tab` | Cycle through the four panels in order |
| `↑`/`↓` | Scroll the focused panel's content (TICKET/TIMELINE/GATES); `Page Up`/`Page Down` scroll by 5 lines |
| `j`/`k` | While EVIDENCE holds focus: move the EVIDENCE selection (not scroll — the one panel where j/k mean select, not scroll) |
| `↵` | Attach to the run — or, while EVIDENCE holds focus, open the selected evidence entry: a plain evidence doc opens in the in-TUI reader, a `pr`-kind entry (CON-55) opens externally in the OS browser instead |
| `k` | Kill the run, behind a `y` confirmation — only bound while the run is live; inert (and unadvertised) once it has finished |
| `r` | Restart the run, behind a `y` confirmation — same liveness gating as `k` |
| `esc` | Back to the fleet |

`k` kill / `r` restart are deliberately unreachable while EVIDENCE holds
focus (`j`/`k` mean something else there); they return once focus moves to
TICKET, TIMELINE, or GATES. A destructive action (`k`/`r`) always needs a
deliberate `y` — any other key, including `esc`, cancels the confirmation
without acting.

## Keys

| Key | Action |
| --- | --- |
| `↵` | Attach to the selected run — or, on a row with a live escalation, open the escalation screen. `Ctrl-b d` detaches back to the dashboard |
| `l` / `→` | Open the run drill-down (timeline, gates, evidence) for the selected RUNNING/FAILED/DONE/NEEDS YOU row |
| `t` | Open the ticket detail view (title, description, comments) for the focused/selected row in QUICK START, QUEUED, RUNNING, or DONE. Additive to `l` on RUNNING/DONE — the two open different screens for the same row. A no-op if the row has no resolvable ticket at keypress time |
| `j` / `k` | Move the selection — or, while QUICK START/QUEUED is locally focused, that section's own cursor instead |
| `1`-`9` | Jump straight to the Nth section actually on screen this frame (NEEDS YOU, RUNNING, QUICK START, QUEUED, FAILED, DONE, METRICS — whichever are rendered), focusing QUICK START/QUEUED locally when the target is one of those two |
| `/` | Open a search prompt — typing filters/highlights every row (any section) whose ticket id or title contains the typed text, live; `↵` jumps the selection to the first match, in on-screen render order; `esc` cancels with no state change |
| `space` | On a FAILED row, or the QUEUED-locally-focused row: toggle that row into/out of its section's multi-select set (marked with a dedicated `✓`, distinct from the `▸`/`»` cursor markers) — see "Bulk actions on multiple rows" below. Unbound everywhere else |
| `a` | While QUICK START is locally focused: quick-start the highlighted eligible ticket. **On a selected FAILED row** (no local focus at all — see "Addressing a FAILED run" below): launch `/concertino-address-failure` against it — or, with one or more FAILED rows multi-selected, against the whole selection at once, past a `y` confirmation naming the count |
| `d` | **On a selected FAILED row:** mark it DONE on the dashboard, past a `y` confirmation — see "Addressing a FAILED run" below — or, with one or more FAILED rows multi-selected, mark the whole selection DONE at once, past a `y` confirmation naming the count. Unbound everywhere else |
| `f` | While QUEUED is locally focused: force-start the highlighted pending ticket, past a confirmation — or, with one or more QUEUED rows multi-selected, force-start the whole selection at once, past a confirmation naming the count and the resulting concurrency overage |
| `C` | Clear the queue — drops everything still pending, past a confirmation. Bound whenever QUEUED has anything pending, independent of focus |
| `c` | Confirm a queue restored from a previous session (shown after a dashboard restart with tickets still pending/in flight) |
| `n` | Start a new run — type a ticket id and `↵` to launch, or type free text and `↵` to draft a new ticket first (Linear only — see "Starting a run from an intention" below); `esc` to cancel |
| `N` | Open the launch pad — browse epics/tickets, pick a batch, launch it. Always bound; if the feature gate is off it explains why rather than doing nothing (see below) |
| `s` | Open the settings screen (view/edit `concertino.config.json`) |
| `A` | Open the run-archive screen — every retained run under `.concertino/runs/`, filterable by ticket id/title, harness, and date range (see "The run-archive screen" below) |
| `g` | Reply to the oldest live escalation across the whole fleet, from **whatever screen you're on** — see "The cross-screen escalation banner" below |
| `q` | Quit the dashboard (runs keep going) |

On the escalation screen: a letter key per option (`a` approve, `d` deny, ...,
derived from each option's first letter), `t` to type a free-text reply, `↵` to
attach instead, `esc` to go back to the fleet. A **stale** escalation — the run
that raised it has already ended or its window died — shows no answer keys at
all; nobody is waiting on it.

### Addressing a FAILED run

A FAILED row gets two extra keys beyond the generic set (`↵`/`l`/`t`/`j`/`k`)
— bound directly on the ordinary run selection, not a new focus mode: they
only apply while the fleet's plain run list has focus (not while QUEUED or
QUICK START is locally focused) and the selected row is FAILED. The FAILED
section's own footer hint (`a address`, `d done`) only appears while a
FAILED section is actually on screen.

- **`a` (address)** — opens a new tmux window in the run's existing worktree
  (recreated first if it no longer exists) running `/concertino-address-failure
  <TICKET>`, which audits the run's own event log (the same timeline the
  drill-down's TIMELINE/GATES/EVIDENCE panels already render), restores
  planning state, and resumes the ordinary Execution → Evaluation → final
  gate → Delivery → Cleanup loop to correct and finish it — reusing the
  existing executor/evaluator/skeptic machinery, not a separate, lighter
  role. It updates the *existing* row (same ticket, same event log), rather
  than creating a new one; while the redrive is in flight the row reads
  RUNNING again rather than staying stuck on a stale FAILED. **claude-code
  only** — on any other harness, `a` shows an inline notice instead of
  spawning anything.
- **`d` (done)** — a manual, dashboard-only override: "I looked into this
  myself and it's fine." Behind a `y` confirmation (naming the ticket, on
  screen, the same way force-start's own confirmation does), it moves the
  run into the DONE section. This does **not** rewrite or reinterpret the
  run's actual `run.end`/telemetry history, and does **not** write back to
  the ticket provider — it is bookkeeping for this dashboard's own bucketing
  only.

Per-pane audit (design.md Decision 6, filed alongside this pair): NEEDS
YOU's answer keys already are its section-specific action set; RUNNING's
kill/restart already live one level down, in the drill-down; DONE has no
reopen/requeue action today — considered and explicitly deferred, since
"reopen" would mean materially different things for an ordinarily-delivered
row versus a `d`-overridden one. None of the three needed a new top-level key
in this change.

### Bulk actions on multiple rows

FAILED and QUEUED — the two sections with their own row-level action key —
also support multi-select: `space` toggles the cursor row (FAILED) or the
QUEUED-locally-focused row into/out of that section's own multi-select set,
marked on screen with a dedicated `✓`, independent of (and shown alongside)
the ordinary `▸`/`»` cursor marker. Selection persists across `j`/`k`
movement — a row stays marked as the cursor moves away from and back to it —
until explicitly toggled again, until the section's bulk action resolves
(confirmed or cancelled), or until focus leaves that section.

With one or more rows multi-selected, that section's existing action key
(`a`/`d` for FAILED, `f` for QUEUED) applies to the **whole selection**
instead of just the cursor row, behind the same `y`/anything-else
confirmation pattern the single-row action already uses — naming the row
count (e.g. "mark 4 runs as done?"), and, for a bulk `f`, the resulting
concurrent-run count against `maxConcurrent` too. With nothing
multi-selected, `a`/`d`/`f` behave exactly as documented above — multi-select
is additive, never a replacement of the single-row path.

On `y`, each ticket is re-resolved fresh (never a value cached from before
the confirmation opened) and processed independently — one ticket's failure
(a spawn error, a ticket that already left the section between marking and
confirming) never blocks or rolls back any other ticket in the batch. The
outcome of every ticket in the batch — success or failure, with its error
text — is then shown as a per-row result list (ticket id + `✓`/`✗`), never
folded into a single rolled-up pass/fail summary, so a partial failure is
always visible per ticket. The result list stays on screen until the very
next keypress, which both dismisses it and still performs its own ordinary
action (e.g. `j` both clears the result list and moves the cursor, in the
same keypress).

## Mouse support (fleet run rows only)

CON-112: the dashboard enables SGR mouse-reporting mode (`\x1b[?1000h` +
`\x1b[?1006h`) whenever it enters raw-mode input, on a terminal that supports
it, and cleanly disables it (`\x1b[?1000l` + `\x1b[?1006l`) on every exit
path — quit (`q`/Ctrl-C), an uncaught crash, and both directions of
suspending the terminal for a tmux attach — mirroring the same
enable-once/matching-disable-on-every-exit discipline the alternate-screen
buffer already follows. No terminal mouse-reporting state is left enabled
after the dashboard has released the terminal, including after a crash: a
top-level exception handler restores the full terminal (raw mode, alternate
screen, mouse reporting, cursor) before the error is surfaced and the process
exits.

**Scope for this first pass, deliberately narrow:**

- Only the **fleet view's own run-row list** (NEEDS YOU/FAILED/RUNNING/DONE)
  supports clicking — no other screen (drill-down, launch pad, settings,
  sessions, escalation, ticket views, ...), and, on the fleet screen itself,
  not the QUEUED or QUICK START sections.
- Grid mode (the wide-terminal two-column layout) is also out of scope this
  pass — a click while grid mode is on screen is a no-op, same as a click
  outside the row list in single-column mode.
- A left-click on a rendered run row **selects that row only** — exactly the
  same effect the digit-jump keys already have (`lib/ui/controllers/fleet.js`'s
  `jump` action) — it never opens the drill-down or attaches. Selecting and
  opening remain two separate steps, on the keyboard and the mouse alike.
  A click that does not land on a rendered run row (the header, the banner,
  a boxed section's own border/title, QUEUED/QUICK START, METRICS, or blank
  space) is silently ignored — no error, no action dispatched.
- No other mouse event is recognized this pass: right-click, scroll-wheel,
  drag, and a button-release are all no-ops (a release falls through to the
  ordinary keypress path, where it matches no binding and is itself a
  no-op).
- **Text-entry fields have no mouse support at all** — no click-to-focus and
  no click-to-position-cursor, anywhere (the `n`/launch-pad prompts, the
  escalation reply box, settings' own text fields, ...). If a later pass adds
  this, the decision already made for that future work is that a click would
  only focus the field, never reposition the text cursor mid-string.

**Known limitations:**

- A terminal or multiplexer that does not support SGR mouse mode (`?1006`)
  sends legacy X10 coordinates instead, which this dashboard's click parser
  does not match — clicks are silently ignored there; nothing crashes and no
  garbled input reaches the keypress handler.
- **tmux mouse-mode interaction is unverified.** This dashboard enables its
  own SGR mouse reporting unconditionally, including while attached inside a
  `tmux attach` pass-through session. Whether tmux's own mouse mode ever
  swallows or double-delivers those sequences in that configuration has not
  been verified across this project's target terminals — treat mouse support
  as unverified under `tmux attach` until a follow-up ticket covers it.

## Starting runs

A run only appears here if it lives in the dashboard's tmux session. Launching
`/concertino-deliver` in an ordinary terminal gives you a run the dashboard
cannot see or attach to — so start runs with `n`, which opens the window inside
the session for you. If the launch fails, the prompt says so and stays open
rather than taking the dashboard down with it.

### Starting a run from an intention

`n` also accepts free text instead of a ticket id — an intention like "add a
share button to dashboards" rather than an id you already have. Submitting
free text (anything the `n` prompt does not recognise as a ticket id, with or
without a trailing `fast`/`slow`/`--agent-merge` token) opens a headless
drafting invocation: an agent turns it into a title, description and
acceptance criteria, shown on a review screen where each field is editable
(`t`/`d`/`a` to edit a field, `esc` to save a field you're editing). Confirm
(`c`) creates the ticket in the configured provider and immediately launches
the run against the real, provider-issued id — the same launch path as
typing a ticket id directly. `esc` from the review screen abandons the draft
with nothing created.

This is the dashboard's only write to the ticket provider — issue creation
only, never a status transition (the orchestrator's runs still own those).
It is only available when `ticketProvider.kind` is `linear`; any other
provider shows an inline message explaining why rather than opening the
draft flow.

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
It defaults from `harnesses` — `claude "/concertino-deliver {{TICKET}}"` when
claude-code is configured, otherwise the first configured harness's own CLI
(`codex "..."`, or `opencode --prompt "..."` — OpenCode's positional argument
is a project directory, so its prompt goes through `--prompt`) — so most
projects never set it.

A ticket labeled `harness:<value>` (see the per-ticket override in
[`config-reference.md`](config-reference.md)) launches under that harness's
CLI instead of the batch's, resolved per ticket at spawn time — unless you
set a custom `launchCommand`, which pins the command for every ticket.
Likewise a ticket labeled `provider:<value>` (`ollama`/`local` vs
`default`/`subscription`) runs against the local or hosted provider
independently of the rest of the fleet — the dashboard injects the routing
into that ticket's tmux window at spawn (see config-reference.md's
`providers` section), and the launch plan marks re-routed rows with `⇒`.

Each spawned Claude Code session is also named after the ticket it is
delivering — `claude -n "CON-79 Codex launches never receive…"` — so a fleet
is legible in [Remote Control](https://code.claude.com/docs/en/remote-control),
where every session otherwise registers as `<hostname>-graceful-unicorn` or a
summary of its first prompt. The name is applied per ticket at spawn time, so
one queue's shared launch command still covers every row. Codex exposes
`--name` only for its `remote-control` server mode and OpenCode has no
equivalent, so this is claude-code-only by necessity; a `launchCommand` that
already sets `-n`/`--name` is left alone.

`escalationTimeoutMinutes` bounds how long `emit-event.sh --await` blocks before
giving up and letting the orchestrator fall back to presenting the escalation in
chat. `concertino sync` renders it into `CONCERTINO_ESCALATION_TIMEOUT_MIN` in
`.concertino.env`. The default is deliberately short (**8 minutes**, not the
hour it might sound like it should be): `--await` runs inside a single harness
command call, and Claude Code caps a Bash call at roughly 10 minutes — a longer
timeout risks the harness killing the wait before `--await` gets to log
`escalation.timeout` and return control cleanly. Lower it further for a fleet
you expect to check in on constantly; there is little reason to raise it.

`reapDeliveredAfterMinutes` bounds how long a **delivered** run's tmux window
stays open after it finishes. A harness returns to its prompt rather than
exiting when the workflow ends, so a clean delivery leaves an idle session
holding a process, a window, and — if you run Claude Code with Remote Control
enabled for all sessions — a registration that keeps the finished run visible
on your phone indefinitely. The dashboard captures the full scrollback (to
`.concertino/runs/<TICKET>/session-scrollback.txt`, same as for a dead window)
and then closes it. The default is **10 minutes**; `0` disables this and closes
only windows that are already dead. A run still waiting on an escalation is
never closed regardless of age — `cleanup.sh` emits `run.end` mid-Phase-4 and
the orchestrator can raise a question afterwards, and killing a session waiting
on a human is worse than leaving it open.

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

The launch plan also binds `h` to cycle the harness (only shown/bound when
the project has more than one configured), `m` to cycle agent-merge on/off
(only when it's editable for this batch), `s` to cycle the speed (always
available — every project has at least the `default` speed), and `n` to
toggle the batch between starting immediately and being held for a later,
separate confirm from the fleet view. `esc` cancels the plan without
launching anything.

`p` cycles the batch's provider between subscription and local, whenever
`providers.ollama` is configured — the header's `models` row re-resolves as
you cycle, so the local model ids you are about to launch on are visible
before anything starts, and the `each runs:` line shows the flags that
produce them.

`w` applies the next saved **preset** — a named harness/speed/provider/
agent-merge combination, created and managed on the settings screen's
PRESETS view (see below) — to the current batch in one keystroke, cycling
through every saved preset (wrapping) on repeated presses. Every dimension
the preset carries is *set*, not cycled, in one shot: harness, then
agent-merge, then speed, then provider, exactly as if `h`/`m`/`s`/`p` had
been pressed individually for each — and the header's `models` row and
`each runs:` line update once, at the end, the same way they already do
after any single cycle. A dimension the preset doesn't specify, or can't
reach for this project/batch (a harness this project no longer configures,
a provider not configured, or the batch running under a
`dashboard.launchCommand` override), is left unchanged rather than erroring
— the identical graceful-skip behaviour `h`/`p` already have for an
unreachable choice. The `preset` row (next to `provider` in the header)
names the last-applied preset, or explains why `w` isn't doing anything yet
(`no presets saved` when none exist, `none applied` when they do but `w`
hasn't been pressed this session). `w` is unbound and un-hinted whenever no
presets are saved, mirroring how `h` disappears when only one harness is
configured.

On top of those batch-level knobs sits the per-row layer: `j`/`k` (or the
arrows) move a `▸` row cursor, and the capitalised keys override just that
row — `H` cycles its harness, `S` its speed, `P` its provider
(local/subscription, only where the `providers` config makes the flip
possible — see [`config-reference.md`](config-reference.md)). Overridden
rows annotate their effective choice as `⇒ codex·fast·ollama`-style
markers, the same notation `harness:`/`provider:` ticket labels get, and
label-derived values show up the same way (an explicit row choice wins over
a label). Confirming bakes each overridden row's exact launch command and
per-window environment into the queue record, so the choices survive a
dashboard restart along with the queue itself.

This section documents the on-disk cache underneath all of that, so the cache
file is not a mystery if you find one on disk.

```
.concertino/cache/
  tickets.json    { fetchedAt, tickets: [...], epics: [...] }
  presets.json    { presets: [ { id, name, harness, speed, provider,
                                  agentMerge, createdAt, updatedAt } ] }
```

`presets.json` holds the named batch-level presets `w` applies and the
PRESETS screen manages — a sibling of `tickets.json`, written the same
temp-file-and-rename way. `harness` is a canonical harness id (`claude-code`
/ `codex` / `opencode`) or `null` ("don't touch the batch's harness");
`speed` is `default`/`fast`/`slow`; `provider` is `null`/`ollama`/`default`.
A missing file, malformed JSON, or an individual malformed entry all degrade
to "no presets" (or "one fewer preset") rather than an error — the same
cold-cache contract every file under `.concertino/cache/` follows.

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

The gate depends on the provider. Under `ticketProvider.kind: "linear"` it is
**all three** of `dashboard.launchPad.enabled`, `kind === "linear"`, and a
non-empty `LINEAR_API_KEY`. Under `kind: "local"` it is **two** —
`dashboard.launchPad.enabled` and the kind itself; there is no API key to
check, because there is no network call. Either way the gate reports *which*
condition failed, so the UI can explain itself rather than silently hiding.
Any other kind (`github`, or a typo) fails the gate by name.

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

### Local tickets on the launch pad

`ticketProvider.kind: "local"` reads the launch pad from tracked markdown
files under `tickets/` (see config-reference.md's "Local tickets" for the file
format). Everything downstream — epics, the detail pane, `q` add-to-queue,
the queue itself — behaves exactly as it does for Linear, because a local
ticket is normalised into the same shape a Linear one is. Two things differ.

**It refreshes when you open it.** A Linear launch pad opens cold and waits
for `r`, so that opening the screen never spends a network request; the header
says `never fetched` until you ask. A directory read costs nothing, so the
local launch pad fetches for you the moment you press `N` — there is no cold
state to explain and no reason to make you press a key to see your own files.
`r` still works, and is how you pick up a ticket you just edited in another
window.

**Bad files are counted, not hidden.** A ticket file the store can't read —
malformed frontmatter, a missing `title`, an unrecognised `state`, a
frontmatter `id` disagreeing with the filename, or a filename that isn't a
valid ticket id — is skipped individually rather than blanking the board. The
launch pad then says so above the list, e.g. `2 ticket file(s) unreadable —
check frontmatter (title, state, matching id)`, and shows every ticket that
did parse. A board that silently drops two tickets reads as a complete board,
which is the failure this exists to prevent; the count is your cue to look at
`tickets/`.

`ticketProvider.teamKey` is optional under `local` — the store scans the
directory and never queries by key, so the smallest working config is just
`{"ticketProvider": {"kind": "local"}, "dashboard": {"launchPad": {"enabled":
true}}}`. Setting it (or `idExample`, which the key is guessed from) only
changes two cosmetic strings: an empty board reads `no open tickets in CON`
rather than a bare `0 open`, and the first-run hint names
`tickets/CON-1.md` rather than `tickets/TICKET-1.md`.

## The settings screen

`s` from the fleet view opens the settings screen — view and edit
`concertino.config.json` without leaving the dashboard. Two panes: SECTIONS
on the left (the schema's top-level keys, in schema-declaration order) and
that section's FIELDS on the right (each leaf field's current value, type/enum
badge, and whether it's editable), plus a full-width detail pane below showing
the selected field's description and, when one is open, its edit prompt or a
save-time validation error.

| Key | Action |
| --- | --- |
| `j`/`k` | Move the selection — the focused pane's own cursor (sections or fields) |
| `Tab` / `↵` / `l` | Move focus from SECTIONS to FIELDS |
| `Tab` / `h` | Move focus from FIELDS back to SECTIONS |
| `↵` / `space` | On an editable field: open its edit affordance — a boolean toggles immediately, an enum cycles through its allowed values, anything else opens a free-text prompt seeded with the current value. A no-op on a read-only field |
| `S` | Validate every staged edit and, only if clean, write it back to `concertino.config.json` |
| `p` | Open the **PRESETS** screen — create, rename, delete, and edit named launch presets |
| `esc` | Discard every staged edit and return to the fleet screen, without saving |

### The PRESETS screen

`p` from the settings screen opens PRESETS — where the launch plan's `w` key
(see "The launch pad" above) gets its saved combinations from. Presets are
listed one per row (name, harness, speed, provider, agent-merge columns);
`j`/`k` move a `▸` row cursor. `n` prompts for a name and appends a new
preset seeded with the project's own defaults (first configured harness,
`default` speed, no provider, the project's `agentMerge.enabled`); `r`
renames the selected preset (same prompt, seeded with its current name);
`d` opens a `y`/anything-else delete confirmation. On the selected row, `h`
cycles its harness through `none` plus the project's configured harnesses,
`s` cycles its speed (`default`/`fast`/`slow`), `p` cycles its provider
(only bound when `providers.ollama` is configured), and `m` toggles
agent-merge — the SAME keys and cycle order the launch plan's own
batch-level knobs already use, so there is nothing new to learn. `S`
validates the staged list (every preset needs a non-empty, unique name) and
writes it to `presets.json`, showing the specific problem inline and
leaving the screen open on a validation failure rather than saving anything
invalid; `esc` discards every staged change (new/renamed/deleted/edited
presets) and returns to the settings screen without touching disk.

Only `project`, `ui`, `dashboard`, `budgets`, `agentMerge`, `models`,
`modelTiers`, `speeds`, `commitTrailer`, and `worktree.ports.*` are editable
in this screen; everything else (`ticketProvider`, `specProvider`,
`harnesses`, `devServers`, `gates`, `canonicalDocs`, and the rest of
`worktree`) renders read-only regardless of its own field type — the detail
pane says so and points at `concertino update` or hand-editing the config
file directly for those. While a free-text edit prompt is open, `esc`
cancels just that prompt (not the whole screen) and `↵` commits it.

## The run-archive screen

`A` from the fleet view opens the run-archive screen — every run currently
retained under `.concertino/runs/` (bounded only by `dashboard.retentionDays`,
the same retention window the fleet view's own DONE/FAILED sections already
observe), independent of live status, not just the handful of most-recent
DONE/FAILED rows the fleet view itself shows on screen. There is no separate
read path: this is the same run set (`S.runs`) the fleet view already holds
every poll, listed and filtered a different way.

Four filter controls sit above the results list — a ticket id/title
substring, a harness selector, and a date-from/date-to pair against each
run's start time — plus the list itself: five zones in total, one of which
holds keyboard focus at a time (shown with a bold border). `Tab` moves focus
forward through QUERY → HARNESS → FROM → TO → (results list), wrapping at
both ends; `Shift-Tab` moves backward.

| Key | Action |
| --- | --- |
| `Tab` / `Shift-Tab` | Move focus forward/backward through the five zones, wrapping at both ends |
| *(QUERY focused)* type / backspace | Filter live by ticket id/title substring (case-insensitive) — empty shows every run |
| *(HARNESS focused)* `↵` / `space` | Cycle to the next harness value observed among the currently-listed runs, wrapping back to "any" (no harness filter) after the last one |
| *(FROM/TO focused)* `↵` | Open a one-line `YYYY-MM-DD` prompt seeded with that field's current value — `↵` commits it (an empty submission clears the bound), `esc` cancels the prompt only (not the whole screen), an invalid date shows a one-line error and leaves the prompt open |
| *(list focused)* `j`/`k` | Move the selection |
| *(list focused)* `↵` | Open the selected run's drill-down — the same TICKET/TIMELINE/GATES/EVIDENCE panels a live/recent run's own `l` key opens, via the identical action and run lookup |
| `esc` | Return to the fleet — no navigation stack; `esc` from a drill-down opened via the archive screen also returns straight to the fleet, not back to the archive |

All three filters (substring, harness, date range) apply simultaneously and
update the list on every change, with no separate "apply" step. A run with
no recorded start time is excluded whenever either date bound is set, and
included when neither is.
