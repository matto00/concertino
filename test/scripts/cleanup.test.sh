#!/usr/bin/env bash
# cleanup.sh's fast-forward step (CON-25): a clean, unambiguous fast-forward
# proceeds silently — via `git update-ref` when <base> isn't checked out
# anywhere, via `git merge --ff-only` when it is and the tree is clean.
# Anything else (a dirty tree, a diverged base) must change NOTHING and
# escalate instead. Whatever happens, `cleanup.sh --phase4` must still exit 0
# and print its normal `READY cleaned worktree=...` line — a stale base is a
# risk for the NEXT run, never a reason to leave THIS teardown incomplete.
#
# Also covers CON-64: run.end must be emitted (correctly ticket-tagged) even
# when the worktree basename is not ticket-shaped, provided the ticket ID is
# passed as the explicit 4th argument; and the basename-inference fallback
# plus emit-event.sh's loud terminal-event warning when neither resolves.
#
# And CON-66: the post-fast-forward `concertino sync` re-render is skipped
# (with a stderr note) whenever any OTHER run is live — run.start without
# run.end in its events.jsonl, this run's own ticket excluded — and proceeds
# as before when none are.
set -uo pipefail

# See escalation-loop.test.sh's identical note: some shells export
# FORCE_COLOR, which makes node wrap bare output in ANSI codes even off a TTY.
export NO_COLOR=1
unset FORCE_COLOR

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CLEANUP="$ROOT/core/scripts/cleanup.sh"
EMIT="$ROOT/core/scripts/emit-event.sh"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL $1"; echo "       $2"; }
has()  { grep -qF "$2" "$3" && ok "$1" || bad "$1" "expected to find [$2] in $3"; }
hasnt(){ grep -qF "$2" "$3" && bad "$1" "unexpectedly found [$2] in $3" || ok "$1"; }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected [$3] got [$2]"; fi; }

echo "cleanup.sh (fast-forward local main)"

write_answer() {
  # Exercises the actual writer, exactly as the dashboard (or its new banner —
  # CON-25) would after a human answers.
  node -e '
    const store = require(process.argv[1]);
    store.writeAnswer(process.argv[2], process.argv[3], process.argv[4]);
  ' "$ROOT/lib/ui/store.js" "$1" "$2" "$3"
}

wait_for_escalation() {
  local log="$1"
  for _ in $(seq 1 100); do
    [ -f "$log" ] && grep -q escalation.raised "$log" 2>/dev/null && return 0
    sleep 0.1
  done
  return 1
}

# A bare "remote" plus a "primary" checkout cloned from it, with cleanup.sh
# and emit-event.sh vendored in and COMMITTED — an uncommitted copy would
# itself register as the "dirty tree" this whole suite exercises.
new_pair() {
  local base="$1"
  local remote="$base/remote.git" primary="$base/primary"
  git init -q --bare "$remote"
  git clone -q "$remote" "$primary" 2>/dev/null
  mkdir -p "$primary/scripts/concertino/lib"
  cp "$CLEANUP" "$primary/scripts/concertino/cleanup.sh"
  cp "$EMIT" "$primary/scripts/concertino/emit-event.sh"
  cp "$ROOT/core/scripts/lib/git-child-env.sh" "$primary/scripts/concertino/lib/git-child-env.sh"
  chmod +x "$primary/scripts/concertino/"*.sh
  # .concertino/ (the run log emit-event.sh --await writes to) must be
  # gitignored here exactly as it is in the real project — otherwise the
  # escalation this suite itself raises would register as its own "dirty
  # tree", corrupting the very check under test.
  echo ".concertino/" > "$primary/.gitignore"
  echo "hello" > "$primary/file.txt"
  git -C "$primary" add -A
  git -C "$primary" -c user.email=t@t.com -c user.name=t commit -q -m init
  git -C "$primary" branch -M main
  git -C "$primary" push -q origin main
}

# A separate clone pushes one more commit to origin/main — simulating a PR
# merge that landed while the primary checkout wasn't looking.
advance_remote() {
  local remote="$1" other
  other="$(mktemp -d)"
  git clone -q "$remote" "$other" 2>/dev/null
  git -C "$other" checkout -q main
  git -C "$other" -c user.email=t@t.com -c user.name=t commit -q --allow-empty -m "merged PR"
  git -C "$other" push -q origin main
  rm -rf "$other"
}

run_cleanup() {
  # $5 (optional) = explicit TICKET_ID — CON-64's 4th positional script arg.
  # Empty exercises the pre-CON-64 basename-inference fallback.
  local primary="$1" wt="$2" out="$3" err="$4" ticket="${5:-}"
  ( cd "$primary" && bash scripts/concertino/cleanup.sh --phase4 "$wt" "" "" "$ticket" ) > "$out" 2> "$err"
}

run_end_ticket() {
  # Prints the ticket field of the run.end event in $1, if any.
  node -e '
    const fs = require("fs");
    const lines = fs.readFileSync(process.argv[1], "utf8").trim().split("\n");
    const line = lines.map(l => JSON.parse(l)).find(e => e.kind === "run.end");
    console.log(line ? `${line.ticket}/${line.status}` : "<no run.end event>");
  ' "$1" 2>/dev/null
}

# ===========================================================================
# CON-131 fixture extensions — ADDITIVE/OPT-IN ONLY. new_pair() above still
# produces exactly the same bare-remote + primary-clone shape it always has
# (no worktree, no ticket branch); the existing 11 "prints READY ..."
# assertions above depend on that default shape. These helpers are called
# explicitly, on top of a new_pair()-built base, only by the new probes
# below.
# ===========================================================================

new_worktree() {
  # Given a new_pair()-built base's primary checkout, adds a REAL linked
  # worktree checked out on a named ticket branch, with one committed,
  # clean change — the shape needed to exercise real worktree removal and
  # branch resolution/deletion at all (new_pair() itself never does this).
  # $1 = primary checkout dir, $2 = branch name, $3 = worktree path.
  local primary="$1" branch="$2" wt="$3"
  git -C "$primary" worktree add -q -b "$branch" "$wt" main
  echo "ticket change on ${branch}" >> "$wt/file.txt"
  git -C "$wt" add -A
  git -C "$wt" -c user.email=t@t.com -c user.name=t commit -q -m "ticket change on ${branch}"
}

squash_merge_into_main() {
  # Given a new_worktree() branch, squash-merges it into the base's main
  # (content-identical, commits NOT ancestors of main) and pushes — the
  # fixture shape design-gate round 1 probed by hand, made reusable. Must
  # be called from a state where $1's working tree is clean (the caller's
  # own worktree, not $primary, holds the branch's changes).
  # $1 = primary checkout dir, $2 = branch name.
  local primary="$1" branch="$2"
  git -C "$primary" checkout -q main
  git -C "$primary" merge -q --squash "$branch" >/dev/null
  git -C "$primary" -c user.email=t@t.com -c user.name=t commit -q -m "squash merge ${branch}"
  git -C "$primary" push -q origin main
}

run_cleanup_streams() {
  # Like run_cleanup, but never merges stdout/stderr — needed to assert
  # which stream RESULT lands on (task 6.1: a regression probe that merges
  # the two streams can't tell a stdout leak from a stderr print).
  local primary="$1" wt="$2" out="$3" err="$4" ticket="${5:-}"
  ( cd "$primary" && bash scripts/concertino/cleanup.sh --phase4 "$wt" "" "" "$ticket" ) > "$out" 2> "$err"
}

new_fakegit_worktree_remove_noop() {
  # A stand-in `git` first on PATH whose ONLY behavior difference from real
  # git is: `[...] worktree remove [...]` is a no-op that exits 0 without
  # actually removing anything — every other invocation delegates to real
  # git unchanged. Simulates HEL-655's own symptom (`git worktree remove`
  # returning 0 while the directory is left behind, e.g. by an immovable
  # file) without depending on filesystem-specific immutable-attribute
  # support, which this sandbox may not have. $1 = a dir to hold the fake
  # bin; prints the dir to prepend to PATH.
  local dir="$1/fakegit"
  mkdir -p "$dir"
  cat > "$dir/git" <<'EOF'
#!/usr/bin/env bash
prev=""
is_worktree_remove=0
for a in "$@"; do
  if [ "$prev" = "worktree" ] && [ "$a" = "remove" ]; then
    is_worktree_remove=1
  fi
  prev="$a"
done
if [ "$is_worktree_remove" = "1" ]; then
  exit 0
fi
exec /usr/bin/git "$@"
EOF
  chmod +x "$dir/git"
  echo "$dir"
}

# --- already current: silent no-op ------------------------------------------
BASE="$(mktemp -d)"; new_pair "$BASE"
WT="$BASE/TICK-1"
OUT="$BASE/out.txt"; ERR="$BASE/err.txt"
run_cleanup "$BASE/primary" "$WT" "$OUT" "$ERR"
check "exits 0 when already current"        "$?"   "0"
has   "prints READY when already current"   "READY cleaned worktree=" "$OUT"
hasnt "no note when already current"        "note:" "$ERR"
rm -rf "$BASE"

# --- not checked out anywhere: silent update-ref ----------------------------
BASE="$(mktemp -d)"; new_pair "$BASE"
git -C "$BASE/primary" checkout -q -b scratch
advance_remote "$BASE/remote.git"
BEFORE_MAIN="$(git -C "$BASE/primary" rev-parse refs/heads/main)"
WT="$BASE/TICK-2"
OUT="$BASE/out.txt"; ERR="$BASE/err.txt"
run_cleanup "$BASE/primary" "$WT" "$OUT" "$ERR"
RC=$?
check "exits 0 (update-ref path)" "$RC" "0"
AFTER_MAIN="$(git -C "$BASE/primary" rev-parse refs/heads/main)"
REMOTE_MAIN="$(git -C "$BASE/primary" rev-parse origin/main)"
check "local main advanced via update-ref to the fetched remote tip" "$AFTER_MAIN" "$REMOTE_MAIN"
[ "$AFTER_MAIN" != "$BEFORE_MAIN" ] && ok "local main actually moved" || bad "local main actually moved" "still $BEFORE_MAIN"
check "the checked-out branch (scratch) is untouched" "$(git -C "$BASE/primary" symbolic-ref --short HEAD)" "scratch"
has "prints READY (update-ref path)" "READY cleaned worktree=" "$OUT"
hasnt "no escalation note (update-ref path)" "note: local" "$ERR"
rm -rf "$BASE"

# --- checked out and clean: silent merge --ff-only --------------------------
BASE="$(mktemp -d)"; new_pair "$BASE"
advance_remote "$BASE/remote.git"
WT="$BASE/TICK-3"
OUT="$BASE/out.txt"; ERR="$BASE/err.txt"
run_cleanup "$BASE/primary" "$WT" "$OUT" "$ERR"
RC=$?
check "exits 0 (merge --ff-only path)" "$RC" "0"
AFTER_MAIN="$(git -C "$BASE/primary" rev-parse main)"
REMOTE_MAIN="$(git -C "$BASE/primary" rev-parse origin/main)"
check "local main fast-forwarded via merge --ff-only" "$AFTER_MAIN" "$REMOTE_MAIN"
has "prints READY (merge --ff-only path)" "READY cleaned worktree=" "$OUT"
hasnt "no escalation note (merge --ff-only path)" "note: local" "$ERR"
rm -rf "$BASE"

# --- dirty tree: escalates, changes nothing, skip leaves it untouched -------
BASE="$(mktemp -d)"; new_pair "$BASE"
advance_remote "$BASE/remote.git"
echo "uncommitted local edit" >> "$BASE/primary/file.txt"
BEFORE_MAIN="$(git -C "$BASE/primary" rev-parse main)"
WT="$BASE/TICK-4"
LOG="$BASE/primary/.concertino/runs/TICK-4/events.jsonl"
OUT="$BASE/out.txt"; ERR="$BASE/err.txt"
run_cleanup "$BASE/primary" "$WT" "$OUT" "$ERR" &
CPID=$!
wait_for_escalation "$LOG" && ok "dirty tree raises an escalation" || bad "dirty tree raises an escalation" "escalation.raised never landed"
write_answer "$BASE/primary" TICK-4 skip
wait "$CPID"; RC=$?
check "exits 0 after a dirty-tree escalation is skipped" "$RC" "0"
AFTER_MAIN="$(git -C "$BASE/primary" rev-parse main)"
check "local main is untouched (dirty tree)" "$AFTER_MAIN" "$BEFORE_MAIN"
grep -q "uncommitted local edit" "$BASE/primary/file.txt" && ok "the uncommitted edit itself is untouched" || bad "the uncommitted edit itself is untouched" "edit vanished"
has "prints READY despite a dirty-tree escalation" "READY cleaned worktree=" "$OUT"
[ -f "$LOG" ] && grep -q escalation.answered "$LOG" && ok "the answered escalation is logged" || bad "the answered escalation is logged" "no escalation.answered"
hasnt "no gate.warning on a skip (no retry attempted)" "gate.warning" "$LOG"
rm -rf "$BASE"

# --- diverged base: escalates, changes nothing -------------------------------
BASE="$(mktemp -d)"; new_pair "$BASE"
git -C "$BASE/primary" -c user.email=t@t.com -c user.name=t commit -q --allow-empty -m "a local commit origin doesn't have"
BEFORE_MAIN="$(git -C "$BASE/primary" rev-parse main)"
WT="$BASE/TICK-5"
LOG="$BASE/primary/.concertino/runs/TICK-5/events.jsonl"
OUT="$BASE/out.txt"; ERR="$BASE/err.txt"
run_cleanup "$BASE/primary" "$WT" "$OUT" "$ERR" &
CPID=$!
wait_for_escalation "$LOG" && ok "a diverged base raises an escalation" || bad "a diverged base raises an escalation" "escalation.raised never landed"
write_answer "$BASE/primary" TICK-5 skip
wait "$CPID"; RC=$?
check "exits 0 after a diverged-base escalation is skipped" "$RC" "0"
AFTER_MAIN="$(git -C "$BASE/primary" rev-parse main)"
check "local main is untouched (diverged)" "$AFTER_MAIN" "$BEFORE_MAIN"
has "prints READY despite a diverged-base escalation" "READY cleaned worktree=" "$OUT"
hasnt "no gate.warning on a diverged-base skip (no retry attempted)" "gate.warning" "$LOG"
rm -rf "$BASE"

# --- retry: a second attempt that now resolves cleanly succeeds -------------
BASE="$(mktemp -d)"; new_pair "$BASE"
advance_remote "$BASE/remote.git"
echo "uncommitted local edit" >> "$BASE/primary/file.txt"
WT="$BASE/TICK-6"
LOG="$BASE/primary/.concertino/runs/TICK-6/events.jsonl"
OUT="$BASE/out.txt"; ERR="$BASE/err.txt"
run_cleanup "$BASE/primary" "$WT" "$OUT" "$ERR" &
CPID=$!
wait_for_escalation "$LOG" && ok "retry scenario: the first attempt raises an escalation" \
  || bad "retry scenario: the first attempt raises an escalation" "escalation.raised never landed"
# The human "stashes" the offending edit out of band, then answers retry.
git -C "$BASE/primary" checkout -q -- file.txt
write_answer "$BASE/primary" TICK-6 retry
wait "$CPID"; RC=$?
check "exits 0 after a successful retry" "$RC" "0"
AFTER_MAIN="$(git -C "$BASE/primary" rev-parse main)"
REMOTE_MAIN="$(git -C "$BASE/primary" rev-parse origin/main)"
check "local main fast-forwarded on the retried attempt" "$AFTER_MAIN" "$REMOTE_MAIN"
has "prints READY after a successful retry" "READY cleaned worktree=" "$OUT"
hasnt "no 'remains behind' note after a successful retry" "remains behind" "$ERR"
hasnt "no gate.warning after a successful retry" "gate.warning" "$LOG"
rm -rf "$BASE"

# --- retry exhaustion, confirmed still-dirty: keeps "remains behind" wording -
BASE="$(mktemp -d)"; new_pair "$BASE"
advance_remote "$BASE/remote.git"
echo "uncommitted local edit" >> "$BASE/primary/file.txt"
BEFORE_MAIN="$(git -C "$BASE/primary" rev-parse main)"
WT="$BASE/TICK-7"
LOG="$BASE/primary/.concertino/runs/TICK-7/events.jsonl"
OUT="$BASE/out.txt"; ERR="$BASE/err.txt"
run_cleanup "$BASE/primary" "$WT" "$OUT" "$ERR" &
CPID=$!
wait_for_escalation "$LOG" && ok "still-dirty retry: the first attempt raises an escalation" \
  || bad "still-dirty retry: the first attempt raises an escalation" "escalation.raised never landed"
# Answer retry WITHOUT clearing the uncommitted edit — the retry itself
# completes its comparison and still finds the tree dirty.
write_answer "$BASE/primary" TICK-7 retry
wait "$CPID"; RC=$?
check "exits 0 after a still-dirty retry exhaustion" "$RC" "0"
AFTER_MAIN="$(git -C "$BASE/primary" rev-parse main)"
check "local main is untouched (still-dirty retry)" "$AFTER_MAIN" "$BEFORE_MAIN"
has "prints READY despite a still-dirty retry exhaustion" "READY cleaned worktree=" "$OUT"
has "'remains behind' note after a still-dirty retry" "remains behind" "$ERR"
hasnt "no 'could not determine' note after a still-dirty retry" "could not determine" "$ERR"
has "gate.warning event emitted after a still-dirty retry exhaustion" "gate.warning" "$LOG"
check "gate.warning gate=phase:cleanup (still-dirty retry)" \
  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse).find(e=>e.kind==="gate.warning");console.log(l.gate)' "$LOG")" \
  "phase:cleanup"
check "gate.warning resolved=false (still-dirty retry)" \
  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse).find(e=>e.kind==="gate.warning");console.log(l.resolved)' "$LOG")" \
  "false"
check "gate.warning reason names main as still behind (still-dirty retry)" \
  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse).find(e=>e.kind==="gate.warning");console.log(/remains behind/.test(l.reason))' "$LOG")" \
  "true"
check "gate.warning ticket tagged (still-dirty retry)" \
  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse).find(e=>e.kind==="gate.warning");console.log(l.ticket)' "$LOG")" \
  "TICK-7"
check "run.end still status=delivered alongside the gate.warning (still-dirty retry)" \
  "$(run_end_ticket "$LOG")" "TICK-7/delivered"
rm -rf "$BASE"

# --- retry exhaustion, retry's own fetch fails: reports unknown state -------
BASE="$(mktemp -d)"; new_pair "$BASE"
advance_remote "$BASE/remote.git"
echo "uncommitted local edit" >> "$BASE/primary/file.txt"
WT="$BASE/TICK-8"
LOG="$BASE/primary/.concertino/runs/TICK-8/events.jsonl"
OUT="$BASE/out.txt"; ERR="$BASE/err.txt"
run_cleanup "$BASE/primary" "$WT" "$OUT" "$ERR" &
CPID=$!
wait_for_escalation "$LOG" && ok "fetch-failed retry: the first attempt raises an escalation" \
  || bad "fetch-failed retry: the first attempt raises an escalation" "escalation.raised never landed"
# Point origin at an unreachable path so the RETRIED attempt's own `git
# fetch` fails — it never reaches a local-vs-remote comparison.
git -C "$BASE/primary" remote set-url origin "$BASE/no-such-remote.git"
write_answer "$BASE/primary" TICK-8 retry
wait "$CPID"; RC=$?
check "exits 0 after a fetch-failed retry exhaustion" "$RC" "0"
has "prints READY despite a fetch-failed retry exhaustion" "READY cleaned worktree=" "$OUT"
has "'could not determine' note after a fetch-failed retry" "could not determine" "$ERR"
hasnt "no 'remains behind' note after a fetch-failed retry" "remains behind" "$ERR"
has "gate.warning event emitted after a fetch-failed retry exhaustion" "gate.warning" "$LOG"
check "gate.warning gate=phase:cleanup (fetch-failed retry)" \
  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse).find(e=>e.kind==="gate.warning");console.log(l.gate)' "$LOG")" \
  "phase:cleanup"
check "gate.warning resolved=false (fetch-failed retry)" \
  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse).find(e=>e.kind==="gate.warning");console.log(l.resolved)' "$LOG")" \
  "false"
check "gate.warning reason names the base state as unknown, not behind (fetch-failed retry)" \
  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse).find(e=>e.kind==="gate.warning");console.log(/could not determine/.test(l.reason) && !/remains behind/.test(l.reason))' "$LOG")" \
  "true"
check "gate.warning ticket tagged (fetch-failed retry)" \
  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse).find(e=>e.kind==="gate.warning");console.log(l.ticket)' "$LOG")" \
  "TICK-8"
check "run.end still status=delivered alongside the gate.warning (fetch-failed retry)" \
  "$(run_end_ticket "$LOG")" "TICK-8/delivered"
rm -rf "$BASE"

# ===========================================================================
# CON-66 — the end-of-run `concertino sync` re-render must be skipped while
# any OTHER run is live: it rewrites every rendered artifact at the repo root
# with no coordination, so a pending concertino.config.json edit would land
# under live runs at an arbitrary moment. "Live" = run.start without run.end
# in that run's events.jsonl, excluding this run's own ticket.
# ===========================================================================

new_fakebin() {
  # A stand-in `concertino` first on PATH that records each invocation
  # instead of rendering — the observable marker for whether cleanup.sh
  # actually invoked sync.
  mkdir -p "$1/fakebin"
  cat > "$1/fakebin/concertino" <<EOF
#!/usr/bin/env bash
echo "\$@" >> "$1/sync-invocations.txt"
EOF
  chmod +x "$1/fakebin/concertino"
}

run_cleanup_fakebin() {
  local primary="$1" wt="$2" out="$3" err="$4" ticket="$5" fakebin="$6"
  ( cd "$primary" && PATH="$fakebin:$PATH" bash scripts/concertino/cleanup.sh --phase4 "$wt" "" "" "$ticket" ) > "$out" 2> "$err"
}

fake_event() {
  # $1 = repo, $2 = ticket, $3 = kind — appends one event line shaped exactly
  # as emit-event.sh writes it (the fields cleanup.sh's liveness grep reads).
  mkdir -p "$1/.concertino/runs/$2"
  printf '{"t":1,"kind":"%s","project":"p","ticket":"%s","role":"script"}\n' "$3" "$2" \
    >> "$1/.concertino/runs/$2/events.jsonl"
}

# --- another live run present: sync skipped, fast-forward itself unaffected -
BASE="$(mktemp -d)"; new_pair "$BASE"; new_fakebin "$BASE"
git -C "$BASE/primary" checkout -q -b scratch
advance_remote "$BASE/remote.git"
fake_event "$BASE/primary" TICK-88 run.start
WT="$BASE/TICK-30"
OUT="$BASE/out.txt"; ERR="$BASE/err.txt"
run_cleanup_fakebin "$BASE/primary" "$WT" "$OUT" "$ERR" TICK-30 "$BASE/fakebin"
check "exits 0 (sync skipped for a live run)" "$?" "0"
check "local main still fast-forwarded (skip affects only the render)" \
  "$(git -C "$BASE/primary" rev-parse refs/heads/main)" "$(git -C "$BASE/primary" rev-parse origin/main)"
check "sync was NOT invoked while another run is live" \
  "$([ -e "$BASE/sync-invocations.txt" ] && echo invoked || echo not-invoked)" "not-invoked"
has  "stderr notes the skip and names the live run" "skipping \`concertino sync\`: run TICK-88 is still live" "$ERR"
has  "prints READY (sync skipped)" "READY cleaned worktree=" "$OUT"
rm -rf "$BASE"

# --- other runs all terminal, own run.start excluded: sync proceeds ---------
BASE="$(mktemp -d)"; new_pair "$BASE"; new_fakebin "$BASE"
git -C "$BASE/primary" checkout -q -b scratch
advance_remote "$BASE/remote.git"
fake_event "$BASE/primary" TICK-88 run.start
fake_event "$BASE/primary" TICK-88 run.end
# This run's OWN log legitimately has run.start without run.end at this point
# (cleanup.sh is what writes its run.end, later) — it must never count itself
# as "another live run" and self-block the render.
fake_event "$BASE/primary" TICK-31 run.start
WT="$BASE/TICK-31"
OUT="$BASE/out.txt"; ERR="$BASE/err.txt"
run_cleanup_fakebin "$BASE/primary" "$WT" "$OUT" "$ERR" TICK-31 "$BASE/fakebin"
check "exits 0 (sync proceeds)" "$?" "0"
check "sync WAS invoked when no other run is live" \
  "$([ -e "$BASE/sync-invocations.txt" ] && echo invoked || echo not-invoked)" "invoked"
has  "sync invoked with --out= at the repo root" "sync --out=" "$BASE/sync-invocations.txt"
hasnt "no skip note when no other run is live" "skipping \`concertino sync\`" "$ERR"
check "this run's own run.end still lands afterwards" \
  "$(run_end_ticket "$BASE/primary/.concertino/runs/TICK-31/events.jsonl")" "TICK-31/delivered"
rm -rf "$BASE"

# ===========================================================================
# CON-64 — run.end must be emitted for a worktree whose basename is NOT a
# ticket shape (doesn't end in a digit), when the ticket ID is passed
# explicitly. This is the exact regression the ticket exists to close: CON-63
# ran on branch `feature/local-llm-harnesses`, the basename inference silently
# failed the ticket regex, and the run never terminated on the dashboard.
# ===========================================================================

# --- explicit ticket + non-ticket basename: run.end lands, correctly tagged -
BASE="$(mktemp -d)"; new_pair "$BASE"
WT="$BASE/local-llm-harnesses"
OUT="$BASE/out.txt"; ERR="$BASE/err.txt"
run_cleanup "$BASE/primary" "$WT" "$OUT" "$ERR" TICK-9
check "exits 0 (explicit ticket, non-ticket basename)" "$?" "0"
has   "prints READY (explicit ticket, non-ticket basename)" "READY cleaned worktree=" "$OUT"
check "run.end is tagged with the explicit ticket, status delivered" \
  "$(run_end_ticket "$BASE/primary/.concertino/runs/TICK-9/events.jsonl")" "TICK-9/delivered"
rm -rf "$BASE"

# --- no explicit ticket, ticket-shaped basename: inference fallback holds ---
BASE="$(mktemp -d)"; new_pair "$BASE"
WT="$BASE/TICK-10"
OUT="$BASE/out.txt"; ERR="$BASE/err.txt"
run_cleanup "$BASE/primary" "$WT" "$OUT" "$ERR"
check "exits 0 (basename-inference fallback)" "$?" "0"
check "run.end via basename inference still lands" \
  "$(run_end_ticket "$BASE/primary/.concertino/runs/TICK-10/events.jsonl")" "TICK-10/delivered"
rm -rf "$BASE"

# --- no explicit ticket, non-ticket basename: no silent drop — loud warning -
BASE="$(mktemp -d)"; new_pair "$BASE"
WT="$BASE/local-llm-harnesses"
OUT="$BASE/out.txt"; ERR="$BASE/err.txt"
run_cleanup "$BASE/primary" "$WT" "$OUT" "$ERR"
check "still exits 0 when run.end cannot be tagged" "$?" "0"
has   "prints READY even when run.end cannot be tagged" "READY cleaned worktree=" "$OUT"
check "no run dir created for the malformed ticket" \
  "$([ -e "$BASE/primary/.concertino/runs/local-llm-harnesses" ] && echo present || echo absent)" "absent"
has   "emit-event.sh warns loudly about the untaggable run.end" "WARNING: run.end" "$ERR"
rm -rf "$BASE"

# ===========================================================================
# CON-131 — cleanup.sh must not exit 0 having swallowed a git failure, must
# verify its own postconditions by result, and must delete the ticket
# branch via content-equality (not ancestry) once the worktree using it is
# gone. See tasks.md §6 for the full enumeration this section implements.
# ===========================================================================

echo "cleanup.sh (CON-131: failure visibility + branch deletion)"

# --- 6.1: forced git failure (the incident's own trigger) exits non-zero, ---
# --- names the failing command + isolated stderr, never prints READY, and --
# --- puts RESULT on stderr specifically (never stdout).                   --
BASE="$(mktemp -d)"; new_pair "$BASE"
git -C "$BASE/primary" config core.bare true
WT="$BASE/nonexistent-worktree"
OUT="$BASE/out.txt"; ERR="$BASE/err.txt"
run_cleanup_streams "$BASE/primary" "$WT" "$OUT" "$ERR" TICK-1311
RC=$?
[ "$RC" -ne 0 ] && ok "forced git failure exits non-zero" || bad "forced git failure exits non-zero" "got exit 0"
has   "names the failing command" "FAILED resolve repo root" "$ERR"
has   "isolates the git stderr" "this operation must be run in a work tree" "$ERR"
hasnt "never prints READY on a forced git failure" "READY cleaned worktree=" "$OUT"
hasnt "RESULT never leaks onto stdout" "RESULT " "$OUT"
has   "RESULT lands on stderr" "RESULT worktree=" "$ERR"
has   "RESULT reports worktree=not-attempted (failed before the removal block)" \
  "RESULT worktree=not-attempted" "$ERR"
rm -rf "$BASE"

# --- 6.2: a squash-merged branch (content-identical, commits NOT ancestors)-
# --- deletes cleanly via two-dot content-equality, even though `git       --
# --- branch -d` would refuse it.                                          --
BASE="$(mktemp -d)"; new_pair "$BASE"
WT="$BASE/wt-squash"
new_worktree "$BASE/primary" "bug/x/TICK-1312" "$WT"
squash_merge_into_main "$BASE/primary" "bug/x/TICK-1312"
OUT="$BASE/out.txt"; ERR="$BASE/err.txt"
run_cleanup "$BASE/primary" "$WT" "$OUT" "$ERR" TICK-1312
check "exits 0 (squash-merged branch deletes cleanly)" "$?" "0"
has  "prints READY (squash-merge branch deletion)" "READY cleaned worktree=" "$OUT"
has  "RESULT branch_local=ok (squash-merge branch deletion)" "branch_local=ok" "$ERR"
check "the squash-merged branch is actually gone" \
  "$(git -C "$BASE/primary" branch --list "bug/x/TICK-1312" | tr -d ' ')" ""
rm -rf "$BASE"

# --- 6.3: a branch with genuinely unmerged content is left alone -----------
BASE="$(mktemp -d)"; new_pair "$BASE"
WT="$BASE/wt-unmerged"
new_worktree "$BASE/primary" "bug/x/TICK-1313" "$WT"
# Deliberately do NOT merge bug/x/TICK-1313 into main — its content diff
# against origin/main stays non-empty.
OUT="$BASE/out.txt"; ERR="$BASE/err.txt"
run_cleanup "$BASE/primary" "$WT" "$OUT" "$ERR" TICK-1313
check "exits 0 (unmerged branch left alone)" "$?" "0"
has  "RESULT branch_local=skipped (unmerged branch)" "branch_local=skipped" "$ERR"
check "the unmerged branch still exists" \
  "$(git -C "$BASE/primary" branch --list "bug/x/TICK-1313" | tr -d ' *+')" "bug/x/TICK-1313"
rm -rf "$BASE"

# --- 6.4: worktree already absent (removed out-of-band), branch resolved --
# --- via the naming-convention fallback and still deleted.                --
BASE="$(mktemp -d)"; new_pair "$BASE"
WT="$BASE/wt-gone"
new_worktree "$BASE/primary" "bug/x/TICK-1314" "$WT"
squash_merge_into_main "$BASE/primary" "bug/x/TICK-1314"
rm -rf "$WT"
git -C "$BASE/primary" worktree prune 2>/dev/null || true
OUT="$BASE/out.txt"; ERR="$BASE/err.txt"
run_cleanup "$BASE/primary" "$WT" "$OUT" "$ERR" TICK-1314
check "exits 0 (worktree already absent, branch resolved by naming convention)" "$?" "0"
has  "RESULT worktree=ok (already absent)" "worktree=ok" "$ERR"
has  "RESULT branch_local=ok (naming-convention fallback)" "branch_local=ok" "$ERR"
check "the branch resolved via naming convention is actually gone" \
  "$(git -C "$BASE/primary" branch --list "bug/x/TICK-1314" | tr -d ' ')" ""
rm -rf "$BASE"

# --- 6.5: naming-convention fallback with MULTIPLE matches reports skipped-
# --- and deletes neither branch (never guesses at an ambiguous match).    --
BASE="$(mktemp -d)"; new_pair "$BASE"
WT1="$BASE/wt-amb1"
new_worktree "$BASE/primary" "bug/a/TICK-1315" "$WT1"
git -C "$BASE/primary" branch "task/b/TICK-1315" main >/dev/null 2>&1
rm -rf "$WT1"
git -C "$BASE/primary" worktree prune 2>/dev/null || true
OUT="$BASE/out.txt"; ERR="$BASE/err.txt"
run_cleanup "$BASE/primary" "$WT1" "$OUT" "$ERR" TICK-1315
check "exits 0 (ambiguous naming-convention match)" "$?" "0"
has  "RESULT branch_local=skipped (ambiguous match)" "branch_local=skipped" "$ERR"
check "neither ambiguously-matching branch is deleted (first)" \
  "$(git -C "$BASE/primary" branch --list "bug/a/TICK-1315" | tr -d ' *+')" "bug/a/TICK-1315"
check "neither ambiguously-matching branch is deleted (second)" \
  "$(git -C "$BASE/primary" branch --list "task/b/TICK-1315" | tr -d ' *+')" "task/b/TICK-1315"
rm -rf "$BASE"

# --- 6.6: local main diverged/dirty still exits 0 (the deliberately       --
# --- tolerated fast-forward outcome, unchanged) while worktree removal    --
# --- and branch deletion both still succeed and report ok.                --
BASE="$(mktemp -d)"; new_pair "$BASE"
WT="$BASE/wt-diverged"
new_worktree "$BASE/primary" "bug/x/TICK-1316" "$WT"
squash_merge_into_main "$BASE/primary" "bug/x/TICK-1316"
# Give local main a commit origin doesn't have — diverged base, same as the
# existing "diverged base: escalates" scenario above, but combined here with
# a real worktree/branch to delete.
git -C "$BASE/primary" -c user.email=t@t.com -c user.name=t commit -q --allow-empty -m "local-only commit"
LOG="$BASE/primary/.concertino/runs/TICK-1316/events.jsonl"
OUT="$BASE/out.txt"; ERR="$BASE/err.txt"
run_cleanup "$BASE/primary" "$WT" "$OUT" "$ERR" TICK-1316 &
CPID=$!
wait_for_escalation "$LOG" && ok "diverged base + real branch deletion: escalation still raised" \
  || bad "diverged base + real branch deletion: escalation still raised" "escalation.raised never landed"
write_answer "$BASE/primary" TICK-1316 skip
wait "$CPID"; RC=$?
check "exits 0 (diverged base tolerated, worktree/branch still cleaned up)" "$RC" "0"
has  "RESULT worktree=ok despite a diverged/skipped base" "worktree=ok" "$ERR"
has  "RESULT branch_local=ok despite a diverged/skipped base" "branch_local=ok" "$ERR"
has  "RESULT base=diverged (unresolved fast-forward, tolerated)" "base=diverged" "$ERR"
rm -rf "$BASE"

# --- 6.7: worktree removal that leaves the directory behind despite       --
# --- `git worktree remove` returning 0 (simulated) exits non-zero          --
# --- IMMEDIATELY with RESULT worktree=fail — never exit 0.                --
BASE="$(mktemp -d)"; new_pair "$BASE"
WT="$BASE/wt-stuck"
new_worktree "$BASE/primary" "bug/x/TICK-1317" "$WT"
FAKEBIN="$(new_fakegit_worktree_remove_noop "$BASE")"
OUT="$BASE/out.txt"; ERR="$BASE/err.txt"
( cd "$BASE/primary" && PATH="$FAKEBIN:$PATH" bash scripts/concertino/cleanup.sh --phase4 "$WT" "" "" TICK-1317 ) \
  > "$OUT" 2> "$ERR"
RC=$?
[ "$RC" -ne 0 ] && ok "stuck worktree removal exits non-zero" || bad "stuck worktree removal exits non-zero" "got exit 0"
hasnt "never prints READY when the worktree removal didn't actually work" "READY cleaned worktree=" "$OUT"
has  "RESULT worktree=fail (stuck removal)" "worktree=fail" "$ERR"
has  "names the postcondition failure" "still present after removal" "$ERR"
rm -rf "$BASE"

# --- 6.8: the fast-forward's own tolerance never masks an unrelated hard --
# --- git failure elsewhere — exits non-zero even though a fast-forward   --
# --- would otherwise resolve cleanly (remote was advanced beforehand).    --
BASE="$(mktemp -d)"; new_pair "$BASE"
WT="$BASE/wt-stuck2"
new_worktree "$BASE/primary" "bug/x/TICK-1318" "$WT"
git -C "$BASE/primary" checkout -q main
advance_remote "$BASE/remote.git"
BEFORE_MAIN="$(git -C "$BASE/primary" rev-parse main)"
FAKEBIN="$(new_fakegit_worktree_remove_noop "$BASE")"
OUT="$BASE/out.txt"; ERR="$BASE/err.txt"
( cd "$BASE/primary" && PATH="$FAKEBIN:$PATH" bash scripts/concertino/cleanup.sh --phase4 "$WT" "" "" TICK-1318 ) \
  > "$OUT" 2> "$ERR"
RC=$?
[ "$RC" -ne 0 ] && ok "unrelated hard failure exits non-zero even with a clean fast-forward available" \
  || bad "unrelated hard failure exits non-zero even with a clean fast-forward available" "got exit 0"
AFTER_MAIN="$(git -C "$BASE/primary" rev-parse main)"
check "main is untouched — the script never reached the fast-forward step" "$AFTER_MAIN" "$BEFORE_MAIN"
has  "RESULT worktree=fail (unrelated failure, ff never masks it)" "worktree=fail" "$ERR"
rm -rf "$BASE"

# --- 6.9: cleanup scoped to its own run — a second, unrelated live         -
# --- worktree/branch in the same base is left completely untouched.       -
BASE="$(mktemp -d)"; new_pair "$BASE"
WT="$BASE/wt-target"
OTHER_WT="$BASE/wt-other"
new_worktree "$BASE/primary" "bug/x/TICK-1319" "$WT"
git -C "$BASE/primary" worktree add -q -b "bug/y/TICK-1320" "$OTHER_WT" main
squash_merge_into_main "$BASE/primary" "bug/x/TICK-1319"
OUT="$BASE/out.txt"; ERR="$BASE/err.txt"
run_cleanup "$BASE/primary" "$WT" "$OUT" "$ERR" TICK-1319
check "exits 0 (scoped cleanup, unrelated worktree present)" "$?" "0"
check "the target worktree is gone" "$([ -d "$WT" ] && echo present || echo absent)" "absent"
check "the target branch is gone" \
  "$(git -C "$BASE/primary" branch --list "bug/x/TICK-1319" | tr -d ' ')" ""
check "the UNRELATED worktree directory is untouched" "$([ -d "$OTHER_WT" ] && echo present || echo absent)" "present"
check "the UNRELATED branch is untouched" \
  "$(git -C "$BASE/primary" branch --list "bug/y/TICK-1320" | tr -d ' *+')" "bug/y/TICK-1320"
git -C "$OTHER_WT" worktree remove --force "$OTHER_WT" 2>/dev/null || true
rm -rf "$BASE"

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
