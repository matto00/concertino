## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
  `specs/cli-harness-flag/spec.md` in full.
- Cross-checked design.md's factual claims about current code against the
  actual worktree source:
  - `lib/cli/sync.js:32` — `const harnesses = args.harness ? args.harness.split(',') : c.harnesses;`
    matches design's Context section verbatim.
  - `lib/cli/diff.js:63` — same pattern, matches.
  - `lib/cli/eject.js:18,34,51,67,77` — `args.harness || 'claude-code'` plus
    the `claude-code`/`codex`/`opencode`/`else` strict-equality if/else-if
    chain, matches design's description of eject's current single-value
    behavior, including the codex role-restriction error text
    (`'codex harness only has executor, evaluator, and auditor'`, line 53)
    and the "unknown harness" fallback error (line 78).
  - `lib/cli/shared.js` — confirmed no `parseHarnessList` exists yet, and
    that every existing exported helper there is a pure function (no
    `process.exit` calls), supporting Decision 1's "would be the only
    side-effecting helper" claim.
  - `lib/cli/help.js:23,45,78` and `README.md:92,104,131` — confirmed
    `sync`/`diff` already show `--harness=claude-code,codex,opencode` and
    `eject` shows `--harness=claude-code|codex|opencode`, exactly as the
    ticket and design describe.
  - `test/scripts/opencode-render.test.sh:91,96` — confirmed this is the one
    caller of `eject --harness=<single value>` in the repo (grepped
    `test/` and `scripts/` for `harness=`; no other `eject --harness=`
    caller exists, and no test passes an intentionally-invalid `--harness`
    to `sync`/`diff` — both match the Risks section's grep claims).
  - `test/completion.test.js:70,90,91` — confirmed the completion
    assertions are exact-string matches for the current (non-comma-aware)
    completion shape for `eject`/`sync`/`diff --harness`, supporting
    Decision 6's "untouched" claim.
  - `adapters/claude-code/agents.json`'s `roles` keys and
    `lib/cli/emit.js`'s `OPENCODE_ROLES` constant — both are the identical
    5-role set (`orchestrator, executor, evaluator, skeptic, auditor`). This
    is the fact that surfaces the gap below.
- Traced the ticket's acceptance intent (unify `--harness` parsing across
  `sync`/`diff`/`eject`, make `eject` act on a list) against
  `specs/cli-harness-flag/spec.md`'s requirements/scenarios — the harness-
  name-validation and multi-harness-output requirements are traceable to
  concrete scenarios and tasks (1.1–3.6, 5.1–5.7).

### Verdict: REFUTE

### Change Requests

1. **`design.md` / `tasks.md` — undecided behavior when `--role` itself is
   invalid across a multi-harness `eject` list; conflates two different
   kinds of "role not supported" and risks duplicate/confusing errors.**

   Ground truth: `eject`'s current per-harness branches enforce role
   validity in two genuinely different ways that the design does not
   distinguish:
   - `claude-code` and `opencode` both check `meta.roles[role]` — the same
     fixed 5-role set (`adapters/claude-code/agents.json`'s `roles` keys ==
     `lib/cli/emit.js`'s `OPENCODE_ROLES`). A role not in this set is
     **globally invalid** — not a harness-specific capability gap — and
     today it hard-fails immediately (`eject.js:38-40`, `:70-72`) with
     `unknown role "<x>" — valid: ...`.
   - `codex` checks against a narrower, genuinely harness-specific subset
     (`executor`/`evaluator`/`auditor`) — this *is* a real per-harness
     capability difference, which Decisions 4/5 correctly design a
     skip-and-continue mechanism for.

   `tasks.md` 3.2 says the per-harness render function returns "the
   rendered string (or `null` + a stderr note when the role isn't supported
   by that harness — the existing codex role-restriction check moves here
   unchanged)" — worded broadly enough to cover *all three* branches'
   error conditions uniformly, not just codex's. If an implementer follows
   this literally, a genuinely-typo'd `--role` (e.g.
   `eject --role=bogus --harness=claude-code,opencode`) would print the
   *same* "unknown role" stderr note once per harness in the list (since
   both claude-code's and opencode's checks hit the identical
   `meta.roles[role]` failure independently), then fall through to "zero
   harnesses produced output → exit 1" — duplicate, confusing output for
   what is actually a single, harness-independent input error.

   This is inconsistent with the design's own stated philosophy elsewhere:
   Decision 1 deliberately validates `--harness` **once, upfront, before any
   per-harness work**, producing "a single clear error naming the invalid
   value(s)" specifically so a bad input isn't reported once per affected
   downstream branch. Role validity against the fixed 5-role set is exactly
   analogous — a global input check, not a per-harness capability
   difference — yet the design routes it through the per-harness
   skip-and-continue path instead.

   Required revision: `design.md` needs an explicit decision (and
   `tasks.md`/`spec.md` a corresponding task/scenario) that:
   - Validates `--role` against the known 5-role set **once, upfront**
     (independent of which/how many harnesses are named), hard-failing
     immediately with a single error if invalid — mirroring Decision 1's
     treatment of `--harness`.
   - Reserves the per-harness skip-and-continue mechanism (Decisions 4/5)
     strictly for codex's genuine capability restriction (a role that *is*
     in the 5-role set but that codex specifically doesn't support).

   Without this, an implementer has no unambiguous spec to follow for this
   case, and the literal reading of task 3.2 produces the duplicate-error
   behavior described above — not tested anywhere in `tasks.md` §5 or
   `spec.md`'s scenarios, which only cover the codex-specific
   unsupported-role case (5.4/5.5), never a role that's invalid for every
   harness in the list.

### Non-blocking notes

- The pre-existing `args.harness` boolean-flag edge case (`--harness` passed
  with no `=value`, which currently sets `args.harness = true` and would
  make today's `args.harness.split(',')` throw a `TypeError`) is unaffected
  either way by this design — `parseHarnessList`'s documented contract
  ("`raw` is a string or `undefined`") doesn't account for it, but since the
  crash is identical before and after this change, it's out of scope here,
  not a new regression. Worth a one-line mention in design.md's Context so
  a future reader doesn't mistake it for something this change was supposed
  to harden.
- Once Change Request 1 is resolved, the rest of the design is sound: the
  accept-a-list vs. rename tradeoff (Non-Goals) is well-reasoned and matches
  the ticket's stated blast-radius concern; the shared helper's pure-function
  contract (Decision 1) is consistent with every other `lib/cli/shared.js`
  helper; the single-harness byte-for-byte-unchanged requirement is
  traceable to a concrete task (3.4) and test (5.2/5.7) against the one
  real caller (`test/scripts/opencode-render.test.sh`); and Decision 6's
  "completion.js untouched" claim checks out against the actual completion
  test assertions.
