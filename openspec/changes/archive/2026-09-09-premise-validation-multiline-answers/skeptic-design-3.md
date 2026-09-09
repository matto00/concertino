## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

- **Both parser sites exist and are byte-identical in the relevant lines.** `sed -n '145,200p'` and
  `sed -n '280,330p' core/scripts/assert-phase.sh` — the `setup` premise check (fields
  `Claims checked:` / `Already-done scope:` / `Sibling collisions:`) and the Delivery
  `## Gate-Chain Implications Checklist` check (five prompts) each build `marker = "**" + label + "**"`
  and slice to `section.indexOf("\n", at)`. Design Decision 2's description of the second site is
  accurate, and a single helper taking `(section, labels)` genuinely serves both (the setup labels
  already carry their trailing `:`; the prompt labels carry `?`) — no per-site marker syntax split.
- **The two sites are separate `node -e` processes in different `case` branches** (lines ~153 and
  ~289), so R1's remedy (a `require()`d file, not an in-file function) is the only workable sharing
  mechanism. `SCRIPT_DIR` is computed at `assert-phase.sh:28` and already used for
  `lib/git-child-env.sh` at line 30 — the cited idiom is real.
- **Render-pipeline claim checked.** `lib/cli/emit.js:447-449` copies
  `listFilesRecursive(core/scripts)` **verbatim** into `scripts/concertino/`, and
  `lib/cli/resolve-core.js:46-47` confirms `core/scripts/lib/` is a real recursive render target.
  So a plain `cp` of a new `.js` is byte-equivalent to what `sync` would render — the "no manifest
  edit needed" and "cp is sufficient" claims both hold.
- **Drift-gate count claim checked against ground truth.** `bash test/scripts/rendered-scripts-drift.test.sh`
  → `18 passed, 0 failed`. Reading `run_drift_check` (lines 66-107): the whole `find`-based tree walk
  reports through the single assertion `1.1`, so the count does **not** rise per rendered file, and a
  missing rendered counterpart is reported under `never rendered:`. `design.md:79` and `tasks.md:61`
  are correct; task 4.1's predicted RED shape (`1.1` naming `lib/field-answers.js` under
  `never rendered:`) is exactly what that code produces. Also confirmed the walk compares with `cmp -s`
  (byte identity) and only enforces the executable bit for `*.sh`, so the new `.js` needs no mode care.
- **Gate-chain self-exposure checked.** `core/scripts/check-gate-chain-change.sh` classifies only
  `.husky/**` plus hook-invoked scripts; this repo has no `.husky/` (`ls -a` → none), so changing
  `assert-phase.sh` here does not itself trigger the Delivery checklist/isolation-test evidence
  requirements. Design's parenthetical on this is correct, and no missing task hides there.
- **No third copy of the parser.** `grep -rln 'indexOf("\n", at)'` → only `core/scripts/assert-phase.sh`
  and its rendered copy (plus this change's own prose). Task 1.5's "confirm neither site retains a
  private copy" is complete as scoped.
- **Spec delta headers checked against the baseline specs.**
  `openspec/specs/premise-validation/spec.md:42` matches the delta's MODIFIED header verbatim (good).
  `openspec/specs/gate-chain-live-infra-classification/spec.md` has no requirement named
  "The Delivery gate requires a completed Gate-Chain Implications Checklist" — see CR 2.
  `openspec validate premise-validation-multiline-answers --strict` → `is valid` (it does not
  cross-check MODIFIED headers against the baseline, so its green is not evidence here).
- **AC coverage traced:** AC1→Decisions 1/3 + tasks 1.1-1.3; AC2→Decision 4 + task 2.2; AC3→Decision 3
  edge table + task 2.6 (correctly labelled a GUARD with mutation-failability); AC4→tasks 2.3/2.4 +
  Decision 5 (Verdict left on its own regex, and added as a delimiter); AC5→Decision 2; AC6→tasks 3.1-3.3;
  AC7→tasks 4.1-4.3. No scope beyond the ticket other than Decision 2's second site, which AC5 invites.

### Verdict: REFUTE

Two artifact defects, both narrow. The technical design itself is sound and I found no fault with the
parsing approach, the sharing mechanism, or the testing strategy.

### Change Requests

1. **`proposal.md:34-35` still carries the drift-count claim that round 2 refuted**, contradicting
   `design.md:79` and `tasks.md:61` and contradicting the tree. It reads:
   "…so the CON-172 drift gate stays green (its assertion count **rises by one for the new lib file**)."
   Ground truth: the suite is 18 assertions and `run_drift_check`'s whole-tree walk is reported through
   the single assertion `1.1`; the count does not change. The R2 remedy moved the correct statement into
   Decision 2 but left the wrong one in the proposal, so the change still contradicts itself on the same
   fact. Fix: delete the parenthetical or replace it with "the count stays 18/18; a skipped `cp` shows up
   as assertion 1.1 going red under `never rendered:` — see design.md Decision 2", and keep the single
   authoritative statement in Decision 2 as design.md already promises.

2. **`specs/gate-chain-live-infra-classification/spec.md` labels its requirement `## MODIFIED` under a
   header that does not exist in the baseline spec**, so it would not modify anything. The baseline
   requirement carrying this behaviour is
   `openspec/specs/gate-chain-live-infra-classification/spec.md:21` —
   `### Requirement: Delivery blocks on missing gate-chain evidence`. The delta's header is
   `### Requirement: The Delivery gate requires a completed Gate-Chain Implications Checklist`.
   This repo's convention (verified against `openspec/changes/archive/2026-09-09-squash-never-strands-branch/`
   and `.../validate-committed-declaration-blob/`, whose MODIFIED headers match baseline headers verbatim)
   is that a MODIFIED delta reuses the exact baseline header; the premise-validation delta in this very
   change does so correctly. As written, archiving would leave the real requirement's line-bounded
   semantics unamended alongside a near-duplicate new one. Fix: retitle the delta to
   `### Requirement: Delivery blocks on missing gate-chain evidence` and restate that requirement's full
   modified text (baseline body plus the new answer-extent paragraph and the two new scenarios), since a
   MODIFIED block replaces the requirement wholesale.

### Non-blocking notes

- _Superseded, see design.md Decision 4 as corrected (final-gate skeptic, CON-169): measurement showed no tightening exists here._
- Decision 4 tightens the gate beyond AC2: `TBD` on the line *below* a marker is newly caught. That is the
  right direction and is stated, but it can newly fail artifacts that pass today. Worth one sentence in
  `proposal.md`'s What Changes so the behaviour change is visible outside `design.md`.
- Task 1.6 ("a parity assertion that both call sites resolve the lib to the same file") does not say where
  that assertion lives — a shell-level check inside `assert-phase.sh` or a test in
  `test/scripts/assert-phase.test.sh` are quite different things. Naming the location would remove the
  ambiguity for the implementer.
- `test/scripts/premise-validation-demonstration.test.sh` exercises the real rendered
  `scripts/concertino/assert-phase.sh` with premise-validation fixtures. It is not named anywhere in
  `tasks.md`; task 4.3's "full `test/scripts/` suite" covers it, but calling it out would make the
  regression surface explicit.
