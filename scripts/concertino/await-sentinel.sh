#!/usr/bin/env bash
set -uo pipefail

# ===========================================================================
# await-sentinel.sh (CON-178) — bounded, self-terminating poll for a
# sentinel file, replacing the ad-hoc `until [ -f "$SENTINEL" ]; do sleep N;
# done` loop orchestrators previously improvised (and backgrounded) whenever
# their harness could not block inline on a spawned sub-agent.
#
# The incident this fixes: a sub-agent's result normally arrives through the
# ordinary blocking spawn/resume call returning (see core/roles/orchestrator
# .md's "Harness resume model"), NOT through the sentinel file. So once that
# call returned, the backgrounded poller kept sleeping on a file that would
# never appear -- for the rest of the session. One real run (HEL-533,
# 2026-09-10) leaked 18 such idle shells this way.
#
# This closes the leak by construction, not by cleanup:
#
#   1. It is a single FOREGROUND, BOUNDED call. It ALWAYS exits on its own
#      -- either the sentinel appears, or TIMEOUT_SEC elapses -- so nothing
#      is ever left running past the call returning, whether or not the
#      caller itself backgrounds the call.
#   2. The ONLY completion signal is the sentinel file's existence, checked
#      by this process alone. It never polls by process/pattern match (no
#      `pgrep -f`, no `pkill`): a `pgrep -f "<pattern>"` waiter can match
#      its own command line and deadlock waiting on itself -- exactly the
#      sibling bug CON-178 explicitly must not reintroduce.
#
# If a caller backgrounds this script anyway (e.g. because a single Bash
# tool call has a shorter timeout than the wait could take) and later
# obtains the result through the normal blocking-call path FIRST, the
# caller must kill this script's PID itself rather than let it run out its
# own timeout -- see "Harness resume model" in core/roles/orchestrator.md
# for the instruction this script exists to support. This script cannot
# detect that on its own: it has no visibility into the caller's other,
# unrelated completion path.
#
# Usage: await-sentinel.sh <SENTINEL_PATH> <TIMEOUT_SEC> [POLL_INTERVAL_SEC]
#   <SENTINEL_PATH>       file whose existence signals completion.
#   <TIMEOUT_SEC>         hard bound in seconds; on expiry this script exits
#                         1 -- it never waits unboundedly.
#   [POLL_INTERVAL_SEC]   seconds between existence checks (default: 2).
#
# Exit 0: sentinel appeared. Exit 1: timed out. Exit 2: usage error.
# ===========================================================================

SENTINEL="${1:?usage: await-sentinel.sh <SENTINEL_PATH> <TIMEOUT_SEC> [POLL_INTERVAL_SEC]}"
TIMEOUT_SEC="${2:?usage: await-sentinel.sh <SENTINEL_PATH> <TIMEOUT_SEC> [POLL_INTERVAL_SEC]}"
POLL_INTERVAL_SEC="${3:-2}"

case "$TIMEOUT_SEC" in
  ''|*[!0-9]*)
    echo "FAIL TIMEOUT_SEC must be a non-negative integer, got: ${TIMEOUT_SEC}" >&2
    exit 2
    ;;
esac
case "$POLL_INTERVAL_SEC" in
  ''|*[!0-9]*)
    echo "FAIL POLL_INTERVAL_SEC must be a non-negative integer, got: ${POLL_INTERVAL_SEC}" >&2
    exit 2
    ;;
esac
if [ "$POLL_INTERVAL_SEC" -eq 0 ]; then
  POLL_INTERVAL_SEC=1
fi

ELAPSED=0
while [ ! -f "$SENTINEL" ]; do
  if [ "$ELAPSED" -ge "$TIMEOUT_SEC" ]; then
    echo "TIMEOUT waiting for sentinel: ${SENTINEL} (waited ${ELAPSED}s, bound ${TIMEOUT_SEC}s)" >&2
    exit 1
  fi
  sleep "$POLL_INTERVAL_SEC"
  ELAPSED=$((ELAPSED + POLL_INTERVAL_SEC))
done

echo "READY sentinel present: ${SENTINEL}"
exit 0
