#!/usr/bin/env bash
# Shell tests for scripts/concertino/tui-attached.sh (CON-126 gate-escalation-
# on-tui-liveness): the single authority answering "is a Concertino TUI
# attached to this repo right now?" — reusing lib/ui/watch-lock.js's PID-
# liveness pidfile contract rather than a heartbeat.
#
# All lockfile/repo state is a throwaway scratch repo, never this checkout's
# own — mirrors check-agent-merge-permission.test.sh's `new_repo`-style
# isolation and its `ok/bad/check/has` helper shape.
set -uo pipefail

export NO_COLOR=1
unset FORCE_COLOR

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/core/scripts/tui-attached.sh"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL $1"; echo "       $2"; }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected [$3] got [$2]"; fi; }

echo "tui-attached.sh (CON-126 gate-escalation-on-tui-liveness)"

new_repo() {
  local d; d="$(mktemp -d)"
  git -C "$d" init -q -b main
  git -C "$d" -c user.email=t@t.test -c user.name=t commit -q --allow-empty -m init
  printf '%s' "$d"
}

lock_path() {
  # $1 = repo
  printf '%s' "$1/.concertino/cache/watch.lock"
}

write_lock() {
  # $1 = repo, $2 = raw JSON body written verbatim to the lockfile
  local repo="$1"; shift
  mkdir -p "$repo/.concertino/cache"
  printf '%s' "$1" > "$(lock_path "$repo")"
}

run_check() {
  # $1 = repo path ; result on stdout, stderr captured to $ERR
  ERR="$(mktemp)"
  OUT="$(cd "$1" && "$SCRIPT" 2>"$ERR")"
  RC=$?
}

start_live_proc() {
  # Starts a real long-lived background process this test owns, so its pid
  # is guaranteed live (and killable) for the duration of the test.
  sleep 60 &
  LIVE_PID=$!
}

# --- live pid, owned by us: attached -----------------------------------------
REPO="$(new_repo)"
start_live_proc
write_lock "$REPO" "$(printf '{"pid":%d}' "$LIVE_PID")"
run_check "$REPO"
check "1.1 live owned pid: exits zero (attached)" "$RC" "0"
kill "$LIVE_PID" 2>/dev/null; wait "$LIVE_PID" 2>/dev/null
rm -rf "$REPO" "$ERR"

# --- missing lockfile: not attached ------------------------------------------
REPO="$(new_repo)"
run_check "$REPO"
check "2.1 missing lockfile: fails (not attached)" "$([ "$RC" -ne 0 ] && echo nonzero || echo zero)" "nonzero"
rm -rf "$REPO" "$ERR"

# --- dead pid: not attached ---------------------------------------------------
REPO="$(new_repo)"
# A pid essentially guaranteed not to be alive: start and immediately reap a
# short-lived subprocess, then reuse its now-dead pid.
sh -c 'exit 0' &
DEAD_PID=$!
wait "$DEAD_PID" 2>/dev/null
write_lock "$REPO" "$(printf '{"pid":%d}' "$DEAD_PID")"
run_check "$REPO"
check "3.1 dead pid: fails (not attached)" "$([ "$RC" -ne 0 ] && echo nonzero || echo zero)" "nonzero"
rm -rf "$REPO" "$ERR"

# --- torn/unparsable JSON: treated as absent ---------------------------------
REPO="$(new_repo)"
write_lock "$REPO" 'not valid json at all {'
run_check "$REPO"
check "4.1 torn JSON: fails (not attached)" "$([ "$RC" -ne 0 ] && echo nonzero || echo zero)" "nonzero"
rm -rf "$REPO" "$ERR"

# --- missing numeric pid field: treated as absent ----------------------------
REPO="$(new_repo)"
write_lock "$REPO" '{"startedAt":123}'
run_check "$REPO"
check "5.1 no pid field: fails (not attached)" "$([ "$RC" -ne 0 ] && echo nonzero || echo zero)" "nonzero"
rm -rf "$REPO" "$ERR"

REPO="$(new_repo)"
write_lock "$REPO" '{"pid":"not-a-number"}'
run_check "$REPO"
check "5.2 pid field not a number: fails (not attached)" "$([ "$RC" -ne 0 ] && echo nonzero || echo zero)" "nonzero"
rm -rf "$REPO" "$ERR"

# --- EPERM-owned-but-live pid: attached (matches pidAlive()'s own contract) --
# pid 1 (init/systemd) always exists and, run as a non-root user, always
# yields EPERM on signal-0 — pidAlive()'s own documented "exists, not ours"
# case, distinct from bash's builtin `kill -0`, which exits non-zero on
# EPERM (measured in design-gate round 1, CR4).
if [ "$(id -u)" -ne 0 ]; then
  REPO="$(new_repo)"
  write_lock "$REPO" '{"pid":1}'
  run_check "$REPO"
  check "6.1 EPERM-owned live pid 1: exits zero (attached)" "$RC" "0"
  rm -rf "$REPO" "$ERR"
else
  ok "6.1 EPERM-owned live pid 1: skipped (running as root, EPERM cannot occur)"
fi

# --- not a git repo: main checkout cannot be resolved, treated as absent ----
NOTAREPO="$(mktemp -d)"
run_check "$NOTAREPO"
check "7.1 not a git repo: fails (not attached)" "$([ "$RC" -ne 0 ] && echo nonzero || echo zero)" "nonzero"
rm -rf "$NOTAREPO" "$ERR"

# --- invoked from a worktree: resolves the MAIN checkout's lockfile --------
# The load-bearing scenario tui-attached.sh's main_checkout() exists for: a
# dashboard attached against the main checkout must still read as attached
# from a delivery run executing inside a worktree.
REPO="$(new_repo)"
start_live_proc
write_lock "$REPO" "$(printf '{"pid":%d}' "$LIVE_PID")"
WT="$(mktemp -d)"
rmdir "$WT"
git -C "$REPO" worktree add -q -b tui-attached-check-branch "$WT" >/dev/null 2>&1
run_check "$WT"
check "8.1 checked from a worktree, main checkout's live lock: attached" "$RC" "0"
kill "$LIVE_PID" 2>/dev/null; wait "$LIVE_PID" 2>/dev/null
git -C "$REPO" worktree remove -f "$WT" >/dev/null 2>&1
rm -rf "$REPO" "$WT" "$ERR" 2>/dev/null

# --- red-before-green mutation check -----------------------------------------
# Confirms the "dead pid" assertion above is actually exercising liveness
# (not vacuously true because the script never reads the pid at all): a
# mutant that skips the liveness check entirely and always exits 0 whenever
# the lockfile parses would flip test 3.1 (dead pid -> not attached) to red.
REPO="$(new_repo)"
sh -c 'exit 0' &
DEAD_PID=$!
wait "$DEAD_PID" 2>/dev/null
write_lock "$REPO" "$(printf '{"pid":%d}' "$DEAD_PID")"
MUTANT="$(mktemp)"
sed 's/process\.exit(e && e\.code === "EPERM" ? 0 : 1);/process.exit(0);/' "$SCRIPT" > "$MUTANT"
chmod +x "$MUTANT"
MUTANT_OUT="$(cd "$REPO" && "$MUTANT" 2>/dev/null)"
MUTANT_RC=$?
if [ "$MUTANT_RC" -eq 0 ]; then
  ok "9.1 mutation check: liveness-skipping mutant flips dead-pid case to attached (test 3.1 would catch it)"
else
  bad "9.1 mutation check: liveness-skipping mutant flips dead-pid case to attached (test 3.1 would catch it)" "mutant still exited non-zero — test 3.1 may not be exercising liveness"
fi
rm -f "$MUTANT"
rm -rf "$REPO" "$ERR"

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
