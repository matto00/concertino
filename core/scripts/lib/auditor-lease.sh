# auditor-lease.sh — shared helper for the CON-171 Phase-4 teardown guard.
#
# Owns the one thing that must never drift between the three call sites that
# touch it (`check-merge-readiness.sh` acquires, `emit-event.sh` releases,
# `cleanup.sh` queries): the lease's path, its ticket-key canonicalisation,
# and how the run root is resolved. See design.md Decision 2 for the full
# rationale; this file implements exactly what that decision pins down.
#
# The lease lives at:
#   <run-root>/.concertino/runs/<CANONICAL_TICKET_ID>/locks/auditor.lease
# in the MAIN checkout, never the worktree — it must outlive the worktree it
# protects in order to be checked at teardown time.
#
# Usage: source this file, then call:
#   lease_resolve_root [DIR]     — resolve the run root via the same
#                                  `git rev-parse --git-common-dir` path both
#                                  writers already use, run from DIR (default:
#                                  the caller's own cwd). Prints the absolute
#                                  root on stdout; returns non-zero (prints
#                                  nothing) if it cannot be resolved. Callers
#                                  must not substitute their own root
#                                  resolution (e.g. `--show-toplevel`) — see
#                                  design.md Decision 2's "silent fail-open"
#                                  note.
#   lease_canonicalize TICKET    — print the canonical ticket id (uppercase,
#                                  matching emit-event.sh's existing
#                                  canonicalisation). Identical on every call
#                                  site so acquire and release can never key
#                                  under different spellings of the same id.
#   lease_path ROOT TICKET       — print the absolute lease file path.
#   lease_acquire ROOT TICKET WORKTREE_PATH SCRIPT_NAME
#                                 — idempotently (re)write the lease. Records
#                                  the acquiring script, canonical ticket,
#                                  absolute worktree path, acquiring pid, and
#                                  an ISO-8601 UTC timestamp. Returns non-zero
#                                  only if the lease directory/file could not
#                                  be created (e.g. an unwritable root).
#   lease_release ROOT TICKET    — idempotently remove the lease. Never fails
#                                  the caller: a missing lease is treated
#                                  identically to a successfully-removed one.
#   lease_find_by_worktree ROOT WORKTREE_PATH
#                                 — scan every lease under ROOT for one whose
#                                  recorded worktree path exactly matches
#                                  WORKTREE_PATH (never keyed on a ticket id
#                                  inferred from a basename — see design.md
#                                  Decision 2's "matched on worktree path, not
#                                  ticket id" note). Prints the matching lease
#                                  file path on stdout and returns 0 on a hit;
#                                  returns 1 with no output on no match.
#   lease_field LEASE_FILE FIELD — print one field (script|ticket|worktree|
#                                  pid|ts) recorded in LEASE_FILE.

# lease_resolve_root [DIR]
#
# Mirrors check-merge-readiness.sh's and emit-event.sh's own main_checkout()
# functions exactly (they resolve identically; this is the single copy both
# should eventually call through). Deliberately does NOT accept or trust a
# caller-supplied root (e.g. cleanup.sh's REPO_ROOT, which is
# `--show-toplevel` relative to its own cwd and can disagree — design.md
# Decision 2).
lease_resolve_root() {
  local dir="${1:-.}" common
  common="$(cd "$dir" 2>/dev/null && git rev-parse --git-common-dir 2>/dev/null)" || return 1
  [ -z "$common" ] && return 1
  case "$common" in
    /*) ;;
    *) common="$(cd "$dir" 2>/dev/null && cd "$common" 2>/dev/null && pwd)" || return 1 ;;
  esac
  ( cd "$(dirname "$common")" 2>/dev/null && pwd ) || return 1
}

# lease_canonicalize TICKET
#
# Only the letters `looks_like_ticket` already permits
# (`[A-Za-z#][A-Za-z0-9_-]*[0-9]`) are touched by `tr`; `#`, digits, `_`, `-`
# pass through unchanged — identical to emit-event.sh's existing
# canonicalisation (CON-80 design.md Decision 2), copied here rather than
# widened.
lease_canonicalize() {
  printf '%s' "$1" | tr '[:lower:]' '[:upper:]'
}

# lease_path ROOT TICKET
lease_path() {
  local root="$1" ticket
  ticket="$(lease_canonicalize "$2")"
  printf '%s/.concertino/runs/%s/locks/auditor.lease' "$root" "$ticket"
}

# lease_normalize_worktree_path PATH
#
# Both writer and every reader of the `worktree=` field go through this, so
# a trailing slash or a relative path at one call site can never silently
# mismatch a canonical absolute path at another (final-gate skeptic review
# round 1, non-blocking note — the failure direction without this was
# already the safe one, fail-OPEN to today's un-guarded behaviour rather
# than a new hazard, but cheap to close outright). Uses `realpath -m`
# (canonicalize WITHOUT requiring the path to exist — a worktree may
# already be removed by the time cleanup.sh re-queries on an idempotent
# re-run, so `realpath` without `-m` would wrongly fail on exactly the case
# this lookup most needs to succeed) when available; falls back to
# stripping one trailing slash when `realpath` is not on `PATH`, which is
# strictly less normalisation but never worse than doing nothing.
lease_normalize_worktree_path() {
  local p="$1"
  if command -v realpath >/dev/null 2>&1; then
    realpath -m -- "$p" 2>/dev/null && return 0
  fi
  case "$p" in
    */) printf '%s' "${p%/}" ;;
    *) printf '%s' "$p" ;;
  esac
}

# lease_acquire ROOT TICKET WORKTREE_PATH SCRIPT_NAME
#
# Idempotent by construction: re-invoking simply rewrites the same file with
# a fresh pid/timestamp for the same (root, ticket) pair, which is required
# because check-merge-readiness.sh re-runs on a PENDING (exit 3) re-invoke
# (up to three times) and must not error on the re-acquire.
lease_acquire() {
  local root="$1" ticket="$2" worktree_path="$3" script_name="$4"
  local lease_file dir ts
  worktree_path="$(lease_normalize_worktree_path "$worktree_path")"
  lease_file="$(lease_path "$root" "$ticket")"
  dir="$(dirname "$lease_file")"
  mkdir -p "$dir" 2>/dev/null || return 1
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null)"
  {
    printf 'script=%s\n' "$script_name"
    printf 'ticket=%s\n' "$(lease_canonicalize "$ticket")"
    printf 'worktree=%s\n' "$worktree_path"
    printf 'pid=%s\n' "$$"
    printf 'ts=%s\n' "$ts"
  } > "$lease_file" 2>/dev/null || return 1
  return 0
}

# lease_release ROOT TICKET
#
# Never fails the caller — a lost/already-absent lease is not an error here
# (emit-event.sh's own "a lost event never fails the run" posture, design.md
# Decision 4a).
lease_release() {
  local root="$1" ticket="$2" lease_file
  lease_file="$(lease_path "$root" "$ticket")"
  rm -f "$lease_file" 2>/dev/null
  return 0
}

# lease_field LEASE_FILE FIELD
lease_field() {
  local lease_file="$1" field="$2"
  [ -f "$lease_file" ] || return 1
  sed -n "s/^${field}=//p" "$lease_file" | head -n1
}

# lease_find_by_worktree ROOT WORKTREE_PATH
#
# Matched on the RECORDED WORKTREE PATH, never on a ticket id inferred from a
# basename (cleanup.sh's own `T="${TICKET_ID:-${WORKTREE_PATH##*/}}"`
# fallback is not a reliable ticket id for a non-conforming branch name —
# design.md Decision 2). Tolerates a lease file vanishing mid-scan (another
# process racing a release) — that is a real race here, not a theoretical
# one, so a failed read of one candidate is skipped rather than aborting the
# whole scan.
lease_find_by_worktree() {
  local root="$1" worktree_path="$2" lease_file wt
  worktree_path="$(lease_normalize_worktree_path "$worktree_path")"
  local -a leases=()
  # Populate the glob into an array first so an empty match (nullglob off)
  # doesn't hand a literal, non-existent glob pattern to the loop body.
  for lease_file in "${root}"/.concertino/runs/*/locks/auditor.lease; do
    leases+=("$lease_file")
  done
  for lease_file in ${leases+"${leases[@]}"}; do
    [ -f "$lease_file" ] || continue
    wt="$(lease_field "$lease_file" worktree 2>/dev/null)" || continue
    wt="$(lease_normalize_worktree_path "$wt")"
    if [ "$wt" = "$worktree_path" ]; then
      printf '%s\n' "$lease_file"
      return 0
    fi
  done
  return 1
}
