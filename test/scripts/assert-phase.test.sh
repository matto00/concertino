#!/usr/bin/env bash
# Shell tests for core/scripts/assert-phase.sh's gate.result telemetry
# (duration_ms / first_error). Run: bash test/scripts/assert-phase.test.sh
set -uo pipefail

# See emit-event.test.sh for why this is disabled: FORCE_COLOR would wrap
# node's bare-number output in ANSI codes even off a TTY.
export NO_COLOR=1
unset FORCE_COLOR

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/core/scripts/assert-phase.sh"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL $1"; echo "       $2"; }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected [$3] got [$2]"; fi; }

# Each test runs in a throwaway git repo so emit-event.sh's main-checkout
# resolution is exercised for real, exactly like emit-event.test.sh does.
new_repo() {
  local d; d="$(mktemp -d)"
  git -C "$d" init -q
  git -C "$d" commit -q --allow-empty -m init
  printf '%s' "$d"
}

echo "assert-phase.sh"

# --- passing phase emits a numeric duration and no first_error -------------
REPO="$(new_repo)"
WT="$REPO/worktrees/HEL-1"
mkdir -p "$WT/.git"          # satisfies the "looks like a git worktree" check
OUT="$(cd "$REPO" && "$SCRIPT" setup "$WT")"
RC=$?
LOG="$REPO/.concertino/runs/HEL-1/events.jsonl"
check "exit 0 on pass"          "$RC" "0"
check "stdout is PASS setup"    "$OUT" "PASS setup"
check "emits gate.result"       "$([ -f "$LOG" ] && echo yes || echo no)" "yes"
check "one gate.result line"    "$(wc -l < "$LOG" | tr -d ' ')" "1"
check "kind is gate.result"     "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(JSON.parse(l).kind)' "$LOG")" "gate.result"
check "status pass"             "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(JSON.parse(l).status)' "$LOG")" "pass"
check "duration_ms is numeric"  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(typeof JSON.parse(l).duration_ms)' "$LOG")" "number"
check "duration_ms non-negative" "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(JSON.parse(l).duration_ms >= 0)' "$LOG")" "true"
check "no first_error on pass"  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log("first_error" in JSON.parse(l))' "$LOG")" "false"
rm -rf "$REPO"

# --- failing phase emits a duration and the first failure message ----------
# The setup phase trips two checks in order when the worktree dir is simply
# missing (dir-missing, then not-a-git-worktree) — this doubles as coverage
# for "only the FIRST failure is recorded, not a concatenation of all of them".
REPO="$(new_repo)"
WT="$REPO/worktrees/HEL-2"     # deliberately never created
ERR="$(cd "$REPO" && "$SCRIPT" setup "$WT" 2>&1 >/dev/null)"
RC=$?
LOG="$REPO/.concertino/runs/HEL-2/events.jsonl"
check "exit 1 on fail"              "$RC" "1"
check "stderr reports first failure only as FAIL line 1" \
  "$(printf '%s\n' "$ERR" | sed -n '1p')" "FAIL worktree dir missing: $WT"
check "stderr also reports the second failure" \
  "$(printf '%s\n' "$ERR" | sed -n '2p')" "FAIL worktree not a git work tree: $WT"
check "emits gate.result"           "$([ -f "$LOG" ] && echo yes || echo no)" "yes"
check "status fail"                 "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(JSON.parse(l).status)' "$LOG")" "fail"
check "duration_ms is numeric"      "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(typeof JSON.parse(l).duration_ms)' "$LOG")" "number"
check "first_error is the FIRST failure message" \
  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(JSON.parse(l).first_error)' "$LOG")" \
  "worktree dir missing: $WT"
rm -rf "$REPO"

# --- an oversized failure message is trimmed at the source ------------------
REPO="$(new_repo)"
mkdir -p "$REPO/HEL-3" && git -C "$REPO/HEL-3" init -q
LONG_BRANCH="$(head -c 300 /dev/zero | tr '\0' 'b')"
( cd "$REPO" && "$SCRIPT" delivery "$REPO/HEL-3" "$LONG_BRANCH" ) >/dev/null 2>&1
RC=$?
LOG="$REPO/.concertino/runs/HEL-3/events.jsonl"
EXPECTED_MSG="branch ${LONG_BRANCH} not pushed to origin"
check "exit 1 on fail"              "$RC" "1"
check "first_error trimmed to 200 chars" \
  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(JSON.parse(l).first_error.length)' "$LOG")" "200"
check "first_error is a prefix of the untrimmed message" \
  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(JSON.parse(l).first_error)' "$LOG")" \
  "${EXPECTED_MSG:0:200}"
rm -rf "$REPO"

# --- a multi-byte character at the 200-char trim boundary is never split (CON-16) ----------
# Old bug: fail() trimmed with bash's own `${msg:0:200}`, which slices by BYTE rather than by
# character whenever the calling shell's locale is C/POSIX (the common case for a minimal
# CI/container image) — bash's substring indexing is character-aware only when the ambient
# locale names a multibyte encoding. The fix trims by Unicode code point via a node helper
# instead, so the boundary is character-safe regardless of locale.
#
# "branch " is 7 ASCII characters; the emoji below is placed as the 198th character of the
# full message (0-based index 197), so its 4 UTF-8 bytes span byte offsets 197-200 —
# straddling byte offset 200, the OLD code's byte-oriented cut point under a C/POSIX locale.
EMOJI="$(printf '\xf0\x9f\x98\x80')"          # U+1F600, a 4-byte UTF-8 sequence
FILLER="$(head -c 190 /dev/zero | tr '\0' 'b')"
TAIL="$(head -c 10 /dev/zero | tr '\0' 'b')"
MB_BRANCH="${FILLER}${EMOJI}${TAIL}"
# First 200 whole characters of "branch ${MB_BRANCH} not pushed to origin":
# 7 ("branch ") + 190 (FILLER) + 1 (the emoji, one code point) + 2 (next two filler chars).
EXPECTED_TRIMMED="branch ${FILLER}${EMOJI}bb"

REPO="$(new_repo)"
mkdir -p "$REPO/HEL-5" && git -C "$REPO/HEL-5" init -q
( cd "$REPO" && "$SCRIPT" delivery "$REPO/HEL-5" "$MB_BRANCH" ) >/dev/null 2>&1
RC=$?
LOG="$REPO/.concertino/runs/HEL-5/events.jsonl"
check "exit 1 on fail (multi-byte branch)" "$RC" "1"
check "first_error is exactly 200 code points" \
  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(Array.from(JSON.parse(l).first_error).length)' "$LOG")" "200"
check "first_error has no replacement character (never split)" \
  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(JSON.parse(l).first_error.includes("�")?"has-replacement":"clean")' "$LOG")" \
  "clean"
check "first_error is exactly the expected 200-character prefix" \
  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(JSON.parse(l).first_error)' "$LOG")" \
  "$EXPECTED_TRIMMED"
rm -rf "$REPO"

# --- same, but with the calling shell forced into the C/POSIX locale -----------------------
# This is exactly the environment (a minimal CI/container image) where the old
# `${msg:0:200}` bug actually bit — proving the fix is locale-independent, not merely "works
# on this dev machine's UTF-8 locale."
REPO="$(new_repo)"
mkdir -p "$REPO/HEL-6" && git -C "$REPO/HEL-6" init -q
( cd "$REPO" && LC_ALL=C LANG=C "$SCRIPT" delivery "$REPO/HEL-6" "$MB_BRANCH" ) >/dev/null 2>&1
RC=$?
LOG="$REPO/.concertino/runs/HEL-6/events.jsonl"
check "exit 1 on fail under LC_ALL=C" "$RC" "1"
check "first_error exactly 200 code points under LC_ALL=C" \
  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(Array.from(JSON.parse(l).first_error).length)' "$LOG")" "200"
check "first_error has no replacement character under LC_ALL=C" \
  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(JSON.parse(l).first_error.includes("�")?"has-replacement":"clean")' "$LOG")" \
  "clean"
check "first_error matches the same expected prefix under LC_ALL=C" \
  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(JSON.parse(l).first_error)' "$LOG")" \
  "$EXPECTED_TRIMMED"
rm -rf "$REPO"

# --- sub-second gate reports true millisecond resolution --------------------
# A single run of a near-instant `setup` phase (filesystem stats only) could
# legitimately land exactly on a millisecond tick (duration_ms == 0, itself a
# multiple of 1000) without any bug present — that's a real near-zero
# duration, not a regression. So this samples several runs and only requires
# that NOT ALL of them collapse onto a multiple of 1000: the old
# `date +%s` * 1000 measurement guaranteed a multiple of 1000 on every single
# run, so seeing even one non-multiple proves true ms resolution is in use.
REPO="$(new_repo)"
WT="$REPO/worktrees/HEL-4"
mkdir -p "$WT/.git"
SAW_NON_MULTIPLE=no
for _ in $(seq 1 20); do
  (cd "$REPO" && "$SCRIPT" setup "$WT") >/dev/null
  LOG="$REPO/.concertino/runs/HEL-4/events.jsonl"
  D="$(node -e 'const lines=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n");console.log(JSON.parse(lines[lines.length-1]).duration_ms)' "$LOG")"
  if [ "$((D % 1000))" -ne 0 ]; then
    SAW_NON_MULTIPLE=yes
    break
  fi
done
check "sub-second setup run reports true ms resolution (non-1000-multiple duration_ms) within 20 tries" \
  "$SAW_NON_MULTIPLE" "yes"
rm -rf "$REPO"

# ===========================================================================
# CON-80: explicit trailing TICKET_ID argument (mirrors CON-64's fix to
# cleanup.sh). Without it, assert-phase.sh infers the ticket id from the
# worktree path's basename — a branch whose ticket suffix is lowercase (or a
# branch that doesn't carry a ticket-shaped suffix at all) makes that
# inference wrong or a silent no-op. Passing the id explicitly fixes both.
# ===========================================================================

echo "assert-phase.sh (CON-80: explicit ticket id)"

# --- non-ticket-shaped basename + explicit ticket id: gate.result still
#     lands, tagged with the explicit id (mirrors cleanup.test.sh's identical
#     CON-64 regression case) ---------------------------------------------
REPO="$(new_repo)"
WT="$REPO/worktrees/local-llm-harnesses"     # basename is NOT ticket-shaped
mkdir -p "$WT/.git"
OUT="$(cd "$REPO" && "$SCRIPT" setup "$WT" TICK-9)"
RC=$?
LOG="$REPO/.concertino/runs/TICK-9/events.jsonl"
check "exit 0 (explicit ticket id, non-ticket basename)" "$RC" "0"
check "stdout is PASS setup (explicit ticket id)"        "$OUT" "PASS setup"
check "gate.result lands under the explicit ticket id" \
  "$([ -f "$LOG" ] && echo yes || echo no)" "yes"
check "gate.result ticket field is the explicit id" \
  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(JSON.parse(l).ticket)' "$LOG")" \
  "TICK-9"
rm -rf "$REPO"

# --- same non-ticket-shaped basename, NO explicit ticket id: no event at
#     all (the pre-CON-80, pre-CON-64-style baseline — proves the fix above
#     is what makes the difference, not some other change) -----------------
REPO="$(new_repo)"
WT="$REPO/worktrees/local-llm-harnesses"
mkdir -p "$WT/.git"
OUT="$(cd "$REPO" && "$SCRIPT" setup "$WT")"
RC=$?
LOG="$REPO/.concertino/runs/local-llm-harnesses/events.jsonl"
check "exit 0 (no explicit ticket id, non-ticket basename)" "$RC" "0"
check "no run dir created when the basename isn't ticket-shaped and no id was passed" \
  "$([ -e "$LOG" ] && echo present || echo absent)" "absent"
rm -rf "$REPO"

# --- the ticket's own regression scenario: a lowercase-suffix branch, with
#     the explicit id passed, produces exactly one (canonically-cased) run
#     directory rather than splitting across a phantom lowercase one --------
REPO="$(new_repo)"
WT="$REPO/worktrees/con-79"        # lowercase, ticket-shaped (Linear's own gitBranchName case)
mkdir -p "$WT/.git"
OUT="$(cd "$REPO" && "$SCRIPT" setup "$WT" CON-79)"
RC=$?
LOG="$REPO/.concertino/runs/CON-79/events.jsonl"
PHANTOM="$REPO/.concertino/runs/con-79"
check "exit 0 (lowercase-suffix branch, explicit canonical id)" "$RC" "0"
check "gate.result lands under the canonical (uppercase) ticket dir" \
  "$([ -f "$LOG" ] && echo yes || echo no)" "yes"
check "gate.result ticket field is the canonical id, not the lowercase basename" \
  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(JSON.parse(l).ticket)' "$LOG")" \
  "CON-79"
check "no phantom lowercase run dir is created" \
  "$([ -e "$PHANTOM" ] && echo present || echo absent)" "absent"
rm -rf "$REPO"

# --- no explicit ticket id, ticket-shaped basename: basename-inference
#     fallback is unchanged (same shape as the very first test in this file,
#     re-asserted here under the CON-80 heading for clarity) ----------------
REPO="$(new_repo)"
WT="$REPO/worktrees/HEL-20"
mkdir -p "$WT/.git"
OUT="$(cd "$REPO" && "$SCRIPT" setup "$WT")"
RC=$?
LOG="$REPO/.concertino/runs/HEL-20/events.jsonl"
check "exit 0 (no explicit ticket id, fallback)" "$RC" "0"
check "gate.result ticket field is the inferred basename" \
  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(JSON.parse(l).ticket)' "$LOG")" \
  "HEL-20"
rm -rf "$REPO"

has()  { grep -qF "$2" "$3" && ok "$1" || bad "$1" "expected to find [$2] in $3"; }
hasnt(){ grep -qF "$2" "$3" && bad "$1" "unexpectedly found [$2] in $3" || ok "$1"; }

# =============================================================================
# CON-31: delivery-gate stale-base warning — best-effort, non-blocking.
#
# A bare "remote" plus a worktree checkout cloned from it, mirroring
# cleanup.test.sh's new_pair() shape: the worktree is what assert-phase.sh's
# `delivery` case operates on directly (git -C "$WORKTREE_PATH" ...), so it
# needs its own real `origin` remote to fetch from. The worktree's own path is
# also used as `assert-phase.sh`'s cwd, so emit-event.sh's git-common-dir
# main-checkout resolution has a real repo to resolve (it writes events to
# <that repo>/.concertino/runs/<ticket>/events.jsonl).
# =============================================================================

new_stale_base_pair() {
  local base="$1" branch="$2"
  local remote="$base/remote.git" seed wt="$base/$branch"
  git init -q --bare "$remote"
  seed="$(mktemp -d)"
  git init -q "$seed"
  git -C "$seed" -c user.email=t@t.com -c user.name=t commit -q --allow-empty -m init
  git -C "$seed" branch -M main
  git -C "$seed" remote add origin "$remote"
  git -C "$seed" push -q origin main
  rm -rf "$seed"

  git clone -q "$remote" "$wt" 2>/dev/null
  # Start from origin/main explicitly, not the bare name "main" — unlike
  # `git checkout main` (used elsewhere in this file), `git checkout -b
  # <new> <start-point>` resolves <start-point> as a literal revision, not
  # via remote-tracking DWIM. On a machine with init.defaultBranch=main
  # configured globally (common on developer machines), the freshly
  # cloned repo's own local HEAD already happens to be "main", masking
  # this; on a vanilla install (e.g. GitHub Actions runners, which default
  # to "master") there is no local "main" ref yet and this fails with
  # "'main' is not a commit". Reproduced directly: HOME pointed at a fresh
  # dir with no git config, `git checkout -q -b X main` against this same
  # fixture shape fails with exactly that fatal error; explicit
  # origin/main resolves regardless of ambient default-branch config.
  git -C "$wt" -c user.email=t@t.com -c user.name=t checkout -q -b "$branch" origin/main
  git -C "$wt" -c user.email=t@t.com -c user.name=t commit -q --allow-empty -m "feature work"
  git -C "$wt" push -q origin "HEAD:refs/heads/${branch}"
  printf '%s' "$wt"
}

# Simulates N sibling merges landing on origin/main after the branch above was
# cut, via a separate clone — exactly cleanup.test.sh's advance_remote().
advance_remote_main() {
  local remote="$1" n="$2" other i
  other="$(mktemp -d)"
  git clone -q "$remote" "$other" 2>/dev/null
  git -C "$other" checkout -q main
  for i in $(seq 1 "$n"); do
    git -C "$other" -c user.email=t@t.com -c user.name=t commit -q --allow-empty -m "sibling merge $i"
  done
  git -C "$other" push -q origin main
  rm -rf "$other"
}

echo "assert-phase.sh delivery (CON-31 stale-base warning)"

# --- base is current: no warning, no telemetry, gate unaffected ------------
BASE="$(mktemp -d)"
WT="$(new_stale_base_pair "$BASE" "TICK-1")"
OUT="$BASE/out.txt"; ERR="$BASE/err.txt"
( cd "$WT" && "$SCRIPT" delivery "$WT" "TICK-1" ) >"$OUT" 2>"$ERR"
RC=$?
LOG="$WT/.concertino/runs/TICK-1/events.jsonl"
check "exit 0 when base current"       "$RC" "0"
check "stdout is PASS delivery"        "$(cat "$OUT")" "PASS delivery"
hasnt "no WARN line when base current" "WARN" "$ERR"
check "only one event (gate.result) when base current" \
  "$([ -f "$LOG" ] && wc -l < "$LOG" | tr -d ' ' || echo 0)" "1"
hasnt "no gate.warning kind in log" "gate.warning" "$LOG"
rm -rf "$BASE"

# --- base has moved (3 commits): warning + telemetry, gate still passes ----
BASE="$(mktemp -d)"
WT="$(new_stale_base_pair "$BASE" "TICK-2")"
advance_remote_main "$BASE/remote.git" 3
OUT="$BASE/out.txt"; ERR="$BASE/err.txt"
( cd "$WT" && "$SCRIPT" delivery "$WT" "TICK-2" ) >"$OUT" 2>"$ERR"
RC=$?
LOG="$WT/.concertino/runs/TICK-2/events.jsonl"
check "exit 0 when base behind"   "$RC" "0"
check "stdout is still PASS delivery" "$(cat "$OUT")" "PASS delivery"
has   "warning names the commit count" "3 commit(s) behind" "$ERR"
has   "warning names the merged commit subject" "sibling merge 3" "$ERR"
has   "warning names the merged commit subject" "sibling merge 1" "$ERR"
has   "gate.warning event emitted" "gate.warning" "$LOG"
check "gate.warning behind=3" \
  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse).find(e=>e.kind==="gate.warning");console.log(l.behind)' "$LOG")" \
  "3"
check "gate.warning gate=phase:delivery" \
  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse).find(e=>e.kind==="gate.warning");console.log(l.gate)' "$LOG")" \
  "phase:delivery"
check "gate.warning base=main" \
  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse).find(e=>e.kind==="gate.warning");console.log(l.base)' "$LOG")" \
  "main"
check "gate.warning remote=origin" \
  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse).find(e=>e.kind==="gate.warning");console.log(l.remote)' "$LOG")" \
  "origin"
check "gate.warning commits lists 3 short SHAs" \
  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse).find(e=>e.kind==="gate.warning");console.log(l.commits.split(",").length)' "$LOG")" \
  "3"
has "gate.result still recorded alongside gate.warning" "gate.result" "$LOG"
rm -rf "$BASE"

# --- base has moved by more than 5 commits: list capped, "+N more" shown ---
BASE="$(mktemp -d)"
WT="$(new_stale_base_pair "$BASE" "TICK-3")"
advance_remote_main "$BASE/remote.git" 12
OUT="$BASE/out.txt"; ERR="$BASE/err.txt"
( cd "$WT" && "$SCRIPT" delivery "$WT" "TICK-3" ) >"$OUT" 2>"$ERR"
RC=$?
LOG="$WT/.concertino/runs/TICK-3/events.jsonl"
check "exit 0 when far behind" "$RC" "0"
check "stdout is still PASS delivery (far behind)" "$(cat "$OUT")" "PASS delivery"
has "warning names the true total count (12)" "12 commit(s) behind" "$ERR"
has "warning appends the +N more suffix" "(+7 more)" "$ERR"
check "warning lists at most 5 commit lines" \
  "$(grep -c 'sibling merge' "$ERR")" "5"
check "gate.warning behind=12" \
  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse).find(e=>e.kind==="gate.warning");console.log(l.behind)' "$LOG")" \
  "12"
check "gate.warning commits capped at 5 short SHAs" \
  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse).find(e=>e.kind==="gate.warning");console.log(l.commits.split(",").length)' "$LOG")" \
  "5"
rm -rf "$BASE"

# --- fetch fails (remote unreachable): silent skip, gate unaffected --------
# refs/remotes/origin/<branch> (the pushed-branch check) and the clean-tree
# check both read local state only, so pointing origin at a now-nonexistent
# path after the initial clone/push leaves the gate's existing pass/fail
# checks untouched — only this new best-effort fetch is affected.
BASE="$(mktemp -d)"
WT="$(new_stale_base_pair "$BASE" "TICK-4")"
rm -rf "$BASE/remote.git"          # origin now points at a nonexistent path
git -C "$WT" remote set-url origin "$BASE/remote.git"
OUT="$BASE/out.txt"; ERR="$BASE/err.txt"
( cd "$WT" && "$SCRIPT" delivery "$WT" "TICK-4" ) >"$OUT" 2>"$ERR"
RC=$?
LOG="$WT/.concertino/runs/TICK-4/events.jsonl"
check "exit 0 when fetch fails"        "$RC" "0"
check "stdout is still PASS delivery (fetch fails)" "$(cat "$OUT")" "PASS delivery"
hasnt "no WARN line when fetch fails" "WARN" "$ERR"
hasnt "no gate.warning kind when fetch fails" "gate.warning" "$LOG"
check "only one event (gate.result) when fetch fails" \
  "$([ -f "$LOG" ] && wc -l < "$LOG" | tr -d ' ' || echo 0)" "1"
rm -rf "$BASE"

# =============================================================================
# CON-132: gate-chain-touching diffs must not reach Delivery without recorded
# evidence. Every case runs the REAL script (assert-phase.sh delivery, which
# calls the real check-gate-chain-change.sh) against a throwaway bare
# remote + clone, red-before-green: the FAIL cases are proven to actually
# fail before the PASS case is proven to pass.
# =============================================================================

# Same base + clone/push shape as new_stale_base_pair(), seeded instead with a
# .husky/pre-commit hook that runs `npm run check:foo`, resolving (via
# package.json) to scripts/check-foo.mjs -- the fixture check-gate-chain-
# change.sh's own selftest already exercises directly.
new_gatechain_pair() {
  local base="$1" branch="$2"
  local remote="$base/remote.git" seed wt="$base/$branch"
  git init -q --bare "$remote"
  seed="$(mktemp -d)"
  git init -q "$seed"
  mkdir -p "$seed/.husky" "$seed/scripts"
  cat > "$seed/.husky/pre-commit" <<'EOF'
#!/usr/bin/env sh
npm run check:foo
EOF
  cat > "$seed/package.json" <<'EOF'
{"scripts": {"check:foo": "node scripts/check-foo.mjs"}}
EOF
  cat > "$seed/scripts/check-foo.mjs" <<'EOF'
console.log("ok");
EOF
  echo "hello" > "$seed/README.md"
  # Evidence written under .concertino/runs/... below lands INSIDE this
  # fixture's own worktree (main_checkout() resolves a plain clone to
  # itself, exactly like new_stale_base_pair()'s WT) — ignore it, or the
  # gate's own OTHER "worktree has uncommitted changes" precondition trips
  # on the evidence files these tests deliberately create.
  echo ".concertino/" > "$seed/.gitignore"
  git -C "$seed" add -A
  git -C "$seed" -c user.email=t@t.com -c user.name=t commit -q -m init
  git -C "$seed" branch -M main
  git -C "$seed" remote add origin "$remote"
  git -C "$seed" push -q origin main
  rm -rf "$seed"

  git clone -q "$remote" "$wt" 2>/dev/null
  git -C "$wt" -c user.email=t@t.com -c user.name=t checkout -q -b "$branch" origin/main
  printf '%s' "$wt"
}

write_full_checklist() {
  local design_md="$1"
  mkdir -p "$(dirname "$design_md")"
  cat > "$design_md" <<'EOF'
## Context

Some ordinary design content.

## Gate-Chain Implications Checklist

- **What does it execute?** Runs `node scripts/check-foo.mjs`.
- **What environment does it inherit, and from where?** GIT_* vars from the hook.
- **Does it write anything outside its own sandbox?** No.
- **Does it behave differently from a linked worktree than from a main checkout?** No, GIT_WORK_TREE unaffected.
- **What happens on its first run?** It runs live under Husky against the real repo.
EOF
}

write_passing_isolation_transcript() {
  local dest="$1"
  mkdir -p "$(dirname "$dest")"
  cat > "$dest" <<'EOF'
# Gate-in-isolation transcript

## Verdict

**PASS**
EOF
}

echo "assert-phase.sh delivery (CON-132 gate-chain evidence)"

# --- gate-chain diff (.husky touched) + no evidence at all -> FAIL ----------
BASE="$(mktemp -d)"
WT="$(new_gatechain_pair "$BASE" "GC-1")"
cat > "$WT/.husky/pre-commit" <<'EOF'
#!/usr/bin/env sh
npm run check:foo
npm run check:bar
EOF
git -C "$WT" add -A
git -C "$WT" -c user.email=t@t.com -c user.name=t commit -q -m "wire second gate"
git -C "$WT" push -q origin "HEAD:refs/heads/GC-1"
OUT="$BASE/out.txt"; ERR="$BASE/err.txt"
( cd "$WT" && "$SCRIPT" delivery "$WT" "GC-1" ) >"$OUT" 2>"$ERR"
RC=$?
check "exit 1: gate-chain diff, no evidence"  "$RC" "1"
has "names missing design.md checklist"       "Gate-Chain Implications Checklist evidence is missing" "$ERR"
rm -rf "$BASE"

# --- gate-chain diff + checklist only, no isolation evidence -> FAIL -------
BASE="$(mktemp -d)"
WT="$(new_gatechain_pair "$BASE" "GC-2")"
cat > "$WT/scripts/check-foo.mjs" <<'EOF'
console.log("changed");
EOF
git -C "$WT" add -A
git -C "$WT" -c user.email=t@t.com -c user.name=t commit -q -m "modify hook-invoked script"
git -C "$WT" push -q origin "HEAD:refs/heads/GC-2"
write_full_checklist "$WT/.concertino/runs/GC-2/evidence/openspec/changes/some-change/design.md"
OUT="$BASE/out.txt"; ERR="$BASE/err.txt"
( cd "$WT" && "$SCRIPT" delivery "$WT" "GC-2" ) >"$OUT" 2>"$ERR"
RC=$?
check "exit 1: checklist present, isolation evidence missing" "$RC" "1"
has "names the specific missing script" "no isolation-test evidence for changed script scripts/check-foo.mjs" "$ERR"
rm -rf "$BASE"

# --- gate-chain diff touching script A, isolation evidence only for unrelated script B -> FAIL naming A ---
BASE="$(mktemp -d)"
WT="$(new_gatechain_pair "$BASE" "GC-3")"
cat > "$WT/scripts/check-foo.mjs" <<'EOF'
console.log("changed again");
EOF
git -C "$WT" add -A
git -C "$WT" -c user.email=t@t.com -c user.name=t commit -q -m "modify check-foo, not check-bar"
git -C "$WT" push -q origin "HEAD:refs/heads/GC-3"
write_full_checklist "$WT/.concertino/runs/GC-3/evidence/openspec/changes/some-change/design.md"
write_passing_isolation_transcript "$WT/.concertino/runs/GC-3/evidence/.concertino/gate-chain-isolation-evidence/scripts__check-bar.mjs.md"
OUT="$BASE/out.txt"; ERR="$BASE/err.txt"
( cd "$WT" && "$SCRIPT" delivery "$WT" "GC-3" ) >"$OUT" 2>"$ERR"
RC=$?
check "exit 1: evidence for unrelated script does not satisfy the gate" "$RC" "1"
has "names scripts/check-foo.mjs specifically" "no isolation-test evidence for changed script scripts/check-foo.mjs" "$ERR"
rm -rf "$BASE"

# --- gate-chain diff + checklist + isolation evidence for every touched script -> PASS ---
BASE="$(mktemp -d)"
WT="$(new_gatechain_pair "$BASE" "GC-4")"
cat > "$WT/scripts/check-foo.mjs" <<'EOF'
console.log("changed once more");
EOF
git -C "$WT" add -A
git -C "$WT" -c user.email=t@t.com -c user.name=t commit -q -m "modify check-foo, with full evidence"
git -C "$WT" push -q origin "HEAD:refs/heads/GC-4"
write_full_checklist "$WT/.concertino/runs/GC-4/evidence/openspec/changes/some-change/design.md"
write_passing_isolation_transcript "$WT/.concertino/runs/GC-4/evidence/.concertino/gate-chain-isolation-evidence/scripts__check-foo.mjs.md"
OUT="$BASE/out.txt"; ERR="$BASE/err.txt"
( cd "$WT" && "$SCRIPT" delivery "$WT" "GC-4" ) >"$OUT" 2>"$ERR"
RC=$?
check "exit 0: full evidence present for every touched script" "$RC" "0"
check "stdout is PASS delivery" "$(cat "$OUT")" "PASS delivery"
rm -rf "$BASE"

# --- non-gate-chain diff -> PASS, unaffected by this requirement -----------
BASE="$(mktemp -d)"
WT="$(new_gatechain_pair "$BASE" "GC-5")"
echo "more docs" >> "$WT/README.md"
git -C "$WT" add -A
git -C "$WT" -c user.email=t@t.com -c user.name=t commit -q -m "docs only"
git -C "$WT" push -q origin "HEAD:refs/heads/GC-5"
OUT="$BASE/out.txt"; ERR="$BASE/err.txt"
( cd "$WT" && "$SCRIPT" delivery "$WT" "GC-5" ) >"$OUT" 2>"$ERR"
RC=$?
check "exit 0: non-gate-chain diff needs no evidence" "$RC" "0"
check "stdout is PASS delivery (non-gate-chain)" "$(cat "$OUT")" "PASS delivery"
rm -rf "$BASE"

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
