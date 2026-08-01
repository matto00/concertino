#!/usr/bin/env bash
set -euo pipefail

# ===========================================================================
# cleanup.sh — canonical Phase-4 (post-merge) teardown for the ticket-delivery flow.
#
# Stops the dev servers bound to this ticket's ports, removes the worktree,
# and fast-forwards local <base> (default: main) to match the fetched remote
# (CON-25) — Phase 4 is the one moment the workflow knows, synchronously, that
# a merge just happened, so it is the natural place to bring the base forward
# before it goes stale for the next run. Safe to re-run.
#
# DESTRUCTIVE — Phase-4 only. This script removes the live worktree and kills
# the dev servers. It must run ONLY as the orchestrator's post-merge teardown,
# never mid-review. To guard against a stray invocation it refuses to do any
# work unless an explicit Phase-4 opt-in is present:
#   - the first argument is `--phase4`, OR
#   - the environment sentinel `CONCERTINO_PHASE4=1` is set.
# Without the opt-in it prints a refusal to stderr and exits 0 (safe no-op).
#
# Usage: cleanup.sh --phase4 <WORKTREE_PATH> <DEV_PORT> <BACKEND_PORT>
#    or: CONCERTINO_PHASE4=1 cleanup.sh <WORKTREE_PATH> <DEV_PORT> <BACKEND_PORT>
#
# Prints "READY cleaned worktree=<path>" on success — ALWAYS exits 0,
# regardless of whether the fast-forward below succeeded, escalated, or was
# skipped. A stale base is a risk for the NEXT run, never a reason to leave
# THIS already-merged ticket's teardown incomplete.
# ===========================================================================

# Phase-4 guard: proceed with the destructive steps only on explicit opt-in.
if [ "${1:-}" = "--phase4" ]; then
  shift
elif [ "${CONCERTINO_PHASE4:-}" != "1" ]; then
  echo "cleanup.sh: refusing to run — this is a Phase-4 (post-merge) teardown that" >&2
  echo "removes the live worktree and kills the dev servers. It is invoked only by" >&2
  echo "the orchestrator after merge. Pass --phase4 as the first argument (or set" >&2
  echo "CONCERTINO_PHASE4=1) to proceed. No-op; nothing changed." >&2
  exit 0
fi

WORKTREE_PATH="${1:?usage: cleanup.sh --phase4 <WORKTREE_PATH> <DEV_PORT> <BACKEND_PORT>}"
DEV_PORT="${2:-}"
BACKEND_PORT="${3:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
[ -f "${SCRIPT_DIR}/.concertino.env" ] && source "${SCRIPT_DIR}/.concertino.env"

REPO_ROOT="$(git rev-parse --show-toplevel)"

# `concertino sync`'s renderEnv writes both CONCERTINO_BASE_BRANCH and
# CONCERTINO_BASE_REMOTE (see bin/concertino), the latter from
# project.baseRemote (defaulting to origin). Default both with
# ${VAR:-default} anyway, matching setup-worktree.sh's own fallback, so this
# is correct even against a stale .concertino.env rendered before this field
# existed, or one that predates a `concertino sync` re-run.
BASE_REMOTE="${CONCERTINO_BASE_REMOTE:-origin}"
BASE_BRANCH="${CONCERTINO_BASE_BRANCH:-main}"

# Stop dev servers on this ticket's ports (no-op if already down).
[ -n "$DEV_PORT" ]     && fuser -k "${DEV_PORT}/tcp"     2>/dev/null || true
[ -n "$BACKEND_PORT" ] && fuser -k "${BACKEND_PORT}/tcp" 2>/dev/null || true

# Remove the worktree (force: discards the now-merged working tree).
if [ -d "$WORKTREE_PATH" ]; then
  git -C "$REPO_ROOT" worktree remove "$WORKTREE_PATH" --force
fi
git -C "$REPO_ROOT" worktree prune

# Phase-4 cleanup only runs post-merge, so reaching here means the run shipped.
T="${WORKTREE_PATH##*/}"

# ===========================================================================
# Fast-forward local <base> to match the fetched remote (CON-25).
#
# Operates on refs, not on "whatever is checked out", except where a working
# tree is actually involved (design.md Decision 2) — this is what makes it
# safe with several worktrees live off one shared object store: none of the
# ticket worktrees ever have <base> checked out (they are all on feature
# branches), so the overwhelmingly common case touches no working tree at all.
#
# Sets, on return, FF_STATUS to one of:
#   fetch-failed  - offline, or the remote/branch didn't resolve; skip silently
#   no-local-base - refs/heads/<base> doesn't exist locally; skip silently
#   current       - local <base> already equals the fetched remote tip
#   updated       - local <base> was fast-forwarded (FF_WORKTREE says where)
#   dirty         - <base> is checked out somewhere with uncommitted changes
#   diverged      - local <base> carries commits the remote doesn't have
#   failed        - the fast-forward attempt itself failed unexpectedly
# and FF_REASON to a human-readable reason whenever escalation is warranted.
# Never touches a ref or a file outside of what the "updated" outcome itself
# performs — every other outcome leaves everything exactly as it found it.
# ===========================================================================
attempt_fast_forward() {
  FF_STATUS="fetch-failed"
  FF_REASON=""
  FF_WORKTREE=""

  git -C "$REPO_ROOT" fetch --quiet "$BASE_REMOTE" "$BASE_BRANCH" 2>/dev/null || return 0
  git -C "$REPO_ROOT" show-ref --verify --quiet "refs/remotes/${BASE_REMOTE}/${BASE_BRANCH}" || return 0

  local local_tip remote_tip
  local_tip="$(git -C "$REPO_ROOT" rev-parse "refs/heads/${BASE_BRANCH}" 2>/dev/null)" || {
    FF_STATUS="no-local-base"; return 0
  }
  remote_tip="$(git -C "$REPO_ROOT" rev-parse "${BASE_REMOTE}/${BASE_BRANCH}" 2>/dev/null)" || {
    FF_STATUS="failed"; FF_REASON="could not resolve ${BASE_REMOTE}/${BASE_BRANCH} after fetch"; return 0
  }

  if [ "$local_tip" = "$remote_tip" ]; then
    FF_STATUS="current"
    return 0
  fi

  if ! git -C "$REPO_ROOT" merge-base --is-ancestor "$local_tip" "$remote_tip"; then
    FF_STATUS="diverged"
    FF_REASON="local ${BASE_BRANCH} has commits ${BASE_REMOTE}/${BASE_BRANCH} does not (diverged)"
    return 0
  fi

  # Locate whether <base> is checked out anywhere, including REPO_ROOT itself.
  local wt="" base_worktree=""
  while IFS= read -r line; do
    case "$line" in
      "worktree "*) wt="${line#worktree }" ;;
      "branch refs/heads/${BASE_BRANCH}") base_worktree="$wt" ;;
    esac
  done < <(git -C "$REPO_ROOT" worktree list --porcelain)

  if [ -z "$base_worktree" ]; then
    # Not checked out anywhere — a pure ref update, no working tree at risk.
    if git -C "$REPO_ROOT" update-ref "refs/heads/${BASE_BRANCH}" "$remote_tip"; then
      FF_STATUS="updated"
      FF_WORKTREE="$REPO_ROOT"
    else
      FF_STATUS="failed"
      FF_REASON="git update-ref refs/heads/${BASE_BRANCH} failed unexpectedly"
    fi
    return 0
  fi

  if [ -n "$(git -C "$base_worktree" status --porcelain 2>/dev/null)" ]; then
    FF_STATUS="dirty"
    FF_REASON="${BASE_BRANCH} is checked out at ${base_worktree} with uncommitted changes"
    return 0
  fi

  if git -C "$base_worktree" merge --ff-only "${BASE_REMOTE}/${BASE_BRANCH}" >/dev/null 2>&1; then
    FF_STATUS="updated"
    FF_WORKTREE="$base_worktree"
  else
    FF_STATUS="failed"
    FF_REASON="git merge --ff-only failed unexpectedly at ${base_worktree}"
  fi
}

attempt_fast_forward

# Unresolvable: dirty tree, diverged base, or an unexpected failure — escalate
# with a bounded retry/skip loop rather than ever touching either unilaterally
# (the ticket's own "never fast-forward over uncommitted work or a diverged
# base" requirement). `retry` re-runs the algorithm exactly once more; any
# other answer — skip, free text, or a timeout — is left exactly as found and
# does NOT raise a second escalation.
if [ "$FF_STATUS" = "dirty" ] || [ "$FF_STATUS" = "diverged" ] || [ "$FF_STATUS" = "failed" ]; then
  REASON="${FF_REASON:-fast-forward could not complete}"
  ANSWER="$("${SCRIPT_DIR}/emit-event.sh" escalation --await \
    ticket="$T" \
    question="can't fast-forward local ${BASE_BRANCH} (${REASON})" \
    options=retry,skip || true)"

  if [ "$ANSWER" = "retry" ]; then
    attempt_fast_forward
    if [ "$FF_STATUS" = "fetch-failed" ] || [ "$FF_STATUS" = "no-local-base" ]; then
      # The retry itself never reached a local-vs-remote comparison (couldn't
      # fetch the remote, or couldn't resolve the local base branch) — report
      # that the base state is unknown, not that it is confirmed behind.
      case "$FF_STATUS" in
        fetch-failed) UNKNOWN_REASON="${FF_REASON:-fetch failed}" ;;
        no-local-base) UNKNOWN_REASON="${FF_REASON:-no local ${BASE_BRANCH} branch}" ;;
      esac
      echo "note: could not determine whether local ${BASE_BRANCH} is behind ${BASE_REMOTE}/${BASE_BRANCH} after retry — ${UNKNOWN_REASON}" >&2
    elif [ "$FF_STATUS" != "updated" ] && [ "$FF_STATUS" != "current" ]; then
      NOTE="note: local ${BASE_BRANCH} remains behind ${BASE_REMOTE}/${BASE_BRANCH} after retry"
      [ -n "${FF_REASON:-}" ] && NOTE="${NOTE} (${FF_REASON})"
      echo "${NOTE} — resolve manually" >&2
    fi
  fi
fi

# A successful fast-forward (silent, or via retry) gets a best-effort
# re-render so the rendered-artifact staleness this ticket exists to close
# (the same failure mode behind `doctor`'s drift check) cannot recur
# silently. Resolution order matches what an ADOPTING project actually has
# (design.md Decision 4, revised after design-gate round 1) — `bin/concertino`
# as a real file only exists in this repo's own self-hosting case, never
# assumed elsewhere.
if [ "$FF_STATUS" = "updated" ]; then
  RENDER_OK=1
  if command -v concertino >/dev/null 2>&1; then
    concertino sync --out="$REPO_ROOT" >/dev/null 2>&1 || RENDER_OK=0
  elif [ -f "${REPO_ROOT}/bin/concertino" ]; then
    node "${REPO_ROOT}/bin/concertino" sync --out="$REPO_ROOT" >/dev/null 2>&1 || RENDER_OK=0
  else
    npx --no-install concertino sync --out="$REPO_ROOT" >/dev/null 2>&1 || RENDER_OK=0
  fi
  if [ "$RENDER_OK" -ne 1 ]; then
    echo "note: main fast-forwarded — re-render failed or no \`concertino\` found, run \`concertino sync\` manually" >&2
  fi
fi

[[ "$T" =~ ^[A-Za-z#][A-Za-z0-9_-]*[0-9]$ ]] && CONCERTINO_ROLE=script "${SCRIPT_DIR}/emit-event.sh" run.end \
  "ticket=${T}" "status=delivered" || true

echo "READY cleaned worktree=${WORKTREE_PATH}"
