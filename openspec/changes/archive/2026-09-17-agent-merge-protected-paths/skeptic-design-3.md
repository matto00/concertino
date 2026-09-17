## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

- Read `skeptic-design-1.md` and `skeptic-design-2.md` in full as claims to
  verify, then the live artifacts independently: `proposal.md`, `design.md`
  (Decision 6 in full), `tasks.md`, `workflow-state.md`, and both delta spec
  files in full.

- **File split by target capability (round 2 CR1) — confirmed done.**
  `openspec/changes/agent-merge-protected-paths/specs/agent-merge/spec.md`
  now holds only `## RENAMED Requirements` (two FROM:/TO: pairs) +
  `## MODIFIED Requirements` (the two requirement bodies with all their
  scenarios). `specs/agent-merge-protected-paths/spec.md` holds only
  `## Purpose` + `## ADDED Requirements`.

- **Scenario titles restored verbatim (round 2 CR2) — confirmed.**
  `#### Scenario: All three conditions pass` (line 13) and `#### Scenario:
  All four conditions hold` (line 48) in the split `agent-merge/spec.md`
  match the pre-change spec's titles exactly; the corrected condition counts
  live only in each scenario's `WHEN` text, exactly as `design.md` Decision
  6 claims.

- **Archive probe reproduced independently, in a disposable copy** (`cp -r`
  the worktree to a scratch dir, never the live worktree):
  `openspec validate "agent-merge-protected-paths" --type change` → exit 0,
  "Change ... is valid". `openspec archive "agent-merge-protected-paths" -y
  --json` → exit 0, `specsUpdated: true`, `totals: {added: 5, modified: 2,
  removed: 0, renamed: 2}` — matches the round-3 claim exactly.

- **Archived content completeness spot-checked.** In the archived output
  (`openspec/specs/agent-merge/spec.md` post-archive), both modified
  requirement headers are present with their new titles
  ("...evaluates the four machine-verifiable merge conditions" at line 256,
  "...merges only when every deterministic condition holds..." at line 291),
  and the two requirement blocks together carry 8 `#### Scenario` entries —
  all scenarios from the delta, none dropped.

- **FROM: anchors byte-matched against the live pre-change spec.**
  `sed -n '27p;58p' openspec/specs/agent-merge/spec.md` against `sed -n
  '3p;5p'` of the delta's `RENAMED` block — identical strings, confirmed
  directly (not re-trusting round 2's claim).

- **Decision 6's central claim — that retitling the two scenario headers
  re-breaks archive — reproduced, not just read.** In a second disposable
  copy, I reverted the round-3 fix by renaming the two scenario headers back
  to numerically-current titles ("All four conditions pass" / "Every
  deterministic condition holds") and reran archive: it fails immediately
  with `archive_spec_update_failed ... current spec contains scenario(s)
  not present in the modified block: "All three conditions pass"` — the
  exact failure mode Decision 6 describes. This corroborates the trade-off
  is a real tool constraint, not a rationalized shortcut, and that I could
  not find a better alternative either.

- **C1 promoted in both required places.** `workflow-state.md` line 35
  `CONSTRAINTS` carries C1 verbatim with `agreed_at: "design-gate"`.
  `tasks.md` lines 1–3 carry a matching `## Standing Constraints` section
  crediting round 2. Both present, consistent with each other.

- No new drift found elsewhere: `git status --short` in the worktree shows
  only the untracked change dir itself; nothing else touched since round 2's
  fixes.

### Verdict: CONFIRM

Both round 2 change requests are genuinely resolved, reproduced independently
against a disposable copy rather than trusted from the narrative. Decision
6's frozen-header trade-off is correctly reasoned and correctly documented,
and I independently confirmed there is no less-invasive alternative — any
retitle of those two scenario headers reproduces the exact
`archive_spec_update_failed` failure Decision 6 warns about. The design is
sound enough to implement.

### Non-blocking notes

- Round 1's other observations (glob-semantics table, malformed-glob
  fail-closed behavior, main-checkout precedent, exit-code-5 availability)
  were not re-litigated here; nothing in rounds 2/3 touched those decisions
  and round 1 already reproduced them directly.
- The promoted constraint C1 is a genuinely useful addition beyond this
  ticket — worth keeping in mind for any future spec-delta change that
  modifies/renames an existing requirement rather than only adding new ones.
