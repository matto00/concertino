#!/usr/bin/env bash
set -uo pipefail

# ===========================================================================
# persist-evidence.sh — copy an evidence artifact into the main checkout and
# return a durable ref.
#
# Usage: persist-evidence.sh <TICKET_ID> <SOURCE_PATH>
#
# Callers (the orchestrator's per-planning-artifact `evidence` event, and the
# evaluator/skeptic's `verdict.ref`) all write their artifact under
# WORKTREE_PATH — but `cleanup.sh --phase4` destroys the worktree while the
# event log survives it. A ref built from that worktree-relative path becomes
# a dangling reference at exactly the moment a run succeeds, which is when a
# human is most likely to want to read it. This script exists to make that
# impossible: it copies the artifact into
#   <main checkout>/.concertino/runs/<TICKET_ID>/evidence/
# — never touched by cleanup.sh — and prints back the absolute, durable path.
#
# Destination naming: DEST_PATH preserves SOURCE_PATH's path relative to the
# top-level of the git working tree that contains it (creating whatever
# intermediate directories that relative path implies), rather than the
# source's basename alone. Two sources that share a basename but live in
# different directories (e.g. two spec deltas both named `spec.md`) therefore
# land at distinct destinations instead of silently clobbering each other.
# Re-persisting the same source always resolves to the same worktree-relative
# path, so the idempotency contract below is unaffected.
#
# On success prints `READY ref=<absolute destination path>` to stdout and
# exits 0. On failure (missing/unreadable source, source not inside any git
# working tree, or the copy cannot be written) prints `FAIL <reason>` to
# stderr, prints no `READY` line, and exits non-zero — an unresolvable ref is
# worse than no evidence event, so a caller must only emit one once this
# script has confirmed the copy exists at a collision-safe destination.
#
# Idempotent/re-runnable: re-persisting the same source overwrites the
# previous copy with its current content.
# ===========================================================================

TICKET_ID="${1:?usage: persist-evidence.sh <TICKET_ID> <SOURCE_PATH>}"
SOURCE_PATH="${2:?usage: persist-evidence.sh <TICKET_ID> <SOURCE_PATH>}"

# A ticket id feeds directly into DEST_DIR below; unvalidated, a traversal
# shape (`../../../..`) walks out of the runs directory. Same pattern
# assert-phase.sh/start-servers.sh/cleanup.sh already carry — checked before
# anything else in this script touches the filesystem.
looks_like_ticket() { [[ "$1" =~ ^[A-Za-z#][A-Za-z0-9_-]*[0-9]$ ]]; }

if ! looks_like_ticket "$TICKET_ID"; then
  echo "FAIL invalid TICKET_ID: ${TICKET_ID}" >&2
  exit 1
fi

# Resolve the main checkout. `git rev-parse --git-common-dir` points at the
# shared .git directory from a worktree as well as from the main checkout, but
# it is RELATIVE on some git versions and absolute on others — normalise both.
# Duplicated from emit-event.sh rather than sourced: every procedure script in
# this suite is independent, no shared lib (see emit-event.sh's own comment on
# why now_ms() is copied rather than imported).
main_checkout() {
  local common
  common="$(git rev-parse --git-common-dir 2>/dev/null)" || return 1
  [ -z "$common" ] && return 1
  case "$common" in
    /*) ;;
     *) common="$(cd "$common" 2>/dev/null && pwd)" || return 1 ;;
  esac
  ( cd "$(dirname "$common")" 2>/dev/null && pwd ) || return 1
}

if [ ! -f "$SOURCE_PATH" ] || [ ! -r "$SOURCE_PATH" ]; then
  echo "FAIL source artifact missing or unreadable: ${SOURCE_PATH}" >&2
  exit 1
fi

# Resolve SOURCE_PATH to an absolute, symlink-free path via `cd` + `pwd` —
# same approach as main_checkout(), no external `realpath` dependency.
SRC_DIR="$(cd "$(dirname "$SOURCE_PATH")" 2>/dev/null && pwd)"
if [ -z "${SRC_DIR:-}" ]; then
  echo "FAIL could not resolve source path: ${SOURCE_PATH}" >&2
  exit 1
fi
SRC_ABS="${SRC_DIR}/$(basename "$SOURCE_PATH")"

# Resolve the top-level of the git working tree that CONTAINS the source —
# this is the worktree's own toplevel (e.g. WORKTREE_PATH), not
# main_checkout()'s shared git-common-dir. It is what every caller's artifact
# path is naturally relative to (e.g. `openspec/changes/<change>/...`).
SRC_TOPLEVEL="$(git -C "$SRC_DIR" rev-parse --show-toplevel 2>/dev/null)"
if [ -z "${SRC_TOPLEVEL:-}" ]; then
  echo "FAIL source is not inside any git working tree: ${SOURCE_PATH}" >&2
  exit 1
fi
SRC_TOPLEVEL="$(cd "$SRC_TOPLEVEL" 2>/dev/null && pwd)"
if [ -z "${SRC_TOPLEVEL:-}" ]; then
  echo "FAIL could not resolve source's git working tree top-level: ${SOURCE_PATH}" >&2
  exit 1
fi

case "$SRC_ABS" in
  "$SRC_TOPLEVEL"/*) SRC_REL="${SRC_ABS#"$SRC_TOPLEVEL"/}" ;;
  *)
    echo "FAIL source path is not under its own git working tree top-level: ${SOURCE_PATH}" >&2
    exit 1
    ;;
esac

ROOT="$(main_checkout)"
if [ -z "${ROOT:-}" ]; then
  echo "FAIL could not resolve main checkout (not inside a git repo?)" >&2
  exit 1
fi

DEST_DIR="${ROOT}/.concertino/runs/${TICKET_ID}/evidence"
DEST_PATH="${DEST_DIR}/${SRC_REL}"

if ! mkdir -p "$(dirname "$DEST_PATH")" 2>/dev/null; then
  echo "FAIL could not create evidence directory: $(dirname "$DEST_PATH")" >&2
  exit 1
fi

if ! cp -f "$SOURCE_PATH" "$DEST_PATH" 2>/dev/null; then
  echo "FAIL could not copy ${SOURCE_PATH} to ${DEST_PATH}" >&2
  exit 1
fi

echo "READY ref=${DEST_PATH}"
