## Evaluation Report — Cycle 3 (evaluation-3.md)

Resume note: this is a re-evaluation focused specifically on the two round-2
skeptic REFUTE defects fixed in commit `8860195`. Planning artifacts were not
re-read (stable); only the diff and current file state were reviewed against
ground truth.

### Phase 1: Spec Review — PASS

Issues: none.

- `openspec/changes/gate-escalation-on-tui-liveness/design.md` Decision 2 gained
  the "Structural note" clarifying `TUI_ATTACHED` is checked *within* the
  topology split, not as a bypass of it — matches the implemented text.
- `specs/escalation-bubble-up/spec.md` was rewritten to state the
  topology-first, TUI-second ordering explicitly, with a new scenario for the
  no-TUI Claude Code subagent case. Read in full; matches implementation.
- `tasks.md` all 18 items complete and match what shipped.

### Phase 2: Code Review — PASS

Issues: none.

Verified both round-2 defects against the current files (not the executor's
self-report):

**Defect 1 — `core/roles/orchestrator.md` "How to raise one" (lines
1128–1227).** Confirmed the restructured text: "decide how you wait for the
answer — by topology (CON-76) first, with `TUI_ATTACHED` changing what *that*
topology branch does at its own resolution step — never the other way
around" (line 1128). The root branch (lines 1136–1192) is the only place
`TUI_ATTACHED` gates behavior (`--await` when 1, `--raise-only` + chat +
`concertino answer` when 0). The Claude Code subagent branch (lines
1194–1227) explicitly reads "raise it **without blocking**, regardless of
`TUI_ATTACHED`" and unconditionally: calls `--raise-only` (line 1207),
persists `PENDING_ESCALATION` to `workflow-state.md` (step 1, line 1214), and
returns `ESCALATION-PENDING` (step 2, line 1218) — no `TUI_ATTACHED`
conditional anywhere in that branch. This closes the round-2 hang scenario
(a no-TUI subagent silently told to "wait in chat" in an unreachable
transcript).

The root's resolution procedure (lines 1339+) gained step 1a: a fresh
`tui-attached.sh` re-check at resolution time, independent of whatever
`TUI_ATTACHED` value (if any) was observed at raise time, gating whether
step 2's `--wait-only` polling loop runs at all.

**Defect 2 — `adapters/claude-code/command.md` second, independent
resolution-loop implementation.** Confirmed lines 64–141: step 2 now reads
"Re-check TUI liveness fresh, right here, before polling — never reuse
whatever `TUI_ATTACHED` value ... was observed when the escalation was
raised," with an explicit `if scripts/concertino/tui-attached.sh; then ...`
branch — TUI attached polls `--wait-only` as before; TUI not attached skips
the polling loop entirely per lines 93–94. This is the file the actual root
(`/concertino-deliver` top-level session, non-`--inline` default topology)
follows, and it previously had no TUI-liveness gate — matches the round-2
finding exactly, and is now fixed.

**Adapter isolation check.** `git diff main...HEAD --stat -- adapters/`
shows only `adapters/claude-code/command.md` touched (24 insertions/6
deletions). `grep -rn "tui-attached|TUI" adapters/codex adapters/opencode`
returns no matches — the fix is correctly scoped to the Claude Code adapter
only and does not leak into or omit-from the other harnesses (those adapters
have no equivalent second call site to begin with per the ticket's scope).

**Gates (fresh run, not trusted from executor report):**
- `bash test/scripts/tui-attached.test.sh` → 10 passed, 0 failed (including
  the mutation check at 9.1).
- `npm test` (full suite, run to completion by me) → exit code 0, no
  failures across the entire suite (squash-branch, check-gate-chain-change,
  test-gate-in-isolation, tui-attached, and the broader JS/TS test files).

**Untracked files note.** `scripts/concertino/pricing-table.json` and
`scripts/concertino/report-cost.sh` appear untracked in `git status` — per
`files-modified.md` these predate this change (CON-108) and were simply
never synced into this worktree before; not modified/authored as part of
CON-126. Confirmed these are not part of the diff (`git diff
main...HEAD --stat` doesn't include them) and don't affect either defect's
fix. No scope creep.

### Phase 3: UI Review — N/A

No `frontend/**`, `backend/src/main/scala/routes/ApiRoutes.scala`,
`schemas/**`, or `openspec/specs/**` changes — this change touches only
`core/`, `adapters/claude-code/`, `scripts/concertino/tui-attached.sh`,
`test/scripts/`, and `package.json`. No dev servers required.

### Overall: PASS

### Non-blocking Suggestions

- None beyond the skeptic's own already-recorded non-blocking notes
  (line-1218 multi-part example parenthetical, `tui-attached.sh`
  `--out=DIR` divergence) — both already assessed as accepted/out-of-scope
  and not reproduced as defects here.
