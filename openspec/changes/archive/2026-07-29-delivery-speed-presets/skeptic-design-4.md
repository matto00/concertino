## Skeptic Report — design gate (round 4)

### What I verified (with evidence)

- Read round 3's report (`skeptic-design-3.md`) in full as a claims list, not fact.
- Fresh, full, end-to-end read of the current `ticket.md`, `proposal.md`,
  `design.md`, `tasks.md`, `specs/delivery-speed-presets/spec.md` — treated
  as a genuinely independent adversarial pass, not a diff-only check.
- **Round 3's one open finding (harness-label mismatch) — re-verified fixed:**
  - `design.md` Decision 3's TUI-wiring subsection (lines 96–104) now states,
    verbatim: `resolve-speed.sh`'s `$2` and `models.<harness>`/
    `modelTiers.<harness>` use the *canonical* id (`claude-code`/`codex`),
    never the CLI-binary label (`claude`) that `open-launchplan` already
    produces for `plan.harness`/`plan.harnesses`; introduces
    `const canonicalHarness = (h) => (h === 'claude' ? 'claude-code' : h);`
    and requires it be applied "at all three call sites" — the
    `open-launchplan` seed call (line 100), the new `cycle-speed` case (line
    101), and `cycle-harness`'s refresh call (line 102). All three sites are
    named explicitly and the helper is specified as a single shared function,
    not three independent ternaries.
  - `tasks.md` task 5.4a (lines 45–50) mirrors this exactly: adds
    `canonicalHarness(h)` with the identical reverse-mapping, states the
    requirement is "Required (round 3 design-gate finding)", and lists the
    same three call sites in the same order, each explicitly wrapping
    `plan.harness`/`harnesses[0]`/the newly-cycled harness in
    `canonicalHarness(...)` before it becomes `resolve-speed.sh`'s `$2`.
  - `tasks.md` 5.4a's final bullet and task 5.6 both now require a unit-test
    assertion specifically for the Claude Code translation case ("cycling
    to/opening on `harness: 'claude'` must invoke `resolve-speed.sh` with
    `'claude-code'`, never `'claude'`, as `$2`").
  - Cross-checked against current ground truth in `lib/ui/watch.js`
    (`open-launchplan` lines 908–990, `cycle-harness` lines 1000–1013, both
    read in full): `configuredHarnesses`/`plan.harness`/`plan.harnesses`
    still hold the CLI-binary label (`'claude'`/`'codex'`) exactly as round
    3 found — confirming the fix target the revision describes is real and
    still needed, and that the revised design/tasks text, if implemented as
    written, would apply `canonicalHarness()` at exactly the three places
    that currently lack it. No fourth call site exists that reads
    `plan.harness`/`plan.harnesses` and would need the same treatment (only
    `open-launchplan`, `cycle-harness`, and the new `cycle-speed` case touch
    `resolve-speed.sh`; `launchplan.js`'s `render()`/`handleKey()` never do,
    confirmed by re-reading the file — still pure, unmodified).
  - Confirmed `codex`'s label needs no translation (`'codex'` is both the
    CLI-binary label and the canonical id), so `canonicalHarness('codex')`
    is a no-op identity pass-through — consistent with round 3's own framing
    that the bug was masked, not present, for that harness.
- **Fresh full-document adversarial pass, looking for anything new:**
  - `proposal.md`, `design.md`'s Goals/Non-Goals/Decisions 1–6/Risks/
    Migration Plan/Open Questions, `tasks.md` sections 1–6, and
    `specs/delivery-speed-presets/spec.md`'s 9 requirements/scenarios were
    all re-read for internal consistency, placeholders, and AC coverage.
  - `grep -in "TODO\|TBD\|figure out later\|to be decided"` across
    `design.md`/`tasks.md`/`proposal.md`/`spec.md` returns nothing.
  - Every `ticket.md` acceptance criterion traces to a spec requirement and
    at least one `tasks.md` item (speed argument parsing → Req 1/task 4.1,
    5.3; named presets over budgets+tiers → Req 2/task 1.1,1.2; per-harness
    per-role models + config-driven Codex → Req 3,5/tasks 1.1,1.2,1.5,2.3;
    tiers not hardcoded models → Req 3/Decision 1; explicit override beats
    preset → Req 4/task 1.5; final gate always runs → Req 6/Decision 2,
    task 3.6; auditable on run.start+drilldown → Req 7/tasks 2.5,5.1,5.2;
    n-prompt+launch-plan set/preview → Req 8/tasks 5.3,5.4,5.4a; escalation
    unchanged → Req 9/Decision 4).
  - Verified `emitCodex()`'s existing `.toml`-rendering loop only covers
    `['executor', 'evaluator', 'auditor']` (bin/concertino:549) — confirms
    task 2.3's role list (executor/evaluator/auditor) is the correct,
    complete set and doesn't omit or over-scope a role; `models.codex.
    orchestrator`/`.skeptic` in the roleTiers example are consistent with
    the preexisting (pre-this-change) flat-`models` shape's own key set and
    aren't misused anywhere in the new per-harness scheme.
  - Verified no key collision: `canonicalHarness` doesn't already exist
    anywhere in `lib/ui/watch.js` or `core/scripts/setup-worktree.sh`
    (`grep` returned no matches), and the new `s` key in `launchplan.js`'s
    `handleKey` doesn't collide with any existing key binding (`\x1b`, `\r`,
    `c`, `h`, `m` are the only ones currently handled).
  - Verified `lib/ui/reducer.js:72`'s `ev.harness` pattern cited by task 5.1
    as precedent is real ground truth, not an invented citation.
  - No new placeholders, contradictions, ambiguity, scope drift, or missing
    contract updates found beyond what rounds 1–3 already surfaced and this
    round's revision resolved.

### Verdict: CONFIRM

Round 3's single remaining finding — `resolve-speed.sh`'s `$2` requiring the
canonical harness id while `plan.harness` held the CLI-binary label — is now
correctly and completely specified as fixed: a single shared
`canonicalHarness()` helper applied at all three call sites that pass a
harness to `resolve-speed.sh` (`open-launchplan` seed, `cycle-speed`,
`cycle-harness` refresh), plus an explicit unit-test requirement covering the
Claude Code translation case. A fresh, independent, full read of
`proposal.md`/`design.md`/`tasks.md`/`spec.md` surfaces no further
placeholders, internal contradictions, ambiguity, scope drift, or missing
contract updates. The design is sound to implement.

### Non-blocking notes

- `tasks.md` 1.2's Codex `modelTiers` default values are left as "pick
  sensible defaults; document the choice in a code comment" rather than
  named concrete strings — acceptable at the design gate (an implementation
  detail, not a blocking ambiguity that changes behavior/shape), but the
  executor should make sure the comment it adds actually explains the
  choice rather than just asserting it.
- `ticket.md`'s own background section paraphrases the pre-existing
  hardcoded-Codex-model constant as `CODEX_MODEL`; ground truth
  (`bin/concertino:22`) names it `CODEX_MODEL_FALLBACK`. Pre-existing
  wording in the ticket/ROADMAP, not introduced by this design, and doesn't
  affect any task's correctness — task 1.2 correctly references
  `CODEX_MODEL_FALLBACK` by its real name.
