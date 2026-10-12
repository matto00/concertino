#!/usr/bin/env bash
set -uo pipefail

# ===========================================================================
# stop-servers.sh — canonical dev-server teardown, the counterpart to
# start-servers.sh. The ONLY sanctioned way for an agent to stop this run's
# dev servers.
#
# Usage: stop-servers.sh <WORKTREE_PATH> <DEV_PORT> <BACKEND_PORT>
#
# Why this exists: start-servers.sh detaches each server (nohup ... & disown),
# so once its launching shell exits the server is re-parented to the nearest
# subreaper — on a systemd desktop that is the user's `systemd --user`
# manager. An ad-hoc "kill the listener, its parent and its grandparent" loop
# therefore SIGTERMs the user manager, which answers by starting exit.target:
# the whole graphical session is logged out and the machine sits on a dead
# console. That happened twice in one day (2026-10-12). Never walk PPid to
# find something to kill; call this script.
#
# What it signals, in order:
#   1. Each server start-servers.sh recorded (a pidfile under the worktree's
#      git admin dir). start-servers.sh launches servers under `setsid`, so a
#      recorded pid leads its own process group and the group is signalled —
#      that takes `npm run dev` and the vite child it spawned down together.
#   2. Whatever still LISTENS on DEV_PORT / BACKEND_PORT (servers started by
#      an older start-servers.sh, or by hand). Listener pids only — never a
#      parent — and the group only when the listener leads its own group.
#   3. After CONCERTINO_STOP_TIMEOUT seconds (default 10), SIGKILL whatever
#      step 2 would still find.
#
# Every target passes is_safe_target first: never pid 1, never this script or
# any of its ancestors, never another user's process, never a process whose
# command is `systemd` (a user manager). A port of 0 or an empty port is
# skipped. Always exits 0 when the ports end up free.
#
# On success prints:  STOPPED ports=<DEV_PORT>,<BACKEND_PORT>
# On failure prints:  FAIL port <n> still bound by pid(s) <pids>  (exit 1)
# ===========================================================================

WORKTREE_PATH="${1:?usage: stop-servers.sh <WORKTREE_PATH> <DEV_PORT> <BACKEND_PORT>}"
DEV_PORT="${2:-}"
BACKEND_PORT="${3:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/lib/git-child-env.sh"
# shellcheck disable=SC1091
[ -f "${SCRIPT_DIR}/.concertino.env" ] && source "${SCRIPT_DIR}/.concertino.env"

STOP_TIMEOUT="${CONCERTINO_STOP_TIMEOUT:-10}"

# Same location start-servers.sh writes to. Kept in sync by hand — these
# procedure scripts stay standalone rather than sourcing one another.
server_pid_dir() {
  local gd
  if gd="$(git_child -C "$WORKTREE_PATH" rev-parse --absolute-git-dir 2>/dev/null)" && [ -n "$gd" ]; then
    printf '%s/concertino-servers' "$gd"
  else
    printf '%s/.concertino-servers' "$WORKTREE_PATH"
  fi
}
PID_DIR="$(server_pid_dir)"

# This script and its literal ancestor chain (self -> PPid -> ... -> 1).
ANCESTORS=" "
p="$$"
while [ -n "$p" ] && [ "$p" != "0" ]; do
  ANCESTORS="${ANCESTORS}${p} "
  [ "$p" = "1" ] && break
  p="$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')"
done
MY_UID="$(id -u)"

is_safe_target() {
  local pid="$1"
  case "$pid" in ''|*[!0-9]*) return 1 ;; esac
  [ "$pid" -gt 1 ] || return 1
  case "$ANCESTORS" in *" $pid "*) return 1 ;; esac
  kill -0 "$pid" 2>/dev/null || return 1
  local uid comm
  uid="$(ps -o uid= -p "$pid" 2>/dev/null | tr -d ' ')"
  [ "$uid" = "$MY_UID" ] || return 1
  comm="$(ps -o comm= -p "$pid" 2>/dev/null | tr -d ' ')"
  [ "$comm" = "systemd" ] && return 1
  return 0
}

pgid_of() { ps -o pgid= -p "$1" 2>/dev/null | tr -d ' '; }

# Signal a pid; signal its whole group instead when it leads its own group
# and that group is not ours.
signal_target() {
  local sig="$1" pid="$2"
  is_safe_target "$pid" || { echo "note: refusing to signal pid ${pid}" >&2; return 0; }
  local pg; pg="$(pgid_of "$pid")"
  if [ "$pg" = "$pid" ] && [ "$pg" != "$(pgid_of $$)" ]; then
    kill "-${sig}" -- "-${pid}" 2>/dev/null || true
  else
    kill "-${sig}" "$pid" 2>/dev/null || true
  fi
}

# Pids listening on a local TCP port. Duplicated from start-servers.sh's
# pids_on_local_port (CON-165): lsof first, /proc scan as the fallback.
pids_on_local_port() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -ti ":${port}" -sTCP:LISTEN 2>/dev/null | sort -u
    return 0
  fi
  local hexport; hexport="$(printf '%04X' "$port")"
  local inodes
  inodes="$(awk -v hp=":${hexport}\$" '$2 ~ hp && $4 == "0A" {print $10}' \
              /proc/net/tcp /proc/net/tcp6 2>/dev/null | sort -u)"
  [ -z "$inodes" ] && return 0
  local pid fd link ino found=""
  for pid in /proc/[0-9]*; do
    pid="${pid##*/}"
    for fd in "/proc/${pid}/fd"/*; do
      [ -e "$fd" ] || continue
      link="$(readlink "$fd" 2>/dev/null)" || continue
      case "$link" in
        socket:\[*\])
          ino="${link#socket:[}"; ino="${ino%]}"
          if printf '%s\n' "$inodes" | grep -qx "$ino"; then
            found="${found}${pid}
"
          fi
          ;;
      esac
    done
  done
  printf '%s' "$found" | sed '/^$/d' | sort -u
}

PORTS=""
for port in "$DEV_PORT" "$BACKEND_PORT"; do
  case "$port" in ''|0|*[!0-9]*) continue ;; esac
  PORTS="${PORTS} ${port}"
done

# 1. Recorded servers.
for label in backend frontend; do
  f="${PID_DIR}/${label}.pid"
  [ -f "$f" ] || continue
  signal_target TERM "$(tr -dc '0-9' < "$f")"
  rm -f "$f"
done

# 2. Remaining listeners.
for port in $PORTS; do
  for pid in $(pids_on_local_port "$port"); do
    signal_target TERM "$pid"
  done
done

# 3. Wait for the ports to free; SIGKILL stragglers at the deadline.
port_busy() {
  local port
  for port in $PORTS; do
    [ -n "$(pids_on_local_port "$port")" ] && return 0
  done
  return 1
}
deadline=$(( $(date +%s) + STOP_TIMEOUT ))
while port_busy && [ "$(date +%s)" -lt "$deadline" ]; do sleep 0.5; done
if port_busy; then
  for port in $PORTS; do
    for pid in $(pids_on_local_port "$port"); do
      signal_target KILL "$pid"
    done
  done
  sleep 1
fi

rc=0
for port in $PORTS; do
  left="$(pids_on_local_port "$port" | tr '\n' ' ')"
  if [ -n "${left// /}" ]; then
    echo "FAIL port ${port} still bound by pid(s) ${left% }" >&2
    rc=1
  fi
done
[ "$rc" -eq 0 ] && echo "STOPPED ports=$(echo $PORTS | tr ' ' ',')"
exit "$rc"
