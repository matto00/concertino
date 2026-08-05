#!/usr/bin/env bash
set -euo pipefail

# ===========================================================================
# assert-phase.sh — postcondition gate for each orchestrator phase.
#
# The autonomous equivalent of a human glancing and confirming "yep, that
# worked." The orchestrator runs this before leaving a phase; a non-zero exit
# means the phase did NOT actually complete and it must not advance.
#
# Usage:
#   assert-phase.sh setup    <WORKTREE_PATH> [TICKET_ID]
#   assert-phase.sh servers  <WORKTREE_PATH> <DEV_PORT> <BACKEND_PORT> [TICKET_ID]
#   assert-phase.sh delivery <WORKTREE_PATH> <BRANCH> [TICKET_ID]
#   assert-phase.sh cleanup  <WORKTREE_PATH> <DEV_PORT> <BACKEND_PORT> [TICKET_ID]
#
# [TICKET_ID], when passed, is used verbatim to tag every gate.result/
# gate.warning event this script emits (CON-80, mirroring cleanup.sh's CON-64
# shape). When omitted, the ticket id is inferred from the worktree path's
# basename as a documented fallback — see GATE_TICKET below.
#
# Prints "PASS <phase>" on success, "FAIL <reason>" (one per line) + non-zero
# exit on failure.
# ===========================================================================

PHASE="${1:?usage: assert-phase.sh <phase> <worktree> [args]}"
WORKTREE_PATH="${2:?missing WORKTREE_PATH}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
[ -f "${SCRIPT_DIR}/.concertino.env" ] && source "${SCRIPT_DIR}/.concertino.env"

# utf8_safe_char_prefix <char-budget>
#
# Reads UTF-8 text on stdin and writes to stdout the first <char-budget>
# Unicode code points, never a partial multi-byte sequence. Iterates by code
# point (`Array.from`/`for...of`, the same pattern `visibleLength()` in
# lib/ui/format.js already uses for the analogous surrogate-pair-safety
# reason) rather than relying on bash's `${msg:0:200}`, which is
# character-safe only when the ambient locale names a multibyte encoding —
# silently byte-oriented (splitting a multi-byte character) under `C`/`POSIX`,
# the default for many minimal CI/container images. A no-op for all-ASCII
# input, where 200 characters is also 200 bytes. Duplicated from
# emit-event.sh's analogous helper rather than sourced — these procedure
# scripts stay standalone (see now_ms() above for the same pattern).
utf8_safe_char_prefix() {
  local n="$1"
  node -e '
    const s = require("fs").readFileSync(0, "utf8");
    const n = Math.max(0, parseInt(process.argv[1], 10) || 0);
    process.stdout.write(Array.from(s).slice(0, n).join(""));
  ' "$n"
}

fail() {
  local msg="$*"
  echo "FAIL $msg" >&2
  FAILED=1
  # Record only the first failure message, trimmed at the source so an
  # oversized reason can't blow emit-event.sh's whole-line byte cap and drop
  # every other field on the gate.result line. fail() is always called as the
  # RHS of a `check || fail ...`, so under `set -e` its own return status must
  # stay 0 on every branch — otherwise a second-or-later call (where the `&&`
  # short-circuits because FIRST_ERROR is already set) would be the last
  # command in that AND-OR list and would kill the script right there.
  if [ -z "$FIRST_ERROR" ]; then
    FIRST_ERROR="$(printf '%s' "$msg" | utf8_safe_char_prefix 200)"
  fi
  return 0
}
FAILED=0
FIRST_ERROR=""

# Millisecond epoch. GNU date supports %3N; BSD/macOS date does not, so fall
# back to node (already a hard requirement for Concertino). Duplicated from
# emit-event.sh's now_ms() rather than sourced — these procedure scripts stay
# standalone.
now_ms() {
  local d
  d="$(date +%s%3N 2>/dev/null)"
  case "$d" in
    *N*|'') node -e 'process.stdout.write(String(Date.now()))' ;;
    *) printf '%s' "$d" ;;
  esac
}

# Resolve a health URL template ($DEV_PORT / $BACKEND_PORT in scope).
resolve_url() { eval "echo \"$1\""; }

START_TS="$(now_ms)"

looks_like_ticket() { [[ "$1" =~ ^[A-Za-z#][A-Za-z0-9_-]*[0-9]$ ]]; }

case "$PHASE" in
  setup)
    TICKET_ID="${3:-}"
    # The canonical ticket id arrives as the explicit trailing argument
    # (CON-80, mirroring cleanup.sh's CON-64 shape); worktree-basename
    # inference stays only as a fallback for call sites rendered before the
    # argument existed. Inference is not reliable — a branch without the
    # <type>/<desc>/<TICKET-ID> suffix makes the basename a non-ticket, and a
    # branch whose ticket suffix is lowercase (Linear's own `gitBranchName`
    # convention) makes the basename a different-cased, differently-addressed
    # run directory (the defect this ticket exists to close).
    GATE_TICKET="${TICKET_ID:-${WORKTREE_PATH##*/}}"
    [ -d "$WORKTREE_PATH" ]                 || fail "worktree dir missing: $WORKTREE_PATH"
    [ -d "$WORKTREE_PATH/.git" ] || [ -f "$WORKTREE_PATH/.git" ] \
                                            || fail "worktree not a git work tree: $WORKTREE_PATH"
    for f in ${CONCERTINO_ENV_FILES:-}; do
      [ -f "$WORKTREE_PATH/$f" ] || fail "env file not present in worktree: $f (servers will fail)"
    done
    ;;

  servers)
    DEV_PORT="${3:?servers assert needs <DEV_PORT> <BACKEND_PORT>}"
    BACKEND_PORT="${4:?servers assert needs <DEV_PORT> <BACKEND_PORT>}"
    TICKET_ID="${5:-}"
    GATE_TICKET="${TICKET_ID:-${WORKTREE_PATH##*/}}"
    if [ -n "${CONCERTINO_BACKEND_HEALTH:-}" ]; then
      curl -sf "$(resolve_url "$CONCERTINO_BACKEND_HEALTH")" >/dev/null 2>&1 \
          || fail "backend not healthy on ${BACKEND_PORT}"
    fi
    if [ -n "${CONCERTINO_FRONTEND_HEALTH:-}" ]; then
      curl -sf "$(resolve_url "$CONCERTINO_FRONTEND_HEALTH")" >/dev/null 2>&1 \
          || fail "frontend not serving on ${DEV_PORT}"
    fi
    ;;

  delivery)
    BRANCH="${3:?delivery assert needs <BRANCH>}"
    TICKET_ID="${4:-}"
    GATE_TICKET="${TICKET_ID:-${WORKTREE_PATH##*/}}"
    git -C "$WORKTREE_PATH" rev-parse --verify --quiet "refs/remotes/origin/${BRANCH}" >/dev/null \
        || fail "branch ${BRANCH} not pushed to origin"
    [ -z "$(git -C "$WORKTREE_PATH" status --porcelain)" ] \
        || fail "worktree has uncommitted changes"

    # -----------------------------------------------------------------------
    # CON-31: best-effort, non-blocking stale-base warning. Fetches the
    # configured base remote/branch and compares it to this branch's
    # merge-base with it. Purely additive: never sets FAILED, never changes
    # the exit code or the `PASS delivery` stdout line. Every git call is
    # individually guarded (`... || VAR=""` / `if ...; then`) so a fetch
    # failure, an unresolvable ref, or any other unexpected git error
    # degrades to "skip this check silently" rather than tripping
    # `set -euo pipefail` and aborting the whole script (design.md
    # Decision 2, Goals).
    # -----------------------------------------------------------------------
    STALE_REMOTE="${CONCERTINO_BASE_REMOTE:-origin}"
    STALE_BRANCH="${CONCERTINO_BASE_BRANCH:-main}"
    if git -C "$WORKTREE_PATH" fetch --quiet "$STALE_REMOTE" "$STALE_BRANCH" 2>/dev/null; then
      STALE_REMOTE_TIP="$(git -C "$WORKTREE_PATH" rev-parse "${STALE_REMOTE}/${STALE_BRANCH}" 2>/dev/null)" || STALE_REMOTE_TIP=""
      if [ -n "$STALE_REMOTE_TIP" ]; then
        STALE_MERGE_BASE="$(git -C "$WORKTREE_PATH" merge-base HEAD "$STALE_REMOTE_TIP" 2>/dev/null)" || STALE_MERGE_BASE=""
        if [ -n "$STALE_MERGE_BASE" ] && [ "$STALE_MERGE_BASE" != "$STALE_REMOTE_TIP" ]; then
          STALE_BEHIND="$(git -C "$WORKTREE_PATH" rev-list --count "${STALE_MERGE_BASE}..${STALE_REMOTE_TIP}" 2>/dev/null)" || STALE_BEHIND=""
          if [[ "$STALE_BEHIND" =~ ^[0-9]+$ ]] && [ "$STALE_BEHIND" -gt 0 ]; then
            STALE_LOG="$(git -C "$WORKTREE_PATH" log --oneline -5 "${STALE_MERGE_BASE}..${STALE_REMOTE_TIP}" 2>/dev/null)" || STALE_LOG=""
            if [ -n "$STALE_LOG" ]; then
              echo "WARN base ${STALE_REMOTE}/${STALE_BRANCH} has moved — this branch is ${STALE_BEHIND} commit(s) behind:" >&2
              while IFS= read -r stale_line; do
                echo "  $stale_line" >&2
              done <<< "$STALE_LOG"
              if [ "$STALE_BEHIND" -gt 5 ]; then
                echo "  (+$((STALE_BEHIND - 5)) more)" >&2
              fi

              STALE_SHAS="$(printf '%s\n' "$STALE_LOG" | awk '{print $1}' | paste -sd, -)" || STALE_SHAS=""
              looks_like_ticket "$GATE_TICKET" && CONCERTINO_ROLE=script "${SCRIPT_DIR}/emit-event.sh" gate.warning \
                "ticket=${GATE_TICKET}" "gate=phase:delivery" "behind=${STALE_BEHIND}" \
                "base=${STALE_BRANCH}" "remote=${STALE_REMOTE}" "commits=${STALE_SHAS}" || true
            fi
          fi
        fi
      fi
    fi
    ;;

  cleanup)
    DEV_PORT="${3:-}"
    BACKEND_PORT="${4:-}"
    TICKET_ID="${5:-}"
    GATE_TICKET="${TICKET_ID:-${WORKTREE_PATH##*/}}"
    if [ -n "$DEV_PORT" ] && [ -n "${CONCERTINO_FRONTEND_HEALTH:-}" ]; then
      curl -sf "$(resolve_url "$CONCERTINO_FRONTEND_HEALTH")" >/dev/null 2>&1 \
          && fail "frontend still serving on ${DEV_PORT}" || true
    fi
    if [ -n "$BACKEND_PORT" ] && [ -n "${CONCERTINO_BACKEND_HEALTH:-}" ]; then
      curl -sf "$(resolve_url "$CONCERTINO_BACKEND_HEALTH")" >/dev/null 2>&1 \
          && fail "backend still healthy on ${BACKEND_PORT}" || true
    fi
    [ ! -d "$WORKTREE_PATH" ] || fail "worktree dir still present: $WORKTREE_PATH"
    ;;

  *)
    echo "FAIL unknown phase '$PHASE' (expected: setup|servers|delivery|cleanup)" >&2
    exit 2
    ;;
esac

DURATION_MS=$(( $(now_ms) - START_TS ))

if [ "$FAILED" -ne 0 ]; then
  looks_like_ticket "$GATE_TICKET" && CONCERTINO_ROLE=script "${SCRIPT_DIR}/emit-event.sh" gate.result \
    "ticket=${GATE_TICKET}" "gate=phase:${PHASE}" "status=fail" "duration_ms=${DURATION_MS}" "first_error=${FIRST_ERROR}" || true
  exit 1
fi

looks_like_ticket "$GATE_TICKET" && CONCERTINO_ROLE=script "${SCRIPT_DIR}/emit-event.sh" gate.result \
  "ticket=${GATE_TICKET}" "gate=phase:${PHASE}" "status=pass" "duration_ms=${DURATION_MS}" || true
echo "PASS $PHASE"
