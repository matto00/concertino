## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

1. **Ticket fetched fresh** via `mcp__linear__get_issue CON-3` (also cross-checked against the committed `ticket.md`) — four ACs:
   - (A) unrecognised phase detected, renders visibly-unknown not zero-progress
   - (B) `PHASE_ORDER` and `workflow-state.template.md` cross-reference each other
   - (C) `orchestrator.md` states exact permitted values at the emit instruction, not `<Phase>`
   - (D) a reducer or fleet test covers an unrecognised phase value

2. **Read the actual diff** (`git diff main...HEAD --stat`, one commit `3e803b6`): `lib/ui/reducer.js`, `lib/ui/screens/fleet.js`, `lib/ui/screens/drilldown.js`, `lib/ui/store.js` (comment only), `core/workflow-state.template.md`, `core/roles/orchestrator.md`, plus `test/reducer.test.js`, `test/fleet.test.js`, `test/drilldown.test.js` and the openspec change artifacts. No files outside this footprint.

3. **AC A** — `lib/ui/reducer.js:81-92`: `applyEvent`'s `phase.enter` case now does `if (PHASE_ORDER.includes(ev.phase)) run.phase = ev.phase; else run.malformed++;` — an unrecognised value never overwrites `run.phase`, and is counted. `fleet.js` renders `phase unknown` (statusLine, `fleet.js:38-39`) with a zero-fill bar (`phaseFraction`, `fleet.js:25-29`) plus the fleet-wide `▲ N malformed events` line (`fleet.js:122-123`). Verified live (see item 6 below) — this is not just "zero progress," it is zero progress *plus* an explicit "phase unknown" label *plus* the malformed counter, which is the distinguishing signal the AC asks for.

4. **AC B** — `reducer.js:15-20` comment names `workflow-state.template.md`'s `PHASE:` line; `core/workflow-state.template.md` diff adds `# Enforced by PHASE_ORDER in lib/ui/reducer.js — keep both lists in sync.` right under the `PHASE:` line. Bidirectional.

5. **AC C** — `core/roles/orchestrator.md` diff adds, immediately after the `phase=<Phase>` emit example: `` `<Phase>` must be exactly one of: `Setup | Planning | Execution | Evaluation | Delivery | Cleanup` `` and explicitly warns "A section heading like 'Phase 2: Execution' is not a phase value — emit `phase=Execution`, never `phase=Phase 2`". This directly names the actual bug mechanism the ticket described.

6. **AC D** — three new `test/reducer.test.js` cases (unrecognised value rejected + malformed++; a valid phase after an unrecognised one still applies; combined dropped-line + rejected-phase case) and one new `test/fleet.test.js` case that goes through the real `reduce()` → `renderFleet()` pipeline (not a hand-built fixture), asserting `phase unknown`, no `Phase 2` string leak, and the malformed counter.

7. **Ran the gates myself:**
   - `npm test` → `tests 377`, `pass 377`, `fail 0` (full raw output captured, not summarized).
   - `openspec validate --changes "validate-phase-values" --strict` → `✓ change/validate-phase-values`, `Totals: 1 passed, 0 failed`.

8. **No other `PHASE_ORDER` duplication or `run.phase` reader missed.** `grep -rn "PHASE_ORDER"` across `lib/` and `test/` shows exactly one definition (`reducer.js:20`) and two re-exporting/import sites (`fleet.js` imports from `../reducer`; `drilldown.js` imports from `./fleet`, which re-exports the same array — confirmed identity, not a copy). `escalation.js:63` reads `run.phase` only as a plain fallback string (`run.phase || 'phase unknown'/'no telemetry'`) — since `run.phase` is now always either `null` or a validated member of `PHASE_ORDER` post-reducer, this cannot show a garbage value either. `drilldown.js:87`'s timeline `describeEvent` intentionally reads `ev.phase` raw (the literal bad value in the event, not `run.phase`) — this is a deliberate, documented design decision (surfacing the offending raw value in the timeline while keeping `run.phase` clean), not a missed path.

9. **End-to-end reproduction of the actual bug mechanism, not just the unit tests' framing.** I ran the real, unmodified `scripts/concertino/emit-event.sh` in a scratch git repo exactly the way an orchestrator agent following the (old) doc's `phase=<Phase>` placeholder plausibly would — unquoted `phase=Phase 2` on the command line:
   ```
   emit-event.sh phase.enter ticket=HEL-9 role=orchestrator phase=Phase 2 cycle=1
   ```
   Confirmed the actual word-splitting the ticket describes: the raw `events.jsonl` line came out as `"phase":"Phase"` (the `2` silently dropped as a valueless arg). I then fed that real log through the real `lib/ui/store.js` → `lib/ui/reducer.js` (`reduce()`) → `lib/ui/screens/fleet.js` (`renderFleet()`) and `lib/ui/screens/drilldown.js` (`renderDrillDown()`) pipeline, unmodified:
   - Reduced run: `{ phase: null, malformed: 1, telemetry: "full" }` — confirming the exact "confidently-empty progress bar on a run claiming full telemetry" defect described in the ticket is what's being fixed, and that it *is* fixed.
   - Fleet render: `phase unknown` label, zero-fill bar, and `▲ 1 malformed events` footer line.
   - Drill-down render: `phase unknown` in the header, `no phase.enter events recorded — phase pipeline unavailable` for the pipeline panel, `TIMELINE ▲ 1 malformed` badge, and the timeline literally showing `phase → Phase  cycle 1` (the offending raw value, visible per design intent).
   This confirms the fix holds against the real shell-level bug mechanism end to end, not only against the illustrative `"Phase 2"` string used in the added unit tests.

10. **Design/implementation consistency** — read `design.md`'s three Decisions (where `PHASE_ORDER` lives, where validation happens, `run.malformed` broadening) and confirmed each matches the shipped code exactly. `tasks.md` all 18 items checked and each corresponds to a real diff hunk. `files-modified.md`'s claims verified against the actual `git diff` — accurate, no unlisted changes, no listed-but-missing changes.

### Verdict: CONFIRM

### Non-blocking notes
- The fleet-wide `▲ N malformed events` counter still conflates "dropped envelope line" and "rejected phase field" into one number with no per-reason breakdown — this is an explicit, documented design.md trade-off (a per-reason counter was considered and rejected as premature for a single validated field), not an oversight. Worth revisiting if a second field ever needs the same kind of validation, as the design doc itself already flags.
- `docs/superpowers/specs/2026-07-27-tui-fleet-dashboard-design.md` and the sibling plan doc also contain a copy of the `Setup | Planning | Execution | ...` phase list in prose; these are historical planning documents (not live code/contracts pulled in by any test or script), so leaving them un-cross-referenced is reasonable and out of this ticket's scope.
