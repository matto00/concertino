#!/usr/bin/env bash
set -uo pipefail

# ===========================================================================
# next-ticket-id.sh — collision-safe, disk-derived next `<PREFIX>-N` ticket
# id for the local ticket provider (`ticketProvider.kind: "local"`).
#
# Usage: next-ticket-id.sh <tickets-dir> <prefix>
#
# Why this exists (CON-91): under `ticketProvider.kind: "local"` the
# orchestrator has no Linear/GitHub MCP tool to file a `standalone`
# follow-up ticket with — it has to write `tickets/<PREFIX>-<N>.md` itself,
# the same way a human filing a local ticket would. That needs a script to
# pick the next free `<N>` for a given `<prefix>`, mirroring
# `next-report-number.sh`'s proven contract: scan disk for what already
# exists rather than keeping a run-local counter, so it is correct
# regardless of how many tickets already exist and needs no cross-run state
# anywhere.
#
# Scans <tickets-dir> (non-recursive) for files matching
# ^<prefix>-([0-9]+)\.md$, computes NEXT = (highest matched number found, or
# 0) + 1.
#
# On success prints `READY id=<prefix>-<NEXT> path=<tickets-dir>/<prefix>-<NEXT>.md`
# to stdout and exits 0.
#
# On failure prints `FAIL <reason>` to stderr and exits non-zero:
#   - <prefix> does not match ^[A-Za-z][A-Za-z0-9]*$ (letters then optional
#     letters/digits — deliberately narrower than `set-ticket-state.sh`'s own
#     full-ticket-id validation, which validates a complete `<PREFIX>-<N>`
#     id, not just the prefix component in isolation; the invariant this
#     shape protects is that <prefix> never itself contains the `-`
#     separator, so `<prefix>-<NEXT>` can never be ambiguously re-split)
#   - <tickets-dir> exists but is not a directory, or is unreadable
#   - the computed target path unexpectedly already exists (should never
#     happen given the scan above — this is a safety re-check, not the
#     normal path; treated as a hard failure rather than silently returning
#     a number that would overwrite something)
#
# Unlike next-report-number.sh (which fails on a missing <change-dir>),
# a missing <tickets-dir> is created with `mkdir -p` — a local-provider
# project's very first standalone follow-up may be filed before any human
# has hand-created a tickets/ directory, and lib/ui/tickets/local.js's
# readTickets() already treats a missing directory as a legitimate empty
# state, not an error.
# ===========================================================================

TICKETS_DIR="${1:?usage: next-ticket-id.sh <tickets-dir> <prefix>}"
PREFIX="${2:?usage: next-ticket-id.sh <tickets-dir> <prefix>}"

if [[ ! "$PREFIX" =~ ^[A-Za-z][A-Za-z0-9]*$ ]]; then
  echo "FAIL invalid prefix shape \"${PREFIX}\" (expected: ^[A-Za-z][A-Za-z0-9]*\$)" >&2
  exit 1
fi

if [ -e "$TICKETS_DIR" ] && [ ! -d "$TICKETS_DIR" ]; then
  echo "FAIL tickets directory path exists but is not a directory: ${TICKETS_DIR}" >&2
  exit 1
fi

if [ ! -e "$TICKETS_DIR" ]; then
  mkdir -p "$TICKETS_DIR" || {
    echo "FAIL could not create tickets directory: ${TICKETS_DIR}" >&2
    exit 1
  }
fi

if [ ! -r "$TICKETS_DIR" ]; then
  echo "FAIL tickets directory missing or unreadable: ${TICKETS_DIR}" >&2
  exit 1
fi

HIGHEST=0
for f in "$TICKETS_DIR"/"$PREFIX"-*.md; do
  [ -e "$f" ] || continue
  base="$(basename "$f")"
  if [[ "$base" =~ ^${PREFIX}-([0-9]+)\.md$ ]]; then
    n="${BASH_REMATCH[1]}"
    # Strip any leading zeros before the arithmetic comparison so a
    # zero-padded name (e.g. CON-01.md) is compared numerically rather than
    # tripping bash's octal interpretation of a leading 0.
    n=$((10#$n))
    [ "$n" -gt "$HIGHEST" ] && HIGHEST="$n"
  fi
done

NEXT=$((HIGHEST + 1))
TARGET="${TICKETS_DIR}/${PREFIX}-${NEXT}.md"

if [ -e "$TARGET" ]; then
  echo "FAIL computed target already exists (scan/regex bug?): ${TARGET}" >&2
  exit 1
fi

echo "READY id=${PREFIX}-${NEXT} path=${TARGET}"
