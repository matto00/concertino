## Skeptic Report — final gate (round 2)

### What I verified (with evidence)

- **Read round-1 report fresh** (this is a cold spawn) at
  `.concertino/runs/CON-51/evidence/.../skeptic-final-1.md` to recover the
  single Change Request: `design.md` §Decisions/4 and
  `core/roles/orchestrator.md`'s fold-in steps needed to explicitly resolve
  the `specs/` delta collision that made re-archiving a fold-in change abort
  (`"<header> ... - already exists"`), which I had reproduced against two
  real archived changes in round 1.

- **Read the fix as landed** (commit `95a37d7`), not the commit message's
  narrative:
  - `design.md` §Decisions/4 item 6 (lines 189-216) now states explicitly:
    before re-archiving, state whether the fold-in's `design.md` revision
    introduced any new/modified spec requirement; if not, re-archive with
    `--skip-specs`; if so, first prune the change's `specs/<capability>/
    spec.md` delta file(s) down to just the new scope (removing the
    already-merged entries) before a normal re-archive. Explicitly forbids
    defaulting to `--skip-specs` unconditionally.
  - `core/roles/orchestrator.md` lines 489-518 (the fold-in sub-procedure's
    step 6) states the identical two-branch instruction, tied to the same
    "did step 2 add a new/modified spec requirement" test.
  - Both texts also now correctly describe "move the directory back" (not
    "copy") and the archive/restore lifecycle — no residual hand-waving.

- **Independently reproduced both fix paths myself**, fresh, in a throwaway
  scratch clone (not trusting the executor's task-6.1 narrative) using the
  real archived `force-escalation-ticket-ambiguity` change from this repo:
  - **Reconfirmed the original break still reproduces** on a naive
    `openspec archive <name> --yes` after moving the archived change back
    unmodified: `escalation-context ADDED failed for header "... sixth
    kind, ticket-ambiguity" - already exists` / `Aborted. No files were
    changed.` — the collision is real, not fixed by coincidence.
  - **Scenario A (no new spec requirement):** moved the change back via
    `mv` (matching the documented verb), left `specs/` untouched, ran
    `openspec archive <name> --yes --skip-specs` → `Change ... archived as
    '2026-08-01-force-escalation-ticket-ambiguity'.` — clean.
  - **Scenario B (a new spec requirement was added):** moved the change
    back via `mv`, replaced `specs/escalation-context/spec.md`'s delta with
    *only* a new requirement (pruning the already-merged sixth-kind entry,
    per the documented instruction), deleted the `specs/ticket-drafting-
    escalation/` delta entirely (no new scope there), ran `openspec archive
    <name> --yes` (no `--skip-specs`) → `Specs to update: escalation-context:
    update` / `+ 1 added` / archived cleanly. Confirmed the canonical
    `openspec/specs/escalation-context/spec.md` now contains the new
    requirement exactly once, and the previously-merged sixth-kind
    requirement is still present exactly once (not duplicated, not lost).
  - Both paths work as documented. Change Request 1 is genuinely fixed, not
    just narrated.

- **Both non-blocking notes from round 1 also addressed:**
  - `design.md`'s stale "in the *current* change's `openspec/changes/
    <CHANGE_NAME>/` directory" prose is gone — `grep -n "current.*change.*
    openspec/changes"` on the revised `design.md` returns nothing; the text
    now describes the archive/restore handling throughout.
  - `triage-followup.sh` is now listed in both `core/scripts/README.md:57`
    and `scripts/concertino/README.md:57` (identical rows).

- **Gates re-run myself, fresh, not trusted from any prior report:**
  - `npm test` → exit 0, `grep -c "^not ok"` on the full captured log → `0`.
    (Spot-checked tail output directly, not summarized secondhand.)
  - `openspec validate follow-up-triage-classification --strict` →
    `Change 'follow-up-triage-classification' is valid`.

- **Scope re-confirmed, nothing regressed.** `git diff e92a0ad...HEAD --stat`
  (this ticket's own commits, isolated from the stacked CON-49/CON-50
  history exactly as in round 1) now shows 20 files / 1972 insertions — the
  round-1 file set plus exactly the round-2 fix's own files (`design.md`,
  `evaluation-1.md` unchanged, `skeptic-final-1.md` added as evidence,
  `tasks.md`, `workflow-state.md`, both README tables, `orchestrator.md`).
  No unrelated files touched. `core/scripts/triage-followup.sh` and
  `scripts/concertino/triage-followup.sh` remain byte-identical (`diff` →
  no output) — untouched by the round-2 fix, as expected since the CR was
  documentation-only.
  - Sync verified: `git status --short .claude/agents/concertino-
    orchestrator.md` → clean (no diff against the synced source), and
    `grep -n "skip-specs" .claude/agents/concertino-orchestrator.md` finds
    the same fix text — the rendered agent file genuinely reflects the
    edit, not just the source `core/roles/orchestrator.md`.

- **UI review — still genuinely N/A, re-confirmed not assumed.**
  `concertino.config.json` → `"ui": { "enabled": false, "tool": "none" }`
  (re-read, unchanged from round 1). `git show 95a37d7 --stat` touches no
  frontend files (`.tsx`/`.jsx`/`.css`/`src/`) — confirmed via grep, no
  matches. No dev-server/screenshot phase applies.

### Verdict: CONFIRM

### Non-blocking notes

- None new. Both round-1 non-blocking notes (stale archive-path prose,
  missing README row) are now resolved rather than merely carried forward.
