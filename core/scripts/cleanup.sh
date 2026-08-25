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
# Usage: cleanup.sh --phase4 <WORKTREE_PATH> <DEV_PORT> <BACKEND_PORT> [TICKET_ID]
#    or: CONCERTINO_PHASE4=1 cleanup.sh <WORKTREE_PATH> <DEV_PORT> <BACKEND_PORT> [TICKET_ID]
#
# Prints "READY cleaned worktree=<path>" and, on every exit path past the
# --phase4 guard, a machine-parseable "RESULT ..." summary line (see
# print_result below) to stderr. Exits 0 ONLY when every hard-failing
# postcondition this script re-probes (worktree absent, local branch absent
# or intentionally left in place) was confirmed true; exits non-zero,
# naming the failing command and its stderr, the instant any of those git
# operations fails or a re-probed postcondition is found unmet. The ONE
# deliberately-tolerant exception is the fast-forward comparison of local
# <base> against the fetched remote (attempt_fast_forward, below): "main
# cannot fast-forward" (dirty tree / diverged base / fetch failed) is a
# distinct, reportable, non-fatal outcome and does NOT affect the exit code
# — a stale base is a risk for the NEXT run, never a reason to leave THIS
# already-merged ticket's worktree/branch teardown incomplete.
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

WORKTREE_PATH="${1:?usage: cleanup.sh --phase4 <WORKTREE_PATH> <DEV_PORT> <BACKEND_PORT> [TICKET_ID]}"
DEV_PORT="${2:-}"
BACKEND_PORT="${3:-}"
TICKET_ID="${4:-}"

# ---------------------------------------------------------------------------
# RESULT-line fields, declared to defined defaults immediately — before
# REPO_ROOT, before anything else that can fail (design.md Decision 4). This
# is what lets fail()/print_result() emit a coherent RESULT line even from
# the very first hard-failing call, without dereferencing an unset variable
# under `set -u`.
# ---------------------------------------------------------------------------
WT_OK="not-attempted"
BRANCH=""
BRANCH_LOCAL="not-attempted"
BRANCH_REMOTE="not-attempted"
FF_STATUS="not-attempted"

# print_result: the machine-parseable summary line, printed to STDERR
# deliberately (never stdout) — several call sites below invoke run_git via
# `VAR="$(run_git ...)"` command substitution (e.g. REPO_ROOT), and a
# command substitution only ever captures the subshell's stdout. A RESULT
# line on stdout would be silently captured and discarded on exactly that
# failure path, reproducing the very "failure happened but nothing legible
# came out" defect this script exists to close (design-gate round 3, change
# request 1). Printed on every exit path past this point: success,
# fail()-driven hard failure (at whatever point it fires), and the existing
# tolerant fast-forward outcome.
print_result() {
  echo "RESULT worktree=${WT_OK} branch_local=${BRANCH_LOCAL} branch_remote=${BRANCH_REMOTE} base=${FF_STATUS}" >&2
}

# fail: the one exit path for every hard-failing git operation below.
# Always prints whatever RESULT state has been confirmed so far (never
# nothing) to stderr before exiting non-zero, so a caller inspecting stderr
# always finds exactly one RESULT line regardless of how early the failure
# occurred.
fail() {
  echo "cleanup.sh: FAILED: $1" >&2
  print_result
  exit 1
}

# run_git <description> -- <command...>: wraps a single hard-failing git (or
# git_child) invocation. On success, prints the command's stdout on stdout
# and returns 0 — safe to use as `VAR="$(run_git ...)"`. On failure, prints
# "cleanup.sh: FAILED <description>: <command>" plus the command's own
# stderr (captured via a temp file, not `2>&1`, which would corrupt a stdout
# capture) to stderr, then calls fail() to exit non-zero. This is what makes
# the failure message name the specific failing command and isolate its
# stderr, and what makes the RESULT line reliably reflect what happened
# regardless of exactly where in the script a failure occurs (design.md
# Decision 2).
run_git() {
  local desc="$1"; shift
  [ "${1:-}" = "--" ] && shift
  local out err rc
  err="$(mktemp)"
  if out="$("$@" 2>"$err")"; then
    rc=0
  else
    rc=$?
  fi
  if [ "$rc" -ne 0 ]; then
    echo "cleanup.sh: FAILED ${desc}: $*" >&2
    sed 's/^/  /' "$err" >&2
    rm -f "$err"
    fail "${desc}"
  fi
  rm -f "$err"
  printf '%s' "$out"
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/lib/git-child-env.sh"
# shellcheck disable=SC1091
[ -f "${SCRIPT_DIR}/.concertino.env" ] && source "${SCRIPT_DIR}/.concertino.env"

REPO_ROOT="$(run_git "resolve repo root" -- git_child rev-parse --show-toplevel)"

# `concertino sync`'s renderEnv writes both CONCERTINO_BASE_BRANCH and
# CONCERTINO_BASE_REMOTE (see bin/concertino), the latter from
# project.baseRemote (defaulting to origin). Default both with
# ${VAR:-default} anyway, matching setup-worktree.sh's own fallback, so this
# is correct even against a stale .concertino.env rendered before this field
# existed, or one that predates a `concertino sync` re-run.
BASE_REMOTE="${CONCERTINO_BASE_REMOTE:-origin}"
BASE_BRANCH="${CONCERTINO_BASE_BRANCH:-main}"

# Phase-4 cleanup only runs post-merge, so reaching here means the run shipped.
# The canonical ticket ID arrives as the explicit 4th argument (CON-64); the
# worktree-basename inference stays only as a fallback for call sites rendered
# before the argument existed. Inference is not reliable — a branch without
# the <type>/<desc>/<TICKET-ID> suffix makes the basename a non-ticket, and
# the run.end at the bottom of this script would then never be tagged, leaving
# the run permanently non-terminal on the dashboard. Resolved up front (moved
# ahead of the worktree-removal step) because branch resolution's
# naming-convention fallback (Decision 3a) also needs it.
T="${TICKET_ID:-${WORKTREE_PATH##*/}}"

# Stop dev servers on this ticket's ports (no-op if already down).
[ -n "$DEV_PORT" ]     && fuser -k "${DEV_PORT}/tcp"     2>/dev/null || true
[ -n "$BACKEND_PORT" ] && fuser -k "${BACKEND_PORT}/tcp" 2>/dev/null || true

# ---------------------------------------------------------------------------
# Resolve BRANCH, remove the worktree, and set WT_OK — all before any branch
# deletion is attempted (git branch -D fails while a worktree still uses the
# branch — design.md Decision 3).
#
# BRANCH resolution is two-step (Decision 3a, revised design-gate round 2):
#   (a) worktree still present — parse `git worktree list --porcelain` for
#       the branch it has checked out, captured BEFORE removal.
#   (b) worktree already absent (the idempotent-re-run / "branch left
#       behind" case — the ticket's own most-cited real scenario) — search
#       local branches by this project's own naming convention
#       (`.../<TICKET_ID>`); use it only if exactly one branch matches.
# ---------------------------------------------------------------------------
if [ -d "$WORKTREE_PATH" ]; then
  _wt=""
  while IFS= read -r line; do
    case "$line" in
      "worktree "*) _wt="${line#worktree }" ;;
      "branch refs/heads/"*)
        if [ "$_wt" = "$WORKTREE_PATH" ]; then
          BRANCH="${line#branch refs/heads/}"
        fi
        ;;
    esac
  done < <(git_child -C "$REPO_ROOT" worktree list --porcelain)

  run_git "remove worktree" -- git_child -C "$REPO_ROOT" worktree remove "$WORKTREE_PATH" --force >/dev/null
  # Re-probe IMMEDIATELY — a `worktree remove` that returns 0 but leaves a
  # non-empty directory behind must still be caught here, driving the exit
  # code right away rather than merely being reported at the end.
  if [ -d "$WORKTREE_PATH" ]; then
    WT_OK=fail
    fail "worktree still present after removal: $WORKTREE_PATH"
  fi
  WT_OK=ok
else
  # Already absent — the postcondition this field tracks is already true.
  WT_OK=ok
  if [ -n "$T" ]; then
    MATCHES="$(git_child -C "$REPO_ROOT" branch --list "*/${T}" --format='%(refname:short)' 2>/dev/null || true)"
    if [ "$(printf '%s\n' "$MATCHES" | grep -c .)" -eq 1 ]; then
      BRANCH="$MATCHES"
    fi
  fi
fi
git_child -C "$REPO_ROOT" worktree prune 2>/dev/null || true   # soft, unchanged from today

# ---------------------------------------------------------------------------
# Branch deletion — content-equality against the fetched base, not
# ancestry, so a squash-merged branch (commits not ancestors of <base>)
# still deletes cleanly. Uses the two-dot diff form deliberately (design.md
# Decision 3b): `git diff <base_remote>/<base_branch> <branch>`, NOT
# three-dot `...` (merge-base-relative, non-empty for exactly the
# squash-merge case this feature exists to handle). Never guesses when the
# diff itself can't be computed (fetch failed, branch already gone) —
# mirrors the same "unresolvable → report, don't force" posture the
# fast-forward step below already uses.
# ---------------------------------------------------------------------------
if [ -n "$BRANCH" ] && [ "$BRANCH" != "$BASE_BRANCH" ]; then
  git_child -C "$REPO_ROOT" fetch --quiet "$BASE_REMOTE" "$BASE_BRANCH" 2>/dev/null || true
  if DIFF="$(git_child -C "$REPO_ROOT" diff "${BASE_REMOTE}/${BASE_BRANCH}" "${BRANCH}" 2>/dev/null)"; then
    DIFF_OK=1
  else
    DIFF_OK=0
  fi
  if [ "$DIFF_OK" -eq 1 ] && [ -z "$DIFF" ]; then
    run_git "delete local branch ${BRANCH}" -- git_child -C "$REPO_ROOT" branch -D "$BRANCH" >/dev/null
    # Re-probe IMMEDIATELY — a `branch -D` that returns 0 but somehow left
    # the ref behind must still be caught here, driving the exit code right
    # away (the same "re-probe drives the exit code" principle as the
    # worktree postcondition above).
    if git_child -C "$REPO_ROOT" show-ref --verify --quiet "refs/heads/${BRANCH}" 2>/dev/null; then
      BRANCH_LOCAL=fail
      fail "branch ${BRANCH} still present after deletion"
    fi
    BRANCH_LOCAL=ok
    # Remote branch deletion is best-effort: the remote branch is very
    # commonly already gone by Phase 4 (host "delete branch on merge"
    # defaults), and re-attempting a delete against an already-gone ref is
    # not itself a defect worth failing the whole teardown over.
    if git_child -C "$REPO_ROOT" push "$BASE_REMOTE" --delete "$BRANCH" 2>/dev/null; then
      BRANCH_REMOTE=ok
    else
      BRANCH_REMOTE=fail_or_absent
    fi
  else
    # Content differs from base, or the diff itself couldn't be computed
    # (fetch failed, or the branch is already gone) — never force-delete.
    BRANCH_LOCAL=skipped
    BRANCH_REMOTE=skipped
  fi
else
  BRANCH_LOCAL=skipped
  BRANCH_REMOTE=skipped
fi

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

  git_child -C "$REPO_ROOT" fetch --quiet "$BASE_REMOTE" "$BASE_BRANCH" 2>/dev/null || return 0
  git_child -C "$REPO_ROOT" show-ref --verify --quiet "refs/remotes/${BASE_REMOTE}/${BASE_BRANCH}" || return 0

  local local_tip remote_tip
  local_tip="$(git_child -C "$REPO_ROOT" rev-parse "refs/heads/${BASE_BRANCH}" 2>/dev/null)" || {
    FF_STATUS="no-local-base"; return 0
  }
  remote_tip="$(git_child -C "$REPO_ROOT" rev-parse "${BASE_REMOTE}/${BASE_BRANCH}" 2>/dev/null)" || {
    FF_STATUS="failed"; FF_REASON="could not resolve ${BASE_REMOTE}/${BASE_BRANCH} after fetch"; return 0
  }

  if [ "$local_tip" = "$remote_tip" ]; then
    FF_STATUS="current"
    return 0
  fi

  if ! git_child -C "$REPO_ROOT" merge-base --is-ancestor "$local_tip" "$remote_tip"; then
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
  done < <(git_child -C "$REPO_ROOT" worktree list --porcelain)

  if [ -z "$base_worktree" ]; then
    # Not checked out anywhere — a pure ref update, no working tree at risk.
    if git_child -C "$REPO_ROOT" update-ref "refs/heads/${BASE_BRANCH}" "$remote_tip"; then
      FF_STATUS="updated"
      FF_WORKTREE="$REPO_ROOT"
    else
      FF_STATUS="failed"
      FF_REASON="git update-ref refs/heads/${BASE_BRANCH} failed unexpectedly"
    fi
    return 0
  fi

  if [ -n "$(git_child -C "$base_worktree" status --porcelain 2>/dev/null)" ]; then
    FF_STATUS="dirty"
    FF_REASON="${BASE_BRANCH} is checked out at ${base_worktree} with uncommitted changes"
    return 0
  fi

  if git_child -C "$base_worktree" merge --ff-only "${BASE_REMOTE}/${BASE_BRANCH}" >/dev/null 2>&1; then
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

  # CON-138: never block on --await when no TUI can possibly answer it.
  # `cleanup.sh` is a synchronous script with no chat channel and no
  # resumable agent state to fall back on — unlike orchestrator.md's
  # no-TUI branch, there is no live caller left to hand a "resolve me
  # later" token to by the time this runs (this is the last thing Phase 4
  # does). $SCRIPT_DIR-relative, NOT cwd-relative (see design.md Decision
  # 1): cleanup.sh runs against an arbitrary worktree cwd, so the
  # cwd-relative form orchestrator.md uses would fail closed here.
  if "${SCRIPT_DIR}/tui-attached.sh"; then
    ANSWER="$("${SCRIPT_DIR}/emit-event.sh" escalation --await \
      ticket="$T" \
      question="can't fast-forward local ${BASE_BRANCH} (${REASON})" \
      options=retry,skip || true)"
  else
    # No TUI attached: leave local <base> exactly as found (the existing
    # skip/timeout outcome) and make the outcome dashboard-visible via the
    # same gate.warning family used below, rather than a silent `|| true`.
    # Deliberately does NOT also call `--raise-only` here — see design.md
    # Decision 3b (an unresolved escalation left open at the very end of
    # Phase 4 would make other_runs_live() false-positive forever, per
    # CON-121).
    NO_TUI_NOTE="skipped fast-forward escalation: no TUI attached (${FF_STATUS}: ${REASON})"
    echo "note: ${NO_TUI_NOTE}" >&2
    CONCERTINO_ROLE=script "${SCRIPT_DIR}/emit-event.sh" gate.warning \
      ticket="$T" gate=phase:cleanup resolved=false "reason=${NO_TUI_NOTE}" || true
    ANSWER=""
  fi

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
      UNKNOWN_NOTE="could not determine whether local ${BASE_BRANCH} is behind ${BASE_REMOTE}/${BASE_BRANCH} after retry — ${UNKNOWN_REASON}"
      echo "note: ${UNKNOWN_NOTE}" >&2
      # CON-99: a retry that still can't even complete the comparison must
      # not be silently indistinguishable from a clean run — emit the same
      # gate.warning telemetry `assert-phase.sh delivery`'s stale-base
      # warning already established (CON-80), so the dashboard's event
      # log/timeline can surface it without a human watching a terminal.
      CONCERTINO_ROLE=script "${SCRIPT_DIR}/emit-event.sh" gate.warning \
        ticket="$T" gate=phase:cleanup resolved=false "reason=${UNKNOWN_NOTE}" || true
    elif [ "$FF_STATUS" != "updated" ] && [ "$FF_STATUS" != "current" ]; then
      NOTE="local ${BASE_BRANCH} remains behind ${BASE_REMOTE}/${BASE_BRANCH} after retry"
      [ -n "${FF_REASON:-}" ] && NOTE="${NOTE} (${FF_REASON})"
      echo "note: ${NOTE} — resolve manually" >&2
      # CON-99: same as above — a retry that completed its comparison and
      # still didn't resolve must be dashboard-visible, not stderr-only.
      CONCERTINO_ROLE=script "${SCRIPT_DIR}/emit-event.sh" gate.warning \
        ticket="$T" gate=phase:cleanup resolved=false "reason=${NOTE}" || true
    fi
  fi
fi

# The re-render below rewrites EVERY rendered artifact at the repo root
# (.claude/agents/*, AGENTS.md, .codex/config.toml, opencode.json,
# scripts/concertino/.concertino.env, speeds.json) — shared by all runs, not
# owned by this one. Idempotent when the config is unchanged, but a pending
# concertino.config.json edit (e.g. the TUI settings screen writes without
# syncing) would land under other LIVE runs at an arbitrary moment, so the
# sync is skipped whenever any other run is live (CON-66).
#
# "Live" here is events.jsonl state plus a staleness bound (CON-121): a
# run.start with no run.end yet, excluding this run's own ticket, AND whose
# last logged event is within CONCERTINO_LIVE_RUN_STALE_HOURS (default 6,
# falls back to 6 when unset/non-numeric — mirrors CONCERTINO_CLEANUP_SKIP_
# SYNC's env-gate pattern above) hours of now. A run stuck on an unresolved
# Phase-4 escalation (or any other path that ends without ever writing
# run.end) is exactly the case `lib/ui/retention.js` will NEVER prune —
# `retention.isEligible()` requires `hasRunEnd()`, so a run missing run.end
# is permanently ineligible for retention regardless of age. Without this
# staleness bound, such a run would stay "live" by this test forever; this
# bound is what closes that window instead. When the last event's timestamp
# can't be extracted (torn trailing line, blank line, hand-edited log), this
# fails closed to LIVE — never treat an unparsable timestamp as "not live".
# The failure mode of overcounting (a skipped re-render plus a note pointing
# at `concertino sync`) is strictly safer than rewriting shared artifacts
# under a run that really is live. Sets LIVE_RUN_TICKET to the first live
# ticket found, for the note.
other_runs_live() {
  local log t stale_hours stale_ms last_ts now_ms age_ms line i
  local -a lines

  stale_hours="${CONCERTINO_LIVE_RUN_STALE_HOURS:-6}"
  case "$stale_hours" in
    ''|*[!0-9]*) stale_hours=6 ;;
  esac
  stale_ms=$(( stale_hours * 3600 * 1000 ))

  for log in "${REPO_ROOT}/.concertino/runs"/*/events.jsonl; do
    [ -f "$log" ] || continue
    t="$(basename "$(dirname "$log")")"
    [ "$t" = "$T" ] && continue
    if grep -q '"kind":"run.start"' "$log" 2>/dev/null \
       && ! grep -q '"kind":"run.end"' "$log" 2>/dev/null; then
      # Scan backwards from the end of the file for the last line that
      # parses as a JSON object with a numeric "t" field — a blind `tail -1`
      # could land on a torn final line from a concurrent append (most
      # likely to occur under a genuinely live run, exactly the dangerous
      # direction to get wrong).
      last_ts=""
      lines=()
      while IFS= read -r line || [ -n "$line" ]; do
        lines+=("$line")
      done < "$log"
      for (( i=${#lines[@]}-1; i>=0; i-- )); do
        if [[ "${lines[$i]}" =~ ^\{.*\"t\":([0-9]+).*\}$ ]]; then
          last_ts="${BASH_REMATCH[1]}"
          break
        fi
      done
      if [ -z "$last_ts" ]; then
        # Decision 5: unparsable/missing timestamp fails closed to LIVE.
        LIVE_RUN_TICKET="$t"
        return 0
      fi
      now_ms=$(( $(date +%s) * 1000 ))
      age_ms=$(( now_ms - last_ts ))
      if [ "$age_ms" -lt "$stale_ms" ]; then
        LIVE_RUN_TICKET="$t"
        return 0
      fi
      # Past the staleness window: not live, keep scanning other logs.
    fi
  done
  return 1
}

# A successful fast-forward (silent, or via retry) gets a best-effort
# re-render so the rendered-artifact staleness this ticket exists to close
# (the same failure mode behind `doctor`'s drift check) cannot recur
# silently. Resolution order matches what an ADOPTING project actually has
# (design.md Decision 4, revised after design-gate round 1) — `bin/concertino`
# as a real file only exists in this repo's own self-hosting case, never
# assumed elsewhere.
# CONCERTINO_CLEANUP_SKIP_SYNC: env-gated escape hatch for the automatic
# re-render below. Unset/falsy (default) — sync runs as documented above.
# Set to a truthy value — the automatic `concertino sync` call is skipped,
# but the rest of Phase-4 cleanup (worktree removal, server teardown,
# run.end) proceeds unaffected. This is a real, named, off-by-default
# capability, not a permanently-on hardcoded disable: a project that needs
# to suppress the automatic sync (e.g. because its own `concertino` binary
# resolution is misbehaving) sets this env var itself, rather than the
# capability being baked into core/ as unconditionally disabled.
#
# CONCERTINO_LIVE_RUN_STALE_HOURS (CON-121): env-gated override for
# `other_runs_live()`'s staleness bound, above. Unset/non-numeric falls back
# to the default of 6 hours. A project that observes legitimately longer (or
# wants a tighter) delivery durations than this repo's own history sets this
# env var itself, same pattern as CONCERTINO_CLEANUP_SKIP_SYNC.
CLEANUP_SKIP_SYNC="${CONCERTINO_CLEANUP_SKIP_SYNC:-}"
case "$CLEANUP_SKIP_SYNC" in
  1|true|TRUE|True|yes|YES) CLEANUP_SKIP_SYNC=1 ;;
  *) CLEANUP_SKIP_SYNC=0 ;;
esac

if [ "$FF_STATUS" = "updated" ]; then
  if [ "$CLEANUP_SKIP_SYNC" -eq 1 ]; then
    echo "note: main fast-forwarded — \`concertino sync\` re-render skipped (CONCERTINO_CLEANUP_SKIP_SYNC set); run it manually if needed" >&2
  elif other_runs_live; then
    echo "note: main fast-forwarded — skipping \`concertino sync\`: run ${LIVE_RUN_TICKET} is still live and the re-render would rewrite shared root artifacts under it; run \`concertino sync\` manually once it finishes" >&2
  else
    RENDER_OK=1
    mkdir -p "${REPO_ROOT}/.concertino" 2>/dev/null || true
    # Serialise the render itself: two Phase-4 cleanups finishing at once must
    # not interleave their artifact writes. flock ships with util-linux; in
    # the unlikely environment without it, proceed unlocked — matching the
    # pre-CON-66 behavior rather than failing an already-merged teardown.
    {
      if command -v flock >/dev/null 2>&1; then flock 9 || true; fi
      if command -v concertino >/dev/null 2>&1; then
        concertino sync --out="$REPO_ROOT" >/dev/null 2>&1 || RENDER_OK=0
      elif [ -f "${REPO_ROOT}/bin/concertino" ]; then
        node "${REPO_ROOT}/bin/concertino" sync --out="$REPO_ROOT" >/dev/null 2>&1 || RENDER_OK=0
      else
        npx --no-install concertino sync --out="$REPO_ROOT" >/dev/null 2>&1 || RENDER_OK=0
      fi
    } 9>"${REPO_ROOT}/.concertino/sync.lock"
    if [ "$RENDER_OK" -ne 1 ]; then
      echo "note: main fast-forwarded — re-render failed or no \`concertino\` found, run \`concertino sync\` manually" >&2
    fi
  fi
fi

# run.end is the run's terminal marker — the dashboard defines "terminal" as
# "has emitted run.end" (lib/ui/retention.js) — so the write must always be
# ATTEMPTED, never pre-gated here on a ticket-shape regex whose silent failure
# is indistinguishable from success (CON-64). emit-event.sh owns ticket
# validation and warns loudly on stderr when it cannot tag a terminal event.
CONCERTINO_ROLE=script "${SCRIPT_DIR}/emit-event.sh" run.end \
  "ticket=${T}" "status=delivered" || true

print_result
echo "READY cleaned worktree=${WORKTREE_PATH}"
