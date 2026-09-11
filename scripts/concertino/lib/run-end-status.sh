# lib/run-end-status.sh — shared "is this run terminal?" helper (CON-182).
#
# Extracted so watchdog.sh's lane_is_complete() and cleanup.sh's
# other_runs_live() share ONE implementation instead of two independently
# maintained copies that could silently drift apart (the same rationale as
# lib/pr-reconcile.sh). Both scripts read `.concertino/runs/<TICKET>/
# events.jsonl` and need the identical answer to "has this run finished?".
#
# run_is_complete <events.jsonl>
#
# Returns 0 (true, "complete") iff, scanning the log in file order
# (== chronological order — an append-only log):
#   - the LAST run.end event seen has a status other than "escalated", AND
#   - no run.start event appears AFTER that run.end.
# Returns 1 (false, "still live") otherwise, including when the log has no
# run.end at all, or does not exist.
#
# Two things this generalizes, both from real incidents:
#
# 1. `status:"escalated"` is NOT terminal (CON-182, helio HEL-1080,
#    2026-09-11). It marks an orchestrator pausing on a circuit-breaker
#    escalation, not the run ending — the same run typically resumes once
#    it's answered, sometimes without ever writing a new run.start. As of
#    this ticket, orchestrator.md no longer emits run.end for an escalation
#    pause at all (escalation.raised/escalation.answered already record the
#    pause without it) — run.end is now written from exactly one place,
#    cleanup.sh, with status=delivered — but historic logs, and any run
#    still mid-flight against an un-synced older orchestrator.md, may still
#    contain such a line, so this stays permanent, defensive logic, not a
#    one-time migration. Any OTHER status (delivered; abandoned-stale, the
#    fleet-driver's manual marker for a confirmed-dead run — see
#    .claude/skills/concertino-fleet-driver/SKILL.md; a missing status
#    field) counts as terminal, same as always.
#
# 2. A run.start emitted AFTER a real terminal run.end means the ticket was
#    genuinely re-run (its events.jsonl is append-only and shared across
#    that ticket's whole history) — that later run is live again, and
#    treating the ticket as permanently "complete" from its first delivery
#    would make watchdog.sh silently stop watching, and cleanup.sh silently
#    let `concertino sync` run, out from under a second, currently-active
#    delivery of the same ticket (cold review finding, cycle 2, 2026-09-11).
#
# Only the LAST run.end/run.start transition matters — earlier ones are
# superseded exactly the way a real resume supersedes an escalated pause.
run_is_complete() {
  local log="$1" line status complete=1
  [ -f "$log" ] || return 1
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      *'"kind":"run.end"'*)
        status="$(printf '%s' "$line" | sed -n 's/.*"status":"\([^"]*\)".*/\1/p')"
        if [ "$status" != "escalated" ]; then
          complete=0
        fi
        ;;
      *'"kind":"run.start"'*)
        complete=1
        ;;
    esac
  done < "$log"
  return "$complete"
}
