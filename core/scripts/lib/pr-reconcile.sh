#!/usr/bin/env bash
# lib/pr-reconcile.sh — shared BEHIND-auto-reconcile-once helper (CON-122
# cycle 2, finding 6). Extracted verbatim from check-merge-readiness.sh's
# original condition 0 so both it and check-pr-mergeable.sh share ONE
# implementation instead of two independently-maintained copies that could
# silently drift apart.
#
# pr_reconcile_behind_once <WORKTREE_PATH> <BRANCH>
#
# If the PR is currently BEHIND its base, merges the base into BRANCH once
# (never a rebase/force-push, so current work is never rewritten or lost)
# and pushes. On success (including the no-op case where the PR isn't
# BEHIND at all), prints nothing and returns 0. On failure, prints exactly
# one reason line to stdout (the caller decides how to surface it — as a
# `fail "..."` line, in check-merge-readiness.sh's case, or directly, in
# check-pr-mergeable.sh's) and returns 1. Never touches $FAILED or any
# other caller-scoped state directly, so it's safe to source from either
# script's global scope.
pr_reconcile_behind_once() {
  local worktree="$1" branch="$2"
  local pre_raw pre_status base_ref fetch_out merge_out push_out

  pre_raw="$(cd "$worktree" && gh pr view "$branch" --json mergeStateStatus,baseRefName 2>&1)"
  if [ $? -ne 0 ]; then
    return 0 # let the caller's own subsequent query surface the gh failure
  fi
  pre_status="$(printf '%s' "$pre_raw" | jq -r '.mergeStateStatus // ""' 2>/dev/null)"
  base_ref="$(printf '%s' "$pre_raw" | jq -r '.baseRefName // ""' 2>/dev/null)"
  [ -z "$base_ref" ] && base_ref="${CONCERTINO_BASE_BRANCH:-main}"

  if [ "$pre_status" != "BEHIND" ]; then
    return 0
  fi

  fetch_out="$(cd "$worktree" && git fetch origin "$base_ref" 2>&1)"
  if [ $? -ne 0 ]; then
    echo "not mergeable: BEHIND (auto-reconcile: could not fetch origin/${base_ref}: $(printf '%s' "$fetch_out" | tr '\n' ' ' | cut -c1-200))"
    return 1
  fi

  merge_out="$(cd "$worktree" && git merge --no-edit "origin/${base_ref}" 2>&1)"
  if [ $? -ne 0 ]; then
    (cd "$worktree" && git merge --abort) >/dev/null 2>&1 || true
    echo "not mergeable: BEHIND (auto-reconcile with origin/${base_ref} hit conflicts — needs human resolution; current work left untouched)"
    return 1
  fi

  push_out="$(cd "$worktree" && git push origin "HEAD:${branch}" 2>&1)"
  if [ $? -ne 0 ]; then
    echo "not mergeable: BEHIND (auto-reconcile merged origin/${base_ref} locally but push to origin/${branch} failed: $(printf '%s' "$push_out" | tr '\n' ' ' | cut -c1-200))"
    return 1
  fi

  return 0
}
