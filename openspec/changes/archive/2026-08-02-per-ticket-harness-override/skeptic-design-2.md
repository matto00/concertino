## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/harness-identity/spec.md` in full, fresh (not trusting round-1's
  reading or the orchestrator's revision narrative).
- Read round 1's report (`skeptic-design-1.md`) to know exactly what the
  single Change Request was, then re-verified it end to end against the
  **current** code rather than taking the revised prose's word for it:
  - `core/scripts/setup-worktree.sh` (current, pre-implementation) —
    confirmed today's actual code is exactly what design.md/tasks.md
    describe as the "before" state: `RUNTIME_HARNESS="$(detect_harness)"`,
    `HARNESS="${RUNTIME_HARNESS:-${CONCERTINO_HARNESS:-unknown}}"`, then
    `resolve-speed.sh "$SPEED" "$HARNESS"` (line 98), whose `models` output
    (`RESOLVED_MODELS_JSON`) flows into both `READY models=` (line 261) and
    the `run.start` event's `models=` field (line 253).
  - `core/scripts/resolve-speed.sh` — confirmed `HARNESS` is used verbatim
    (no re-detection) to look up `.modelTiers[$harness]` (line 97) and to
    build the per-role `models` object (line 120), i.e. confirmed the
    round-1 failure mode is real for the *current* code and would remain
    real unless the harness value fed to this script is decoupled from a
    ticket override.
  - Design.md's Decision 5 now explicitly splits `HARNESS` (identity,
    override-aware) from `MODEL_TIER_HARNESS` (model-tier resolution,
    **never** influenced by `HARNESS_OVERRIDE` — computed via the exact
    pre-ticket expression `"${RUNTIME_HARNESS:-${CONCERTINO_HARNESS:-unknown}}"`).
    tasks.md 2.3/2.4 operationalize this: 2.3 computes both variables
    separately and calls the split "load-bearing," 2.4 changes the
    `resolve-speed.sh` call site to pass `"$MODEL_TIER_HARNESS"` instead of
    `"$HARNESS"` — the exact one call site the round-1 finding was about.
  - Traced the consequence forward through
    `core/roles/orchestrator.md`'s "Per-spawn model overrides (Claude Code
    only)" section (line 351+): every `Agent(model=...)` spawn uses
    `workflow-state.md`'s `MODELS.<role>`, which is populated from
    `setup-worktree.sh`'s `READY models=` line — now sourced from
    `MODEL_TIER_HARNESS`, not `HARNESS`. So a ticket override that
    contradicts the live runtime signal can no longer feed the wrong
    harness's model ids into the live `Agent(...)` call — the round-1
    failure mode is closed.
  - Confirmed `specs/harness-identity/spec.md`'s two new/modified scenarios
    ("Valid ticket-declared override outranks runtime detection for
    identity" and "A contradicting override never changes per-role
    model-tier resolution") match this split exactly, and that the base
    "SHALL NOT report a harness value that contradicts a detected runtime
    signal" requirement is correctly carved out with a scoped exception
    ("this constraint does not apply when a valid `HARNESS_OVERRIDE` is
    passed... see the override requirement below for why").
  - Checked the delta's two MODIFIED requirements against
    `openspec/specs/harness-identity/spec.md` (base, unmodified) —
    confirmed every existing scenario (single/multi-harness, both signals
    set, no-signal cases, static/runtime validate reporting) is carried
    forward verbatim, nothing silently dropped, consistent with round 1's
    finding on this point.
  - tasks.md 6.1 requires an explicit, named regression test for exactly
    the round-1 scenario ("a contradicting override ... does NOT change the
    harness value passed to `resolve-speed.sh`/reflected in `READY
    models=`"), called out by name as the round-1 REFUTE's subject rather
    than left to be inferred from other cases.
  - Re-checked tasks.md's other file/line references against the current
    tree (still accurate, unrelated to the round-1 fix but re-verified
    fresh per the design-gate mandate): `lib/config.js:204`
    (`VALID_HARNESSES`), `bin/concertino:442` (`renderEnv`'s
    `CONCERTINO_HARNESS=` line), `bin/concertino:1293`/`1309`
    (`cmdValidate`/`collectConfigIssues` call site), `docs/config-reference.md:21,33-43`,
    `docs/harness-capabilities.md:1-20`, and confirmed
    `core/scripts/setup-worktree.sh` and `scripts/concertino/setup-worktree.sh`
    are still byte-identical (the core→synced-copy pattern tasks.md 2.7
    relies on).
  - Confirmed `core/roles/orchestrator.md` has no existing `HARNESS`
    variable usage of its own (grep found none) — the new `HARNESS`/
    `HARNESS_SOURCE` READY lines are additive and don't need to be threaded
    into `workflow-state.md` for any existing orchestrator decision; the
    only consumer of the resolved `HARNESS` value is the `run.start`
    telemetry event the script itself already emits, so no gap there.
  - Grepped the change dir for `TODO|TBD|figure out later|xxx|FIXME` — none
    found.
  - Grepped design.md/tasks.md for stray unqualified `"$HARNESS"` references
    to the `resolve-speed.sh` call site — the only two hits are both
    explicitly describing the *before* state being replaced, not leftover
    contradictions.

### Verdict: CONFIRM

The round-1 finding is genuinely resolved, not just reworded: the
`HARNESS`/`MODEL_TIER_HARNESS` split is threaded consistently through
design.md (Decision 5), the spec delta (both new scenarios plus the scoped
exception to the existing "no contradiction" requirement), and tasks.md
(2.3/2.4 implement it, 2.5 documents both variables in the header comment,
6.1 requires a named regression test for the exact scenario). Traced against
the live code, the fix actually closes the failure mode: `resolve-speed.sh`
now only ever receives the actually-detected runtime harness, so per-role
model ids fed into the live `Agent(model=...)` call stay valid for the
harness really executing the process, regardless of what a ticket declares.
No new contradictions, placeholders, or scope drift found in this round's
sweep.

### Non-blocking notes

- Carried forward from round 1 (still just notes, not blocking): AC5's
  "surfaces per-ticket harness overrides it finds and validates each"
  reading (single named ticket via `--ticket`, "each" = each matching label
  on that ticket) is defensible but still not stated explicitly in Decision
  6 — worth a one-line clarification for the next reader. The
  `harness:<value>` label has no documented normalization convention
  (case/whitespace) — worth a one-line note in `docs/config-reference.md`
  (task 5.1).
