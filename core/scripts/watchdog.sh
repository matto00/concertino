#!/usr/bin/env bash
# watchdog.sh — two-signal fleet staleness watchdog (CON-177).
#
# Rebuilt from a driving session's scratchpad at least three times
# (2026-07-20, 2026-09-08, 2026-09-10) before landing here; each rebuild
# reintroduced constraints this script now exists to preserve permanently.
#
# Usage: watchdog.sh <tasks-dir> <lanes-file>
#   <tasks-dir>  directory whose `a*.output` entries are transcripts (real
#                files or, in this repo, symlinks into subagents/agent-*.jsonl)
#                to STAT ONLY — never read for content (constraint 3).
#   <lanes-file> the watchdog's liveness input, NOT inferred from silence.
#                One "<agentId> <label>" per line = a lane currently in
#                flight. The driver owns this file: remove a line when that
#                lane completes or is deliberately parked (constraint 5).
#                Blank lines and lines starting with '#' are ignored. An
#                empty/all-ignored file means no tracked lane is live, so the
#                watchdog stands down SILENTLY — exit 0, no TRIP banner
#                (constraint 7: a run where every lane completed normally
#                must never trip; happy-path silence is not stall silence).
#
# Two signals, because one mtime is the wrong signal on its own:
#   FLEET (strong): newest mtime across ALL tasks-dir transcripts is older
#     than the fleet threshold *while lanes are still tracked live* — nothing
#     anywhere is writing even though the driver still thinks work is
#     outstanding. This is the real stall detector.
#   LANE (weak): one tracked lane's own transcript is older than the lane
#     threshold — may be parked mid-handoff, may be a child legitimately
#     still working (constraint 6: diagnose, never kill).
#
# Env overrides (constraint-testability — see test/scripts/watchdog.test.sh):
#   WATCHDOG_FLEET_SEC  fleet threshold in seconds (default 900  = 15 min)
#   WATCHDOG_LANE_SEC   lane threshold in seconds  (default 10800 = 3 h;
#                       constraint 4 — must stay >= 3h in production; only
#                       tests should lower it)
#   WATCHDOG_POLL_SEC   poll interval in seconds   (default 60)
#
# Exit codes: 0 stood down / superseded, 1 TRIP (FLEET or LANE), 2 usage error.
set -uo pipefail

if [ "$#" -lt 2 ]; then
  echo "usage: watchdog.sh <tasks-dir> <lanes-file>" >&2
  echo "  <tasks-dir>  directory of a*.output transcripts to stat (never read)" >&2
  echo "  <lanes-file> one \"<agentId> <label>\" per line for lanes in flight;" >&2
  echo "               empty/absent => stand down silently, exit 0" >&2
  exit 2
fi

TASKS="$1"
LANES="$2"

FLEET_SEC=${WATCHDOG_FLEET_SEC:-900}
LANE_SEC=${WATCHDOG_LANE_SEC:-10800}
POLL_SEC=${WATCHDOG_POLL_SEC:-60}

# Portable "mtime of a file, following symlinks" (constraint 2: tasks/ entries
# are symlinks into subagents/agent-*.jsonl — `-L` is required). GNU `stat`
# takes `-Lc %Y`; BSD/macOS `stat` takes `-Lf %m` and has no `-c`. Fall back to
# node (already a hard requirement for Concertino), mirroring the now_ms()
# GNU/BSD `date` fallback duplicated across emit-event.sh/start-servers.sh/
# assert-phase.sh/cleanup.sh — these procedure scripts stay standalone rather
# than sourcing each other.
mtime_of() {
  local f="$1" m
  m="$(stat -Lc %Y "$f" 2>/dev/null)"
  if [ -z "$m" ]; then
    m="$(stat -Lf %m "$f" 2>/dev/null)"
  fi
  if [ -z "$m" ]; then
    m="$(node -e '
      try { console.log(Math.floor(require("fs").statSync(process.argv[1]).mtimeMs / 1000)); }
      catch (e) {}
    ' "$f" 2>/dev/null)"
  fi
  printf '%s' "$m"
}

# Newest mtime across every a*.output entry in TASKS (constraint 3: stat only,
# glob expansion + stat never opens/reads the file's contents).
newest_transcript_mtime() {
  local best='' f m
  for f in "$TASKS"/a*.output; do
    [ -e "$f" ] || continue
    m="$(mtime_of "$f")"
    [ -n "$m" ] || continue
    if [ -z "$best" ] || [ "$m" -gt "$best" ]; then best="$m"; fi
  done
  printf '%s' "$best"
}

# Live lane lines: strip blanks and '#' comments (constraint 5 — the driver
# removes a lane's line to stop that lane's alerts; the file itself is the
# liveness input, never inferred from silence).
live_lanes() {
  grep -vE '^[[:space:]]*(#|$)' "$LANES" 2>/dev/null || true
}

# ---------------------------------------------------------------------------
# Singleton lockfile (constraint 1). NOT pgrep-and-kill-others — that pattern
# has matched the wrapper shell invoking this script and killed the watchdog
# before it could run (observed exit 144 in the field). A lockfile records
# only this script's own prior PID: a fresh instance signals that specific
# PID (a previous *watchdog*, never an orchestrator/executor agent) and takes
# over, and every loop iteration re-checks the lock still names this PID
# before proceeding — an instance superseded mid-sleep notices on wake and
# exits 0 quietly rather than firing alerts against a lane list it no longer
# owns. This never targets $$ itself.
LOCK_DIR="$(dirname "$LANES")"
LOCK="$LOCK_DIR/watchdog.pid"

if [ -f "$LOCK" ]; then
  old="$(cat "$LOCK" 2>/dev/null || true)"
  if [ -n "$old" ] && [ "$old" != "$$" ]; then
    kill "$old" 2>/dev/null || true
  fi
fi
echo "$$" > "$LOCK"
trap '[ "$(cat "$LOCK" 2>/dev/null)" = "$$" ] && rm -f "$LOCK"' EXIT

while :; do
  sleep "$POLL_SEC"

  # Superseded by a newer instance while asleep: stand down, don't touch the
  # lock (the newer instance owns it), don't fire.
  [ "$(cat "$LOCK" 2>/dev/null)" = "$$" ] || exit 0

  live="$(live_lanes)"
  if [ -z "$live" ]; then
    echo "STAND-DOWN: no tracked lanes in flight — nothing to watch"
    exit 0
  fi

  now=$(date +%s)
  newest="$(newest_transcript_mtime)"
  if [ -n "$newest" ] && [ $(( now - newest )) -gt "$FLEET_SEC" ]; then
    echo "TRIP FLEET: no agent transcript written in $TASKS for $(( (now - newest) / 60 )) min, but lanes are still tracked live:"
    echo "$live"
    echo "DIAGNOSE FIRST, do not kill: check workflow-state.md phase, \`git -C <worktree> log/status\`, and child process CPU vs. elapsed time before touching any agent. \`SendMessage\` reporting \"queued at next tool round\" means ALIVE and busy, not stalled."
    exit 1
  fi

  while read -r id label; do
    [ -n "$id" ] || continue
    f="$TASKS/$id.output"
    [ -e "$f" ] || continue
    m="$(mtime_of "$f")"
    [ -n "$m" ] || continue
    if [ $(( now - m )) -gt "$LANE_SEC" ]; then
      echo "TRIP LANE $label ($id): own transcript quiet for $(( (now - m) / 60 )) min — may be legitimately mid-handoff or waiting on a child."
      echo "DIAGNOSE FIRST, do not kill: this alone is not proof of a stall."
      exit 1
    fi
  done <<< "$live"
done
