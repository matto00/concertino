#!/usr/bin/env bash
set -uo pipefail

# ===========================================================================
# next-report-number.sh — collision-safe, disk-derived filename number for
# the evaluator's/skeptic's next review report.
#
# Usage: next-report-number.sh <change-dir> <kind>
#   <kind> is one of: evaluation | skeptic-design | skeptic-final
#
# Why this exists (CON-81): the evaluator/skeptic used to number their report
# filenames off a run-local counter (CYCLE/N) that always restarts at 1 for a
# new sub-run. A `fold-in` follow-up reopens an already-archived change in a
# freshly re-created worktree whose change directory already contains the
# first sub-run's evaluation-*.md/skeptic-*-*.md files — so the second
# sub-run's counter-derived filename landed on the exact same name and
# silently overwrote the first sub-run's review history. This script instead
# scans the change directory for what's actually already on disk and returns
# a number strictly higher than anything found, so it is correct for the
# 1st, 2nd, or Nth sub-run identically and needs no cross-sub-run state
# anywhere.
#
# Scans <change-dir> (non-recursive) for files matching ^<kind>-([0-9]+)\.md$,
# computes NEXT = (highest matched number found, or 0) + 1.
#
# On success prints `READY number=<NEXT> path=<change-dir>/<kind>-<NEXT>.md`
# to stdout and exits 0.
#
# On failure prints `FAIL <reason>` to stderr and exits non-zero:
#   - <change-dir> missing or unreadable
#   - <kind> is not one of the three recognised values
#   - the computed target path unexpectedly already exists (should never
#     happen given the scan above — this is a safety re-check, not the
#     normal path; treated as a hard failure rather than silently returning
#     a number that would overwrite something)
# ===========================================================================

CHANGE_DIR="${1:?usage: next-report-number.sh <change-dir> <kind>}"
KIND="${2:?usage: next-report-number.sh <change-dir> <kind>}"

case "$KIND" in
  evaluation|skeptic-design|skeptic-final) ;;
  *)
    echo "FAIL unknown kind \"${KIND}\" (expected: evaluation|skeptic-design|skeptic-final)" >&2
    exit 1
    ;;
esac

if [ ! -d "$CHANGE_DIR" ] || [ ! -r "$CHANGE_DIR" ]; then
  echo "FAIL change directory missing or unreadable: ${CHANGE_DIR}" >&2
  exit 1
fi

HIGHEST=0
for f in "$CHANGE_DIR"/"$KIND"-*.md; do
  [ -e "$f" ] || continue
  base="$(basename "$f")"
  if [[ "$base" =~ ^${KIND}-([0-9]+)\.md$ ]]; then
    n="${BASH_REMATCH[1]}"
    # Strip any leading zeros before the arithmetic comparison so a
    # zero-padded name (e.g. evaluation-01.md) is compared numerically
    # rather than tripping bash's octal interpretation of a leading 0.
    n=$((10#$n))
    [ "$n" -gt "$HIGHEST" ] && HIGHEST="$n"
  fi
done

NEXT=$((HIGHEST + 1))
TARGET="${CHANGE_DIR}/${KIND}-${NEXT}.md"

if [ -e "$TARGET" ]; then
  echo "FAIL computed target already exists (scan/regex bug?): ${TARGET}" >&2
  exit 1
fi

echo "READY number=${NEXT} path=${TARGET}"
