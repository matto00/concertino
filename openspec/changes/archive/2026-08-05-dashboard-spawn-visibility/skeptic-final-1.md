## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

- **Ground truth re-established.** Read `ticket.md`, `design.md`, `files-modified.md`, `evaluation-1.md`, `skeptic-design-1.md`, and the full `git diff main...HEAD` (20 files, +686/-8) rather than trusting either prior report's narrative.

- **AC1 — "A ticket launched from the dashboard appears in the fleet within one poll, before any telemetry exists."**
  Traced to `lib/ui/session.js`'s new `writeSpawnEvent()`, called synchronously from `spawn()` right after `respawn-window` succeeds (`lib/ui/session.js:206-225`), and `watch.js:135` now threading `root` into `createSession(cfg.tmuxSession || 'concertino', root)`. Confirmed live, end-to-end (not just via the unit tests) with a manual script that calls the real `session.js`/`reducer.js`/`store.js` against a scratch `root` and a real tmux session:
  ```
  s.spawn("MANUAL-1", "sleep 300")
  → events.jsonl written immediately: {"kind":"run.spawn","ticket":"MANUAL-1","role":"dashboard",...}
  → reduce() output: status: "running", telemetry: "none", spawnedAt: <t>, startingMs: 505
  ```
  This matches the design's own honest caveat (design.md "Context", `skeptic-design-1.md`'s CONFIRM) that the literal "fleet showed nothing at all" framing does not reproduce against the pre-existing window-merge fallback in `reduce()` (lines 265-272, unchanged by this diff, confirmed via `git show main:lib/ui/reducer.js`) — but the fix still closes the real gap: durable, poll-independent evidence of the spawn, and disambiguated rendering (see AC3).

- **AC2 — "A spawned window that dies without ever emitting run.start surfaces as a failure with its scrollback reachable, rather than disappearing."**
  Reproduced live: spawned a window running `false` (exits immediately, `remain-on-exit on` keeps it listed dead).
  ```
  windows (after natural death): [ { ticket: 'MANUAL-2', alive: false, ... } ]
  runs status: [ { ticket: 'MANUAL-2', status: 'failed', telemetry: 'none', spawnedAt: <t> } ]
  rendered row: "MANUAL-2  (no branch yet) ... failed to start"
  ```
  `status: 'failed'` puts it in the FAILED section (untouched `deriveStatus`/`STATUS_ORDER`), and `rows.js:69-75,152-156` / `drilldown.js:367-370` render "failed to start" distinctly from "window exited". Scrollback reachability: `fleet/keys.js:268-276` — Enter always issues `{ type: 'attach', ticket }` regardless of `run.status`/`telemetry`; attach is not gated on liveness anywhere in the controller, so a dead-with-`remain-on-exit` window's pane content remains attachable exactly as it was before this change (this mechanism is pre-existing, not part of the diff — confirmed by its absence from the diff).

- **AC3 — "A live window with no telemetry renders distinctly from a run that is genuinely mid-phase."** `telemetry !== 'none'` runs (mid-phase) already render `run.phase` via the untouched branch in `rows.js`/`drilldown.js`; the new `spawnedAt`-gated "starting Ns"/"starting…" text only fires for `telemetry === 'none'`, so the two are structurally disjoint. Also confirmed the narrower but real distinction this design targets: a `telemetry: 'none'` run with `spawnedAt` set now reads "starting Ns" while a `telemetry: 'none'` run without `spawnedAt` (pre-feature run, or a window not spawned by the dashboard) still reads plain "no telemetry" — verified via `test/fleet.test.js`/`test/drilldown.test.js`'s new "predating this feature" case, read directly.

- **AC4 — "Reaping/retention still treat these correctly — an un-started window must not be reaped as though it were terminal."** Read `lib/ui/reap.js` (`selectReapable`'s guard: `if (run.endStatus == null || !run.window) return false;`) and `lib/ui/retention.js#isEligible` (`hasRunEnd` gate) directly — both key exclusively on `run.end`'s presence, untouched by this diff, and a `run.spawn`-only run has neither `endStatus` nor `run.end`. New tests in `test/reap.test.js`/`test/retention.test.js` assert this explicitly for both alive and dead spawn-only windows; no production code change was needed here and none was made (confirmed via `git diff main...HEAD -- lib/ui/reap.js lib/ui/retention.js` — empty).

- **Verification gates re-run myself, not trusted from the evaluator's report:**
  ```
  node --test        → # tests 1483, # pass 1483, # fail 0, # skipped 0
  npm test            → exit 0; all shell-script suites (emit-event, persist-evidence,
                         next-report-number, gather-escalation-context, triage-followup,
                         assert-phase, start-servers, watch-smoke, doctor-artifacts,
                         ticket-pattern, escalation-loop, escalation-raise-wait,
                         sync-core-resolution, harness-identity, resolve-speed, cleanup,
                         doctor-base-branch, doctor-ollama-models, auditor-render,
                         check-merge-readiness, opencode-render, codex-ollama-render,
                         codex-role-render) all passed, 0 failed.
  ```
  Ran `node --test` twice (once directly, once inside `npm test`) — stable, reproduced, no anomaly.

- **Scope check.** `git diff main...HEAD --stat` touches exactly the 5 production files + their corresponding test files enumerated in `files-modified.md`, plus the standard openspec artifact set. No drift beyond ticket scope. `git status --porcelain` shows only expected workflow-bookkeeping artifacts (`workflow-state.md`, `evaluation-1.md`), not stray code changes.

- **Design-gate consistency.** `skeptic-design-1.md` already CONFIRMed this same design, including the same candid "literal framing doesn't reproduce" caveat — the executor implemented the design as reviewed, with no unauthorized reinterpretation found in the diff.

- **No UI/design-standard review applicable** — per this project's configuration, no design standard is bound for this repo; the dashboard is a terminal UI, and the rendering claims above were verified against real `reduce()`/render-function output rather than screenshots, which is the correct evidence form for a TUI with no visual design standard configured.

### Verdict: CONFIRM

The implementation is traceable to all four acceptance criteria with evidence I reproduced myself (not just read in the evaluator's report), the design's own honest caveat about the ticket's literal framing is justified by the actual pre-existing fallback code (verified against `main`), reap/retention correctness is structural and tested, and the full test suite (1483 node tests + 22 shell-script suites) passes cleanly on a fresh run.

### Non-blocking notes

- `design.md`'s Decision 5 alternative-rejected note (a first-class `status: 'starting'`) is the right call for blast-radius reasons; worth keeping in mind if a future ticket wants "starting" to be independently filterable/sortable rather than a label within RUNNING.
- The manual live-tmux reproduction above is not part of the automated suite (the equivalent is `test/session.test.js`'s `skip`-gated integration test, which does run here since tmux is installed) — no action needed, just noting this as the strongest evidence for AC1/AC2 beyond the unit tests.
