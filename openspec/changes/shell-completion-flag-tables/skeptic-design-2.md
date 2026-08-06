## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Read `skeptic-design-1.md` (the round-1 REFUTE) to know exactly what the
  three required revisions were, then read the current
  `ticket.md`/`proposal.md`/`design.md`/`specs/cli-shell-completions/spec.md`/
  `tasks.md` fresh, in full, independent of the executor's framing.

- **Change request 1 (zsh `watch` gap):** confirmed fixed.
  - Re-ran `node bin/concertino completion zsh` directly (not trusting the
    round-1 output): the `args_map`/`case $words[2]` switch still has no
    `watch` entry and no default branch today (pre-change) — reproducing the
    original finding.
  - `design.md`'s Non-Goals now correctly states fish/bash's global claim
    while explicitly carving out zsh as "the exception" needing "a new
    `watch` entry."
  - `tasks.md` §2 now has 2.5: "Add a `watch` entry to `args_map` offering
    `--out`/`--config` only, mirroring the existing `validate|doctor|upgrade`
    pattern."
  - `ticket.md`'s zsh AC now reads "**and for `watch`**" with the correct
    rationale, and `spec.md`'s "watch completes --out/--config in every
    shell" scenario now states the zsh mechanism explicitly ("via a
    dedicated `watch` entry in `args_map`").
  - All four artifacts (ticket/design/spec/tasks) now agree — this isn't
    just matching words, the actual mechanism (add one `args_map` key
    mirroring an existing pattern) is stated consistently and is
    implementable as written.

- **Change request 2 (bash `--sub`/`--total` COMPREPLY case missing from
  tasks):** confirmed fixed.
  - `design.md`'s Decisions section still states the `COMPREPLY=()`
    decision for `--sub`/`--total`, unchanged from round 1.
  - `tasks.md` §3 now has 3.3: "Add a `--sub|--total) COMPREPLY=() ;;` case
    to the `case "$prev"` switch (parallel to the existing `--run` case)."
  - Re-read `lib/cli/completion.js`'s bash branch to confirm the precedent
    it's parallel to actually exists: line 63,
    `'    --run)      COMPREPLY=() ;;',` — present, unchanged. The new task
    is a faithful, mechanically identical addition.
  - `spec.md`'s "answer's --sub/--total take no suggested value in bash"
    scenario matches this task's outcome exactly.

- **Change request 3 (no automated regression coverage):** confirmed fixed.
  - `tasks.md` §4 now has 4.1: "Add `test/completion.test.js`
    (auto-discovered by `node --test`) asserting, for each shell, that the
    generated output (a) contains the new
    `prune`/`eject`/`migrate`/`answer`/`watch`(zsh-only) flag entries and
    the five exact role names, and (b) still contains the pre-existing
    `sync`/`diff`/`init`/`gates`/`completion` entries verbatim (or the
    specific substrings that matter)." This is specific enough to write
    directly (asserts both the new additions and protects the "unchanged"
    spec requirement against future regression, not just a one-time diff).
  - `ticket.md`'s AC list now has a dedicated bullet: "Automated regression
    coverage (`test/completion.test.js`, auto-discovered by `node --test`)
    asserts the new per-command entries are present in each shell's
    generated output and that the pre-existing ... entries remain
    unchanged." Matches the task and closes the gap the round-1 report
    identified (repo convention of a dedicated automated-test task for
    real conditional-logic changes).
  - Old task 4.1 (manual diff) is renumbered 4.2 and retained as a
    secondary check — not a replacement for the automated test, additive.

- **Independent re-verification of underlying facts** (not just re-reading
  the narrative, to rule out this being a documentation-only patch that
  doesn't actually match the code):
  - `node bin/concertino completion zsh` (above) — zsh `watch` gap is real,
    pre-existing, matches the design's premise.
  - `lib/cli/completion.js` bash branch — `--run) COMPREPLY=() ;;` precedent
    is real (line 63); flag-name catch-all (line 65) has no `--role`,
    `--sub`, `--total` yet, matching task 3.1's premise; `--dry-run` is
    already present generically, matching task 3.4's "no change needed."
  - `grep -n "role\|harness\|sub\|total"` in `lib/cli/eject.js` and
    `lib/cli/answer.js` — confirms `eject` takes `--role`/`--harness` and
    `answer` takes `--sub`/`--total` exactly as the design/spec claim, no
    hidden flags.
  - `node -e "console.log(Object.keys(require('./adapters/claude-code/agents.json').roles))"`
    → `[ 'orchestrator', 'executor', 'evaluator', 'skeptic', 'auditor' ]` —
    matches the hard-coded role list in `ticket.md`/`design.md`/`tasks.md`
    exactly, same as round 1.
  - `grep -i "TODO\|TBD\|figure out\|later\|placeholder"` across all five
    planning artifacts — no matches; no new hand-waving introduced by the
    revision.

- Re-traced every AC in the current `ticket.md` (fish 1.1–1.4, zsh
  2.1–2.5, bash 3.1–3.4, automated-test AC → task 4.1, "existing behavior
  unchanged" AC → `spec.md`'s third requirement + tasks 4.1/4.2) against
  `tasks.md` and `spec.md` — every AC now maps to a task and every task
  traces back to an AC or a design decision. No orphaned tasks, no
  uncovered ACs, no scope drift beyond the ticket.

### Verdict: CONFIRM

All three round-1 change requests are genuinely fixed — not just
lexically present but mechanically consistent across ticket/proposal/
design/spec/tasks, and independently re-verified against the actual
pre-change behavior of `lib/cli/completion.js` and the four other command
files. No new placeholders, contradictions, or ambiguities were introduced
by the revision.

### Non-blocking notes

- Same as round 1: `docs/cli-audit-2026-08.md` task 4.4's "if the doc
  tracks per-finding status" hedge remains correct (the audit doc has no
  live status field), and the zsh `args_map` grouping freedom for
  `prune`/`migrate` (share a key or not) remains a reasonable
  implementation-detail choice, not a design gap.
- `tasks.md` 4.1's test task doesn't prescribe exact assertion granularity
  (full-string vs. substring match) — left as "verbatim (or the specific
  substrings that matter)," which is a reasonable implementer judgment call
  given the fish/bash lines are long single strings; not blocking.
