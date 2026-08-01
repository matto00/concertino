#!/usr/bin/env bash
# Shell tests for core/scripts/triage-followup.sh.
# Run: bash test/scripts/triage-followup.test.sh
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/core/scripts/triage-followup.sh"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL $1"; echo "       $2"; }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected [$3] got [$2]"; fi; }

echo "triage-followup.sh"

# A throwaway git repo with a "main" base branch and a "feature" branch that
# has modified a.js (and left b.js/c.js untouched) — exercises the real
# `git -C <worktree> diff --name-only <base>...HEAD` mechanism, not a mock.
new_repo() {
  local d; d="$(mktemp -d)"
  git -C "$d" init -q
  git -C "$d" -c user.email=t@t.com -c user.name=t config user.email t@t.com
  git -C "$d" -c user.email=t@t.com -c user.name=t config user.name t
  printf 'one\n' > "$d/a.js"
  printf 'two\n' > "$d/b.js"
  printf 'three\n' > "$d/c.js"
  git -C "$d" add .
  git -C "$d" commit -q -m base
  git -C "$d" branch -M main
  git -C "$d" checkout -q -b feature
  printf 'one changed\n' >> "$d/a.js"
  git -C "$d" commit -q -am "modify a.js"
  printf '%s' "$d"
}

# --- high overlap + small effort -> fold-in ---------------------------------
REPO="$(new_repo)"
OUT="$("$SCRIPT" description="tighten the icon set" files=a.js ac_relevant=no effort=small worktree="$REPO" base=main)"
RC=$?
check "high overlap: exits 0"                 "$RC" "0"
check "high overlap: overlap is high"         "$(printf '%s' "$OUT" | grep -c 'overlap:.*high')" "1"
check "high overlap: recommends fold-in"      "$(printf '%s' "$OUT" | grep -c 'recommendation:.*fold-in')" "1"
check "high overlap: names the rule"          "$(printf '%s' "$OUT" | grep -c 'overlap=high -> fold-in')" "1"
check "high overlap: notes discard is always valid" \
  "$(printf '%s' "$OUT" | grep -ci 'discard is always a valid choice')" "1"
rm -rf "$REPO"

# --- ac_relevant=yes -> fold-in regardless of effort/overlap ----------------
REPO="$(new_repo)"
OUT="$("$SCRIPT" description="add the missing validation the AC requires" files=unknown ac_relevant=yes effort=large worktree="$REPO")"
RC=$?
check "ac_relevant=yes: exits 0"              "$RC" "0"
check "ac_relevant=yes: recommends fold-in"   "$(printf '%s' "$OUT" | grep -c 'recommendation:.*fold-in')" "1"
check "ac_relevant=yes: rule cites ac_relevant=yes" \
  "$(printf '%s' "$OUT" | grep -c 'ac_relevant=yes -> fold-in')" "1"
rm -rf "$REPO"

# --- large effort -> standalone, regardless of overlap ----------------------
REPO="$(new_repo)"
OUT="$("$SCRIPT" description="add a new dashboard screen" files=a.js ac_relevant=no effort=large worktree="$REPO" base=main)"
RC=$?
check "large effort: exits 0"                 "$RC" "0"
check "large effort: recommends standalone"   "$(printf '%s' "$OUT" | grep -c 'recommendation:.*standalone')" "1"
check "large effort: rule cites effort=large" \
  "$(printf '%s' "$OUT" | grep -c 'effort=large -> standalone')" "1"
rm -rf "$REPO"

# --- a missing required field fails without printing partial output --------
REPO="$(new_repo)"
OUT="$("$SCRIPT" description=x ac_relevant=no worktree="$REPO" 2>/tmp/tf-err)"
RC=$?
check "missing field: exit non-zero"      "$([ "$RC" -ne 0 ] && echo yes || echo no)" "yes"
check "missing field: nothing on stdout"  "$(printf '%s' "$OUT" | wc -c | tr -d ' ')" "0"
check "missing field: FAIL on stderr"     "$(grep -c '^FAIL' /tmp/tf-err)" "1"
check "missing field: names files as missing"  "$(grep -c 'files' /tmp/tf-err)" "1"
check "missing field: names effort as missing" "$(grep -c 'effort' /tmp/tf-err)" "1"
rm -f /tmp/tf-err
rm -rf "$REPO"

# --- files=unknown -> unknown overlap, never treated as overlap ------------
REPO="$(new_repo)"
OUT="$("$SCRIPT" description="some vague future work" files=unknown ac_relevant=no effort=small worktree="$REPO" base=main)"
RC=$?
check "files=unknown: exits 0"                "$RC" "0"
check "files=unknown: overlap is unknown"     "$(printf '%s' "$OUT" | grep -c 'overlap:.*unknown')" "1"
check "files=unknown: recommends standalone (unknown is never overlap)" \
  "$(printf '%s' "$OUT" | grep -c 'recommendation:.*standalone')" "1"
rm -rf "$REPO"

# --- partial overlap (small effort) -> standalone ---------------------------
REPO="$(new_repo)"
OUT="$("$SCRIPT" description="tidy up related files" files=a.js,b.js,c.js,unrelated.js ac_relevant=no effort=small worktree="$REPO" base=main)"
RC=$?
check "partial overlap: exits 0"              "$RC" "0"
check "partial overlap: overlap is partial"   "$(printf '%s' "$OUT" | grep -c 'overlap:.*partial')" "1"
check "partial overlap: recommends standalone" "$(printf '%s' "$OUT" | grep -c 'recommendation:.*standalone')" "1"
rm -rf "$REPO"

# --- no overlap (small effort) -> standalone --------------------------------
REPO="$(new_repo)"
OUT="$("$SCRIPT" description="totally unrelated tweak" files=unrelated.js ac_relevant=no effort=small worktree="$REPO" base=main)"
RC=$?
check "no overlap: overlap is none"           "$(printf '%s' "$OUT" | grep -c 'overlap:.*none')" "1"
check "no overlap: recommends standalone"     "$(printf '%s' "$OUT" | grep -c 'recommendation:.*standalone')" "1"
rm -rf "$REPO"

# --- an out-of-enum ac_relevant value fails cleanly -------------------------
REPO="$(new_repo)"
OUT="$("$SCRIPT" description=x files=a.js ac_relevant=maybe effort=small worktree="$REPO" base=main 2>/tmp/tf-err)"
RC=$?
check "bad ac_relevant: exit non-zero"     "$([ "$RC" -ne 0 ] && echo yes || echo no)" "yes"
check "bad ac_relevant: nothing on stdout" "$(printf '%s' "$OUT" | wc -c | tr -d ' ')" "0"
check "bad ac_relevant: FAIL on stderr"    "$(grep -c '^FAIL' /tmp/tf-err)" "1"
check "bad ac_relevant: names the bad value" "$(grep -c 'maybe' /tmp/tf-err)" "1"
rm -f /tmp/tf-err
rm -rf "$REPO"

# --- an out-of-enum effort value fails cleanly ------------------------------
REPO="$(new_repo)"
OUT="$("$SCRIPT" description=x files=a.js ac_relevant=no effort=medium worktree="$REPO" base=main 2>/tmp/tf-err)"
RC=$?
check "bad effort: exit non-zero"     "$([ "$RC" -ne 0 ] && echo yes || echo no)" "yes"
check "bad effort: nothing on stdout" "$(printf '%s' "$OUT" | wc -c | tr -d ' ')" "0"
check "bad effort: FAIL on stderr"    "$(grep -c '^FAIL' /tmp/tf-err)" "1"
check "bad effort: names the bad value" "$(grep -c 'medium' /tmp/tf-err)" "1"
rm -f /tmp/tf-err
rm -rf "$REPO"

# --- a worktree that is not a git repository fails cleanly ------------------
NOTGIT="$(mktemp -d)"
OUT="$("$SCRIPT" description=x files=a.js ac_relevant=no effort=small worktree="$NOTGIT" base=main 2>/tmp/tf-err)"
RC=$?
check "non-git worktree: exit non-zero"     "$([ "$RC" -ne 0 ] && echo yes || echo no)" "yes"
check "non-git worktree: nothing on stdout" "$(printf '%s' "$OUT" | wc -c | tr -d ' ')" "0"
check "non-git worktree: FAIL on stderr"    "$(grep -c '^FAIL' /tmp/tf-err)" "1"
rm -f /tmp/tf-err
rm -rf "$NOTGIT"

# --- base= defaults to CONCERTINO_BASE_BRANCH when omitted ------------------
REPO="$(new_repo)"
OUT="$(CONCERTINO_BASE_BRANCH=main "$SCRIPT" description="tighten the icon set" files=a.js ac_relevant=no effort=small worktree="$REPO")"
RC=$?
check "base defaults from CONCERTINO_BASE_BRANCH: exits 0" "$RC" "0"
check "base defaults from CONCERTINO_BASE_BRANCH: overlap high" \
  "$(printf '%s' "$OUT" | grep -c 'overlap:.*high')" "1"
rm -rf "$REPO"

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
