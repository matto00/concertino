#!/usr/bin/env bash
# watchdog.sh — two-signal fleet staleness watchdog (CON-177).
#
# Rebuilt from a driving session's scratchpad at least three times
# (2026-07-20, 2026-09-08, 2026-09-10) before landing here; each rebuild
# reintroduced constraints this script now exists to preserve permanently.
# A cold review pass (cycle 2) found real gaps in the first landed version —
# see the constraint-by-constraint comments below for what changed and why.
#
# Usage: watchdog.sh <tasks-dir> <lanes-file>
#   <tasks-dir>  directory whose `a*.output` entries are transcripts (real
#                files or, in this repo, symlinks into subagents/agent-*.jsonl)
#                to STAT ONLY — never read for content (constraint 3). Must
#                already exist (validated at startup, exit 2 otherwise).
#   <lanes-file> the watchdog's liveness input, NOT inferred from silence.
#                Must already exist (an empty file is fine — create one to
#                mean "no lanes yet"; a missing path is a usage error, exit
#                2, not a silent stand-down). One line per lane in flight:
#                  <agentId> <label> [<TICKET>]
#                Blank lines and lines starting with '#' are ignored. The
#                driver owns this file and should edit it atomically (write
#                to a temp file in the same directory, then `mv` over the
#                original) — a plain truncate-then-rewrite can be caught
#                mid-poll and briefly read as empty, which this script would
#                (correctly, per constraint 7) read as "no lanes live" for
#                that one poll.
#
#                The optional 3rd field is a ticket id: when present, this
#                script treats that lane as complete — no LANE trip, and it
#                doesn't count toward keeping the fleet "live" for FLEET
#                purposes — the moment
#                  <main checkout>/.concertino/runs/<TICKET>/events.jsonl
#                contains a `"kind":"run.end"` line (the same terminal-event
#                marker cleanup.sh's other_runs_live() and
#                lib/ui/retention.js's hasRunEnd() already use). This is a
#                REAL completion signal, not driver discipline: a lane whose
#                line was never removed after it actually finished is
#                detected as finished anyway, so forgetting to edit the file
#                (the exact 2026-09-10 incident) can no longer produce a
#                false FLEET trip. A line with no 3rd field falls back to
#                pure liveness-by-file-presence, as before.
#
#                All tracked lanes complete (by either removal or the
#                run.end signal) ⇒ silent stand-down, exit 0, no TRIP text
#                (constraint 7).
#
# Two signals, because one mtime is the wrong signal on its own:
#   FLEET (strong): newest mtime across ALL tasks-dir transcripts is older
#     than the fleet threshold *while at least one lane is still tracked and
#     not yet complete* — nothing anywhere is writing even though the driver
#     still thinks work is outstanding. This is the real stall detector.
#   LANE (weak): one tracked, not-yet-complete lane's own transcript is older
#     than the lane threshold — may be parked mid-handoff, may be a child
#     legitimately still working (constraint 6: diagnose, never kill).
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
  echo "  <lanes-file> one \"<agentId> <label> [<TICKET>]\" per line for lanes" >&2
  echo "               in flight; an empty file means no lanes are live" >&2
  exit 2
fi

TASKS="$1"
LANES="$2"

# Constraint 4: fail loud at startup on a bad path rather than silently
# behaving as if nothing were wrong. A missing tasks-dir would otherwise glob
# to nothing and never detect a fleet-wide stall (empty FLEET signal forever);
# a missing lanes-file would otherwise read as "no lanes" via the same
# `2>/dev/null` that legitimately tolerates an EMPTY file, silently standing
# down when the caller almost certainly passed the wrong path.
if [ ! -d "$TASKS" ]; then
  echo "usage: watchdog.sh <tasks-dir> <lanes-file>" >&2
  echo "  tasks-dir not found or not a directory: $TASKS" >&2
  exit 2
fi
if [ ! -f "$LANES" ]; then
  echo "usage: watchdog.sh <tasks-dir> <lanes-file>" >&2
  echo "  lanes-file not found: $LANES" >&2
  echo "  (create an empty file there to mean \"no lanes in flight yet\")" >&2
  exit 2
fi

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
# glob expansion + stat never opens/reads the file's contents). Deliberately
# scoped to `a*.output`, not `*.output` — other task kinds (e.g. this repo's
# own bash-task `b*.output` transcripts) must never mask a genuinely stalled
# agent fleet by looking fresh on the caller's behalf; see the "b*.output
# does not mask a stale fleet" test.
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
# liveness input, never inferred from silence). Re-read fresh on every poll,
# never cached — see the "same running process" tests, which exercise this
# within one continuous run rather than across restarts.
live_lanes() {
  grep -vE '^[[:space:]]*(#|$)' "$LANES" 2>/dev/null || true
}

# Resolve the main checkout for ticket-completion lookups (constraint 3/7's
# real completion signal). Duplicated from emit-event.sh's main_checkout()
# rather than sourced — these procedure scripts stay standalone. Returns
# non-zero when not inside a git checkout at all; callers must treat that as
# "can't tell, fall back to plain liveness-by-file-presence" rather than a
# hard error, since the watchdog must still work against a non-git tasks dir
# (e.g. in tests).
main_checkout() {
  local common
  common="$(git rev-parse --git-common-dir 2>/dev/null)" || return 1
  [ -z "$common" ] && return 1
  case "$common" in
    /*) ;;
     *) common="$(cd "$common" 2>/dev/null && pwd)" || return 1 ;;
  esac
  ( cd "$(dirname "$common")" 2>/dev/null && pwd ) || return 1
}

# A tracked lane is "complete" when its ticket's run has emitted the terminal
# `run.end` event — the same marker cleanup.sh's other_runs_live() and
# lib/ui/retention.js's hasRunEnd() already treat as authoritative. Plain
# substring grep on the raw JSONL, exactly like cleanup.sh:656-657, rather
# than parsing JSON — consistent with how the rest of this pipeline reads
# events.jsonl cheaply. No ticket field ⇒ can't ask this question ⇒ not
# complete by this signal (falls back to plain liveness-by-file-presence).
lane_is_complete() {
  local ticket="$1" root log
  [ -n "$ticket" ] || return 1
  root="$(main_checkout)" || return 1
  log="$root/.concertino/runs/$ticket/events.jsonl"
  [ -f "$log" ] || return 1
  grep -q '"kind":"run.end"' "$log" 2>/dev/null
}

# Lanes still meaningfully "live" for FLEET/stand-down purposes: every
# non-comment line minus any whose 3rd field names a ticket that has already
# emitted run.end. This is what makes constraint 7 not depend on the driver
# remembering to edit the file — a forgotten line for an actually-finished
# ticket no longer keeps the fleet "live".
effective_live_lanes() {
  local line id label ticket out=""
  while IFS=' ' read -r id label ticket; do
    [ -n "$id" ] || continue
    if [ -n "${ticket:-}" ] && lane_is_complete "$ticket"; then
      continue
    fi
    out="${out}${id} ${label} ${ticket:-}"$'\n'
  done <<< "$1"
  printf '%s' "$out"
}

# Warn once per lane id with a tracked-but-missing transcript (constraint 4)
# rather than either failing loud every poll or silently polling forever with
# no signal at all.
WARNED_MISSING=""
warn_missing_once() {
  local id="$1"
  case " $WARNED_MISSING " in
    *" $id "*) return 0 ;;
  esac
  WARNED_MISSING="$WARNED_MISSING $id"
  echo "watchdog.sh: warning: lane $id has no transcript at $TASKS/$id.output — cannot evaluate LANE staleness for it" >&2
}

# Confirm a PID recorded in the lock actually belongs to a prior watchdog.sh
# instance before ever signalling it (constraint 1 fix — cycle 2 review). A
# SIGKILLed or crashed prior instance can leave a lock recording a PID that
# has since been reused by an unrelated process (possibly a live agent); the
# earlier version of this script signalled that PID unconditionally.
# /proc/<pid>/cmdline is checked first (cheap, exact, Linux); `ps -o command=`
# is the portable fallback for platforms without /proc.
verify_watchdog_pid() {
  local pid="$1" cmdline=""
  if [ -r "/proc/$pid/cmdline" ]; then
    cmdline="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null)"
  fi
  if [ -z "$cmdline" ]; then
    cmdline="$(ps -p "$pid" -o command= 2>/dev/null)"
  fi
  case "$cmdline" in
    *watchdog.sh*) return 0 ;;
    *) return 1 ;;
  esac
}

# ---------------------------------------------------------------------------
# Singleton lock (constraint 1 + constraint 6). A DIRECTORY, not a plain file:
# `mkdir` is atomic on every POSIX filesystem, which is what closes the
# lock-handoff race a plain file can't. The earlier version compared a lock
# FILE's contents with a separate `cat` then a separate `rm` — two operations
# with a window between them where a brand-new instance could write its own
# PID into the file after the old instance's `cat` had already read "yes,
# that's me" but before its `rm` ran, so the old instance's cleanup deleted
# the NEW instance's lock and left nothing running. `mkdir`/`rmdir` have no
# such window: only whichever instance's `mkdir` actually succeeded may ever
# write the PID file inside, and only that same instance's cleanup path can
# ever see itself named at the moment it checks.
#
# NOT pgrep-and-kill-others — that pattern has matched the wrapper shell
# invoking this script and killed the watchdog before it could run (observed
# exit 144 in the field). This never targets $$ itself, and — per constraint
# 1's cycle-2 fix — never signals a PID it hasn't confirmed is actually a
# watchdog.sh process.
LOCK_DIR="$(dirname "$LANES")"
LOCKDIR="$LOCK_DIR/watchdog.pid.d"

acquire_lock() {
  local old attempts=0
  while :; do
    if mkdir "$LOCKDIR" 2>/dev/null; then
      echo "$$" > "$LOCKDIR/pid"
      return 0
    fi
    old="$(cat "$LOCKDIR/pid" 2>/dev/null)"
    if [ -n "$old" ] && [ "$old" != "$$" ] && kill -0 "$old" 2>/dev/null; then
      if verify_watchdog_pid "$old"; then
        # Confirmed: a live, genuine prior watchdog instance. Supersede it —
        # signal it, then loop back around to retry mkdir once it exits and
        # its own EXIT trap cleans up the directory.
        kill "$old" 2>/dev/null || true
        sleep 0.1
        continue
      fi
      # Alive, but not a watchdog.sh process: constraint 1 — never signal an
      # unverified PID. The lock itself is still stale (its owner is not us
      # and is not a watchdog we should wait on), so reclaim the directory
      # without touching that process at all.
      echo "watchdog.sh: warning: lock at $LOCKDIR names pid $old, which is not a watchdog.sh process — reclaiming the lock without signalling it" >&2
      rm -rf "$LOCKDIR" 2>/dev/null
      continue
    fi
    # Dead PID, empty/unreadable pid file, or (rarely) a same-tick race —
    # reclaim.
    rm -rf "$LOCKDIR" 2>/dev/null
    attempts=$((attempts + 1))
    if [ "$attempts" -gt 200 ]; then
      echo "watchdog.sh: FAIL: could not acquire lock at $LOCKDIR after $attempts attempts" >&2
      exit 1
    fi
  done
}

release_lock() {
  local owner
  owner="$(cat "$LOCKDIR/pid" 2>/dev/null)"
  [ "$owner" = "$$" ] && rm -rf "$LOCKDIR" 2>/dev/null
  return 0
}

acquire_lock
trap release_lock EXIT

# Constraint 5 (cycle-2 fix): a superseded instance used to receive the
# default TERM from acquire_lock's `kill "$old"` while blocked in `sleep`,
# which propagates as the shell's exit code 143 — the coordinating process
# that spawned it then sees a nonzero exit from perfectly normal, expected
# supersession and treats routine hand-off as a failure. Backgrounding the
# sleep and trapping TERM explicitly lets a superseded instance clean up its
# own sleep child and exit 0 quietly instead.
SLEEP_PID=""
on_term() {
  trap - TERM
  [ -n "$SLEEP_PID" ] && kill "$SLEEP_PID" 2>/dev/null
  exit 0
}
trap on_term TERM

while :; do
  sleep "$POLL_SEC" &
  SLEEP_PID=$!
  wait "$SLEEP_PID" 2>/dev/null
  SLEEP_PID=""

  # Superseded by a newer instance while asleep: stand down, don't touch the
  # lock (the newer instance owns it), don't fire. (Belt-and-suspenders next
  # to the TERM trap above — covers a supersession that lands between polls
  # rather than during the sleep itself.)
  owner="$(cat "$LOCKDIR/pid" 2>/dev/null)"
  [ "$owner" = "$$" ] || exit 0

  raw_live="$(live_lanes)"
  if [ -z "$raw_live" ]; then
    echo "STAND-DOWN: no tracked lanes in flight — nothing to watch"
    exit 0
  fi

  live="$(effective_live_lanes "$raw_live")"
  live="$(printf '%s' "$live" | grep -vE '^[[:space:]]*$' || true)"
  if [ -z "$live" ]; then
    echo "STAND-DOWN: every tracked lane has completed (run.end observed) — nothing to watch"
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

  while IFS=' ' read -r id label ticket; do
    [ -n "$id" ] || continue
    f="$TASKS/$id.output"
    if [ ! -e "$f" ]; then
      warn_missing_once "$id"
      continue
    fi
    m="$(mtime_of "$f")"
    [ -n "$m" ] || continue
    if [ $(( now - m )) -gt "$LANE_SEC" ]; then
      echo "TRIP LANE $label ($id): own transcript quiet for $(( (now - m) / 60 )) min — may be legitimately mid-handoff or waiting on a child."
      echo "DIAGNOSE FIRST, do not kill: this alone is not proof of a stall."
      exit 1
    fi
  done <<< "$live"
done
