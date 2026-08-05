#!/usr/bin/env bash
# Shell tests for core/scripts/persist-evidence.sh. Run: bash test/scripts/persist-evidence.test.sh
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/core/scripts/persist-evidence.sh"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL $1"; echo "       $2"; }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected [$3] got [$2]"; fi; }

# Each test runs in a throwaway git repo so the script's main-checkout
# resolution is exercised for real.
new_repo() {
  local d; d="$(mktemp -d)"
  git -C "$d" init -q
  git -C "$d" commit -q --allow-empty -m init
  printf '%s' "$d"
}

echo "persist-evidence.sh"

# --- copies the artifact into the MAIN checkout's evidence dir, not the worktree ---
REPO="$(new_repo)"
git -C "$REPO" worktree add -q "$REPO/wt" -b feat 2>/dev/null
printf 'hello proposal\n' > "$REPO/wt/proposal.md"
OUT="$(cd "$REPO/wt" && "$SCRIPT" TICKET-1 "$REPO/wt/proposal.md")"
RC=$?
REF="$(printf '%s' "$OUT" | sed -n 's/^READY ref=//p')"
check "exit 0 on success"        "$RC" "0"
check "READY line printed"       "$([ -n "$REF" ] && echo yes || echo no)" "yes"
check "ref lands in main checkout's evidence dir" \
  "$REF" "$REPO/.concertino/runs/TICKET-1/evidence/proposal.md"
check "ref file exists"          "$([ -f "$REF" ] && echo yes || echo no)" "yes"
check "ref content matches source" "$(cat "$REF")" "hello proposal"
check "not copied into the worktree" \
  "$([ -f "$REPO/wt/.concertino/runs/TICKET-1/evidence/proposal.md" ] && echo yes || echo no)" "no"
rm -rf "$REPO"

# --- ref survives the worktree being removed (the whole point of the script) ---
REPO="$(new_repo)"
git -C "$REPO" worktree add -q "$REPO/wt" -b feat 2>/dev/null
printf 'design content\n' > "$REPO/wt/design.md"
OUT="$(cd "$REPO/wt" && "$SCRIPT" TICKET-2 "$REPO/wt/design.md")"
REF="$(printf '%s' "$OUT" | sed -n 's/^READY ref=//p')"
git -C "$REPO" worktree remove --force "$REPO/wt"
check "ref still exists after worktree removal" "$([ -f "$REF" ] && echo yes || echo no)" "yes"
check "ref still readable after worktree removal" "$(cat "$REF" 2>/dev/null)" "design content"
rm -rf "$REPO"

# --- missing source fails without printing a READY line --------------------
REPO="$(new_repo)"
OUT="$(cd "$REPO" && "$SCRIPT" TICKET-3 "$REPO/does-not-exist.md" 2>/tmp/persist-evidence-test-err)"
RC=$?
check "exit non-zero on missing source" "$([ "$RC" -ne 0 ] && echo yes || echo no)" "yes"
check "no READY line on failure" "$(printf '%s' "$OUT" | grep -c '^READY')" "0"
check "FAIL printed to stderr" "$(grep -c '^FAIL' /tmp/persist-evidence-test-err)" "1"
rm -f /tmp/persist-evidence-test-err
rm -rf "$REPO"

# --- re-running is idempotent: overwrites with current content -------------
REPO="$(new_repo)"
printf 'v1\n' > "$REPO/report.md"
OUT1="$(cd "$REPO" && "$SCRIPT" TICKET-4 "$REPO/report.md")"
REF1="$(printf '%s' "$OUT1" | sed -n 's/^READY ref=//p')"
printf 'v2\n' > "$REPO/report.md"
OUT2="$(cd "$REPO" && "$SCRIPT" TICKET-4 "$REPO/report.md")"
REF2="$(printf '%s' "$OUT2" | sed -n 's/^READY ref=//p')"
check "same ref path across re-runs" "$REF2" "$REF1"
check "re-run reflects the current source content" "$(cat "$REF2")" "v2"
rm -rf "$REPO"

# --- a traversal-shaped TICKET_ID fails without touching the filesystem ----
REPO="$(new_repo)"
printf 'secret\n' > "$REPO/source.md"
BEFORE="$(find "$REPO" -type f | sort)"
OUT="$(cd "$REPO" && "$SCRIPT" '../../../../escape' "$REPO/source.md" 2>/tmp/persist-evidence-test-err)"
RC=$?
AFTER="$(find "$REPO" -type f | sort)"
check "exit non-zero on traversal-shaped TICKET_ID" "$([ "$RC" -ne 0 ] && echo yes || echo no)" "yes"
check "no READY line on traversal-shaped TICKET_ID" "$(printf '%s' "$OUT" | grep -c '^READY')" "0"
check "FAIL printed to stderr on traversal-shaped TICKET_ID" "$(grep -c '^FAIL' /tmp/persist-evidence-test-err)" "1"
check "no new file created outside the runs directory" "$AFTER" "$BEFORE"
check "no runs directory created at all" "$([ -d "$REPO/.concertino/runs" ] && echo yes || echo no)" "no"
# A well-formed sibling ticket id still succeeds in the same run.
OUT2="$(cd "$REPO" && "$SCRIPT" CON-14 "$REPO/source.md")"
RC2=$?
REF2="$(printf '%s' "$OUT2" | sed -n 's/^READY ref=//p')"
check "well-formed sibling ticket id still succeeds" "$RC2" "0"
check "well-formed sibling ticket id ref exists" "$([ -f "$REF2" ] && echo yes || echo no)" "yes"
rm -f /tmp/persist-evidence-test-err
rm -rf "$REPO"

# --- two same-named artifacts from different directories don't collide -----
REPO="$(new_repo)"
git -C "$REPO" worktree add -q "$REPO/wt" -b feat 2>/dev/null
mkdir -p "$REPO/wt/specs/ticket-id-path-safety" "$REPO/wt/specs/evidence-telemetry"
printf 'ticket-id-path-safety delta\n' > "$REPO/wt/specs/ticket-id-path-safety/spec.md"
printf 'evidence-telemetry delta\n' > "$REPO/wt/specs/evidence-telemetry/spec.md"
OUT_A="$(cd "$REPO/wt" && "$SCRIPT" TICKET-5 "$REPO/wt/specs/ticket-id-path-safety/spec.md")"
RC_A=$?
REF_A="$(printf '%s' "$OUT_A" | sed -n 's/^READY ref=//p')"
OUT_B="$(cd "$REPO/wt" && "$SCRIPT" TICKET-5 "$REPO/wt/specs/evidence-telemetry/spec.md")"
RC_B=$?
REF_B="$(printf '%s' "$OUT_B" | sed -n 's/^READY ref=//p')"
check "collision case: first call exits 0"  "$RC_A" "0"
check "collision case: second call exits 0" "$RC_B" "0"
check "collision case: refs are distinct" "$([ "$REF_A" != "$REF_B" ] && echo yes || echo no)" "yes"
check "collision case: first ref exists"  "$([ -f "$REF_A" ] && echo yes || echo no)" "yes"
check "collision case: second ref exists" "$([ -f "$REF_B" ] && echo yes || echo no)" "yes"
check "collision case: first ref has its own content"  "$(cat "$REF_A")" "ticket-id-path-safety delta"
check "collision case: second ref has its own content" "$(cat "$REF_B")" "evidence-telemetry delta"
check "collision case: first ref matches worktree-relative path" \
  "$REF_A" "$REPO/.concertino/runs/TICKET-5/evidence/specs/ticket-id-path-safety/spec.md"
check "collision case: second ref matches worktree-relative path" \
  "$REF_B" "$REPO/.concertino/runs/TICKET-5/evidence/specs/evidence-telemetry/spec.md"
rm -rf "$REPO"

# --- a source outside any git working tree fails rather than risking a collision --
OUTSIDE="$(mktemp -d)"
printf 'no repo here\n' > "$OUTSIDE/spec.md"
OUT="$(cd "$OUTSIDE" && "$SCRIPT" TICKET-6 "$OUTSIDE/spec.md" 2>/tmp/persist-evidence-test-err)"
RC=$?
check "exit non-zero when source is outside any git working tree" "$([ "$RC" -ne 0 ] && echo yes || echo no)" "yes"
check "no READY line when source is outside any git working tree" "$(printf '%s' "$OUT" | grep -c '^READY')" "0"
check "FAIL printed to stderr when source is outside any git working tree" "$(grep -c '^FAIL' /tmp/persist-evidence-test-err)" "1"
rm -f /tmp/persist-evidence-test-err
rm -rf "$OUTSIDE"

# --- --no-clobber with no existing destination succeeds like the default ---
REPO="$(new_repo)"
printf 'first write\n' > "$REPO/report.md"
OUT="$(cd "$REPO" && "$SCRIPT" TICKET-7 "$REPO/report.md" --no-clobber)"
RC=$?
REF="$(printf '%s' "$OUT" | sed -n 's/^READY ref=//p')"
check "--no-clobber, no existing dest: exit 0"      "$RC" "0"
check "--no-clobber, no existing dest: ref exists"  "$([ -f "$REF" ] && echo yes || echo no)" "yes"
check "--no-clobber, no existing dest: content matches" "$(cat "$REF")" "first write"
rm -rf "$REPO"

# --- --no-clobber + identical existing content is a no-op success ----------
REPO="$(new_repo)"
printf 'same content\n' > "$REPO/report.md"
OUT1="$(cd "$REPO" && "$SCRIPT" TICKET-8 "$REPO/report.md" --no-clobber)"
REF1="$(printf '%s' "$OUT1" | sed -n 's/^READY ref=//p')"
OUT2="$(cd "$REPO" && "$SCRIPT" TICKET-8 "$REPO/report.md" --no-clobber)"
RC2=$?
REF2="$(printf '%s' "$OUT2" | sed -n 's/^READY ref=//p')"
check "--no-clobber, identical re-run: exit 0"        "$RC2" "0"
check "--no-clobber, identical re-run: same ref"      "$REF2" "$REF1"
check "--no-clobber, identical re-run: content intact" "$(cat "$REF2")" "same content"
rm -rf "$REPO"

# --- --no-clobber + differing existing content fails, destination untouched -
REPO="$(new_repo)"
printf 'sub-run 1 report\n' > "$REPO/report.md"
OUT1="$(cd "$REPO" && "$SCRIPT" TICKET-9 "$REPO/report.md" --no-clobber)"
REF1="$(printf '%s' "$OUT1" | sed -n 's/^READY ref=//p')"
printf 'sub-run 2 report (different)\n' > "$REPO/report.md"
OUT2="$(cd "$REPO" && "$SCRIPT" TICKET-9 "$REPO/report.md" --no-clobber 2>/tmp/persist-evidence-test-err)"
RC2=$?
check "--no-clobber, differing content: exit non-zero" "$([ "$RC2" -ne 0 ] && echo yes || echo no)" "yes"
check "--no-clobber, differing content: no READY line" "$(printf '%s' "$OUT2" | grep -c '^READY')" "0"
check "--no-clobber, differing content: FAIL on stderr" "$(grep -c '^FAIL' /tmp/persist-evidence-test-err)" "1"
check "--no-clobber, differing content: destination unchanged" "$(cat "$REF1")" "sub-run 1 report"
rm -f /tmp/persist-evidence-test-err
rm -rf "$REPO"

# --- omitting --no-clobber still unconditionally overwrites (regression) ---
REPO="$(new_repo)"
printf 'v1\n' > "$REPO/report.md"
OUT1="$(cd "$REPO" && "$SCRIPT" TICKET-10 "$REPO/report.md")"
REF1="$(printf '%s' "$OUT1" | sed -n 's/^READY ref=//p')"
printf 'v2 (different)\n' > "$REPO/report.md"
OUT2="$(cd "$REPO" && "$SCRIPT" TICKET-10 "$REPO/report.md")"
RC2=$?
check "no flag: exit 0 despite differing content" "$RC2" "0"
check "no flag: destination overwritten"          "$(cat "$REF1")" "v2 (different)"
rm -rf "$REPO"

# --- an unrecognized third argument fails loudly rather than being ignored -
REPO="$(new_repo)"
printf 'content\n' > "$REPO/report.md"
OUT="$(cd "$REPO" && "$SCRIPT" TICKET-11 "$REPO/report.md" --bogus-flag 2>/tmp/persist-evidence-test-err)"
RC=$?
check "unknown third arg: exit non-zero" "$([ "$RC" -ne 0 ] && echo yes || echo no)" "yes"
check "unknown third arg: no READY line" "$(printf '%s' "$OUT" | grep -c '^READY')" "0"
check "unknown third arg: FAIL on stderr" "$(grep -c '^FAIL' /tmp/persist-evidence-test-err)" "1"
rm -f /tmp/persist-evidence-test-err
rm -rf "$REPO"

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
