#!/usr/bin/env bash
set -uo pipefail

# ===========================================================================
# report-cost.sh — Claude Code SessionEnd + SubagentStop hook body.
#
# Wired into `.claude/settings.json` by `mergeCostHookSettings()`
# (lib/cli/emit.js) only when `costTracking.enabled` is true (design.md
# Decision 3 of the track-per-run-cost-spend change). Reads the firing hook's
# JSON payload from stdin, sums that firing's INCREMENT of token usage from
# the relevant transcript, resolves a `$` figure via pricing-table.json, and
# emits a `run.cost` event through emit-event.sh — itself unmodified
# (design.md Decision 6).
#
# WHY TWO HOOK EVENTS, NOT JUST SessionEnd (design.md Decision 1, tasks.md
# 7.1 — empirically verified in this repo's own runtime, not doc-derived):
#   - `SessionEnd` fires exactly ONCE, for the top-level (orchestrator/root)
#     Claude Code session. Its payload NEVER carries `agent_type`, even when
#     that session spawned Task-tool subagents. `transcript_path` is the
#     root session's own transcript.
#   - `SubagentStop` — not `SessionEnd` — is the actual per-subagent signal.
#     It fires once per Task-tool subagent TURN-COMPLETION, carrying
#     `agent_type` (Concertino's own custom agent definitions are named
#     `concertino-<role>` — confirmed empirically, literally
#     `"concertino-executor"`), `agent_id`, and `agent_transcript_path` (the
#     subagent's own transcript, separate from the parent's).
#   - Critically: a RESUMED subagent fires `SubagentStop` AGAIN for the SAME
#     `agent_id`, against the SAME, APPENDED `agent_transcript_path` file —
#     confirmed by resuming a probe subagent once and observing two firings,
#     the second against a transcript with more assistant-usage entries than
#     the first. Concertino's own orchestrator protocol
#     (core/roles/orchestrator.md's "Cycles 2+ — resume") resumes the
#     executor/evaluator across evaluation cycles routinely — this is the
#     COMMON path, not an edge case. Summing the whole transcript on every
#     firing would double-/triple-/quadruple-count every token a prior
#     firing already reported. See the incremental cursor below.
#
# Best-effort telemetry only: every exit path is 0, and a missing/unreadable
# transcript, a malformed payload, or a downstream emit-event.sh failure
# never surfaces as a hook error back to an already-terminating Claude Code
# session (matches emit-event.sh's own "telemetry must never fail a delivery
# run" discipline).
# ===========================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PAYLOAD="$(cat 2>/dev/null || true)"

# CONCERTINO_TICKET absent = an ordinary, non-concertino Claude Code session
# (or a concertino session whose harness/role never had it set) — never a
# candidate for cost reporting. Checked before ever invoking node, so the
# common "this hook fires for something else entirely" case (costTracking is
# project-wide runtime surface, not scoped to concertino sessions — design.md
# Risks) pays for nothing more than one env read.
if [ -z "${CONCERTINO_TICKET:-}" ]; then
  exit 0
fi

# main_checkout(): identical resolution to emit-event.sh's own helper of the
# same name (duplicated, not sourced — this script suite stays standalone,
# see emit-event.sh's own now_ms()/assert-phase.sh's utf8_safe_char_prefix()
# precedent for the same convention). This script is invoked from inside a
# WORKTREE (whatever `cwd` the firing session has); the incremental cursor
# (below) must live alongside events.jsonl in the MAIN checkout, never the
# worktree, which cleanup.sh --phase4 can destroy.
main_checkout() {
  local common
  common="$(git rev-parse --git-common-dir 2>/dev/null)" || return 1
  case "$common" in
    /*) : ;;
    *) common="$(cd "$common" 2>/dev/null && pwd)" || return 1 ;;
  esac
  ( cd "$(dirname "$common")" 2>/dev/null && pwd ) || return 1
}
ROOT="$(main_checkout)" || exit 0

# pricing-table.json resolution mirrors emit-event.sh's own two-location
# `.concertino.env` search: next to this script first (the common case — this
# script's own directory is scripts/concertino/ in whichever checkout it is
# actually running from, worktree or main), main-checkout fallback for the
# rare case that copy is somehow missing.
PRICING_TABLE="${SCRIPT_DIR}/pricing-table.json"
[ -f "$PRICING_TABLE" ] || PRICING_TABLE="${ROOT}/scripts/concertino/pricing-table.json"

CURSOR_DIR="${ROOT}/.concertino/runs/${CONCERTINO_TICKET}/.cost-cursors"
EMIT_EVENT="${SCRIPT_DIR}/emit-event.sh"
[ -x "$EMIT_EVENT" ] || EMIT_EVENT="${ROOT}/scripts/concertino/emit-event.sh"

node -e '
  const fs = require("fs");
  const path = require("path");
  const { execFileSync } = require("child_process");

  const [ticket, pricingTablePath, cursorDir, emitEventPath] = process.argv.slice(1);

  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(0, "utf8"));
  } catch (e) {
    process.exit(0);
  }

  // See this script'"'"'s header comment for the full empirical writeup.
  const isSubagent = payload.hook_event_name === "SubagentStop";
  const transcriptPath = isSubagent ? payload.agent_transcript_path : payload.transcript_path;
  if (!transcriptPath) process.exit(0);

  // Concertino'"'"'s own custom Claude Code agent definitions are named
  // `concertino-<role>` (lib/cli/emit.js'"'"'s emitClaude()) — a SubagentStop
  // payload'"'"'s `agent_type` is literally `concertino-executor` etc. SessionEnd
  // never carries `agent_type` at all, so this always defaults to
  // "orchestrator" for that firing.
  const role = payload.agent_type
    ? String(payload.agent_type).replace(/^concertino-/, "")
    : "orchestrator";
  const cursorKey = String((isSubagent ? payload.agent_id : payload.session_id) || "unknown");

  let raw;
  try {
    raw = fs.readFileSync(transcriptPath, "utf8");
  } catch (e) {
    process.exit(0);
  }
  const lines = raw.split("\n").filter(Boolean);

  // Incremental cursor (design.md Decision 5): a resumed subagent'"'"'s
  // transcript is the SAME, APPENDED file across every SubagentStop firing
  // for that agent_id — summing the whole file every time would double-count
  // everything an earlier firing already reported. Only lines past the
  // persisted cursor are summed THIS firing; the cursor is then rewritten to
  // the transcript'"'"'s new total line count (even when this increment had no
  // new usage, so an empty increment is never re-scanned either). A
  // missing/unwritable cursor degrades to "treat this firing as the first"
  // rather than losing the event.
  let priorCount = 0;
  let cursorFile = null;
  try {
    fs.mkdirSync(cursorDir, { recursive: true });
    cursorFile = path.join(cursorDir, cursorKey + ".count");
    if (fs.existsSync(cursorFile)) {
      const n = parseInt(fs.readFileSync(cursorFile, "utf8").trim(), 10);
      if (Number.isFinite(n) && n >= 0) priorCount = n;
    }
  } catch (e) { /* best-effort — see header comment */ }
  if (priorCount > lines.length) priorCount = 0; // transcript rotated/shrank — never negative-slice
  const newLines = lines.slice(priorCount);

  let inputTokens = 0, outputTokens = 0, cacheReadTokens = 0, cacheCreationTokens = 0;
  let model = null;
  let sawUsage = false;
  for (const line of newLines) {
    let entry;
    try { entry = JSON.parse(line); } catch (e) { continue; }
    const usage = entry && entry.message && entry.message.usage;
    if (!entry || entry.type !== "assistant" || !usage) continue;
    sawUsage = true;
    inputTokens += usage.input_tokens || 0;
    outputTokens += usage.output_tokens || 0;
    cacheReadTokens += usage.cache_read_input_tokens || 0;
    cacheCreationTokens += usage.cache_creation_input_tokens || 0;
    if (entry.message.model) model = entry.message.model;
  }

  try {
    if (cursorFile) fs.writeFileSync(cursorFile, String(lines.length));
  } catch (e) { /* best-effort */ }

  if (!sawUsage) process.exit(0); // nothing new to report this firing

  let costUsd = null;
  try {
    const table = JSON.parse(fs.readFileSync(pricingTablePath, "utf8"));
    const rates = model && table[model];
    if (rates && typeof rates === "object") {
      costUsd = (inputTokens / 1e6) * (rates.inputPerMTok || 0)
        + (outputTokens / 1e6) * (rates.outputPerMTok || 0)
        + (cacheReadTokens / 1e6) * (rates.cacheReadPerMTok || 0)
        + (cacheCreationTokens / 1e6) * (rates.cacheCreationPerMTok || 0);
    }
  } catch (e) { /* no pricing table / unreadable — cost stays unresolved */ }

  const args = [
    "run.cost", "ticket=" + ticket, "role=" + role,
    "input_tokens=" + inputTokens, "output_tokens=" + outputTokens,
    "cache_read_tokens=" + cacheReadTokens, "cache_creation_tokens=" + cacheCreationTokens,
  ];
  if (model) args.push("model=" + model);
  // Fixed-point, not exponential notation (a tiny cost like 8.5e-7 would
  // otherwise reach emit-event.sh'"'"'s json_value() as a string it writes out
  // literally — "8.5e-7" round-trips through JSON fine, but is needlessly
  // surprising for a human tailing events.jsonl). 6 decimal places is
  // sub-hundredth-of-a-cent precision, comfortably below what this self-
  // maintained pricing table can even claim to be accurate to.
  if (costUsd != null) args.push("cost_usd=" + costUsd.toFixed(6));

  try {
    execFileSync(emitEventPath, args, { stdio: "ignore" });
  } catch (e) { /* telemetry must never fail a delivery run */ }
' "$CONCERTINO_TICKET" "$PRICING_TABLE" "$CURSOR_DIR" "$EMIT_EVENT" <<< "$PAYLOAD"

exit 0
