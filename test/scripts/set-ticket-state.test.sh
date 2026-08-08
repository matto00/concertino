#!/usr/bin/env bash
# Shell tests for core/scripts/set-ticket-state.sh.
# Run: bash test/scripts/set-ticket-state.test.sh
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/core/scripts/set-ticket-state.sh"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL $1"; echo "       $2"; }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected [$3] got [$2]"; fi; }

echo "set-ticket-state.sh"

seed() {
  D="$(mktemp -d)"
  printf '%s\n' \
    '---' \
    'id: CON-12' \
    'title: A ticket' \
    'state: unstarted' \
    'priority: 2' \
    '---' \
    '' \
    '## Description' \
    '' \
    'Body text with a state: word that must not be rewritten.' \
    > "$D/CON-12.md"
}

# CRLF-terminated variant of seed(): every line, frontmatter and body alike,
# ends \r\n. lib/ui/tickets/local.js's FRONTMATTER_RE accepts \r?\n, so the
# store parses this fine — the write-back script must too.
seed_crlf() {
  D="$(mktemp -d)"
  printf '%s\r\n' \
    '---' \
    'id: CON-12' \
    'title: A ticket' \
    'state: unstarted' \
    'priority: 2' \
    '---' \
    '' \
    '## Description' \
    '' \
    'Body text with a state: word that must not be rewritten.' \
    > "$D/CON-12.md"
}

# CRLF ticket whose BODY has its own line starting literally with `state:` —
# the shape that exposes a closing-fence match too narrow to see \r: if the
# loop never recognises the closing `---\r` line, it keeps treating body
# lines as frontmatter and rewrites this one too.
seed_crlf_body_state() {
  D="$(mktemp -d)"
  printf '%s\r\n' \
    '---' \
    'id: CON-14' \
    'title: A ticket' \
    'state: unstarted' \
    'priority: 2' \
    '---' \
    '' \
    '## Notes' \
    '' \
    'state: this line starts with state: in the body' \
    > "$D/CON-14.md"
}

# --- happy path -------------------------------------------------------------
seed
OUT="$("$SCRIPT" "$D" CON-12 started)"; RC=$?
check "valid transition: exit 0"   "$RC"  "0"
check "valid transition: reports"  "$OUT" "OK CON-12 started"
check "valid transition: rewrote frontmatter" \
  "$(grep -c '^state: started$' "$D/CON-12.md")" "1"
check "valid transition: left the body alone" \
  "$(grep -c 'state: word that must not be rewritten' "$D/CON-12.md")" "1"
check "valid transition: title intact" \
  "$(grep -c '^title: A ticket$' "$D/CON-12.md")" "1"
rm -rf "$D"

# --- idempotence ------------------------------------------------------------
seed
"$SCRIPT" "$D" CON-12 completed >/dev/null
"$SCRIPT" "$D" CON-12 completed >/dev/null
check "idempotent: one state line" "$(grep -c '^state: ' "$D/CON-12.md")" "1"
check "idempotent: value is completed" "$(grep -c '^state: completed$' "$D/CON-12.md")" "1"
rm -rf "$D"

# --- all five states are accepted -------------------------------------------
seed
ALL_OK=0
for s in backlog unstarted started completed canceled; do
  "$SCRIPT" "$D" CON-12 "$s" >/dev/null 2>&1 || ALL_OK=1
done
check "all five states accepted" "$ALL_OK" "0"
rm -rf "$D"

# --- rejections -------------------------------------------------------------
seed
OUT="$("$SCRIPT" "$D" CON-12 in-review 2>&1)"; RC=$?
check "unknown state: exit 1"       "$RC" "1"
case "$OUT" in *"in-review"*) ok "unknown state: names the bad value";;
  *) bad "unknown state: names the bad value" "got [$OUT]";; esac
check "unknown state: file untouched" "$(grep -c '^state: unstarted$' "$D/CON-12.md")" "1"
rm -rf "$D"

seed
"$SCRIPT" "$D" CON-99 started >/dev/null 2>&1; RC=$?
check "missing ticket: exit 1" "$RC" "1"
rm -rf "$D"

seed
printf '%s\n' 'no frontmatter at all' > "$D/CON-13.md"
"$SCRIPT" "$D" CON-13 started >/dev/null 2>&1; RC=$?
check "no frontmatter: exit 1" "$RC" "1"
rm -rf "$D"

# --- CRLF tickets -------------------------------------------------------------
seed_crlf
OUT="$("$SCRIPT" "$D" CON-12 started)"; RC=$?
check "CRLF: exit 0"  "$RC"  "0"
check "CRLF: reports" "$OUT" "OK CON-12 started"
check "CRLF: rewrote frontmatter, CR preserved" \
  "$(grep -c $'^state: started\r$' "$D/CON-12.md")" "1"
check "CRLF: left the body alone" \
  "$(grep -c 'state: word that must not be rewritten' "$D/CON-12.md")" "1"
check "CRLF: body line still ends in CR" \
  "$(grep -c $'Body text with a state: word that must not be rewritten.\r$' "$D/CON-12.md")" "1"
check "CRLF: title intact" \
  "$(grep -c $'^title: A ticket\r$' "$D/CON-12.md")" "1"
rm -rf "$D"

# CRLF ticket with a body line starting `state:` — exercises the
# closing-fence \r blind spot directly: if the loop fails to recognise the
# closing `---\r`, this body line gets overwritten to `state: started` too,
# and the count below comes back 2 instead of 1.
seed_crlf_body_state
"$SCRIPT" "$D" CON-14 started >/dev/null
check "CRLF body-state-line: frontmatter rewritten" \
  "$(grep -c $'^state: started\r$' "$D/CON-14.md")" "1"
check "CRLF body-state-line: body line preserved verbatim" \
  "$(grep -c 'state: this line starts with state: in the body' "$D/CON-14.md")" "1"
rm -rf "$D"

# --- ticket id path traversal ------------------------------------------------
seed
OUTSIDE="$(mktemp -d)"
BAD_ID="../$(basename "$OUTSIDE")/pwned"
OUT="$("$SCRIPT" "$D" "$BAD_ID" started 2>&1)"; RC=$?
check "path traversal: exit 1" "$RC" "1"
case "$OUT" in *"$BAD_ID"*) ok "path traversal: names the bad value";;
  *) bad "path traversal: names the bad value" "got [$OUT]";; esac
check "path traversal: no file written outside tickets-dir" \
  "$([ -e "$OUTSIDE/pwned.md" ] && echo yes || echo no)" "no"
check "path traversal: original ticket untouched" \
  "$(grep -c '^state: unstarted$' "$D/CON-12.md")" "1"
rm -rf "$OUTSIDE"
rm -rf "$D"

seed
OUT="$("$SCRIPT" "$D" '..' started 2>&1)"; RC=$?
check "bare .. id: exit 1" "$RC" "1"
rm -rf "$D"

# --- canonical ticket shape (CON-44) ----------------------------------------
# This script used to carry its own looser id pattern that accepted dots — the
# one shape lib/ui/ticket.js singles out as breaking tmux's session:window.pane
# addressing. It now shares the canonical pattern with assert-phase.sh and
# friends (test/scripts/ticket-pattern.test.sh guards the five copies against
# drift); these cases prove the SCRIPT actually rejects/accepts accordingly,
# not just that the literal text matches.
seed
printf '%s\n' '---' 'title: Dotted' 'state: unstarted' '---' '' 'b' > "$D/CON-1.2.md"
OUT="$("$SCRIPT" "$D" 'CON-1.2' started 2>&1)"; RC=$?
check "dotted id: exit 1" "$RC" "1"
check "dotted id: the file is left untouched" \
  "$(grep -c '^state: unstarted$' "$D/CON-1.2.md")" "1"
case "$OUT" in *'CON-1.2'*) ok "dotted id: names the bad value";;
  *) bad "dotted id: names the bad value" "got [$OUT]";; esac
rm -rf "$D"

# A kebab-case slug is NOT a ticket id — the canonical shape must end in a
# digit. tickets/fix-login.md is the exact file the dashboard now refuses to
# list, so the write-back seam must refuse it too rather than disagreeing.
seed
printf '%s\n' '---' 'title: Slug' 'state: unstarted' '---' '' 'b' > "$D/fix-login.md"
OUT="$("$SCRIPT" "$D" 'fix-login' started 2>&1)"; RC=$?
check "kebab slug id: exit 1" "$RC" "1"
check "kebab slug id: the file is left untouched" \
  "$(grep -c '^state: unstarted$' "$D/fix-login.md")" "1"
rm -rf "$D"

# Conforming shapes the canonical pattern admits beyond TEAM-123 still work.
seed
printf '%s\n' '---' 'title: Underscored' 'state: unstarted' '---' '' 'b' > "$D/a_b_c-9.md"
OUT="$("$SCRIPT" "$D" 'a_b_c-9' completed 2>&1)"; RC=$?
check "underscored id: exit 0" "$RC" "0"
check "underscored id: rewritten" "$(grep -c '^state: completed$' "$D/a_b_c-9.md")" "1"
rm -rf "$D"

# --- no leftover temp files -------------------------------------------------
seed
"$SCRIPT" "$D" CON-12 started >/dev/null
check "no temp files left behind" "$(find "$D" -name '*.tmp*' | wc -l | tr -d ' ')" "0"
rm -rf "$D"

# =============================================================================
# CON-90: commit + best-effort push (local-ticket-state-durability).
#
# Every case above this point deliberately seeds a bare `mktemp -d` scratch
# dir with NO `git init` — that stays true unmodified, so those cases now
# exercise the "not a git working tree" no-op path (design.md Decision 4)
# implicitly. The cases below seed a REAL git repo instead.
# =============================================================================

write_ticket_file() {
  # $1 = full path to write CON-12.md-shaped content to.
  printf '%s\n' \
    '---' \
    'id: CON-12' \
    'title: A ticket' \
    'state: unstarted' \
    'priority: 2' \
    '---' \
    '' \
    '## Description' \
    '' \
    'Body text.' \
    > "$1"
}

# Seeds $D as a real git repo (repo root == tickets dir) on branch `main`,
# with CON-12.md already committed, and a throwaway identity scoped to this
# repo only (git config, not --global).
seed_git() {
  D="$(mktemp -d)"
  git -C "$D" init -q -b main
  git -C "$D" config user.email "concertino-test@example.invalid"
  git -C "$D" config user.name "Concertino Test"
  write_ticket_file "$D/CON-12.md"
  git -C "$D" add -- CON-12.md
  git -C "$D" commit -q -m "seed CON-12"
}

# --- commits the write when tickets-dir is a real git working tree ---------
seed_git
"$SCRIPT" "$D" CON-12 started >/dev/null
check "git repo: exactly one new commit" \
  "$(git -C "$D" log --oneline | wc -l | tr -d ' ')" "2"
check "git repo: commit touches only CON-12.md" \
  "$(git -C "$D" show --name-only --format= -1 | tr -d '[:space:]')" "CON-12.md"
check "git repo: working tree clean after commit" \
  "$(git -C "$D" status --porcelain)" ""
check "git repo: state actually rewritten" \
  "$(grep -c '^state: started$' "$D/CON-12.md")" "1"
rm -rf "$D"

# --- an unrelated uncommitted change is left exactly as it was -------------
seed_git
printf 'orig\n' > "$D/OTHER.md"
git -C "$D" add -- OTHER.md
git -C "$D" commit -q -m "seed OTHER"
printf 'orig\nchanged\n' > "$D/OTHER.md"
"$SCRIPT" "$D" CON-12 started >/dev/null
check "unrelated file: still modified and uncommitted" \
  "$(git -C "$D" status --porcelain -- OTHER.md)" " M OTHER.md"
check "unrelated file: ticket commit still landed" \
  "$(git -C "$D" log -1 --format=%s)" "tickets: CON-12 -> started"
rm -rf "$D"

# --- push succeeds -----------------------------------------------------------
seed_git
BARE="$(mktemp -d)"
git init -q --bare "$BARE"
git -C "$D" remote add origin "$BARE"
git -C "$D" push -q origin HEAD:main
"$SCRIPT" "$D" CON-12 started >/dev/null
check "push succeeds: remote branch has the new commit" \
  "$(git --git-dir="$BARE" log -1 --format=%s main)" "tickets: CON-12 -> started"
rm -rf "$D" "$BARE"

# --- push is rejected (remote has diverged) ---------------------------------
seed_git
BARE="$(mktemp -d)"
git init -q --bare "$BARE"
git -C "$D" remote add origin "$BARE"
git -C "$D" push -q origin HEAD:main
CLONE="$(mktemp -d)"
git clone -q "$BARE" "$CLONE"
git -C "$CLONE" config user.email "concertino-test@example.invalid"
git -C "$CLONE" config user.name "Concertino Test"
printf 'divergent\n' > "$CLONE/DIVERGE.md"
git -C "$CLONE" add -- DIVERGE.md
git -C "$CLONE" commit -q -m "divergent commit"
git -C "$CLONE" push -q origin HEAD:main
ERRFILE="$(mktemp)"
OUT="$("$SCRIPT" "$D" CON-12 started 2>"$ERRFILE")"; RC=$?
check "push rejected: exit 0" "$RC" "0"
check "push rejected: still reports OK" "$OUT" "OK CON-12 started"
check "push rejected: local commit still present" \
  "$(git -C "$D" log -1 --format=%s)" "tickets: CON-12 -> started"
check "push rejected: remote NOT force-pushed over" \
  "$(git --git-dir="$BARE" log -1 --format=%s main)" "divergent commit"
check "push rejected: a stderr note was printed" \
  "$([ -s "$ERRFILE" ] && echo yes || echo no)" "yes"
rm -rf "$D" "$BARE" "$CLONE"
rm -f "$ERRFILE"

# --- detached HEAD: commit happens, push is skipped, no error --------------
seed_git
git -C "$D" checkout -q --detach
OUT="$("$SCRIPT" "$D" CON-12 started 2>&1)"; RC=$?
check "detached HEAD: exit 0" "$RC" "0"
check "detached HEAD: still reports OK" "$OUT" "OK CON-12 started"
check "detached HEAD: commit still happened" \
  "$(git -C "$D" log -1 --format=%s)" "tickets: CON-12 -> started"
rm -rf "$D"

# --- REQUIRED regression (design.md Decision 2): relative <tickets-dir> ----
# Mirrors the orchestrator's actual production call shape exactly:
# `set-ticket-state.sh tickets "$TICKET_ID" started` with cwd = the repo
# root. A naive `git -C "$DIR" add -- "$FILE"` implementation (reusing the
# already-$DIR-prefixed $FILE variable as the pathspec) fails here with
# "pathspec 'tickets/CON-12.md' did not match any files" because -C tickets
# already changed the root the pathspec resolves against — this case is the
# only one in this file that can catch that defect; every other case above
# uses an absolute mktemp -d path and would pass either way.
REPO="$(mktemp -d)"
git -C "$REPO" init -q -b main
git -C "$REPO" config user.email "concertino-test@example.invalid"
git -C "$REPO" config user.name "Concertino Test"
mkdir -p "$REPO/tickets"
write_ticket_file "$REPO/tickets/CON-12.md"
git -C "$REPO" add -- tickets/CON-12.md
git -C "$REPO" commit -q -m "seed CON-12"
OUT="$(cd "$REPO" && "$SCRIPT" tickets CON-12 started)"; RC=$?
check "relative tickets-dir: exit 0" "$RC" "0"
check "relative tickets-dir: reports OK" "$OUT" "OK CON-12 started"
check "relative tickets-dir: commit landed" \
  "$(git -C "$REPO" log -1 --format=%s)" "tickets: CON-12 -> started"
check "relative tickets-dir: commit touches only tickets/CON-12.md" \
  "$(git -C "$REPO" show --name-only --format= -1 | tr -d '[:space:]')" "tickets/CON-12.md"
check "relative tickets-dir: working tree clean after commit" \
  "$(git -C "$REPO" status --porcelain)" ""
rm -rf "$REPO"

echo "  ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ]
