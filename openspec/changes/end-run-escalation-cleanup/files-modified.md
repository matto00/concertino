- `core/roles/orchestrator.md` — Phase 4 gets a precise "genuinely complete"
  definition (cleanup.sh run + ticket Done/closing comment + hygiene check
  reported, `run.end` alone is not sufficient), a new step requiring any
  post-cleanup suggestion to go through `emit-event.sh escalation --await`
  (one-shot, skipped if nothing to raise, no circuit-breaker interaction), a
  terminal-summary-then-end-turn step, and a short Guardrails
  cross-reference.
- `docs/harness-capabilities.md` — new subsection recording the mirror-image
  harness-behavior fact to CON-15's "a suspended agent is never resumed":
  once Phase 4 is genuinely complete the orchestrator must actually end its
  turn, and why a lingering bare-chat prompt after `run.end` is invisible to
  both the dashboard (`run.end` already renders `DONE`) and
  `window-reaping`'s conservative "never touch a live window" rule.
- `lib/ui/reducer.js` — `escalationStale` is now stale iff the window is
  confirmed not alive or there is no window data at all (no longer forced
  stale merely by `run.endStatus` being set); `deriveStatus` now returns
  `needs-you` for a non-stale escalation with a confirmed-alive window,
  checked before the `run.endStatus` done/failed short-circuit — every other
  branch's precedence is unchanged.
- `test/reducer.test.js` — three new cases: run.end + live escalation (window
  alive) → `escalationStale=false`, `status=needs-you`; same, then
  `escalation.answered` → reverts to `done`; run.end + escalation.raised with
  no window data at all → `escalationStale=true` (explicit regression guard,
  unchanged behavior).
- `test/fleet.test.js` — new end-to-end (reduce() → renderFleet()) case
  confirming a run.end-then-live-escalation run buckets under `NEEDS YOU`,
  not `DONE`.
- `.claude/agents/concertino-orchestrator.md` (and the other rendered
  `.claude/agents/concertino-*.md` / `.claude/commands/concertino-deliver.md`
  files) — re-rendered via `concertino sync` to pick up the prose-only
  `core/roles/orchestrator.md` change (no new `{{block:}}`/`{{var:}}` tokens
  needed). **Not included in the commit**: `/.claude/agents/concertino-*.md`
  and `/.claude/commands/concertino-*.md` are gitignored in this repo (see
  `.gitignore` lines 8-9) — they are per-checkout generated artifacts here,
  never checked into version control, contrary to this ticket's assumption
  that they are committed. Spot-checked instead (per tasks.md 5.1's own
  fallback wording) that the freshly rendered file on disk contains the new
  Phase 4 text.
