# CON-78: Track every harness session, not just concertino runs — a sessions view for claude/codex/opencode/hermes/…

## Description

The dashboard models exactly one thing: a Concertino delivery run, identified by a ticket id, evidenced by `.concertino/runs/<TICKET>/events.jsonl`. Anything else an agent harness is doing on this machine is invisible to it — including a plain `claude`/`codex`/`opencode` session in another terminal, and including a Concertino launch that never got as far as reporting (CON-77).

That is a narrower model than how these tools are actually used. A working session usually has several harness processes alive at once: a couple of Concertino runs, an interactive Claude Code window, a Codex session someone is poking at by hand. Only the first category is visible, so "what is running right now, and what is it costing me" cannot be answered from the dashboard — which is the question the fleet view otherwise exists to answer.

Prompted directly by the CON-77 incident: with no session-level view, a launched-but-not-reporting run is indistinguishable from a launch that never happened.

## Scope

A **sessions** view — a second, lower-level lens beside the run-centric fleet:

* Enumerate live harness processes for every configured harness (`harnesses`), plus any others worth recognising (`hermes`, `copilot`, `qwen`, … — Ollama's own launcher already enumerates a useful set, see `ollama launch --help`).
* Per session, show what can be established cheaply and truthfully: harness + version, working directory / repo, model where discoverable, tmux window (when it is in one), age, and whether it is attached to a Concertino run or is freelance.
* Both directions must be covered: a Concertino run whose window exists but has no telemetry (CON-77), and a harness session Concertino never launched at all.
* Attach/kill from this view, reusing the drill-down's existing control plane, so a stray session is actionable and not just observable.

## Discovery — the hard part, and the part to design first

Concertino currently knows only about windows in its own tmux session. Sessions started elsewhere need a different source. Worth evaluating, cheapest first:

* Process enumeration (`/proc`, `pgrep`) matched against known harness binaries, with cwd from `/proc/<pid>/cwd`. No cooperation needed from the harness, works for sessions started anywhere.
* Each harness's own session state — Codex writes rollout/session files under `$CODEX_HOME`, Claude Code keeps sessions under `~/.claude/projects/`. Richer, but per-harness and version-fragile.
* tmux-wide enumeration (all sessions, not just `concertino`), which catches the common "I ran it in another window" case for free.

Process enumeration is likely the right v1: one mechanism, no per-harness coupling, and it degrades to "we can see it exists" rather than nothing.

## Explicit non-goals

* Not a cost/usage tracker — that is CON-61.
* Not remote/multi-machine.
* Not reconstructing conversation content from another harness's session files; visibility only.

## Acceptance criteria

* A harness session started outside Concertino appears in the sessions view with its harness, cwd and age.
* A Concertino-launched window with no telemetry appears, and is labelled as belonging to its ticket.
* The view distinguishes Concertino-managed sessions from freelance ones.
* Discovery is best-effort and never blocks or slows the poll loop when a source is unavailable.
