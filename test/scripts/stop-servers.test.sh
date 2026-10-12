#!/usr/bin/env bash
# Shell tests for core/scripts/stop-servers.sh, and the pidfile/setsid launch
# it relies on in start-servers.sh. The behaviour that matters most: it stops
# a server and that server's children, and it never signals a parent, an
# ancestor of its own, or pid 1 — a detached server's parent is the user's
# systemd --user manager, and SIGTERMing that logs the desktop session out.
# Run: bash test/scripts/stop-servers.test.sh
set -uo pipefail

# CON-181: scope every mktemp/mktemp -d call in this file to a scratch
# TMPDIR removed on exit -- see test/scripts/lib/tmp-scratch.sh.
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp-scratch.sh"
trap con181_cleanup_scratch EXIT

export NO_COLOR=1
unset FORCE_COLOR

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
START="$ROOT/core/scripts/start-servers.sh"
STOP="$ROOT/core/scripts/stop-servers.sh"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL $1"; echo "       $2"; }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected [$3] got [$2]"; fi; }
alive(){ kill -0 "$1" 2>/dev/null && echo yes || echo no; }

new_repo() {
  local d; d="$(mktemp -d)"
  git -C "$d" init -q
  git -C "$d" commit -q --allow-empty -m init
  printf '%s' "$d"
}
free_port() { echo $(( 20000 + (RANDOM % 20000) )); }
wait_http() {
  local i
  for i in $(seq 1 50); do curl -sf "http://127.0.0.1:$1/" >/dev/null 2>&1 && return 0; sleep 0.1; done
  return 1
}
LISTEN_JS='require("http").createServer((_, res) => res.end("ok")).listen(process.argv[1]);'

echo "stop-servers.sh"

# --- start-servers records a group-leading pid; stop takes down the server
# --- AND the child it spawned (the npm -> vite shape) --------------------
REPO="$(new_repo)"
WT="$REPO/HEL-1"; mkdir -p "$WT"
PORT="$(free_port)"
# A wrapper shell that spawns the listener as a child and waits on it.
cat > "$WT/serve.sh" <<EOF
#!/usr/bin/env bash
node -e '$LISTEN_JS' "\$1" &
wait
EOF
chmod +x "$WT/serve.sh"
(
  cd "$REPO" && \
  CONCERTINO_BACKEND_CWD="." \
  CONCERTINO_BACKEND_START="./serve.sh $PORT" \
  CONCERTINO_BACKEND_HEALTH="http://127.0.0.1:${PORT}/" \
  CONCERTINO_BACKEND_TIMEOUT="10" \
  "$START" "$WT" 0 0
) >/dev/null 2>&1
PIDFILE="$REPO/.git/concertino-servers/backend.pid"
check "pidfile written to the git admin dir" "$([ -s "$PIDFILE" ] && echo yes || echo no)" "yes"
check "no pidfile in the worktree"           "$(ls -A "$WT" | grep -c 'pid')" "0"
LEADER="$(tr -dc '0-9' < "$PIDFILE")"
check "recorded pid leads its own group"     "$(ps -o pgid= -p "$LEADER" | tr -d ' ')" "$LEADER"
CHILD="$(pgrep -P "$LEADER" | head -1)"
check "wrapper has a listener child"         "$([ -n "$CHILD" ] && echo yes || echo no)" "yes"
OUT="$("$STOP" "$WT" 0 "$PORT" 2>&1)"; RC=$?
sleep 0.3
check "exit 0"                               "$RC" "0"
check "prints STOPPED"                       "$OUT" "STOPPED ports=$PORT"
check "wrapper stopped"                      "$(alive "$LEADER")" "no"
check "child listener stopped"               "$(alive "$CHILD")" "no"
check "pidfile removed"                      "$([ -e "$PIDFILE" ] && echo yes || echo no)" "no"
rm -rf "$REPO"

# --- port fallback kills the listener only, never its parent ------------
REPO="$(new_repo)"
WT="$REPO/HEL-2"; mkdir -p "$WT"
PORT="$(free_port)"
# Parent keeps running in the foreground after its listener child is gone,
# standing in for the systemd --user manager an orphaned server reparents to.
bash -c "node -e '$LISTEN_JS' $PORT & sleep 30" >/dev/null 2>&1 &
PARENT=$!
wait_http "$PORT"
LISTENER="$(pgrep -P "$PARENT" node | head -1)"
OUT="$(CONCERTINO_STOP_TIMEOUT=3 "$STOP" "$WT" "$PORT" 0 2>&1)"; RC=$?
check "exit 0"                               "$RC" "0"
check "listener stopped"                     "$(alive "$LISTENER")" "no"
check "parent left alone"                    "$(alive "$PARENT")" "yes"
kill "$PARENT" 2>/dev/null; wait "$PARENT" 2>/dev/null
rm -rf "$REPO"

# --- a pidfile naming pid 1 or an ancestor is refused --------------------
REPO="$(new_repo)"
WT="$REPO/HEL-3"; mkdir -p "$WT"
mkdir -p "$REPO/.git/concertino-servers"
echo 1  > "$REPO/.git/concertino-servers/backend.pid"
echo $$ > "$REPO/.git/concertino-servers/frontend.pid"
OUT="$("$STOP" "$WT" 0 0 2>&1)"; RC=$?
check "exit 0"                               "$RC" "0"
check "refuses pid 1"                        "$(grep -c 'refusing to signal pid 1$' <<<"$OUT")" "1"
check "refuses its own ancestor"             "$(grep -c "refusing to signal pid $$\$" <<<"$OUT")" "1"
check "test shell still alive"               "$(alive $$)" "yes"
rm -rf "$REPO"

# --- nothing to stop is a clean no-op ------------------------------------
REPO="$(new_repo)"
WT="$REPO/HEL-4"; mkdir -p "$WT"
OUT="$("$STOP" "$WT" "$(free_port)" 0 2>&1)"; RC=$?
check "no-op exit 0"                         "$RC" "0"
rm -rf "$REPO"

echo
echo "stop-servers.sh: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
