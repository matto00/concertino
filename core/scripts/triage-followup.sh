#!/usr/bin/env bash
set -uo pipefail

# ===========================================================================
# triage-followup.sh — classify a suggested follow-up as fold-in or
# standalone, combining the one mechanically-checkable signal (file overlap
# with the current change's own diff, computed from real git state) with two
# caller-supplied judgment calls (`ac_relevant`, `effort`) through a fixed
# decision table (design.md's Decision 1).
#
# Usage:
#   triage-followup.sh \
#     description="<one-line description of the suggested follow-up>" \
#     files="<comma-separated files the follow-up would touch, or 'unknown'>" \
#     ac_relevant=<yes|no> \
#     effort=<small|large> \
#     worktree=<WORKTREE_PATH> \
#     base=<base-branch, optional>
#
# `base=`, when omitted, defaults to ${CONCERTINO_BASE_BRANCH:-main} — the
# same base-branch convention core/scripts/cleanup.sh and
# core/scripts/assert-phase.sh already use, read from the environment rather
# than hardcoded to "main".
#
# Mechanical step: `git -C <worktree> diff --name-only <base>...HEAD` computes
# the current change's already-modified files. `files=`'s comma-separated
# entries are then intersected against that list to classify overlap as:
#   high    — >=50% of `files=`'s entries already appear in the diff
#   partial — some, but <50%, of `files=`'s entries appear in the diff
#   none    — none of `files=`'s entries appear in the diff
#   unknown — `files=unknown` was given (never treated as overlap — the
#             caller stated no files at all, so overlap is never *assumed*)
#
# Decision table (fixed and deterministic — stated here so it is auditable,
# not tuned model judgment):
#   ac_relevant=yes                                        -> fold-in (always;
#                                                              this is already
#                                                              in scope)
#   ac_relevant=no, effort=small, overlap=high             -> fold-in
#   ac_relevant=no, effort=small, overlap=partial|none|unknown -> standalone
#   ac_relevant=no, effort=large (any overlap)             -> standalone
# `discard` is never this script's own recommendation — it has no signal for
# "not worth doing," only for scope/cost. `discard` remains a valid human
# choice regardless of the recommendation; the printed block says so
# explicitly, so the recommendation is read as "if this is worth doing at
# all, here's how" rather than "should we do it."
#
# On success: prints a plain-text block to stdout (mirroring
# gather-escalation-context.sh's kind blocks) stating all four inputs, the
# computed overlap, the resulting recommendation, and the one-line rule that
# produced it, then exits 0 — this is what the caller passes through as
# `context=` on the `emit-event.sh escalation --await` call that follows.
#
# On a missing required field, an `ac_relevant`/`effort` value outside the
# allowed set, or a `worktree=` that is not a git repository: prints
# `FAIL <reason>` to stderr, prints nothing to stdout, and exits non-zero —
# mirroring gather-escalation-context.sh's own failure contract. The caller
# must not let a malformed call here block the escalation itself: if this
# script fails, raise the escalation without `context=` rather than skip
# raising it, exactly like that script's own documented fallback rule.
# ===========================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
[ -f "${SCRIPT_DIR}/.concertino.env" ] && source "${SCRIPT_DIR}/.concertino.env"

fail() {
  echo "FAIL $1" >&2
  exit 1
}

# Parse k=v args the same way gather-escalation-context.sh/emit-event.sh do:
# split on the FIRST '=' only, so a value containing '=' survives intact.
declare -A F=()
for kv in "$@"; do
  key="${kv%%=*}"
  val="${kv#*=}"
  [ "$key" = "$kv" ] && continue   # no '=' — ignore
  F["$key"]="$val"
done

# A field counts as missing whether it was never passed or was passed empty —
# either way there is nothing to classify on, so it fails the same way.
require() {
  local missing="" f
  for f in "$@"; do
    if [ -z "${F[$f]:-}" ]; then
      missing="${missing}${missing:+, }${f}"
    fi
  done
  [ -n "$missing" ] && fail "missing required field(s): ${missing}"
  return 0
}

require description files ac_relevant effort worktree

DESCRIPTION="${F[description]}"
FILES="${F[files]}"
AC_RELEVANT="${F[ac_relevant]}"
EFFORT="${F[effort]}"
WORKTREE="${F[worktree]}"
BASE="${F[base]:-${CONCERTINO_BASE_BRANCH:-main}}"

case "$AC_RELEVANT" in
  yes|no) ;;
  *) fail "ac_relevant must be 'yes' or 'no', got '${AC_RELEVANT}'" ;;
esac

case "$EFFORT" in
  small|large) ;;
  *) fail "effort must be 'small' or 'large', got '${EFFORT}'" ;;
esac

git -C "$WORKTREE" rev-parse --git-dir >/dev/null 2>&1 \
  || fail "worktree is not a git repository: ${WORKTREE}"

# --- Compute overlap ---------------------------------------------------------
if [ "$FILES" = "unknown" ]; then
  OVERLAP="unknown"
else
  DIFF_FILES="$(git -C "$WORKTREE" diff --name-only "${BASE}...HEAD" 2>/dev/null)" || DIFF_FILES=""

  TOTAL=0
  MATCHED=0
  IFS=',' read -ra FILE_LIST <<< "$FILES"
  for f in "${FILE_LIST[@]}"; do
    f="$(printf '%s' "$f" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    [ -z "$f" ] && continue
    TOTAL=$((TOTAL + 1))
    if printf '%s\n' "$DIFF_FILES" | grep -qxF "$f"; then
      MATCHED=$((MATCHED + 1))
    fi
  done

  if [ "$TOTAL" -eq 0 ] || [ "$MATCHED" -eq 0 ]; then
    OVERLAP="none"
  elif [ $((MATCHED * 2)) -ge "$TOTAL" ]; then
    OVERLAP="high"
  else
    OVERLAP="partial"
  fi
fi

# --- Apply the fixed decision table ------------------------------------------
if [ "$AC_RELEVANT" = "yes" ]; then
  RECOMMENDATION="fold-in"
  RULE="ac_relevant=yes -> fold-in regardless of effort/overlap (already in scope)"
elif [ "$EFFORT" = "small" ] && [ "$OVERLAP" = "high" ]; then
  RECOMMENDATION="fold-in"
  RULE="ac_relevant=no, effort=small, overlap=high -> fold-in"
elif [ "$EFFORT" = "small" ]; then
  RECOMMENDATION="standalone"
  RULE="ac_relevant=no, effort=small, overlap=${OVERLAP} -> standalone"
else
  RECOMMENDATION="standalone"
  RULE="ac_relevant=no, effort=large -> standalone regardless of overlap (overlap=${OVERLAP})"
fi

cat <<EOF
Follow-up triage
  description:    ${DESCRIPTION}
  files:           ${FILES}
  ac_relevant:     ${AC_RELEVANT}
  effort:          ${EFFORT}
  overlap:         ${OVERLAP}
  recommendation:  ${RECOMMENDATION}
  rule:            ${RULE}
  note: discard is always a valid choice regardless of this recommendation —
        this script has no signal for "not worth doing," only for scope/cost.
EOF
