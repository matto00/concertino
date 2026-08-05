- `core/scripts/assert-phase.sh` — accept an optional trailing `TICKET_ID` argument for every phase
  (`setup`, `servers`, `delivery`, `cleanup`); `GATE_TICKET` now resolves to the explicit id first,
  falling back to `${WORKTREE_PATH##*/}` basename inference only when omitted.
- `core/scripts/start-servers.sh` — accept an optional 4th positional argument `TICKET_ID`;
  `start_one()`'s local `T` now resolves the same way as `GATE_TICKET` above.
- `core/scripts/emit-event.sh` — canonicalise a validated `ticket=` to uppercase unconditionally
  (after the existing `looks_like_ticket` shape check, before `RUN_DIR` is computed and before it
  is written into any event), so a case-only variant can never address a different run directory.
- `scripts/concertino/assert-phase.sh`, `scripts/concertino/emit-event.sh`,
  `scripts/concertino/start-servers.sh`, `scripts/concertino/README.md` — rendered copies of the
  three scripts above plus the scripts README, re-synced via `concertino sync` so the live
  (gitignored-config) rendering matches the templates. `scripts/concertino/README.md` was missed
  in the cycle-1 sync (the README edit landed after that sync had already run) — the evaluator's
  cycle-2 change request caught it via `node bin/concertino doctor`'s "Rendered artifacts" drift
  check; re-running `concertino sync` fixed it and `doctor` now reports the section clean.
- `core/roles/orchestrator.md` — pass `$TICKET_ID` as the trailing argument at the `setup`,
  `delivery`, and `cleanup` `assert-phase.sh` call sites.
- `core/roles/evaluator.md`, `core/roles/skeptic.md` — pass `$TICKET_ID` as the trailing argument
  at the `start-servers.sh` / `assert-phase.sh servers` call sites.
- `core/scripts/README.md` — usage-summary table now shows the new optional trailing `[TICKET_ID]`
  argument for `assert-phase.sh` and `start-servers.sh`.
- `test/scripts/assert-phase.test.sh` — CON-64-style regression cases: an explicit ticket id
  alongside a non-ticket-shaped basename tags `gate.result` correctly (and is absent without the
  argument); the ticket's own lowercase-suffix-branch scenario produces one canonically-cased run
  dir, no phantom lowercase one; the no-argument basename-inference fallback is unchanged.
- `test/scripts/start-servers.test.sh` — the analogous explicit-ticket-id regression cases for
  `start-servers.sh`.
- `test/scripts/emit-event.test.sh` — case-canonicalisation cases: lowercase and mixed-case tickets
  write to the uppercase run dir; three invocations differing only by case converge on one
  directory; an already-uppercase ticket is unaffected; the malformed-ticket degradation path
  (silent drop / loud `run.end` warning) is unaffected by the new canonicalisation step.

## Root cause / probe (per systematic-debugging.md)

- **Root cause:** `assert-phase.sh` and `start-servers.sh` (the telemetry-tagging layer) inferred
  the ticket id from `${WORKTREE_PATH##*/}` instead of being told it explicitly, so a worktree
  whose branch's ticket suffix is lowercase (Linear's own `gitBranchName` convention) tagged
  `gate.result`/`gate.warning` events with the lowercase basename while `setup-worktree.sh`
  (already fixed, receiving `TICKET_ID` explicitly) tagged its own events with the canonical
  uppercase id — splitting one run's telemetry across two `.concertino/runs/<TICKET>/` directories.
- **Probe:** before the fix, ran
  `bash core/scripts/assert-phase.sh setup "$REPO/worktrees/con-79"` (no explicit ticket id) and
  inspected the resulting `.concertino/runs/` tree — confirmed a `con-79/` directory was created
  (lowercase, matching the WORKTREE_PATH basename) rather than `CON-79/`.
- **Probe output:** `.concertino/runs/con-79/events.jsonl` existed with
  `{"kind":"gate.result", ..., "ticket":"con-79", ...}` — reproducing the ticket's described
  phantom-directory split.
- **Fix + lock:** threaded `TICKET_ID` through both scripts (mirroring `cleanup.sh`'s CON-64 fix)
  and added unconditional uppercase canonicalisation in `emit-event.sh` as a second, independent
  line of defense. Regression tests in `test/scripts/assert-phase.test.sh` and
  `test/scripts/start-servers.test.sh` reproduce the exact lowercase-suffix scenario
  (`worktrees/con-79`, ticket `CON-79`) and assert a single canonically-cased run directory with no
  phantom lowercase sibling — these fail against the pre-fix scripts and pass after.
