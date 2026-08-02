# Files modified — per-ticket-harness-override (CON-62)

- `lib/config.js` — hoists `VALID_HARNESSES` to a module-level exported constant;
  adds `parseHarnessOverrideLabels`/`classifyHarnessOverride` (pure, unit-tested
  label-parsing/classification for the `harness:<value>` override convention);
  `collectConfigIssues` renders an optional `opts.ticketHarnessCheck` in the
  Integrations section (no-override/valid/invalid/ambiguous/unsupported-provider).
- `bin/concertino` — `renderEnv(c)` writes the new `CONCERTINO_IMPLEMENTED_HARNESSES`
  key into `.concertino.env`; `cmdValidate` becomes `async` and accepts `--ticket <ID>`
  (live-fetches via `lib/ui/linear.js`'s `fetchOneTicket`, classifies via
  `classifyHarnessOverride`, threads the result into `collectConfigIssues`);
  `cmdSync`/`cmdUpdate`/the dispatch table are updated to `await` the now-async
  `cmdValidate`/`cmdSync` chain; help text documents `--ticket`.
- `lib/ui/linear.js` — adds `ISSUE_QUERY` and `fetchOneTicket({ apiKey, id, transport })`,
  a minimal single-issue fetch reusing the existing `postRaw`/transport/auth plumbing.
- `core/scripts/setup-worktree.sh` — accepts an optional 4th `HARNESS_OVERRIDE`
  positional arg; validates it against `CONCERTINO_IMPLEMENTED_HARNESSES` before any
  git/worktree operation (FAILs loudly on an unsupported value); splits harness
  resolution into two variables per design.md Decision 5 — `MODEL_TIER_HARNESS`
  (runtime signal → static default → `unknown`, NEVER influenced by
  `HARNESS_OVERRIDE`, the only value passed to `resolve-speed.sh`) and `HARNESS`/
  `HARNESS_SOURCE` (identity/telemetry only, override wins when present even against
  a contradicting runtime signal); adds `READY harness=`/`READY harness_source=`.
- `scripts/concertino/setup-worktree.sh` — re-synced copy of the above (via
  `concertino sync`, this repo's own core→synced-copy convention).
- `scripts/concertino/speeds.json` — re-synced byproduct of running `concertino sync`
  (task 2.7/3.4's required re-sync step); corrects a pre-existing drift
  (`executionCycles` 7 → 3) back in line with `concertino.config.json`'s actual
  `budgets.executionCycles`, unrelated to this ticket's own logic.
- `core/roles/orchestrator.md` — Setup step 1 now inspects the fetched ticket's
  `labels` for `^harness:(.+)$` and hard-stops (before deriving a branch name or
  calling `setup-worktree.sh`) on an unsupported/ambiguous match; step 3's
  `setup-worktree.sh` invocation threads `HARNESS_OVERRIDE` through as the optional
  4th arg and notes the script's own defense-in-depth re-validation.
- `docs/config-reference.md` — documents the `harness:<value>` label convention, its
  precedence over both the static default and runtime detection, and
  `concertino validate --ticket <ID>`.
- `docs/harness-capabilities.md` — documents the implemented-harness closed set
  (`claude-code`, `codex`) a per-ticket override validates against, cross-linked
  with `docs/config-reference.md`.
- `test/scripts/harness-identity.test.sh` — new section (d): valid override beats a
  contradicting runtime signal + static default for `HARNESS`/`READY harness=`/
  `READY harness_source=`; invalid override FAILs before any worktree operation (no
  branch/worktree created); no-override behavior unchanged; explicit assertion that
  a contradicting override never changes `READY models=`/`resolve-speed.sh`'s
  harness input (the design-gate skeptic's round-1 regression). Also asserts
  `renderEnv` writes `CONCERTINO_IMPLEMENTED_HARNESSES`.
- `test/config.test.js` — unit tests for `VALID_HARNESSES`, `parseHarnessOverrideLabels`,
  `classifyHarnessOverride`, and `collectConfigIssues`'s `opts.ticketHarnessCheck`
  rendering for every `kind` (no-override/valid/invalid/ambiguous/unsupported-provider).
- `test/linear.test.js` — unit tests for `fetchOneTicket` (found/not-found, labels
  normalisation, missing id, missing/env `LINEAR_API_KEY`, GraphQL error propagation).
- `test/validate.test.js` — subprocess-level tests for `--ticket`'s no-network-required
  paths: omitted (no-op), non-linear provider (informational, no crash), linear
  provider with no `LINEAR_API_KEY` (clear error, non-zero exit, before any fetch).

## Debugging notes (systematic-debugging.md)

No bug was fixed during this implementation — one self-caught test-authoring error
(the shell test's `run_setup_capture4` helper redirected `2>/dev/null` internally,
so an outer `2>&1` capture in the FAIL-message assertion never saw the message) was
found and fixed via direct reproduction (running the failing assertion's exact
command manually, observing the FAIL line prints fine standalone, then tracing the
helper's own redirect) before the test suite was reported as passing — not a
product-code bug, so no separate root-cause writeup beyond this note.
