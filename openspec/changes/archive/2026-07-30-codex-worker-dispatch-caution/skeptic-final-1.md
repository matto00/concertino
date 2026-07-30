## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

**Diff / scope.** `git diff main...HEAD` — exactly one non-artifact file changed:
`adapters/codex/agent.toml.tmpl`, +4 lines, all `#` comments. Matches
`files-modified.md`. No scope drift. `git status --short` shows only the untracked
`evaluation-1.md`. Branch `task/codex-worker-dispatch-caution/CON-38`, HEAD
`f775b1f`.

**Gate re-run (not trusted from the evaluator).** `evaluation-1.md:29` asserts
"`npm test`: 1000+ tests passed" without pasted output, so I re-ran it myself,
twice. Second run captured: `EXIT=0`, and zero suite lines matching a nonzero
`N failed`. Test gate independently confirmed PASS.

**AC 2 — "No behavioral/rendering change — comment only."** MET. Rendered the
codex adapter for real rather than reasoning about it: built a scratch config with
`harnesses: ["codex"]` and ran `node bin/concertino sync --out=<scratch>`. All
artifacts wrote cleanly (`AGENTS.md`, three `.codex/agents/*.toml`,
`.codex/prompts/`). Generated `concertino-executor.toml` retains a well-formed
`name = "concertino-executor"` after the added comment block; comments are inert.
No rendering change.

**AC 1 — "carries a short comment pointing at the sub-agent-orphaning caution
(wait for `report_agent_job_result` before ending your turn), rather than relying
solely on the reader having also read `header.md`."** Substantively MET but the
pointer is broken. `adapters/codex/agent.toml.tmpl:6-8` does state the actionable
instruction inline ("wait for report_agent_job_result before ending your turn, or
the dispatched worker is orphaned"), so a reader of the generated `.toml` in
isolation does get the caution. I confirmed this matters: I grepped the generated
`concertino-executor.toml` for `report_agent_job_result` and the **only** hit is
this new comment (line 8) — the executor role body carries no `{{block:harness}}`
note, so before this change the executor/evaluator tomls carried no caution at
all. The change has real value.

**The pointer itself, checked against the generated artifact.** The comment says
`see header.md (lines 26-31)`. In the rendered scratch project:
`ls <out>/header.md` → *No such file or directory*; `ls <out>/adapters` → *No such
file or directory*. `header.md` is a package-internal source template
(`bin/concertino:628` reads it from `ADAPTERS`); its content is rendered into
`<out>/AGENTS.md` (`bin/concertino:636-645`). So the generated
`.codex/agents/concertino-executor.toml` instructs its reader to open a file that
does not exist anywhere in their project.

**The line numbers, checked both render paths.** `sed -n '26,31p' <out>/AGENTS.md`
does return the worker-dispatch caution — but only because this was a *fresh*
AGENTS.md, where `full = blockText` (`bin/concertino:643`) and numbering happens to
coincide with `header.md`'s. `bin/concertino:641` is a first-class supported path:
when AGENTS.md already exists without the CONCERTINO markers, the block is
appended after the pre-existing content (`cur.trimEnd() + '\n\n' + blockText`),
shifting every line number. AGENTS.md is a widely-adopted convention file that
many target projects already have, so "lines 26-31" is correct by coincidence, not
by construction. It is also unguarded against drift in `header.md`, which is
edited in practice — the archived `2026-07-29-agent-merge-role` change has a task
(`tasks.md:2.4`) that edits `adapters/codex/header.md` directly.

**Internal inconsistency within the changed file.** `agent.toml.tmpl:3` — the line
four above the addition — already refers the reader to `AGENTS.md`
("the orchestration runs sequentially (see AGENTS.md)"), i.e. the file's existing
convention is to name the *rendered, reader-visible* artifact. The new line 7 names
the *source template* instead. Separately, every other reference to this file
across the repo (`docs/harness-capabilities.md:123`, `ROADMAP.md`, the archived
change docs) uses the full path `adapters/codex/header.md`; the bare `header.md` is
unresolvable even inside the concertino repo.

**Iron Laws.** `verification-before-completion` — I re-ran the one configured gate
and read its output rather than accepting the assertion. `systematic-debugging` —
N/A, this is not a bug fix, so no probe/regression-test obligation applies.

**UI review.** N/A — no UI configured for this project; servers not started.

**Noted and excluded per orchestrator instruction:** `openspec validate` reporting
"no deltas found" for this comment-only change. Not treated as a defect.

### Verdict: REFUTE

The acceptance criteria are substantively met and the gate is green, but this
change's entire deliverable is the accuracy of three comment lines, and two of
them misdirect the reader. Both fixes are one-liners.

### Change Requests

1. **`adapters/codex/agent.toml.tmpl:7` — point at `AGENTS.md`, not `header.md`.**
   `header.md` is a package-internal source template and does not exist in any
   consuming project; verified by rendering (`ls <out>/header.md` → No such file or
   directory). The caution's reader-visible home is `AGENTS.md`
   (`bin/concertino:628,636-645`). This also makes the addition consistent with
   line 3 of the same file, which already says "(see AGENTS.md)". If you want the
   in-repo source named as well, use the full path `adapters/codex/header.md` as
   the rest of the repo does — never the bare filename.

2. **`adapters/codex/agent.toml.tmpl:7` — drop the hardcoded `(lines 26-31)`.**
   The numbers are correct only when `AGENTS.md` is created fresh; on the
   append path at `bin/concertino:641` (pre-existing AGENTS.md, a supported and
   common case) every line number shifts, and nothing guards the reference against
   `header.md` being edited. Replace with a stable anchor — e.g. "see the
   sub-agent-orphaning note in `AGENTS.md`" — which costs nothing given the comment
   already states the actionable instruction inline. This also honours
   `design.md`'s own stated rationale (point rather than duplicate "to avoid the
   two copies drifting out of sync"): a line-number citation reintroduces exactly
   that drift risk in a different form.

### Non-blocking notes

- `evaluation-1.md:10` and `:34` assert "Line references are accurate" / "Line
  reference (26-31) correctly points to the full worker-dispatch caution in
  header.md". True of the *source template's* own numbering, which is what the
  evaluator checked; it did not check the generated artifact, where both the
  filename and the numbering fail. Worth noting for the evaluator's future
  handling of template changes: verify the rendered output, not just the template.
- `agent.toml.tmpl:4` still says "dispatch the executor/evaluator as workers",
  omitting the auditor, even though `bin/concertino:649` renders a
  `concertino-auditor.toml`. Pre-existing staleness, already flagged in
  `openspec/changes/archive/2026-07-29-agent-merge-role/evaluation-1.md:33,44` —
  not introduced here, and out of scope for this ticket, but this change touches
  the adjacent lines and could fold it in cheaply.
