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
#                The optional 3rd field is a ticket id, spelled either
#                  TICKET
#                or, when this watchdog's own CWD is not (or will not stay)
#                inside the repo that ticket belongs to,
#                  TICKET@/absolute/path/to/that/repo
#                When present, this script treats that lane as complete — no
#                LANE trip, and it doesn't count toward keeping the fleet
#                "live" for FLEET purposes — the moment
#                  <repo root>/.concertino/runs/<TICKET>/events.jsonl
#                contains a run.end event with a TERMINAL status (any status
#                except "escalated" — CON-182; see run_end_is_terminal()
#                below) — the same definition cleanup.sh's other_runs_live()
#                and lib/ui/retention.js's hasRunEnd() already use; TICKET is
#                matched case-insensitively, uppercased the same way
#                emit-event.sh normalises it before writing that path). This
#                is a REAL completion signal, not driver discipline: a lane
#                whose line was never removed after it actually finished is
#                detected as finished anyway, so forgetting to edit the file
#                (the exact 2026-09-10 incident) can no longer produce a
#                false FLEET trip. A line with no 3rd field falls back to
#                pure liveness-by-file-presence, as before.
#
#                <repo root> resolution order (cycle-3 fix — the CWD-only
#                lookup silently never detected completion, and fell back to
#                a TRIP FLEET, when this watchdog was launched from outside
#                the consumer repo: a scratchpad, a driving session in a
#                DIFFERENT repo, or a worktree a later cleanup.sh deletes):
#                  1. the inline `@/abs/path` on that lane's own line, if any
#                  2. $CONCERTINO_REPO_ROOT, if set (a single default root —
#                     insufficient on its own for a driver tracking lanes
#                     across two repos at once, which is why (1) exists and
#                     always wins per-lane)
#                  3. `git rev-parse --git-common-dir` from this script's own
#                     CWD, same as emit-event.sh's main_checkout()
#                A ticket whose root can't be resolved by any of the three
#                warns once on stderr and is treated as not-yet-complete
#                (falls back to plain liveness-by-file-presence) rather than
#                silently misjudging it either way.
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

# File-marker-backed "warn once" (cycle-3-tidy fix). An in-memory
# space-separated variable is NOT enough here: lane_is_complete() is called
# from effective_live_lanes(), which the main loop invokes as
# `live="$(effective_live_lanes ...)"` — a COMMAND SUBSTITUTION, which bash
# runs in a subshell. Any variable that subshell sets is gone the instant it
# exits, so an in-memory dedup set silently reset every single poll and
# "warn once" was actually "warn every poll" for this call path (caught by
# this fix's own "warns only once despite multiple polls" test). One marker
# file per (kind, key) under the lock directory persists for the life of
# this process (and is cleaned up automatically — release_lock() removes the
# whole LOCKDIR on exit) and survives being set from inside a subshell,
# since the subshell's filesystem writes are real, not undone on exit.
warn_once() {
  local key="$1" msg="$2" marker
  marker="$LOCKDIR/.warned-$(printf '%s' "$key" | tr -c 'A-Za-z0-9_-' '_')"
  [ -e "$marker" ] && return 0
  : > "$marker" 2>/dev/null
  echo "watchdog.sh: warning: $msg" >&2
}

# Warn once per ticket whose repo root can't be resolved, or resolves to
# something that plainly isn't a Concertino checkout (cycle-3/4 fix) —
# distinct from "root is fine, run dir just doesn't exist yet", which is
# normal early in a run and must stay silent.
warn_unresolved_root_once() {
  local ticket="$1" detail="${2:-}"
  if [ -n "$detail" ]; then
    warn_once "root-$ticket" "$detail for ticket $ticket — cannot check run.end completion for it; treating it as not-yet-complete"
  else
    warn_once "root-$ticket" "could not resolve a repo root for ticket $ticket (no inline @/abs/path on its lane line, \$CONCERTINO_REPO_ROOT unset, and this process's CWD is not inside a git checkout) — cannot check run.end completion for it; treating it as not-yet-complete"
  fi
}

# CON-182: a run.end whose status is "escalated" is NOT terminal — it marks
# an orchestrator pausing on a circuit-breaker escalation, and the same run
# typically resumes once it's answered, sometimes without ever writing a new
# run.start (observed on helio HEL-1080, 2026-09-11 — see cleanup.sh's
# matching comment on last_run_end_status()/run_end_is_terminal() for the
# full incident and the shared definition of "terminal" every run.end
# consumer in this repo now applies: any status except "escalated"). As of
# this ticket, orchestrator.md no longer emits run.end for an escalation
# pause, but historic logs still contain such lines. Only the LAST run.end
# line in the log is consulted, since a resumed run could in principle write
# a second, later run.end with a terminal status.
last_run_end_status() {
  local log="$1" line status="" found=1
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      *'"kind":"run.end"'*)
        found=0
        status="$(printf '%s' "$line" | sed -n 's/.*"status":"\([^"]*\)".*/\1/p')"
        ;;
    esac
  done < "$log"
  [ "$found" -eq 0 ] || return 1
  printf '%s' "$status"
  return 0
}

# True iff $1's log has a run.end AND its last one is terminal (see
# last_run_end_status() above for what "terminal" means here).
run_end_is_terminal() {
  local log="$1" status
  status="$(last_run_end_status "$log")" || return 1
  [ "$status" != "escalated" ]
}

# A tracked lane is "complete" when its ticket's run has emitted a TERMINAL
# `run.end` event — the same marker cleanup.sh's other_runs_live() and
# lib/ui/retention.js's hasRunEnd() already treat as authoritative.
#
# $1 is the raw 3rd field from a lane's line: `TICKET` or `TICKET@/abs/root`
# (cycle-3 fix — see the header comment's "repo root resolution order").
# Empty ⇒ can't ask this question ⇒ not complete by this signal (falls back
# to plain liveness-by-file-presence).
lane_is_complete() {
  local field="$1" ticket root log
  [ -n "$field" ] || return 1
  case "$field" in
    *@*) ticket="${field%%@*}"; root="${field#*@}" ;;
    *)   ticket="$field"; root="" ;;
  esac
  # emit-event.sh:345 uppercases the ticket id before it ever becomes a
  # RUN_DIR path component — match that normalisation here too, or a
  # lowercase lane line (e.g. "con-9") would never find the run dir
  # emit-event.sh actually wrote ("CON-9").
  ticket="$(printf '%s' "$ticket" | tr '[:lower:]' '[:upper:]')"
  if [ -z "$root" ]; then
    root="${CONCERTINO_REPO_ROOT:-}"
  fi
  if [ -z "$root" ]; then
    root="$(main_checkout)" || { warn_unresolved_root_once "$ticket"; return 1; }
  fi
  # A resolved-but-wrong root (a mistyped `@/abs/path`, or a
  # $CONCERTINO_REPO_ROOT that no longer exists) is a distinct failure mode
  # from "root is fine, this run just hasn't started yet" — the latter is
  # normal and silent, the former means completion can never be detected for
  # this lane and the operator should hear about it once. `.concertino/`
  # itself (not just `.concertino/runs/`) is the check, so a root that is a
  # real, unrelated directory still warns rather than reading as merely
  # run-not-started-yet.
  if [ ! -d "$root/.concertino" ]; then
    warn_unresolved_root_once "$ticket" "resolved repo root '$root' does not exist or has no .concertino/ directory"
    return 1
  fi
  log="$root/.concertino/runs/$ticket/events.jsonl"
  # No run dir yet (but a genuine .concertino/ root) is a normal, silent
  # "not complete" (early in a run) — only an unresolvable/wrong ROOT
  # (above) warns.
  [ -f "$log" ] || return 1
  run_end_is_terminal "$log"
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
# no signal at all. File-marker-backed (see warn_once() above) for the same
# subshell-safety reason, even though THIS call site happens to run in the
# main loop's own process today — a future refactor that moved it behind a
# command substitution would otherwise silently reintroduce the same
# warn-every-poll bug lane_is_complete()'s callers already hit.
warn_missing_once() {
  local id="$1"
  warn_once "missing-$id" "lane $id has no transcript at $TASKS/$id.output — cannot evaluate LANE staleness for it"
}

# This script's own resolved absolute path, used by verify_watchdog_pid()
# below. Resolved once at startup rather than matching any cmdline that
# merely mentions "watchdog.sh" as a substring (cycle-3 fix — a same-named
# but unrelated script, or a shell history entry mentioning this file, would
# otherwise also pass identity verification).
resolve_self_path() {
  if command -v realpath >/dev/null 2>&1; then
    realpath "$0" 2>/dev/null && return
  fi
  if command -v readlink >/dev/null 2>&1; then
    readlink -f "$0" 2>/dev/null && return
  fi
  ( cd "$(dirname "$0")" 2>/dev/null && printf '%s/%s' "$(pwd)" "$(basename "$0")" )
}
SELF_PATH="$(resolve_self_path)"

# Confirm a PID recorded in the lock actually belongs to a prior instance of
# THIS script before ever signalling it (constraint 1 fix — cycle 2 review).
# A SIGKILLed or crashed prior instance can leave a lock recording a PID that
# has since been reused by an unrelated process (possibly a live agent); the
# earlier version of this script signalled that PID unconditionally.
# /proc/<pid>/cmdline is checked first (cheap, exact, Linux); `ps -o command=`
# is the portable fallback for platforms without /proc.
verify_watchdog_pid() {
  local pid="$1" cmdline="" cwd="" tok abs
  if [ -r "/proc/$pid/cmdline" ]; then
    cmdline="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null)"
  fi
  if [ -z "$cmdline" ]; then
    cmdline="$(ps -p "$pid" -o command= 2>/dev/null)"
  fi
  if [ -z "$SELF_PATH" ] || [ -z "$cmdline" ]; then
    return 1
  fi
  case "$cmdline" in
    *"$SELF_PATH"*) return 0 ;;
  esac
  # cycle-3-tidy fix: a genuine prior instance launched by a RELATIVE path
  # (`./watchdog.sh`, `scripts/concertino/watchdog.sh`) has a cmdline entry
  # that is relative to THAT process's own cwd, not this one's — the bare
  # substring compare above then falsely reports "not a watchdog.sh
  # process" for a perfectly real prior instance. Resolve each cmdline token
  # against /proc/<pid>/cwd before giving up. Best-effort: only Linux has
  # /proc/<pid>/cwd; a platform without it (already outside /proc/<pid>/cmdline
  # above, so already on the `ps` fallback) simply can't recover a relative
  # path and returns not-verified, same as before this fix.
  if [ -r "/proc/$pid/cwd" ]; then
    cwd="$(readlink "/proc/$pid/cwd" 2>/dev/null)"
  fi
  [ -n "$cwd" ] || return 1
  for tok in $cmdline; do
    case "$tok" in
      /*) abs="$tok" ;;
      *)  abs="$cwd/$tok" ;;
    esac
    abs="$(cd "$(dirname "$abs")" 2>/dev/null && printf '%s/%s' "$(pwd)" "$(basename "$abs")" 2>/dev/null)"
    [ -n "$abs" ] && [ "$abs" = "$SELF_PATH" ] && return 0
  done
  return 1
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
  local old attempts=0 kill_attempts=0
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
        # its own EXIT trap cleans up the directory. Capped (cycle-3 fix):
        # a wedged prior instance that never honours TERM must not spin this
        # loop forever re-sending it.
        kill_attempts=$((kill_attempts + 1))
        if [ "$kill_attempts" -gt 50 ]; then
          echo "watchdog.sh: FAIL: prior watchdog instance (pid $old) did not exit after $kill_attempts TERM signals — giving up rather than retrying forever" >&2
          exit 2
        fi
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
