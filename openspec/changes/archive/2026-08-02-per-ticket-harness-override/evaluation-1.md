## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

- All ticket ACs addressed explicitly:
  1. Ticket metadata (Linear `labels`, `harness:<value>`) read alongside other fields at Setup — `core/roles/orchestrator.md` Setup step 1.
  2. Supported harness override takes precedence over project `harnesses` config default and runtime env detection — `core/scripts/setup-worktree.sh` `HARNESS`/`HARNESS_SOURCE` resolution (Decision 5), plumbed via new 4th positional arg from orchestrator step 3.
  3. No-override behavior unchanged (verified byte-identical resolution order retained, and covered by test `d.3` in `test/scripts/harness-identity.test.sh` plus pre-existing sections a/b/c still passing unmodified).
  4. Unsupported harness fails loudly, before worktree creation — validated at two sites: orchestrator hard-stop (before branch derivation/`setup-worktree.sh` call) and `setup-worktree.sh`'s own defense-in-depth check, which runs before `REPO_ROOT="$(git rev-parse --show-toplevel)"` (confirmed by line order: check at line ~118, `REPO_ROOT` at line 192).
  5. `concertino validate --ticket <ID>` surfaces and validates a per-ticket override against `VALID_HARNESSES` — `bin/concertino` `cmdValidate`/`buildTicketHarnessCheck`, `lib/config.js` `classifyHarnessOverride`.
  6. `docs/config-reference.md` and `docs/harness-capabilities.md` updated, cross-linked in both directions.
  7. No local-llm (or any new) adapter implemented — correctly out of scope; `local-llm` is used only as the "fails loudly" example.
- No AC silently reinterpreted — implementation matches design.md's decisions verbatim, including the `HARNESS` vs `MODEL_TIER_HARNESS` split from Decision 5 (the skeptic's round-1 design-gate finding), confirmed end-to-end in the diff and its dedicated regression test (`d.4`).
- All `tasks.md` items marked `[x]` match what was actually implemented (verified 1.1–7.2 against the diff item by item).
- No scope creep: the only change outside the ticket's direct footprint is `scripts/concertino/speeds.json`'s `executionCycles: 7 → 3`, which is a documented, required byproduct of re-running `concertino sync` (tasks.md 2.7/3.4) to pick up the core→synced-copy changes — it corrects a pre-existing drift back in line with `concertino.config.json`'s actual `budgets.executionCycles: 3`, not unrelated product logic.
- No regressions to existing behavior: all pre-existing `harness-identity.test.sh` sections (a/b/c, no-override/runtime/static paths) and the full pre-existing suite pass unchanged.
- API/contract changes reflected correctly: `setup-worktree.sh`'s new 4th positional arg is additive/backward-compatible; new `READY harness=`/`READY harness_source=` lines are additive; `.concertino.env`'s new `CONCERTINO_IMPLEMENTED_HARNESSES` key is additive.
- Planning artifacts (proposal/design/tasks/spec delta) accurately reflect the final implementation — cross-checked design.md Decision 5's exact code sketch against the actual `setup-worktree.sh` diff; they match near verbatim.

### Phase 2: Code Review — PASS
Issues: none blocking.

**Gates (fresh run, in `WORKTREE_PATH`, `EVALUATOR_CLEAN_WORKTREE=false` per workflow-state.md — not `slow` speed, no clean-worktree re-run required):**
- `npm test` → exit 0. `node --test`: 1280 tests, 1280 pass, 0 fail. All 17 bash test scripts in the `test` script chain (including `test/scripts/harness-identity.test.sh`, which contains this ticket's new section (d)) reported `N passed, 0 failed` with no `FAIL`/`not ok` lines outside of intentionally-asserted-failure test names.

**Code quality:**
- DRY: `VALID_HARNESSES` hoisted to a single module-level export in `lib/config.js`, reused by both `collectConfigIssues` and `cmdValidate --ticket`'s classification path, and re-exposed to bash once via `CONCERTINO_IMPLEMENTED_HARNESSES` — no duplicated harness-list logic anywhere.
- Readable: `HARNESS` vs `MODEL_TIER_HARNESS` split is heavily and clearly commented at the point of definition and at the `resolve-speed.sh` call site in `core/scripts/setup-worktree.sh`; naming is self-explanatory (`parseHarnessOverrideLabels`, `classifyHarnessOverride`, `HARNESS_SOURCE`).
- Modular: label parsing (`parseHarnessOverrideLabels`) and classification (`classifyHarnessOverride`) are small, pure, independently unit-tested functions in `lib/config.js`; the network fetch (`fetchOneTicket` in `lib/ui/linear.js`) is kept separate from classification, matching design.md Decision 6's intent.
- Type safety: N/A (no TS in this repo); JS is used consistently with the rest of the codebase's conventions, no untyped escape hatches introduced.
- Security: `fetchOneTicket` validates `id`/`LINEAR_API_KEY` presence before any network call, matching existing `lib/ui/linear.js` conventions; label values are only ever compared against a fixed whitelist (`VALID_HARNESSES`) or interpolated into error/informational strings, never executed or used to build a shell command unsafely — `HARNESS_OVERRIDE`'s use in `setup-worktree.sh` is a plain string comparison in a `for` loop, not eval'd.
- Error handling: `setup-worktree.sh` FAILs loudly to stderr with a named unsupported value before any git/worktree mutation; `fetchOneTicket` throws clear, typed errors for missing id/key/not-found/GraphQL-error rather than crashing with a raw stack trace; `cmdValidate --ticket` against a non-linear provider degrades to an informational note rather than crashing (verified in `test/validate.test.js`).
- Tests meaningful: `test/scripts/harness-identity.test.sh` section (d) includes the specific regression the skeptic's round-1 design-gate REFUTE was about — `d.4` explicitly asserts a contradicting override changes `READY harness=` (identity) but does NOT change `READY models=`/`resolve-speed.sh`'s harness input, asserting the absence of `codex-mini-latest` in both the READY line and the `run.start` event's `models=` field. `test/config.test.js` and `test/linear.test.js` cover every classification kind and fetch-error path. `test/validate.test.js` covers the two --ticket paths reachable without a live Linear fetch (non-linear provider, missing `LINEAR_API_KEY`).
- No dead code: no leftover TODO/FIXME/commented-out code found in the diff; grepped and none present (also independently confirmed by the skeptic's round-2 design-gate sweep noted in `skeptic-design-2.md`).
- No over-engineering: the two-variable (`HARNESS`/`MODEL_TIER_HARNESS`) split looks like extra surface at first glance but is directly required by the design-gate-confirmed regression it prevents (feeding a mismatched harness's model ids into a live `Agent(...)` call) — not a premature abstraction.
- Behavior-preserving where expected: `cmdValidate`/`cmdSync`/`cmdUpdate`/`cmdInit`'s conversion to `async` (required by the new live `--ticket` fetch) is a clean, minimal propagation with no other behavior change — omitting `--ticket` is asserted as a complete no-op in `test/validate.test.js`, and pre-existing validate/sync tests pass unchanged.
- `core/scripts/setup-worktree.sh` and its synced copy `scripts/concertino/setup-worktree.sh` are byte-identical (`diff` confirms), satisfying the core→synced-copy convention (tasks.md 2.7).

No canonical code-quality standard is configured for this project beyond what's covered above (per role instructions, "(none configured)").

### Phase 3: UI Review — N/A
This project has no UI review configured for this change (per role instructions); dev-server steps skipped.

### Overall: PASS

### Change Requests
(none — PASS)

### Non-blocking Suggestions
- Carried forward from the skeptic's own round-2 design-gate notes (`skeptic-design-2.md`): the `harness:<value>` label has no documented normalization convention (case sensitivity, surrounding whitespace) — worth a one-line clarification in `docs/config-reference.md` in a future pass, not blocking here since the ticket doesn't require it and the current behavior (case-sensitive exact match) is reasonable and consistent with how `VALID_HARNESSES` values are already written.
