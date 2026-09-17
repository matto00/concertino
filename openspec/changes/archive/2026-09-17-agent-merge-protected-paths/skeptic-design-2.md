## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md` (not reproduced here in full —
  covered thoroughly in round 1 and unchanged in substance), `tasks.md`,
  `skeptic-design-1.md`, and the live delta
  `openspec/changes/agent-merge-protected-paths/specs/agent-merge-protected-paths/spec.md`
  in full.

- **CR1 (round 1's title/body mismatch) is genuinely resolved.** The two
  `## MODIFIED Requirements` headers now read "...evaluates the four
  machine-verifiable merge conditions" and "...merges only when every
  deterministic condition holds and the acceptance-criteria trace succeeds",
  each matching a `## RENAMED Requirements` `TO:` entry, and each body/scenario
  set is now internally consistent with its new title (spec.md:94–164).

- **RENAMED+MODIFIED pairing precedent claim (brief item 1) — confirmed.**
  `openspec/changes/archive/2026-08-08-local-provider-standalone-escalation/specs/followup-triage/spec.md`
  does carry `## RENAMED Requirements` (line 1) immediately followed by
  `## MODIFIED Requirements` (line 5) on the same requirement. Real, archived
  house pattern, not invented.

- **FROM: anchors byte match (brief item 2) — confirmed.** Compared
  `specs/agent-merge-protected-paths/spec.md:96` and `:98` against the live
  `openspec/specs/agent-merge/spec.md:27` and `:58` directly; both `FROM:`
  strings match the live requirement headers exactly, including punctuation.

- **`openspec validate` exit code (brief item 3) — confirmed exit 0**, and I
  went further per the brief's own suggestion: I copied the worktree to a
  disposable scratch dir
  (`/tmp/.../scratchpad/con193-archive-probe`) and ran
  `openspec archive "agent-merge-protected-paths" -y --json` against it twice
  (reproduced, not a one-off flake). **Both runs fail hard**, before touching
  any file:

  ```
  {
    "status": [{
      "severity": "error",
      "code": "archive_spec_update_failed",
      "message": "agent-merge-protected-paths: target spec does not exist; only ADDED requirements are allowed for new specs. MODIFIED and RENAMED operations require an existing spec.",
      "fix": "Fix the change delta specs and rerun. No files were changed."
    }]
  }
  ```

  **Root cause, structural, not cosmetic:** the entire delta — the `ADDED`
  requirements for the genuinely new `agent-merge-protected-paths` capability
  *and* the `RENAMED`/`MODIFIED` requirements that belong to the existing
  `agent-merge` capability — all live in one file at
  `openspec/changes/agent-merge-protected-paths/specs/agent-merge-protected-paths/spec.md`.
  OpenSpec resolves which spec a delta file's requirements target by the
  file's *directory path* under `specs/`, not by requirement content. Because
  the whole file sits under the `agent-merge-protected-paths` capability
  directory — which has no existing main spec (it's brand new) — every
  requirement in it, including the `RENAMED`/`MODIFIED` ones, is treated as
  targeting a spec that doesn't exist yet. `openspec validate` does not catch
  this (it only checks delta *syntax*, per the brief's own warning that
  validate does not prove archive-time matching); `openspec archive` does,
  and refuses outright. **This is not round 1's already-fixed title mismatch
  — it's a different, still-live defect:** the `RENAMED`/`MODIFIED` block
  needs its own file at `specs/agent-merge/spec.md` (mirroring the existing
  `agent-merge` capability directory), separate from the `ADDED`-only file
  under `specs/agent-merge-protected-paths/spec.md`.

  I confirmed the fix shape works structurally: splitting the file at the
  `## RENAMED Requirements` boundary into
  `specs/agent-merge/spec.md` (RENAMED+MODIFIED) and
  `specs/agent-merge-protected-paths/spec.md` (ADDED only, retained) in the
  scratch copy gets past the "target spec does not exist" error — but
  **surfaces a second, related defect** once that's fixed:

  ```
  ✗ [ERROR] agent-merge/spec.md: MODIFIED "check-merge-readiness.sh
    deterministically evaluates the four machine-verifiable merge conditions"
    omits scenario(s) the current spec still has: "All three conditions
    pass". Copy them into the MODIFIED block (a MODIFIED requirement
    replaces the whole block, so archive refuses to drop them).
  ✗ [ERROR] agent-merge/spec.md: MODIFIED "The auditor merges only when
    every deterministic condition holds and the acceptance-criteria trace
    succeeds, and escalates cleanly otherwise" omits scenario(s) the current
    spec still has: "All four conditions hold". ...
  ```

  This is the reworded-scenario-titles problem: the delta renamed
  `"All three conditions pass"` → `"All four machine-verifiable conditions
  pass"` and `"All four conditions hold"` → `"Every deterministic condition
  holds and the trace succeeds"` (spec.md:106, 141). OpenSpec's MODIFIED
  scenario reconciliation matches scenarios by **title string**, not
  semantic content — a MODIFIED requirement must retain every scenario title
  the current spec has, or archive refuses to drop it (even though the
  content is present under a new title). Both `openspec validate` and the
  first archive attempt were silent about this because the file-placement
  error masked it entirely; it only surfaces once placement is corrected.

- **Brief item 4 (MODIFIED blocks carry full original content)** — the split
  probe above confirms the *content* itself is complete (no validate content
  error once scenario titles are reconciled would be the only remaining
  issue); the missing piece is that renamed scenario titles need either to be
  reverted to their original titles or the original titles need to be
  explicitly retained/aliased. Not itself a content-completeness defect, but
  adjacent to it and must be fixed together with the file-placement issue.

- **Brief item 5 (cross-reference grep) — confirmed**, with a positive
  control: `grep -rn "three machine-verifiable" --include="*.md" .` (root:
  worktree root, excluding nothing beyond git's own tracked set) hits only
  `proposal.md:76` (the change's own prose, describing the old title — fine),
  `specs/agent-merge-protected-paths/spec.md:96` (the `FROM:` anchor, must
  stay verbatim), `skeptic-design-1.md` (a prior report, inert), and three
  hits under `openspec/changes/archive/2026-07-29-agent-merge-role/**`
  (historical, frozen) plus the live pre-change
  `openspec/specs/agent-merge/spec.md:27` (which the rename will retitle).
  Positive control: `core/roles/auditor.md:60` uses "the machine-verifiable
  conditions" with no numeral, confirming the grep pattern isn't
  over-broad/silently missing real hits elsewhere. No live cross-reference
  breaks.

### Verdict: REFUTE

CR1 from round 1 is resolved. This is a **new** defect found by going past
`validate` to the tool's own archive step, exactly as the brief invited —
`validate` exiting 0 was never proof the delta resolves at archive time, and
in fact it doesn't.

### Change Requests

1. **Split the single delta spec file by target capability.** Move the
   `## RENAMED Requirements` and `## MODIFIED Requirements` blocks (currently
   `specs/agent-merge-protected-paths/spec.md:94–164`) into a new file at
   `openspec/changes/agent-merge-protected-paths/specs/agent-merge/spec.md`,
   leaving only the `## ADDED Requirements` block (lines 1–92) in
   `specs/agent-merge-protected-paths/spec.md`. Without this, `openspec
   archive` fails hard with `archive_spec_update_failed` — reproduced twice
   in a disposable copy of this worktree; this is not a hypothetical.

2. **Reconcile the reworded scenario titles with the existing spec's
   titles**, once (1) is fixed. Either revert `"All three conditions pass"`
   / `"All four conditions hold"` back to their original titles (and instead
   only reword the numerals inside the body/steps, not the scenario
   headers), or explicitly account for why archive's
   scenario-title-preservation check should be satisfied another way. As
   currently worded, fixing (1) alone still fails archive with
   `archive_spec_update_failed: ... omits scenario(s) the current spec still
   has`. Verify the fix by rerunning `openspec archive
   "agent-merge-protected-paths" -y --json` against a disposable copy (not
   the live worktree) until it exits with no `archive_spec_update_failed`
   error, the same probe I used here.

### Non-blocking notes

- Round 1's other observations (glob-semantics table, malformed-glob
  fail-closed behavior, main-checkout precedent, exit-code-5 availability)
  were not re-litigated here since round 1 reproduced them directly and
  nothing in this round's diff touched those decisions; I have no reason to
  doubt them.
- Once CR1/CR2 above are fixed, rerun the full archive probe (not just
  `validate`) before the next skeptic round — `validate` passing is not
  sufficient signal for this class of change, and the discovery cost here
  was one `cp` + two commands.
