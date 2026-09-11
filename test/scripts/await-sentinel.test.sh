#!/usr/bin/env bash
set -uo pipefail

# ===========================================================================
# await-sentinel.test.sh (CON-178) — proves await-sentinel.sh never leaves a
# process running after it returns, unlike the ad-hoc
# `until [ -f "$SENTINEL" ]; do sleep N; done` idiom it replaces.
#
# Hard rule (CON-178 sibling-bug note): every liveness check in this file
# uses a PID *this test itself spawned and recorded* via `$!` and checks
# with `kill -0 $pid` -- NEVER `pkill`/`kill` by name pattern, and NEVER
# `pgrep -f`, which can match its own (or a sibling test's) command line.
# ===========================================================================

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/core/scripts/await-sentinel.sh"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  ok   $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL $1"; echo "       $2"; }

WORKDIR="$(mktemp -d)"
# CON-178 cycle-2 review: restore-on-exit for the REAL script (Scenario 4
# below mutates it in place, never a scratch copy), and unconditionally
# reap any process this suite itself spawned and never joined -- belt and
# braces alongside each scenario's own explicit kill, so a bug in one
# scenario can never leave a straggler for the next test file to trip over.
PRISTINE_SCRIPT="$(mktemp)"
cp "$SCRIPT" "$PRISTINE_SCRIPT"
SPAWNED_PIDS=""
cleanup() {
  cp "$PRISTINE_SCRIPT" "$SCRIPT" 2>/dev/null || true
  rm -f "$PRISTINE_SCRIPT"
  for p in $SPAWNED_PIDS; do
    kill -9 "$p" 2>/dev/null || true
  done
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

pid_alive() {
  # own-PID-only liveness check (never pgrep -f / pkill by pattern).
  kill -0 "$1" 2>/dev/null
}

wait_for_death() {
  # Poll our own recorded PID up to ~5s; never a pattern match.
  local pid="$1" waited=0
  while pid_alive "$pid"; do
    if [ "$waited" -ge 50 ]; then
      return 1
    fi
    sleep 0.1
    waited=$((waited + 1))
  done
  return 0
}

# ---------------------------------------------------------------------
# Scenario 1: the OLD idiom genuinely leaks -- an unbounded
# `until [ -f "$SENTINEL" ]; do sleep 1; done` loop, backgrounded the way
# an orchestrator would, is still alive well after the moment its result
# arrived through the normal (non-sentinel) path. This is the red baseline
# proving the bug this ticket describes is real, not hypothetical.
# ---------------------------------------------------------------------
echo "Scenario 1: baseline -- the old unbounded sentinel-poll idiom leaks"

SENTINEL1="$WORKDIR/never-appears.sentinel"
( until [ -f "$SENTINEL1" ]; do sleep 1; done ) &
OLD_IDIOM_PID=$!
SPAWNED_PIDS="${SPAWNED_PIDS} ${OLD_IDIOM_PID}"
sleep 0.3
if pid_alive "$OLD_IDIOM_PID"; then
  ok "1.1 the old unbounded poller is alive shortly after being backgrounded"
else
  bad "1.1 the old unbounded poller is alive shortly after being backgrounded" "expected pid $OLD_IDIOM_PID alive"
fi
sleep 1.5
if pid_alive "$OLD_IDIOM_PID"; then
  ok "1.2 the old unbounded poller is STILL alive after its result would normally already be known (this is the leak CON-178 reports)"
else
  bad "1.2 the old unbounded poller is STILL alive after its result would normally already be known (this is the leak CON-178 reports)" "expected pid $OLD_IDIOM_PID still alive; it exited early"
fi
# Clean up this deliberately-leaked demonstration process by its own
# recorded PID (never by pattern).
kill "$OLD_IDIOM_PID" 2>/dev/null || true
wait "$OLD_IDIOM_PID" 2>/dev/null || true

# ---------------------------------------------------------------------
# Scenario 2: await-sentinel.sh self-terminates once the sentinel appears,
# well before its timeout, leaving no process behind.
# ---------------------------------------------------------------------
echo "Scenario 2: await-sentinel.sh exits promptly once the sentinel appears"

SENTINEL2="$WORKDIR/appears-soon.sentinel"
"$SCRIPT" "$SENTINEL2" 30 1 >"$WORKDIR/out2.log" 2>&1 &
AWAIT_PID=$!
SPAWNED_PIDS="${SPAWNED_PIDS} ${AWAIT_PID}"
sleep 0.3
if pid_alive "$AWAIT_PID"; then
  ok "2.1 await-sentinel.sh is running while waiting"
else
  bad "2.1 await-sentinel.sh is running while waiting" "expected pid $AWAIT_PID alive before the sentinel exists"
fi
touch "$SENTINEL2"
if wait_for_death "$AWAIT_PID"; then
  ok "2.2 await-sentinel.sh exits on its own within ~5s of the sentinel appearing (bound was 30s)"
else
  bad "2.2 await-sentinel.sh exits on its own within ~5s of the sentinel appearing (bound was 30s)" "pid $AWAIT_PID still alive"
fi
wait "$AWAIT_PID" 2>/dev/null
RC2=$?
if [ "$RC2" -eq 0 ]; then
  ok "2.3 await-sentinel.sh exits 0 when the sentinel appeared"
else
  bad "2.3 await-sentinel.sh exits 0 when the sentinel appeared" "exit=$RC2"
fi
if pid_alive "$AWAIT_PID"; then
  bad "2.4 no process remains for this PID after the call returned" "pid $AWAIT_PID still alive"
else
  ok "2.4 no process remains for this PID after the call returned"
fi

# ---------------------------------------------------------------------
# Scenario 3: await-sentinel.sh self-terminates on timeout when the
# sentinel never appears -- it never waits unboundedly, unlike the old
# idiom demonstrated in Scenario 1.
# ---------------------------------------------------------------------
echo "Scenario 3: await-sentinel.sh times out and exits on its own -- never waits unboundedly"

SENTINEL3="$WORKDIR/never-appears-2.sentinel"
"$SCRIPT" "$SENTINEL3" 1 1 >"$WORKDIR/out3.log" 2>&1 &
TIMEOUT_PID=$!
SPAWNED_PIDS="${SPAWNED_PIDS} ${TIMEOUT_PID}"
if wait_for_death "$TIMEOUT_PID"; then
  ok "3.1 await-sentinel.sh exits on its own once TIMEOUT_SEC elapses, with no sentinel ever created"
else
  bad "3.1 await-sentinel.sh exits on its own once TIMEOUT_SEC elapses, with no sentinel ever created" "pid $TIMEOUT_PID still alive"
fi
wait "$TIMEOUT_PID" 2>/dev/null
RC3=$?
if [ "$RC3" -eq 1 ]; then
  ok "3.2 await-sentinel.sh exits 1 on timeout"
else
  bad "3.2 await-sentinel.sh exits 1 on timeout" "exit=$RC3"
fi
if grep -qF "TIMEOUT" "$WORKDIR/out3.log"; then
  ok "3.3 timeout is reported explicitly, not silently"
else
  bad "3.3 timeout is reported explicitly, not silently" "log: $(cat "$WORKDIR/out3.log")"
fi
if pid_alive "$TIMEOUT_PID"; then
  bad "3.4 no process remains for this PID after the timeout returned" "pid $TIMEOUT_PID still alive"
else
  ok "3.4 no process remains for this PID after the timeout returned"
fi

# ---------------------------------------------------------------------
# Scenario 4: mutation proof -- reintroducing the old unbounded shape
# (removing the timeout bound) makes THE REAL SHIPPED SCRIPT fail to
# self-terminate, so Scenario 3 is actually exercising the timeout logic
# and not a coincidence.
#
# CON-178 cycle-2 review: an earlier draft of this scenario mutated a
# throwaway COPY of the script in a scratch dir, which proves nothing
# about the file that actually ships (a bug introduced only in the real
# file, or only in the copy, would go undetected either way). This
# version edits $SCRIPT (the real core/scripts/await-sentinel.sh) in
# place -- restored unconditionally by the file-level `trap cleanup EXIT`
# above, which runs even if this scenario's own assertions fail or the
# script exits early.
#
# It also bounds its own wait: `wait_for_death` has a hard ~5s poll cap
# (never an unbounded `wait $pid`), and the mutated process is always
# force-killed by its own recorded PID afterward -- so a mutation that
# genuinely reintroduces the unbounded-wait bug cannot hang this test (or
# CI) even transiently; SPAWNED_PIDS also carries it into the file-level
# cleanup trap as a second line of defense.
# ---------------------------------------------------------------------
echo "Scenario 4: mutation proof -- an unbounded variant of the REAL script does not self-terminate"

python3 - "$SCRIPT" <<'PYEOF'
import sys
path = sys.argv[1]
with open(path) as f:
    text = f.read()
old = (
    'ELAPSED=0\n'
    'while [ ! -f "$SENTINEL" ]; do\n'
    '  if [ "$ELAPSED" -ge "$TIMEOUT_SEC" ]; then\n'
    '    echo "TIMEOUT waiting for sentinel: ${SENTINEL} (waited ${ELAPSED}s, bound ${TIMEOUT_SEC}s)" >&2\n'
    '    exit 1\n'
    '  fi\n'
    '  sleep "$POLL_INTERVAL_SEC"\n'
    '  ELAPSED=$((ELAPSED + POLL_INTERVAL_SEC))\n'
    'done\n'
)
new = (
    'while [ ! -f "$SENTINEL" ]; do\n'
    '  sleep "$POLL_INTERVAL_SEC"\n'
    'done\n'
)
assert old in text, "await-sentinel.sh's timeout loop shape has changed -- this mutation fixture is stale"
text = text.replace(old, new, 1)
with open(path, "w") as f:
    f.write(text)
PYEOF

SENTINEL4="$WORKDIR/never-appears-3.sentinel"
"$SCRIPT" "$SENTINEL4" 1 1 >"$WORKDIR/out4.log" 2>&1 &
MUTATED_PID=$!
SPAWNED_PIDS="${SPAWNED_PIDS} ${MUTATED_PID}"
if wait_for_death "$MUTATED_PID"; then
  bad "4.1 mutation-proof: unbounded variant of the real script does NOT self-terminate (if this passes, the timeout test above is not exercising real behavior)" "pid $MUTATED_PID exited on its own -- mutation had no effect"
else
  ok "4.1 mutation-proof: unbounded variant of the real script does NOT self-terminate without a sentinel (confirms Scenario 3 exercises real timeout logic)"
fi
# Reap by recorded PID (bounded -- never an unbounded `wait`) and restore
# the pristine script immediately, rather than relying solely on the
# file-level exit trap, so later scenarios in this same file run against
# the real, unmutated script.
kill -9 "$MUTATED_PID" 2>/dev/null || true
cp "$PRISTINE_SCRIPT" "$SCRIPT"

# ---------------------------------------------------------------------
# Scenario 5: usage errors are rejected loudly (exit 2), never silently
# treated as an unbounded wait.
# ---------------------------------------------------------------------
echo "Scenario 5: malformed TIMEOUT_SEC is a loud usage error"

OUT5="$("$SCRIPT" "$WORKDIR/x.sentinel" not-a-number 2>&1)"
RC5=$?
if [ "$RC5" -eq 2 ]; then
  ok "5.1 non-numeric TIMEOUT_SEC exits 2"
else
  bad "5.1 non-numeric TIMEOUT_SEC exits 2" "exit=$RC5 output=$OUT5"
fi

# ---------------------------------------------------------------------
# Scenario 6 (cold-review finding 6): TIMEOUT_SEC has a hard cap, so this
# script's self-termination guarantee cannot be defeated by a caller (or a
# mistake) passing an enormous bound like 86400.
# ---------------------------------------------------------------------
echo "Scenario 6: TIMEOUT_SEC is hard-capped, not merely 'a number the caller should pick sanely'"

# CON-178 cycle-2 review discipline applied to this scenario too: even
# though the cap-check itself should reject 86400 immediately, this call
# is still backgrounded and bounded via wait_for_death rather than
# captured in the foreground -- if a future mutation of the cap check
# ever let a huge TIMEOUT_SEC through, a foreground `$(...)` capture here
# would hang this test (and CI) for up to that TIMEOUT_SEC, exactly the
# failure mode finding 5 flagged for Scenario 4.
AWAIT_SENTINEL_MAX_TIMEOUT_SEC=5 "$SCRIPT" "$WORKDIR/never.sentinel" 86400 >"$WORKDIR/out6.log" 2>&1 &
CAP_PID=$!
SPAWNED_PIDS="${SPAWNED_PIDS} ${CAP_PID}"
if wait_for_death "$CAP_PID"; then
  ok "6.1a a TIMEOUT_SEC above the cap exits promptly rather than actually waiting 86400s"
else
  bad "6.1a a TIMEOUT_SEC above the cap exits promptly rather than actually waiting 86400s" "pid $CAP_PID still alive after ~5s"
  kill -9 "$CAP_PID" 2>/dev/null || true
fi
wait "$CAP_PID" 2>/dev/null
RC6=$?
if [ "$RC6" -eq 2 ] && grep -qF "exceeds the hard cap" "$WORKDIR/out6.log"; then
  ok "6.1b a TIMEOUT_SEC above the cap is refused loudly (exit 2), not silently allowed"
else
  bad "6.1b a TIMEOUT_SEC above the cap is refused loudly (exit 2), not silently allowed" "exit=$RC6 output=$(cat "$WORKDIR/out6.log")"
fi

AWAIT_SENTINEL_MAX_TIMEOUT_SEC=5 "$SCRIPT" "$WORKDIR/never.sentinel" 5 1 >"$WORKDIR/out6b.log" 2>&1 &
AT_CAP_PID=$!
SPAWNED_PIDS="${SPAWNED_PIDS} ${AT_CAP_PID}"
if wait_for_death "$AT_CAP_PID"; then
  ok "6.2a a TIMEOUT_SEC AT the cap runs to its own bounded completion (~5s), not refused"
else
  bad "6.2a a TIMEOUT_SEC AT the cap runs to its own bounded completion (~5s), not refused" "pid $AT_CAP_PID still alive"
  kill -9 "$AT_CAP_PID" 2>/dev/null || true
fi
wait "$AT_CAP_PID" 2>/dev/null
RC6B=$?
if [ "$RC6B" -eq 1 ]; then
  ok "6.2b a TIMEOUT_SEC at exactly the cap is accepted (only exceeding it is refused)"
else
  bad "6.2b a TIMEOUT_SEC at exactly the cap is accepted (only exceeding it is refused)" "exit=$RC6B output=$(cat "$WORKDIR/out6b.log")"
fi

echo ""
echo "await-sentinel.test.sh: ${PASS} passed, ${FAIL} failed"
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
