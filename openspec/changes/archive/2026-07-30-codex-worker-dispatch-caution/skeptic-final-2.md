## Skeptic Report — final gate (round 2)

Reviewed cold from ground truth. I read `skeptic-final-1.md` and `evaluation-1.md`
as claims only, and re-derived every conclusion from the files, the diff, and a
real render.

### What I verified (with evidence)

**Diff / scope.** `git diff main...HEAD` on branch
`task/codex-worker-dispatch-caution/CON-38`, HEAD `ba80c63` (amended commit,
2026-07-30 01:10:43). Exactly one non-artifact file changed:
`adapters/codex/agent.toml.tmpl`, +4 lines, every one of them a `#` comment. No
scope drift; nothing else in `adapters/`, `bin/`, `core/`, or `lib/` touched.
`git status --short` shows only the untracked `evaluation-1.md` /
`skeptic-final-1.md` and a modified `workflow-state.md` — no stray edits.

**The comment as it now stands** (`adapters/codex/agent.toml.tmpl:5-8`):

```
#
# IMPORTANT: If using worker-dispatch via .codex/agents/*.toml + spawn_agents_on_csv,
# see the sub-agent-orphaning note in AGENTS.md: wait for report_agent_job_result
# before ending your turn, or the dispatched worker is orphaned.
```

**Round-1 CR#1 (pointer must name a file that exists in a consuming project) —
resolved, verified by rendering, not by reading.** Built a scratch config
(`harnesses: ["codex"]`, project `ScratchProj`) from this repo's own
`concertino.config.json` and ran `node bin/concertino sync --config=... --out=...`.
The generated tree contains `AGENTS.md`, three `.codex/agents/*.toml`, and
`.codex/prompts/`; `ls <out>/header.md` and `ls <out>/adapters` both return *No
such file or directory*, confirming the round-1 finding that `header.md` never
ships. The comment now names `AGENTS.md`, which **does** exist in the output — and
is guaranteed to, since `bin/concertino:1000` lists `AGENTS.md` as a required
artifact whenever the codex harness is enabled. It is also now consistent with
line 3 of the same file ("see AGENTS.md").

**Round-1 CR#2 (drop the hardcoded line numbers) — resolved, verified on *both*
render paths.** The `(lines 26-31)` citation is gone, replaced by the non-numeric
anchor "the sub-agent-orphaning note". I exercised both branches of
`bin/concertino:641/643`:

- *Fresh* `AGENTS.md` (`full = blockText`): the note renders at
  `grep -n "sub-agent" <out>/AGENTS.md` → lines **19–31**.
- *Append* path (pre-existing `AGENTS.md` without CONCERTINO markers,
  `cur.trimEnd() + '\n\n' + blockText`): the same note renders at lines
  **26–38** — shifted, exactly the failure mode round 1 identified.

The comment is byte-identical across both renders (`diff` of the two generated
`concertino-executor.toml` → IDENTICAL) and correct in both, because it no longer
depends on numbering. The anchor resolves: searching the rendered `AGENTS.md` for
`orphan` or `sub-agent` lands on the note ("**A note on never ending your turn
with a sub-agent outstanding.**", and again in the harness block at line 100/107,
which states the same worker-dispatch caution). Unambiguous either way.

**AC 1 — "carries a short comment pointing at the sub-agent-orphaning caution
(wait for `report_agent_job_result` before ending your turn), rather than relying
solely on the reader having also read `header.md`." MET.** Verified against the
*generated* artifact, not the template: `head -14
<out>/.codex/agents/concertino-executor.toml` shows the comment present in the
shipped file, and it states the actionable instruction inline
("wait for report_agent_job_result before ending your turn, or the dispatched
worker is orphaned") so a reader of the `.toml` in isolation gets the caution even
without opening `AGENTS.md`. The comment renders into all three worker tomls
(executor, evaluator, auditor). This satisfies the Linear ticket's own wording
("rather than relying solely on the reader having also read `header.md`") more
completely than the round-1 version did, since a consumer has no `header.md` at
all.

**AC 2 — "No behavioral/rendering change — comment only." MET, proven by
construction.** I rendered the same scratch config twice: once with
`bin/concertino` from HEAD, once from a clean `git archive main` extraction.
`diff -ru <base-out> <head-out>` returns **only** the identical 4-line comment
hunk in the three `.codex/agents/*.toml` files — `AGENTS.md`, the prompts, the
scripts, the laws, and every `name`/`description`/`model` line are byte-identical.
I also parsed all three generated tomls with Python `tomllib`: each loads cleanly
with keys `['description','developer_instructions','max_depth','model','name',
'sandbox_mode']` and the expected values (`name = concertino-executor`,
`model = codex-mini-latest`, `max_depth = 1`, non-empty
`developer_instructions`). Comments are inert; nothing parses or re-emits them.

**Gate re-run (not taken from the evaluator, which asserted rather than pasted).**
Ran `npm test` fresh, twice. Both runs `EXIT=0`. Second run filtered for failures
(`grep -Ei "^\s*(not ok|FAIL|✗)|[1-9][0-9]* failed"`) — the single match is the
*test name* `3.1 failed CI names the check as failed, not pending`, not a failure.
Stable, reproduced pass. Also ran `node bin/concertino doctor` → `EXIT=0`,
`environment ready` (the one warning is a pre-existing missing `.mcp.json`,
unrelated). Grepped `test/` for `agent.toml.tmpl` / `spawn_agents_on_csv` — no
test asserts on the old comment text, so nothing was silently made stale.

**Iron Laws.** `verification-before-completion` — I ran every verifying command
myself and read its output/exit code; nothing here rests on another agent's
narrative, and the one gate was reproduced before I relied on it.
`systematic-debugging` — N/A: this is a documentation-comment addition, not a bug
fix, so no probe/root-cause/regression-test obligation attaches.

**UI review.** N/A — `concertino.config.json → ui.enabled: false`; no UI surface
exists in this change (a TOML comment). Servers not started, per role instruction
that UI judgment is N/A for this project.

**Noted and excluded per orchestrator instruction:** `openspec validate` reporting
"no deltas found" for this comment-only change. Not treated as a defect.

### Verdict: CONFIRM

Both round-1 change requests are genuinely fixed, not papered over: the pointer
names a file that provably exists in a rendered consuming project, and the
reference survives both AGENTS.md render paths and any future re-wording of the
note. Acceptance criteria trace to verified evidence in the *generated* artifact.
The gate is green and reproduced. Ships.

### Non-blocking notes

- **Stale planning artifacts describe the superseded round-1 approach.** The code
  is right; three docs still say the comment points at `header.md`:
  - `files-modified.md:1` — "Added comment pointing at the sub-agent-orphaning
    caution in **header.md**". This is now factually wrong about the shipped
    change, and `core/roles/executor.md:82` explicitly requires this file be
    "overwrite[n] on re-runs to reflect the current state". One-word fix.
  - `tasks.md:3` — task 1.1 is marked `[x]` but reads "pointing at
    `adapters/codex/header.md`'s sub-agent-orphaning caution"; the delivered work
    points at `AGENTS.md`.
  - `design.md` Decisions — "pointing at `header.md`'s existing explanation".
    (The Context section's reference to `header.md` lines 26-31 as the *source*
    of the prose is accurate and should stay.)
  Not blocking: these are archived planning records, the auditor verifies against
  the diff and the ACs rather than this prose, and no consumer-visible artifact is
  affected. But they should be corrected before archive so the record matches
  what shipped.
- `docs/harness-capabilities.md:123-124` says "`adapters/codex/header.md`
  documents this same caution so the two stay in agreement" — still true, just no
  longer exhaustive now that there is a third copy of the caution. Out of scope
  for this ticket; worth a sentence if that doc is next touched.
- `agent.toml.tmpl:4` still says "dispatch the executor/evaluator as workers",
  omitting the auditor, even though `bin/concertino` renders a
  `concertino-auditor.toml` (confirmed in my scratch render). Pre-existing
  staleness, flagged before in
  `openspec/changes/archive/2026-07-29-agent-merge-role/evaluation-1.md`, and
  re-raised by the round-1 skeptic. Still out of scope, still cheap to fold in
  someday.
