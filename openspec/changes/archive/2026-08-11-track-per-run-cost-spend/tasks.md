## 1. Pricing table + report-cost.sh (SessionEnd/SubagentStop hooks)

- [x] 1.1 Add `core/scripts/pricing-table.json`: a checked-in map of Claude
      Code model id -> `{ inputPerMTok, outputPerMTok, cacheReadPerMTok,
      cacheCreationPerMTok }` (USD per million tokens), seeded with the
      Sonnet/Opus/Haiku model ids this project's config actually resolves to
      (see `lib/config.js`'s `resolveModel`/`FALLBACK_MODEL`), plus a comment
      block documenting the self-maintenance obligation (design.md Decision 2).
- [x] 1.2 Add `core/scripts/report-cost.sh`: reads the `SessionEnd`/
      `SubagentStop` hook JSON payload from stdin (dispatching on
      `hook_event_name` — see design.md Decision 1/5's empirical correction:
      `SessionEnd` never carries `agent_type` and fires once for the root
      session only; `SubagentStop` is the actual per-subagent signal, via
      `agent_transcript_path`); exits `0` immediately with no event when
      `$CONCERTINO_TICKET` is unset (an unrelated, non-concertino session —
      see task 2.4). Otherwise reads the relevant transcript, sums ONLY the
      token usage added since a persisted per-agent/per-session line cursor
      (design.md Decision 5 — prevents double-counting a resumed subagent's
      repeat `SubagentStop` firings against its same, appended transcript)
      across every assistant-role transcript entry via a `node -e` inline
      script (matching `assert-phase.sh`'s own `node -e` precedent for
      JSON-shaped work), looks up `cost_usd` in `pricing-table.json` (omitting
      the field when the model is unrecognized), determines `role` from the
      payload's `agent_type` field (stripping the `concertino-` prefix) or
      defaults to `orchestrator` when absent, and calls
      `emit-event.sh run.cost ticket="$CONCERTINO_TICKET" role=<derived> ...`
      with the remaining fields specified in `specs/run-cost-telemetry/spec.md`.
      Exits `0` with no event when the transcript is missing/unreadable, or
      when the increment has no new usage. `chmod +x`.
- [x] 1.3 Confirm `core`'s `copyAssets()` loop in `lib/cli/emit.js` (already
      copies every file in `core/scripts/`, `chmod +x` only `.sh`) picks up
      both new files with no code change needed; add a regression test if the
      existing `emit.test.js` doesn't already assert "every file in
      core/scripts ends up in scripts/concertino" generically.

## 2. Sync-time wiring (`costTracking.enabled`)

- [x] 2.1 `lib/config.js`: add `costTracking` config surface (`{ enabled:
      boolean }`, default `{ enabled: false }`), with validation matching the
      existing style for other boolean feature flags (e.g. `agentMerge.enabled`).
- [x] 2.2 `lib/cli/emit.js`: add `mergeCostHookSettings(c, out, dry)`,
      structured like `mergeAgentMergeSettings` — read-modify-write
      `.claude/settings.json`, additively append the SAME hook entry invoking
      `scripts/concertino/report-cost.sh` into BOTH `settings.hooks.SessionEnd`
      AND `settings.hooks.SubagentStop` (design.md Decision 1/3's empirical
      correction: `SessionEnd` alone only ever reports the orchestrator role)
      only when `c.costTracking.enabled` is `true`; never touch `hooks` when
      `false`. Call it from `emitClaude()` alongside the existing
      `mergeAgentMergeSettings(c, out, dry)` call.
- [x] 2.3 `concertino doctor`/`concertino validate` (`lib/config.js`): add a
      check mirroring `checkAgentMergePermission` — when `costTracking.enabled`
      is `true`, confirm `.claude/settings.json` actually has BOTH hook
      entries (`SessionEnd` and `SubagentStop`).
- [x] 2.4 `lib/ui/prompt.js`'s `submitTicket()`: unconditionally merge
      `{ CONCERTINO_TICKET: parsed.ticket }` into the `env` passed to
      `session.spawn()`, first (so a caller-supplied `env`, e.g. CON-65's
      provider routing, still wins on any key collision — none exists today)
      — per `specs/run-cost-telemetry/spec.md`'s `submitTicket()` requirement.
      This applies to every launch path (`n` prompt, queue tick, force-start,
      restart, address-failure) since they all funnel through this one
      function.
- [x] 2.5 `test/prompt.test.js` (or wherever `submitTicket` is already
      tested): cover `CONCERTINO_TICKET` present with no prior `env`, and
      present alongside a provider-routing `env` with no collision/overwrite.

## 3. Event schema + reducer fold

- [x] 3.1 `lib/ui/reducer.js`: add `'run.cost'` to `TIER2_KINDS`.
- [x] 3.2 `lib/ui/reducer.js`: `emptyRun()` gains `costUsd: null` and
      `tokens: null` (an object of the four token fields, or `null`).
- [x] 3.3 `lib/ui/reducer.js`: `applyEvent`'s `run.cost` case parses
      `Number(ev.cost_usd)` (tolerating `emit-event.sh`'s string-encoding of
      fractional values — design.md Decision 6) before summing into
      `run.costUsd`, treating `NaN`/absent as contributing `0`; sums each
      token field into `run.tokens`; initializes from `null` to the first
      event's values rather than `null + number` (per
      `specs/run-cost-telemetry/spec.md`'s accumulation requirement — never
      overwrite, always add).
- [x] 3.4 `test/reducer.test.js`: cover single-event, multi-event summation,
      a string-encoded fractional `cost_usd` (e.g. `"0.0234"`) summing
      correctly rather than concatenating/`NaN`-ing, partial `cost_usd` (one
      event missing it), and zero-events-stays-null cases from
      `specs/run-cost-telemetry/spec.md`.

## 4. METRICS fleet-wide spend line

- [x] 4.1 `lib/ui/screens/fleet/metrics.js`'s `metricsFor()`: compute
      `spendToday`/`spendWeek` (sum of in-window `run.cost` events'
      `cost_usd`) and their coverage fractions (reporting runs / terminal
      runs in that window), per `specs/fleet-metrics-spend/spec.md`.
- [x] 4.2 `metricsColumnLines()`: extend line 1 (or add a new line, whichever
      fits the existing column budget — see the file's own comment on why
      `escalations today` was pulled onto line 1 rather than packed into
      line 2) with the spend text, including the coverage parenthetical only
      when coverage is partial.
- [x] 4.3 `test/fleet.test.js` (or a new `test/metrics.test.js` if the
      existing file doesn't already host `metricsFor`/`metricsColumnLines`
      tests): cover full coverage, partial coverage, and no-terminal-runs-
      today cases from `specs/fleet-metrics-spend/spec.md`.

## 5. Drill-down per-run cost line

- [x] 5.1 `lib/ui/screens/drilldown.js`: add a `costText(run)` helper
      alongside `harnessText`/`speedModelsText`, returning the accumulated
      `$`+tokens string, the harness-attributed "not reported" string (non-
      Claude-Code), or the generic "not reported" string (Claude Code, no
      data) per `specs/drilldown-run-cost/spec.md`.
- [x] 5.2 Wire `costText(run)` into `headerLines()` alongside the existing
      harness/ports/speed lines.
- [x] 5.3 `test/drilldown.test.js` / `test/controllers-drilldown.test.js`:
      cover reported-cost, non-Claude-Code, and Claude-Code-no-data cases.

## 6. Docs

- [x] 6.1 `docs/dashboard.md`: document the METRICS spend line (including the
      coverage-fraction convention) and the drill-down cost line.
- [x] 6.2 `docs/config-reference.md`: document `costTracking.enabled`, the
      pricing-table file's location and self-maintenance obligation, and the
      claude-code-only v1 scope.

## 7. End-to-end verification (REQUIRED — design.md Decision 1's `SessionEnd`/
   `agent_type` behavior for subagent sessions is doc-derived, not yet
   observed in this repo; this is what confirms it before the change ships)

- [x] 7.1 With a `.claude/settings.json` hooking both `SessionEnd` and
      `SubagentStop` to a stdin-logging probe script, drove real `claude -p`
      sessions (one spawning a built-in `general-purpose` Task subagent, one
      spawning a real `.claude/agents/concertino-executor.md`-defined custom
      agent, one resuming that subagent via `SendMessage`) and inspected the
      actual hook payloads that fired. **Result: real behavior differs from
      the original doc-derived assumption, exactly as this task anticipated.**
      `SessionEnd` fires exactly ONCE per top-level session and NEVER carries
      `agent_type`, even when subagents were spawned. `SubagentStop` — not
      `SessionEnd` — is the actual per-subagent signal: it fires once per
      subagent turn-completion, carries `agent_type`/`agent_id`/
      `agent_transcript_path`, confirmed literally `agent_type:
      "concertino-executor"` for the custom-agent probe. Further: a resumed
      subagent fires `SubagentStop` AGAIN for the same `agent_id`, against
      the same (appended, not replaced) `agent_transcript_path` file —
      confirmed by resuming a subagent once and observing two firings, the
      second against a transcript with more assistant-usage entries than the
      first. `report-cost.sh`/design.md/tasks.md/spec.md updated accordingly:
      hooks wired to BOTH `SessionEnd` and `SubagentStop`; role defaults to
      `orchestrator` whenever `agent_type` is absent (unconditionally true for
      `SessionEnd`); a persisted per-agent/per-session line cursor makes each
      firing sum only its own increment, never re-summing a resumed
      subagent's already-reported prefix. See design.md Decision 1/5 for the
      full writeup.
- [x] 7.2 Exercised `report-cost.sh` end-to-end against real captured
      transcripts (both the real `concertino-executor` probe transcript from
      7.1 and controlled synthetic transcripts isolating the incremental-
      cursor behavior): confirmed correct role derivation (`executor` from
      `agent_type: "concertino-executor"`; `orchestrator` default when absent),
      correct token summation, correct pricing-table lookup (a recognized
      model produced `cost_usd`; an unrecognized one omitted it while still
      summing tokens), the `cost_usd` numeric string round-trip through
      `emit-event.sh` (`"0.013465"` in the real emitted event JSON — confirms
      task 3.4's string-encoding case against a REAL event, not just a
      hand-constructed fixture), the `CONCERTINO_TICKET`-unset no-op, and the
      missing-transcript no-op. Separately proved the incremental cursor
      (Decision 5) with a synthetic transcript grown between two firings for
      the SAME `agent_id`: the second firing's emitted event carried only the
      2-line/1-usage-entry INCREMENT (`input_tokens: 30`), not a re-sum of
      the whole 4-line transcript (`input_tokens: 130`) — the exact
      double-counting bug 7.1's finding predicted, confirmed fixed.
- [x] 7.3 Full test suite green; `openspec validate --change
      track-per-run-cost-spend` clean.
