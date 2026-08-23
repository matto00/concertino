## Skeptic Report — final gate (round 3, skeptic-final-3.md)

Derived from ground truth only: `git diff main...HEAD`, the files themselves,
a live run of the new script, and a full `npm test` run. Prior reports read as
claims, not facts.

### What I verified (with evidence)

**1. Topology decided first; subagent branch unconditional — CONFIRMED.**
Read `core/roles/orchestrator.md` "How to raise one" in full (fresh). Order is:
(a) gather context, (b) **present to chat, unconditional**, (c) compute
`TUI_ATTACHED` into a variable, (d) branch **on topology**. The branch structure
is: root → nested `TUI_ATTACHED=1` / `TUI_ATTACHED=0` sub-branches; Claude Code
subagent → "raise it **without blocking**, regardless of `TUI_ATTACHED`", always
`--raise-only`, always `PENDING_ESCALATION` + `ESCALATION-PENDING`. The text
additionally states the invariant explicitly: "do not let `TUI_ATTACHED=0`
short-circuit past the topology check itself, or a non-root run silently loses
its only path to the human (CON-76)". Round-2 defect (a) is genuinely fixed —
there is no path on which a subagent takes a "wait in chat" branch.
(`TUI_ATTACHED` is *computed* before the topology test, but it is only ever
*consulted* inside the root branch — the failure mode the round-2 REFUTE named,
a TUI-first split, does not exist.)

**2. `adapters/claude-code/command.md` resolution loop — CONFIRMED.**
Read the diff and surrounding text. Step 2 now re-checks
`scripts/concertino/tui-attached.sh` fresh before any `--wait-only`, with an
explicit two-branch split: attached → the previous polling loop verbatim
(exit 2 loop / exit 0 resolved / exit 1 deadline, "never an approval");
not attached → "skip the `--wait-only` polling loop entirely" and wait in chat.
The gate is a real `if scripts/concertino/tui-attached.sh; then ... --wait-only`
construction, not prose only. Step 3 (`concertino answer`) unchanged.

**3. Other adapters untouched — CONFIRMED by my own grep.**
`git diff main...HEAD --stat` touches only `adapters/claude-code/command.md`
under `adapters/`. `grep -rn "escalation\b" adapters/codex adapters/opencode`
returns nothing at all — those adapters carry no escalation content to gate.

**4. Whole-repo call-site sweep (my own, not the prior claim) — one finding,
out of scope (see notes).** `grep -rln "escalation --await|--raise-only|
--wait-only"` across the entire repo, excluding `.git`/`node_modules`, yields
live (non-doc, non-archive) hits in: `core/roles/orchestrator.md` (gated),
`adapters/claude-code/command.md` (gated), `emit-event.sh` (the implementation
itself), `gather-escalation-context.sh` + `triage-followup.sh` (comment
references only — verified by line inspection, no invocation), and
`core/scripts/cleanup.sh:345` — a **real, ungated blocking `--await`** in the
Phase-4 fast-forward-failure path. That site is outside this ticket's written
Scope ("gate ... at the orchestrator's single raise call site") and outside
design.md's stated goal; it is a script-level escalation, not the orchestrator's
raise path. Logged as a non-blocking note / spinoff, not a change request.
The follow-up-triage step 4 (round-1 defect) now routes through "How to raise
one ... in full", constructing no bespoke invocation — verified in the diff.

**5. "A timeout is never an approval" on every branch — CONFIRMED.**
Root/TUI-attached `--await` non-zero exit: "**A timeout is never an approval —
never treat it, or silence, as one.**" Root/no-TUI: no deadline exists in the
branch, stated explicitly. Resolution loop exit 1: "a timeout is never an
approval, but you already presented the question in chat". Adapter no-TUI
branch: same statement. The "When to stop doubting an answer" off-ramp still
carries "**This covers answers, never timeouts.**"

**6. Ambiguity resolves to "no TUI" — CONFIRMED at code level.**
`core/scripts/tui-attached.sh`: unresolvable main checkout → `exit 1`; missing
lockfile → `exit 1`; unparsable JSON or non-numeric `pid` → `exit 1`; only a
confirmed-live pid exits 0. EPERM counts as alive, matching
`lib/ui/watch-lock.js`'s `pidAlive()` (deliberately not bash `kill -0`, whose
EPERM semantics differ — documented in the header). `heartbeatAt` is never read.
Live run in this worktree: `./scripts/concertino/tui-attached.sh` → exit 1 (no
dashboard attached), i.e. the safe direction.
`core/scripts/tui-attached.sh` and `scripts/concertino/tui-attached.sh` are
byte-identical (`diff` clean, same blob `324d0ea`), both mode `100755`. `concertino
sync` copies `core/scripts/**` recursively (`lib/cli/emit.js:447-449`, no
manifest), so the new script renders automatically — no missing registration.

**7. `npm test` re-run by me — PASSES.** Exit code 0. Includes the new
`tui-attached.sh` suite: 10/10, covering live pid, missing lockfile, dead pid,
torn JSON, missing/non-numeric `pid`, EPERM-live pid, non-git-repo, worktree
resolution, **and a mutation check** proving the dead-pid case would flip if the
liveness check were removed (i.e. the test actually exercises the guarded path).

**8. Acceptance criteria traced.**
- Single documented signal consulted before `emit-event.sh` — `tui-attached.sh`
  + `specs/tui-liveness-detection/spec.md`; consulted in orchestrator.md's raise
  step and the resolution loop. MET.
- No blocking `--await` with no TUI, reaches human in chat immediately — chat
  presentation is unconditional and precedes everything; the no-TUI root branch
  calls only `--raise-only`, which `emit-event.sh`'s own header documents as
  "return immediately, exit 0, no polling" (verified in the script). MET.
- TUI-attached behaviour unchanged — `--await` block, per-call `timeout: 600000`
  guidance, `TERM`/`INT` trap paragraph, CON-76 dual-channel, CON-46 wizard all
  present and unedited in the diff. MET.
- Timeout never an approval on either branch — item 5. MET.
- No-TUI path documented alongside the topology branch — item 1. MET.
- Staleness safe in the dangerous direction; ambiguity → no TUI — item 6. MET.
- `concertino answer` the single authoritative write path for chat-collected
  answers — no-TUI raise branch, resolution loop step 3, and the adapter all use
  it; the pre-existing `--await`-timeout raw-event fallback is explicitly called
  out as unchanged and out of this requirement's reach (spec scenario states
  this). MET.

No frontend/UI files are touched by this change (`git diff --stat` is docs,
shell scripts, and tests only), so the UI/design-judgment step does not apply.

### Verdict: CONFIRM

### Non-blocking notes
- `core/scripts/cleanup.sh:345` still calls `emit-event.sh escalation --await`
  unconditionally. With no dashboard attached this burns the full escalation
  timeout on a dead wait — the exact harm this ticket describes — but it is a
  script-level escalation outside the ticket's written Scope and design.md's
  goals. Worth a spinoff ticket to gate it (and to decide the no-answer
  behaviour: today `|| true` yields an empty `ANSWER`, which correctly falls
  through to "not retry", so it is safe, just slow).
- `openspec/changes/gate-escalation-on-tui-liveness/evaluation-3.md` is
  untracked in the working tree; commit it with the rest of the evidence.
- Untracked `scripts/concertino/pricing-table.json` / `report-cost.sh` exist in
  the worktree but are unrelated to this change (not in the diff).
