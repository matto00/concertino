## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/cli-harness-flag/spec.md`, and round 1's `skeptic-design-1.md` in
  full, fresh (not trusting round 1's narrative, only its cited ground
  truth, which I independently re-checked below).
- Cross-checked design.md's factual claims against current worktree source
  (unchanged since round 1, since this is still the design phase):
  - `lib/cli/eject.js:17-80` — `role`/`harness` variable assignment, the
    `claude-code`/`codex`/`opencode`/`else` if/else-if chain, the codex
    narrow-role check (line 52-55, `'codex harness only has executor,
    evaluator, and auditor'`), and the two "unknown role" checks for
    claude-code/opencode (lines 37-40, 69-72) via `meta.roles[role]` — all
    match design's description verbatim.
  - `lib/cli/sync.js:32` and `lib/cli/diff.js:63` — both still
    `args.harness ? args.harness.split(',') : c.harnesses`, matching
    design's Context section.
  - `lib/cli/shared.js` — confirmed `parseHarnessList` does not exist yet
    and every exported helper is a pure function (no `process.exit`),
    supporting Decision 1's "only side-effecting helper" rationale.
  - `adapters/claude-code/agents.json`'s `roles` keys
    (`['orchestrator', 'executor', 'evaluator', 'skeptic', 'auditor']`) and
    `lib/cli/emit.js:287`'s `OPENCODE_ROLES` constant — confirmed byte-
    identical 5-entry sets, which is the fact Decision 5a's "global 5-role
    set" check relies on.
  - `lib/cli/help.js:23,45,78,82-83` and `README.md:92,104,131` — confirmed
    current `sync`/`diff` show `--harness=claude-code,codex,opencode` and
    `eject` shows `--harness=claude-code|codex|opencode`, matching the
    ticket/proposal's stated starting point.
  - Grepped `test/` and `scripts/`/`core/` for `eject.*--harness` and
    `harness=`: `test/scripts/opencode-render.test.sh:91,96` remains the one
    caller of `eject --harness=<single value>`; `test/completion.test.js:70,
    90,91` confirms the exact-string completion assertions Decision 6 relies
    on to justify leaving `completion.js` untouched.

### Round-1 issue — confirmed resolved

Round 1's refute was: the design routed two different "invalid role" cases
(globally-invalid-for-every-harness vs. codex's narrower per-harness
restriction) through the same per-harness skip-and-continue mechanism,
which would print a duplicate "unknown role" note once per harness sharing
the global check (claude-code + opencode) before falling through to a
generic zero-output exit.

Verified the fix directly:
- `design.md` Decision 5a (lines 167-185) now states the global 5-role-set
  check happens **once, upfront, before iterating the harness list at
  all**, exits immediately with a single error, and is explicitly carved
  out of Decision 5b's per-harness mechanism — with an explanatory note
  that names the exact duplicate-output failure mode round 1 flagged and
  attributes it to that gate.
- `design.md` Decision 5b (lines 187-203) is now scoped strictly to
  codex's narrower `executor`/`evaluator`/`auditor` subset, operating only
  on an "already-known-valid" role (i.e., one that passed 5a).
- `tasks.md` 3.2a (lines 24-32) implements the global upfront check exactly
  as 5a describes, and explicitly instructs the implementer *not* to route
  it through 3.2b's per-harness mechanism. `tasks.md` 3.2b (lines 33-40) is
  correspondingly narrowed to "strictly for codex's narrower role
  restriction," with an explicit note that claude-code/opencode can no
  longer return `null` from the per-harness render function (since 3.2a
  already ruled out an invalid role for them) — this directly closes the
  original ambiguity in the old, broadly-worded task 3.2.
- `specs/cli-harness-flag/spec.md`'s new "eject validates --role globally,
  once, before per-harness rendering" requirement (lines 59-79) has two
  scenarios that directly test the previously-unspecified case: a
  globally-invalid role with a multi-harness list produces exactly one
  error (not once per harness), and the single-harness case is asserted to
  behave identically — closing the exact gap round 1's Change Request
  named ("not tested anywhere in tasks.md §5 or spec.md's scenarios").
  `tasks.md` 5.4a/5.4b are the corresponding test tasks.
- I traced this against the actual code fact that makes the original bug
  real: `meta.roles` (claude-code/opencode's role-validity source) and
  `OPENCODE_ROLES` are identical 5-role sets, confirmed above — so a role
  outside that set genuinely would have hit both branches' checks
  independently under the old task 3.2 wording. The new split correctly
  treats this as one global-validity fact, not two coincidentally-identical
  per-harness checks.

I checked the split for internal consistency across all downstream
artifacts (not just design.md): 5a and 5b are non-overlapping and jointly
exhaustive of the codex/claude-code/opencode role-check branches in
`eject.js` today (codex's `['executor','evaluator','auditor'].includes`
check at line 52 maps to 5b; the two `meta.roles[role]` checks at lines 37
and 69 map to 5a). No artifact contradicts another on this point.

### Other soundness checks (beyond the round-1 issue)

- Decision 4's alternative-considered note (uniform role support required
  across all named harnesses) is consistent with the now-corrected Decision
  5b — it correctly distinguishes "hard fail if any harness doesn't support
  an otherwise-valid role" (rejected) from "hard fail if the role itself is
  invalid" (Decision 5a, not what Decision 4's alternative was arguing
  against).
- Traced the full single-harness compatibility chain: task 3.4 (byte-for-
  byte no header for exactly one harness), test 5.2 (subprocess baseline
  vs. today), and 5.7 (existing `opencode-render.test.sh` invocation
  unmodified) all point at the one real caller confirmed above — sound.
- Task 5.6 (`eject --harness=bogus` with no `--role` given) relies on the
  harness-list validation (task 3.1, replacing the `harness = args.harness
  || 'claude-code'` assignment at its original source position, which sits
  before the pre-existing `!role` check in `eject.js`) firing before the
  unrelated "--role is required" check. This ordering isn't stated
  explicitly in design.md, but the natural reading of "replace X with Y" at
  the same code position produces it, and task 5.6 itself is the test that
  would catch an implementer who got this backwards — non-blocking, noted
  below rather than a Change Request.
- Confirmed `OPENCODE_ROLES` and `meta.roles` keys are identical (verified
  above), which is the load-bearing fact for Decision 5a's "one global
  5-role set" framing — not a design assumption resting on stale/unverified
  ground truth.
- No new placeholders, TBDs, or deferred decisions introduced by the round-2
  revisions; Decisions 5a/5b read as fully specified, not hand-waved.

### Verdict: CONFIRM

The round-1 defect is genuinely fixed, not just re-labeled: the global vs.
per-harness role-invalidity split is present and consistent across
design.md, tasks.md, and spec.md, with new test tasks (5.4a/5.4b) and
scenarios that specifically exercise the duplicate-error case that was
previously unspecified. I did not find a new issue of comparable severity
in this pass.

### Non-blocking notes

- Consider one sentence in design.md Decision 5a (or a task 3.2a note)
  making explicit that the `--harness`-list validation (3.1) is expected to
  run, and fire, before the pre-existing "--role is required" check —
  currently implicit in "replace X with Y at its original position" plus
  task 5.6's test expectations. Not blocking: a competent implementer
  following the literal task order gets this right, and 5.6 would catch a
  regression either way.
- Not covered by any task: `--harness=,` or `--harness=,,` (a raw value
  that is truthy but reduces to zero valid entries after trimming/dropping
  empties) isn't classified as an error by `parseHarnessList`'s described
  contract (only *invalid* entries produce `error`; an empty resulting list
  isn't described as one). This would silently produce a zero-harness
  no-op for `sync`/`diff` and an empty-result exit for `eject` — a minor
  edge case, same flavor as the already-acknowledged pre-existing bare
  `--harness` boolean-crash edge case noted in Context. Worth a one-line
  design.md mention or an explicit non-goal, but not blocking given its
  narrowness.
