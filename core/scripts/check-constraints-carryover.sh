#!/usr/bin/env bash
set -uo pipefail

# ===========================================================================
# check-constraints-carryover.sh — mechanical divergence check for
# methodology-carryover (CON-161).
#
# Usage:
#   check-constraints-carryover.sh <WORKTREE_PATH> <CHANGE_NAME>
#
# Run as an EXPLICIT Phase 3 step 0 by the orchestrator (before design.md's
# re-persist and before the squash/archive) — deliberately NOT wired into
# assert-phase.sh, whose `delivery` phase fires after the change dir has
# already been archived (see design.md Decision 2a).
#
# Compares three sources, all resolved from
# $WORKTREE_PATH/openspec/changes/<CHANGE_NAME>/{tasks.md,workflow-state.md}:
#   (a) tasks.md's `## Standing Constraints` section `- [C<n>]` marker ids
#   (b) workflow-state.md's CONSTRAINTS field ids (`jq -r '.[].id'`)
#   (c) the union of every CONSTRAINT_REVIEWS[].promoted id, across every
#       `gate` value including "planning"
#
# Exit codes:
#   0 - OK / OK (none)   -- all three id sets identical AND
#                            len(CONSTRAINT_REVIEWS where gate != "planning")
#                            == SKEPTIC_VERDICTS_TOTAL
#   1 - DIVERGED: <reason> -- any set/count mismatch, or malformed JSON in a
#                              field that IS present (never conflated with
#                              an absent field, which defaults to []/0)
#   2 - MISSING <path>    -- either input FILE is absent entirely (never
#                              read as "nothing to check")
# ===========================================================================

WORKTREE_PATH="${1:?usage: check-constraints-carryover.sh <WORKTREE_PATH> <CHANGE_NAME>}"
CHANGE_NAME="${2:?usage: check-constraints-carryover.sh <WORKTREE_PATH> <CHANGE_NAME>}"

CHANGE_DIR="${WORKTREE_PATH}/openspec/changes/${CHANGE_NAME}"
TASKS_FILE="${CHANGE_DIR}/tasks.md"
STATE_FILE="${CHANGE_DIR}/workflow-state.md"

if [ ! -f "$TASKS_FILE" ]; then
  echo "MISSING ${TASKS_FILE}"
  exit 2
fi
if [ ! -f "$STATE_FILE" ]; then
  echo "MISSING ${STATE_FILE}"
  exit 2
fi

# --- (a) tasks.md markers -------------------------------------------------
# Only bullets under the "## Standing Constraints" heading, of the form
# "- [C<n>] <text>". Stops at the next "## " heading (or EOF).
TASKS_IDS="$(awk '
  /^## Standing Constraints/ { in_section = 1; next }
  in_section && /^## / { in_section = 0 }
  in_section && /^- \[C[0-9]+\]/ {
    match($0, /^- \[(C[0-9]+)\]/, m)
    print m[1]
  }
' "$TASKS_FILE" 2>/dev/null | sort -u)"
# Some awk builds lack gawk's match()-array third arg; fall back to sed if
# the above produced nothing but the section exists (portable path).
if [ -z "$TASKS_IDS" ] && grep -q '^## Standing Constraints' "$TASKS_FILE"; then
  TASKS_IDS="$(sed -n '/^## Standing Constraints/,/^## /p' "$TASKS_FILE" \
    | grep -E '^- \[C[0-9]+\]' \
    | sed -E 's/^- \[(C[0-9]+)\].*/\1/' \
    | sort -u)"
fi

# --- helper: pull a single-line field's raw value from workflow-state.md --
# A field line looks like: `FIELD: <rest of line>`. Returns empty string if
# the field line is not present at all (distinct from present-but-empty).
# Requires a single trailing space after `FIELD:` (matching the template's
# own "FIELD: <value>" convention) — not reachable in practice since the
# template always writes a value with that space, but noted for anyone
# hand-editing workflow-state.md.
extract_field() {
  local field="$1"
  grep -E "^${field}: " "$STATE_FILE" | head -1 | sed -E "s/^${field}: //"
}

CONSTRAINTS_RAW="$(extract_field 'CONSTRAINTS')"
CONSTRAINT_REVIEWS_RAW="$(extract_field 'CONSTRAINT_REVIEWS')"
SKEPTIC_TOTAL_RAW="$(extract_field 'SKEPTIC_VERDICTS_TOTAL')"

# --- (b) CONSTRAINTS ids ---------------------------------------------------
if [ -z "$CONSTRAINTS_RAW" ]; then
  CONSTRAINTS_IDS=""
else
  CONSTRAINTS_IDS="$(printf '%s' "$CONSTRAINTS_RAW" | jq -r '.[].id' 2>/dev/null)"
  if [ $? -ne 0 ]; then
    echo "DIVERGED: CONSTRAINTS field present but not valid JSON"
    exit 1
  fi
  CONSTRAINTS_IDS="$(printf '%s\n' "$CONSTRAINTS_IDS" | sort -u | sed '/^$/d')"
fi

# --- (c) CONSTRAINT_REVIEWS: promoted-id union + non-planning count -------
if [ -z "$CONSTRAINT_REVIEWS_RAW" ]; then
  REVIEWS_PROMOTED_IDS=""
  NON_PLANNING_COUNT=0
else
  if ! printf '%s' "$CONSTRAINT_REVIEWS_RAW" | jq -e 'type == "array"' >/dev/null 2>&1; then
    echo "DIVERGED: CONSTRAINT_REVIEWS field present but not valid JSON"
    exit 1
  fi
  REVIEWS_PROMOTED_IDS="$(printf '%s' "$CONSTRAINT_REVIEWS_RAW" | jq -r '.[].promoted[]?' 2>/dev/null | sort -u | sed '/^$/d')"
  NON_PLANNING_COUNT="$(printf '%s' "$CONSTRAINT_REVIEWS_RAW" | jq -r '[.[] | select(.gate != "planning")] | length' 2>/dev/null)"
  if [ -z "$NON_PLANNING_COUNT" ]; then
    echo "DIVERGED: CONSTRAINT_REVIEWS field present but not valid JSON"
    exit 1
  fi
fi

# --- SKEPTIC_VERDICTS_TOTAL --------------------------------------------------
if [ -z "$SKEPTIC_TOTAL_RAW" ]; then
  SKEPTIC_TOTAL=0
else
  if ! [[ "$SKEPTIC_TOTAL_RAW" =~ ^[0-9]+$ ]]; then
    echo "DIVERGED: SKEPTIC_VERDICTS_TOTAL field present but not a valid integer"
    exit 1
  fi
  SKEPTIC_TOTAL="$SKEPTIC_TOTAL_RAW"
fi

# --- three-way id-set comparison -------------------------------------------
SET_A="$TASKS_IDS"
SET_B="$CONSTRAINTS_IDS"
SET_C="$REVIEWS_PROMOTED_IDS"

if [ "$SET_A" != "$SET_B" ] || [ "$SET_B" != "$SET_C" ]; then
  echo "DIVERGED: id sets disagree (tasks.md=[$(echo "$SET_A" | tr '\n' ',' | sed 's/,$//')], CONSTRAINTS=[$(echo "$SET_B" | tr '\n' ',' | sed 's/,$//')], CONSTRAINT_REVIEWS.promoted=[$(echo "$SET_C" | tr '\n' ',' | sed 's/,$//')])"
  exit 1
fi

if [ "$NON_PLANNING_COUNT" -ne "$SKEPTIC_TOTAL" ]; then
  echo "DIVERGED: review count mismatch (non-planning CONSTRAINT_REVIEWS=${NON_PLANNING_COUNT}, SKEPTIC_VERDICTS_TOTAL=${SKEPTIC_TOTAL})"
  exit 1
fi

if [ -z "$SET_A" ] && [ "$SKEPTIC_TOTAL" -eq 0 ]; then
  echo "OK (none)"
else
  echo "OK"
fi
exit 0
