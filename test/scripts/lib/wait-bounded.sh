#!/usr/bin/env bash
# CON-183: shared bounded-wait helpers for test/scripts/*.test.sh suites that
# background a real `emit-event.sh escalation --await` (or any other
# long-running script) and then need to reap it -- whether because the test
# itself killed it (TERM/INT) or because it is expected to resolve on its
# own once the test writes an answer.json.
#
# A plain `wait "$pid"` is unbounded: if the process never exits for ANY
# reason (a signal that never reaches it, a handler that wedges, a genuine
# regression in the script under test), the wait blocks the WHOLE suite
# indefinitely. This hung ~20 minutes during a cold review of PR #138 on
# 2026-09-11, with no line of emit-event.sh itself changed that review cycle
# -- a hang is worse than a failure: every caller here should fail loud and
# fast instead, never wait forever. See CON-183.
#
# Requires the sourcing script to already define `check(name, got, want)`
# (every test/scripts/*.test.sh file does, identically) -- assert_children_dead
# reports through it exactly like every other assertion in these suites.

# wait_killed_bounded <pid> <max_seconds>
#
# Polls `kill -0 <pid>` at 0.1s resolution up to <max_seconds>. If the
# process is still alive once the deadline is reached, SIGKILLs it (never
# TERM/INT again -- those are exactly what a wedged handler already failed
# to respond to) and reaps it, returning 124 (mirroring the `timeout(1)`
# convention) so a caller can tell "it finished" from "it had to be killed"
# without needing a separate check. Reaps and returns the process's own exit
# status otherwise.
wait_killed_bounded() {
  local pid="$1" max_s="$2" i
  for (( i = 0; i < max_s * 10; i++ )); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.1
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill -KILL "$pid" 2>/dev/null
    wait "$pid" 2>/dev/null
    return 124
  fi
  wait "$pid" 2>/dev/null
}

# capture_children <pid>
#
# Lists <pid>'s direct children (own-PID-only via `pgrep -P`, never
# `pgrep -f` / `pkill` by name pattern -- see await-sentinel.test.sh's header
# for why that is unsafe on a shared box). MUST be called BEFORE signalling
# or otherwise reaping <pid>: once a process is reaped, checking its
# children is vacuous by construction (a dead pid has none, and any real
# child it leaked has already reparented to init and is invisible to
# `pgrep -P` under the ORIGINAL pid) -- this is not a corner case, it is
# guaranteed, so the capture must happen while <pid> is still alive.
capture_children() {
  pgrep -P "$1" 2>/dev/null
}

# children_alive <captured-pids-from-capture_children>
#
# The one place the actual liveness check (`kill -0`, by PID) lives --
# checks each PID captured by an earlier capture_children() call directly,
# correct regardless of whether the child has since been reparented, unlike
# re-deriving children from the (by now dead) parent's PID. Prints the
# still-alive subset (empty if none), never calls check() itself, so a
# caller can use it to assert EITHER outcome ("none left" or "still
# alive") -- see emit-event.test.sh's self-test, which exercises both
# through this one function rather than a second, duplicated loop that a
# mutation to the real logic could leave accidentally green.
children_alive() {
  local captured="$1" alive="" pid
  for pid in $captured; do
    kill -0 "$pid" 2>/dev/null && alive="$alive $pid"
  done
  printf '%s' "$alive"
}

# assert_children_dead <label> <captured-pids-from-capture_children>
#
# Asserts children_alive() reports none left. Reports through the caller's
# own `check()`.
assert_children_dead() {
  local label="$1" captured="$2" alive
  alive="$(children_alive "$captured")"
  check "$label" "$([ -z "$alive" ] && echo none || echo "alive:$alive")" "none"
}
