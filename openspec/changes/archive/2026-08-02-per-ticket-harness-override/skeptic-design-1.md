## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/harness-identity/spec.md`, `workflow-state.md`,
  `.openspec.yaml` in full.
- Cross-checked every factual claim in `design.md`/`proposal.md` against the
  actual codebase in the worktree (not trusted on prose alone):
  - `lib/config.js:204-208` — confirmed `VALID_HARNESSES = ['claude-code', 'codex']`
    exists exactly as described, local to `collectConfigIssues`.
  - `bin/concertino:431-450` (`renderEnv`) — confirmed the exact insertion
    point for a new `CONCERTINO_IMPLEMENTED_HARNESSES` line next to the
    existing `CONCERTINO_HARNESS=` line.
  - `bin/concertino:1293-1322` (`cmdValidate`) and `bin/concertino:121-129`
    (`parseArgs`) — confirmed `parseArgs` handles arbitrary `--flag value`
    pairs generically, so `--ticket <ID>` needs no new parsing code, and
    confirmed `collectConfigIssues(cfg, { out, emit })`'s existing shape is
    a plausible extension point for task 4.4.
  - `core/scripts/setup-worktree.sh:1-95` — confirmed the current 3-arg
    signature, `detect_harness()`, the `RUNTIME_HARNESS`/`HARNESS` fallback
    chain, and that `REPO_ROOT=$(git rev-parse --show-toplevel)` genuinely
    is the first git/worktree operation, so a pre-`REPO_ROOT` validation of
    `HARNESS_OVERRIDE` (task 2.2) really does land "before any git/worktree
    operation" as claimed.
  - `diff core/scripts/setup-worktree.sh scripts/concertino/setup-worktree.sh`
    → identical, confirming the "core → synced copy, re-run `concertino
    sync`" pattern task 2.6 alludes to (also confirmed against
    `CONTRIBUTING.md:50-60`, which spells out this exact mechanism and warns
    against hand-editing the rendered copy).
  - `core/roles/orchestrator.md` Setup steps 1–4 (lines 112-150) — confirmed
    the "fetch ticket" step, the existing `FAIL` → treat-as-`BLOCKER`
    precedent design.md Decision 3 leans on, and that step 3 is indeed
    before any worktree work.
  - Live-called `mcp__linear__get_issue` on this very ticket (CON-62) and
    confirmed the response includes a `labels` array (empty for this
    ticket) — verifies the proposal's central claim that `get_issue`
    already returns labels with zero new Linear API surface.
  - `lib/ui/linear.js` — confirmed `labels` parsing (line 327), `postRaw`
    (179), `LINEAR_API_KEY` handling (250) already exist and are reusable
    as claimed for task 4.2.
  - `docs/config-reference.md:21,33-43` and `docs/harness-capabilities.md:1-20`
    — confirmed the referenced line ranges/content tasks 5.1/5.2 point at
    are accurate.
  - `openspec/specs/harness-identity/spec.md` (base spec, not the delta) —
    confirmed the MODIFIED requirement in the change's spec delta correctly
    carries forward every existing requirement/scenario (nothing silently
    dropped) while layering the new override step on top.
  - `test/scripts/harness-identity.test.sh` — found the actual existing
    bash test file for this exact area (not named in tasks.md, but
    discoverable per its own "check test/ for existing coverage" hedge);
    its structure (`new_scripts`/`new_repo`/`run_setup`/`harness_of`
    helpers) is directly reusable for task 6.1's new scenarios.
  - Grepped the change dir for `TODO|TBD|figure out later|xxx` — none found.
- **Traced the model-resolution consequence of Decision 5 through the rest
  of the codebase** (this is the one place I found a real contradiction —
  see Change Request 1 below): read `core/scripts/resolve-speed.sh` in full
  and `core/roles/orchestrator.md`'s "Per-spawn model overrides (Claude
  Code only)" section (lines 351-369).

### Verdict: REFUTE

### Change Requests

1. **Decision 5's "override wins even when it contradicts the detected
   runtime signal" breaks per-spawn model selection on the exact scenario
   the spec itself defines as first-class ("Valid ticket-declared override
   outranks runtime detection", `specs/harness-identity/spec.md:57-65`).**
   Trace:
   - `setup-worktree.sh` resolves `HARNESS="$HARNESS_OVERRIDE"` (e.g.
     `codex`) even when `CLAUDECODE` is set, i.e. even when the orchestrator
     is *actually* running inside a Claude Code process right now.
   - That same `HARNESS` value is passed to
     `resolve-speed.sh "$SPEED" "$HARNESS"` (design.md's own Decision 3a:
     "the orchestrator does not call `resolve-speed.sh` again itself, it
     just parses the READY lines"). `resolve-speed.sh` looks up
     `.modelTiers[$harness]` (confirmed in `core/scripts/resolve-speed.sh`
     and `scripts/concertino/speeds.json`) — for `harness=codex` this
     yields values like `codex-mini-latest` / `gpt-5.1-codex`.
   - `core/roles/orchestrator.md`'s "Per-spawn model overrides (Claude Code
     only)" section then takes `workflow-state.md`'s `MODELS.<role>` value
     verbatim and passes it as the **Claude Code** `Agent(...)` tool's own
     `model` parameter, which Claude Code expects to be a Claude Code model
     name (`haiku`/`sonnet`/`opus` — see `modelTiers.claude-code` in the
     same `speeds.json`), not a Codex model id.
   - Net effect: a ticket labeled `harness:codex`, run by a human who (as
     the current architecture requires — there is no dispatcher anywhere in
     this codebase that launches a different CLI process per ticket, only
     confirmed via `bin/concertino` having no `run`/spawn-a-harness command)
     happens to be working inside a live Claude Code session, would resolve
     `MODELS.executor` etc. to `codex-mini-latest`/`gpt-5.1-codex` and then
     feed that string into Claude Code's own `Agent(model=...)` call for
     every sub-agent spawn in the run — an invalid model identifier for
     that harness. This is not a hypothetical edge case; it is the literal
     scenario the design's own new spec section commits to supporting.
   - This must be resolved before implementation, by one of (not
     prescribing which, but design.md needs to pick one and thread it
     through the spec/tasks):
     (a) decouple telemetry `harness=`/`harness_source=` (which the override
     should keep controlling) from the harness passed to
     `resolve-speed.sh` for `MODELS` purposes (which should stay the
     actually-detected runtime harness, since that's the only one whose
     model names are valid for the live `Agent` tool actually being called);
     (b) treat an override that *contradicts* a detected runtime signal as
     a hard stop (consistent with the ticket's "must fail loudly, not
     silently" spirit) rather than silently honoring it; or
     (c) explicitly scope this ticket's override to non-contradicting cases
     only (i.e. only takes effect when no runtime signal is present or the
     runtime signal already agrees), and drop the "wins over a contradicting
     runtime signal" scenario from the spec/tasks entirely until real
     per-ticket harness dispatch exists.
     Whichever is chosen, `design.md` Decision 5, the
     "Valid ticket-declared override outranks runtime detection" spec
     scenario, and task 6.1's test plan all need to be updated to match —
     right now they describe a scenario that, traced through the existing
     `resolve-speed.sh`/`Agent(model=...)` machinery, produces broken
     sub-agent spawns rather than "the workflow honors that choice" (the
     ticket's own words).

### Non-blocking notes

- AC5 ("`concertino validate` surfaces per-ticket harness overrides it
  finds and validates each against the set of implemented adapters") could
  be read as "scan all in-flight tickets automatically" rather than "check
  one named ticket via a new `--ticket <ID>` flag." Decision 6's reading
  (single ticket, explicit flag) is defensible given this CLI's existing
  per-project (not per-batch) scope and the workflow's own one-ticket-at-a-
  time architecture, and "validates each" plausibly refers to each matching
  label on that one ticket (the ambiguous multi-label case Decision 1
  already specs out) rather than each ticket in a batch — but this reading
  is not stated explicitly anywhere in design.md. Worth a one-line
  clarification in design.md's Decision 6 for the next reader.
- The `harness:<value>` label convention has no documented normalization
  (case sensitivity, surrounding whitespace, e.g. `Harness:Codex` or
  `harness: codex`). Minor — worth a one-line note in
  `docs/config-reference.md` (task 5.1) on whether matching is exact/strict.
