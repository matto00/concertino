## 1. Reducer: `run.override` + retry-visibility

- [x] 1.1 `lib/ui/reducer.js`: add `override: null` to `emptyRun`.
- [x] 1.2 `lib/ui/reducer.js`: handle `case 'run.override':` in `applyEvent`,
      setting `run.override = { status: ev.status, t: ev.t }`.
- [x] 1.3 `lib/ui/reducer.js`: add the new highest-precedence `deriveStatus`
      branch (`if (run.override) return run.override.status;`), ahead of the
      live-escalation branch.
- [x] 1.4 `lib/ui/reducer.js`: refine the existing `endStatus` branch with the
      retry-visibility check (window alive AND `spawnedAt` later than
      `endedAt`/`endedAt` null → `'running'`), per design.md Decision 3.
- [x] 1.5 Unit tests (reducer.test.js or equivalent): `run.override` sets
      status regardless of `endStatus`/window; a respawned FAILED run with a
      live window reports `running`; it reverts to `failed`/`done` once the
      window dies or a new `run.end` lands.

## 2. In-process `run.override` write

- [x] 2.1 `lib/ui/session.js` (or a sibling module, mirroring
      `writeSpawnEvent`'s placement): add `writeOverrideEvent(root, ticket,
      status)` — same try/catch-swallow, same wire shape
      (`t`/`kind`/`project`/`ticket`/`role: 'dashboard'`), plus `status`.
- [x] 2.2 Unit test: `writeOverrideEvent` appends the expected line to
      `events.jsonl` and never throws on a write failure.

## 3. Top-level `a`/`d` bindings (no new focus mode — see design.md Decision 1)

- [x] 3.1 `lib/ui/screens/fleet/keys.js`: after the `focus === 'queue'`/
      `focus === 'quickstart'` blocks, alongside the existing `t`/`l`
      bindings, add:
      `if (key === 'a' && focus === 'runs' && runs[selected] && runs[selected].status === 'failed') return { type: 'address-failure', ticket: runs[selected].ticket };`
      and the equivalent for `d` → `open-mark-done-confirm`. **The explicit
      `focus === 'runs'` condition is required** (skeptic gate round 2,
      finding 1) — without it, `a`/`d` leak through the queue/quickstart
      focus blocks and can fire against a stale, off-screen
      `runs[selected]` while QUEUED/QUICK START is what's actually on
      screen (neither block claims or suppresses `a`/`d` the way they
      already suppress `\r`/`l`/`n`/`N`, and `t` is safe only because it is
      separately re-bound inside both blocks — `a`/`d` have no such
      protection without this condition).
- [x] 3.2 Unit tests for `keys.js` covering the four scenarios in
      `specs/fleet-failed-remediation/spec.md`'s first requirement (`a`/`d`
      resolve on a FAILED selected row while `focus === 'runs'`; both no-op
      on a non-FAILED row; both no-op while `focus === 'queue'` or
      `focus === 'quickstart'`, even when `runs[selected]` is a FAILED row).

## 4. `d` — mark-done confirm gate, with a real on-screen banner

- [x] 4.1 `lib/ui/controllers/fleet.js`: `open-mark-done-confirm` /
      `cancel-mark-done` / `confirm-mark-done` cases, mirroring
      `open-force-start-confirm`/`cancel-force-start`/`confirm-force-start`.
      `open-mark-done-confirm` sets `S.markDoneConfirm = { ticket: action.ticket }`.
      `confirm-mark-done` re-resolves the run from `S.runs` fresh (never a
      cached value), calls `writeOverrideEvent(ctx.root, ticket, 'done')`,
      then clears `S.markDoneConfirm`.
- [x] 4.2 `lib/ui/app-state.js`: add `markDoneConfirm: null` alongside
      `forceStartConfirm`/`clearQueueConfirm`.
- [x] 4.3 Wire the confirm gate into `fleet.js`'s `handleKey` (checked
      alongside `forceStartConfirm`/`clearQueueConfirm`, same precedence
      discipline — newest-opened gate intercepts first) and into
      `scrollToShow`'s `winOpts` (so `buildHeadTail` height estimation stays
      accurate, matching the existing `forceStartConfirm`/`clearQueueConfirm`
      fix noted in that function's own comments).
- [x] 4.4 **(skeptic gate round 1, finding 3 — the part 4.3 alone does not
      cover)** Thread `state.markDoneConfirm` through `render.js`'s
      `render()` and `watch.js`'s `draw()` render opts, exactly like
      `state.forceStartConfirm` already is, and add an
      `else if (markDoneConfirm)` branch to `sections.js`'s `buildHeadTail`
      that actually prints the on-screen confirm banner (naming the ticket),
      not just the height-estimate/keypress-interception wiring in 4.3.
- [x] 4.5 Unit tests covering: the banner is present while `markDoneConfirm`
      is set (render-level test, not just controller-level); `d`→`y` and
      `d`→anything-else scenarios from `specs/fleet-failed-remediation/spec.md`.

## 5. `a` — spawn `/concertino-address-failure`

- [x] 5.1 `lib/ui/harness.js` (or `launcher.js`): add a helper building the
      `/concertino-address-failure {{TICKET}}` command string the same way
      `defaultLaunchCommand` builds the ordinary one, for the claude-code CLI
      wrapper only.
- [x] 5.2 `lib/ui/controllers/fleet.js`: `address-failure` case — re-resolve
      `action.ticket` against `S.runs` fresh at handling time (never trust a
      value cached from a previous frame, same discipline as every other
      controller case in this file); if the run's `harness !== 'claude-code'`,
      set an inline notice and return without spawning; else call the
      launcher/session spawn path with the new command, mirroring
      `restart-confirmed`'s existing spawn call shape. **Deviation:** calls
      `ctx.deps.submitTicket` directly (not `ctx.launcher.launch`) — the
      launcher's own `specFor` re-derives the command per-ticket from cached
      Linear labels (`harness:<value>`), which could silently swap this
      claude-code-only command for a different harness's ordinary
      `/concertino-deliver` template on a mislabeled ticket. `submitTicket`
      is the same function `ctx.launcher.launch` itself calls one layer
      down, just without that per-ticket relabelling on top.
- [x] 5.3 `lib/ui/app-state.js`: add `addressFailureNotice: null` (or reuse
      an existing generic notice field if one fits without overloading its
      meaning — check `drillNotice`/`queueNotice` first).
- [x] 5.4 Render the notice on the fleet screen (`sections.js`), following
      the existing `queueNotice` rendering precedent.
- [x] 5.5 Unit tests covering both the claude-code-spawns and the
      non-claude-code-shows-notice scenarios.

## 6. Footer hints

- [x] 6.1 `lib/ui/screens/fleet/sections.js`: FAILED section's footer hint
      gains `a address`/`d done`, shown only when a FAILED section is
      actually rendered this frame — same discipline as QUEUED's
      `f force-start`/`C clear queue`.
- [x] 6.2 Unit test: no FAILED section on screen → hint text omits both.

## 7. `/concertino-address-failure` command + orchestrator entry point

- [x] 7.1 `adapters/claude-code/address-failure-command.md`: new command
      file, structurally mirroring `command.md` — extracts `TICKET_ID` from
      `$ARGUMENTS`, spawns `concertino-orchestrator` with
      `ADDRESS_FAILURE=true` plus the ticket id.
- [x] 7.2 `lib/cli/emit.js`'s `emitClaude`: write
      `.claude/commands/concertino-address-failure.md` from the new adapter
      file, alongside the existing `concertino-deliver.md` write. No
      equivalent write for Codex/OpenCode (per design.md Non-Goals).
- [x] 7.3 `core/roles/orchestrator.md`: document the `ADDRESS_FAILURE` input
      and the new "Address-Failure entry point" procedure (audit → restore
      worktree via `setup-worktree.sh` → resume from `workflow-state.md` or
      reconstruct from persisted evidence or fall back to a fresh run →
      persist the audit via `persist-evidence.sh` → resume the ordinary
      Execution/Evaluation/Delivery/Cleanup loop, passing the audit's
      findings to the first resumed executor call).
- [x] 7.4 Sync-emission test/check: `concertino sync` (or the equivalent
      emit unit test) confirms `concertino-address-failure.md` is written
      for claude-code and not for codex/opencode.

## 8. Docs

- [x] 8.1 `docs/dashboard.md`: document the `a`/`d` keys — top-level,
      active only when a FAILED row is selected and no other section is
      locally focused (and their footer hints) — and a new subsection on
      `/concertino-address-failure`. No focus mode to document (dropped in
      design-gate revision — see design.md's Decision 1).
- [x] 8.2 `docs/dashboard.md`: note the per-pane audit outcome (decision 6)
      for NEEDS YOU/RUNNING/DONE briefly, so a future reader can see they
      were reviewed rather than overlooked.

## 9. Verification

- [x] 9.1 Run the full existing test suite; confirm no regressions.
- [x] 9.2 Manually exercise (or script) the `a`→spawn and `d`→confirm→override
      flows against a synthetic FAILED run fixture. (Scripted via
      `test/controllers-fleet.test.js`'s `address-failure`/`confirm-mark-done`
      cases and `test/reducer.test.js`'s `run.override`/retry-visibility
      cases — an end-to-end synthetic FAILED-run fixture exercising both
      flows through the real controller/reducer, not a manual tmux session.)
- [x] 9.3 Confirm `openspec validate --change failed-run-remediation-controls`
      is clean before handoff. (Ran as `openspec validate
      failed-run-remediation-controls --strict` — this repo's CLI takes the
      change name positionally, not via a `--change` flag; see final report
      for the exact command/output.)
