#!/usr/bin/env bash
# Shell tests for scripts/concertino/check-constraints-carryover.sh
# (CON-161, methodology-carryover). Ports every red-first scenario from
# openspec/changes/promote-methodology-into-state/tasks.md 4.2 verbatim as
# automated assertions. Every case runs the REAL script against a
# throwaway `mktemp -d` change dir, never a reimplementation.
set -uo pipefail

# CON-181: scope every mktemp/mktemp -d call in this file to a scratch
# TMPDIR removed on exit -- see test/scripts/lib/tmp-scratch.sh.
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp-scratch.sh"
trap con181_cleanup_scratch EXIT

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/core/scripts/check-constraints-carryover.sh"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL $1"; echo "       $2"; }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected [$3] got [$2]"; fi; }
has()  { if printf '%s' "$2" | grep -qF "$3"; then ok "$1"; else bad "$1" "expected to find [$3] in: $2"; fi; }

echo "check-constraints-carryover.sh (CON-161)"

# A scratch $WORKTREE_PATH/openspec/changes/<CHANGE_NAME>/ dir, matching the
# script's own change-dir resolution convention.
new_change_dir() {
  local root="$1" name="$2"
  mkdir -p "$root/openspec/changes/$name"
}

run_check() {
  # $1=worktree $2=change_name -> sets OUT and CODE
  OUT="$("$SCRIPT" "$1" "$2" 2>&1)"
  CODE=$?
}

# --- (a) tasks.md C1 marker absent from CONSTRAINTS -> DIVERGED, exit 1 ----
WT="$(mktemp -d)"
new_change_dir "$WT" foo
cat > "$WT/openspec/changes/foo/tasks.md" <<'EOF'
## Standing Constraints
- [C1] some rule
EOF
cat > "$WT/openspec/changes/foo/workflow-state.md" <<'EOF'
TICKET_ID: X
CONSTRAINTS: []
CONSTRAINT_REVIEWS: []
SKEPTIC_VERDICTS_TOTAL: 0
EOF
run_check "$WT" foo
check "(a) marker absent from CONSTRAINTS: exit code" "$CODE" "1"
has "(a) marker absent from CONSTRAINTS: DIVERGED message" "$OUT" "DIVERGED"
rm -rf "$WT"

# --- (b) the reverse asymmetry -> DIVERGED, exit 1 -------------------------
WT="$(mktemp -d)"
new_change_dir "$WT" foo
: > "$WT/openspec/changes/foo/tasks.md"
cat > "$WT/openspec/changes/foo/workflow-state.md" <<'EOF'
TICKET_ID: X
CONSTRAINTS: [{"id":"C1","text":"x","agreed_at":"design-gate","retired":false}]
CONSTRAINT_REVIEWS: [{"verdict_seq":1,"gate":"design","round":1,"verdict":"REFUTE","promoted":["C1"]}]
SKEPTIC_VERDICTS_TOTAL: 1
EOF
run_check "$WT" foo
check "(b) reverse asymmetry: exit code" "$CODE" "1"
has "(b) reverse asymmetry: DIVERGED message" "$OUT" "DIVERGED"
rm -rf "$WT"

# --- (c) SKEPTIC_VERDICTS_TOTAL ahead of non-planning review count --------
WT="$(mktemp -d)"
new_change_dir "$WT" foo
: > "$WT/openspec/changes/foo/tasks.md"
cat > "$WT/openspec/changes/foo/workflow-state.md" <<'EOF'
TICKET_ID: X
CONSTRAINTS: []
CONSTRAINT_REVIEWS: [{"verdict_seq":1,"gate":"design","round":1,"verdict":"CONFIRM","promoted":[]}]
SKEPTIC_VERDICTS_TOTAL: 3
EOF
run_check "$WT" foo
check "(c) count mismatch: exit code" "$CODE" "1"
has "(c) count mismatch: DIVERGED message" "$OUT" "DIVERGED"
rm -rf "$WT"

# --- (d) a missing workflow-state.md file -> MISSING, exit 2 --------------
WT="$(mktemp -d)"
new_change_dir "$WT" foo
: > "$WT/openspec/changes/foo/tasks.md"
run_check "$WT" foo
check "(d) missing workflow-state.md: exit code" "$CODE" "2"
has "(d) missing workflow-state.md: MISSING message" "$OUT" "MISSING"
rm -rf "$WT"

# --- (e) a workflow-state.md that predates these fields, paired with a ----
# tasks.md with no marker section -> OK (none), exit 0 (absent-field
# defaulting, not a false positive).
WT="$(mktemp -d)"
new_change_dir "$WT" foo
cat > "$WT/openspec/changes/foo/tasks.md" <<'EOF'
## 1. Something
- [ ] 1.1 do stuff
EOF
cat > "$WT/openspec/changes/foo/workflow-state.md" <<'EOF'
TICKET_ID: X
EOF
run_check "$WT" foo
check "(e) predates these fields: exit code" "$CODE" "0"
check "(e) predates these fields: OK (none) message" "$OUT" "OK (none)"
rm -rf "$WT"

# --- (f) a gate:"planning" promotion with a matching tasks.md/CONSTRAINTS -
# entry and zero skeptic verdicts -> OK, exit 0 (planning entry excluded
# from the count check but still required in the id-union).
WT="$(mktemp -d)"
new_change_dir "$WT" foo
cat > "$WT/openspec/changes/foo/tasks.md" <<'EOF'
## Standing Constraints
- [C1] some planning rule
EOF
cat > "$WT/openspec/changes/foo/workflow-state.md" <<'EOF'
TICKET_ID: X
CONSTRAINTS: [{"id":"C1","text":"x","agreed_at":"planning","retired":false}]
CONSTRAINT_REVIEWS: [{"verdict_seq":1,"gate":"planning","round":1,"verdict":"n/a","promoted":["C1"]}]
SKEPTIC_VERDICTS_TOTAL: 0
EOF
run_check "$WT" foo
check "(f) planning promotion, zero skeptic verdicts: exit code" "$CODE" "0"
check "(f) planning promotion, zero skeptic verdicts: OK message" "$OUT" "OK"
rm -rf "$WT"

# --- (g) malformed JSON in a present CONSTRAINTS field -> DIVERGED, exit 1 -
WT="$(mktemp -d)"
new_change_dir "$WT" foo
: > "$WT/openspec/changes/foo/tasks.md"
cat > "$WT/openspec/changes/foo/workflow-state.md" <<'EOF'
TICKET_ID: X
CONSTRAINTS: [{"id":"C1",
CONSTRAINT_REVIEWS: []
SKEPTIC_VERDICTS_TOTAL: 0
EOF
run_check "$WT" foo
check "(g) malformed JSON: exit code" "$CODE" "1"
has "(g) malformed JSON: DIVERGED message" "$OUT" "DIVERGED"
rm -rf "$WT"

# --- (h) tasks.md and CONSTRAINTS both hold C1, but every review's --------
# promoted is [] -> DIVERGED, exit 1 (genuine three-way comparison, not
# two-way-plus-count).
WT="$(mktemp -d)"
new_change_dir "$WT" foo
cat > "$WT/openspec/changes/foo/tasks.md" <<'EOF'
## Standing Constraints
- [C1] rule
EOF
cat > "$WT/openspec/changes/foo/workflow-state.md" <<'EOF'
TICKET_ID: X
CONSTRAINTS: [{"id":"C1","text":"x","agreed_at":"design-gate","retired":false}]
CONSTRAINT_REVIEWS: [{"verdict_seq":1,"gate":"design","round":1,"verdict":"CONFIRM","promoted":[]}]
SKEPTIC_VERDICTS_TOTAL: 1
EOF
run_check "$WT" foo
check "(h) third leg alone disagrees: exit code" "$CODE" "1"
has "(h) third leg alone disagrees: DIVERGED message" "$OUT" "DIVERGED"
rm -rf "$WT"

echo ""
echo "check-constraints-carryover.sh: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
