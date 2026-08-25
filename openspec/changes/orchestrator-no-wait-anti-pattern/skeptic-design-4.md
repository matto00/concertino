## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Extended round, authorized by the human product owner, scoped to verifying that
the five revisions made after `skeptic-design-3.md`'s Change Request 1 actually
close it, and introduce no new defect.

### What I verified (with evidence)

**1. The defect CR1 named is real and still present in ground truth.**
`grep`/`sed` of `lib/cli/render.js`, `case 'harnessResume':` Claude-Code branch
(the fallback `return` after the `codex`/`opencode` early returns) contains,
verbatim:

> "**Never end your turn while a spawned or resumed sub-agent is still outstanding.** As the top-level `/concertino-deliver` session, waiting is free — your session persists and receives the sub-agent's result whenever it arrives."

This is the same contradiction-producing construction as
`core/roles/orchestrator.md:41-43` ("waiting costs nothing: your session
persists and will receive the sub-agent's result whenever it arrives, however
long that takes"), which I also read directly. Both quotes in proposal.md,
design.md and tasks.md 1.5 are accurate against the files — not paraphrase drift.

**2. Revision (a) — Impact list.** proposal.md's Impact now names
`lib/cli/render.js` (the `harnessResume` Claude branch) and explicitly retracts
the earlier "no script changes" framing. Verified present.

**3. Revision (b) — the correction task.** tasks.md 1.5 targets exactly the
branch I located, applies task 1.1's reframing, and names the two distinct
accurate passages to preserve. I confirmed both preserved passages exist in that
block and are accurate as written: the "every `Agent` spawn and every
`SendMessage` resume remains a single blocking call ... its return value **is**
the sub-agent's authoritative result" explanation, and the "poll for the artefact
the sub-agent was told to produce (its report path, or a new commit on the
branch)" fallback. The task also requires reconciling the source-file correction
with the block correction so the rendered section states the rule once — which is
the right shape, since I confirmed `{{block:harnessResume}}` sits at
`core/roles/orchestrator.md:101`, the last line of the "Harness resume model"
section, ~60 lines after the line-41 passage. The design's positional claim checks
out.

**4. Revision (c) — audit broadened to source + all interpolated blocks.**
`grep -n '{{block:' core/roles/orchestrator.md` returns exactly eight distinct
block names — `harnessResume` (101), `ticketProvider` (165), `specScaffold`
(436), `specArtifacts` (452, and a second inline reference at 561),
`standaloneTicket` (823), `specArchive` (950), `agentMergePermissionCheck` (987),
`hygiene` (1085). The plan's enumeration matches this exactly, with no extras and
no omissions. I independently read each of those eight `case`s in `render.js`'s
`block()` and checked their Claude-branch text against the audit term list: only
`harnessResume` carries offending language. `agentMergePermissionCheck`'s "wait
for a human 'merged' confirmation" is an accurate description of a human-gated
step, not implying-notification language — the plan's judgement of it is correct.
I also confirmed the plan's claim that `subagentEscalationNotify` is *not*
reachable from the orchestrator's own interpolation set (no
`{{block:subagentEscalationNotify}}` occurrence in `core/roles/orchestrator.md`).
Task 2.1a's both-directions check (no block falls through to `default: return
'{{block:' + name + '}}'`) is a real property of the code I read and is
verifiable at execution time.

**5. Revision (d) — requirement rescoped to the rendered document.** The ADDED
requirement "The rendered role document contains no language implying an
automatic completion notification" now defines "rendered" as the source file plus
the eight enumerated interpolated blocks' Claude-branch text, and its term list
includes `whenever it arrives`, `costs nothing`, `persists`, `free at the top
level` — all of which the `harnessResume` block's offending sentence trips. So
the block's sentence is covered by a normative requirement, not only by a task.

**6. Revision (e) — Codex scope exclusion.** Verified `adapters/codex/header.md`
does carry its own "free at the top level" phrasing (line ~20), i.e. the excluded
thing exists and is genuinely a Codex-branch copy. Excluding it is consistent with
the ticket's own "Claude Code adapter only" constraint and CON-135.

**7. No new defect introduced by the revisions.** I re-read the MODIFIED
requirement and the other ADDED requirements for contradiction against the new
block-scoped language and found none: the MODIFIED requirement's subject
("`core/roles/orchestrator.md`'s harness-resume guidance") is satisfied, not
contradicted, by correcting text interpolated into that guidance. Non-goals still
exclude `scripts/concertino/*`, which remains true — `lib/cli/render.js` is not
under that path.

**8. Render pipeline sanity.** I traced `renderBody` → `emitClaude` (`lib/cli/emit.js:113`)
and `readRoleFile` (`lib/cli/shared.js:133`). The rendered Claude orchestrator is
frontmatter + `renderBody(core/roles/orchestrator.md)` — there is no
`adapters/claude-code/header.md` prepending additional prose, so the plan's
"source + blocks == rendered body" model is correct and complete. No unaudited
third text source exists for this harness.

### Verdict: CONFIRM

The five revisions do close Change Request 1: the offending render-template text
is named at the correct location, targeted by a task, covered by a normative
requirement, and its surrounding accurate content is explicitly protected. The
block enumeration is complete and correct in both directions against ground
truth. I found no new defect that would block execution.

### Non-blocking notes

- **Task 3.1's before-copy is not literally executable as written.**
  `.claude/agents/concertino-*.md` is gitignored (`.gitignore:16`) and no
  `.claude/agents/` directory exists in this worktree, so there is no "current
  rendered `.claude/agents/concertino-orchestrator.md`" to save before sync. The
  executor should render the pre-edit baseline instead (e.g.
  `node bin/concertino sync --out=<tmpdir> --config=... ` on the unmodified tree,
  or render before editing), and say plainly in its report which baseline it
  used. Task 3.3's grep of the post-render artifact is unaffected and remains the
  load-bearing check.
- **One sibling requirement was not rescoped alongside revision (d).** The ADDED
  requirement "The 'waiting is free' statement does not contradict the
  never-end-your-turn rule" (spec.md) is still phrased as scoping only
  `core/roles/orchestrator.md`'s section, while its twin was broadened to the
  rendered document. This leaves no actual coverage hole — the block's sentence
  is caught by the rescoped notification requirement and by task 1.5 — but
  matching the two scopes would remove an avoidable ambiguity for the final gate.
- `core/roles/orchestrator.md:672` contains "free at the top level, fatal as a
  sub-agent" in the *source* file (distinct from the out-of-scope Codex header
  copy). It is in scope and the audit term list will hit it; the executor should
  judge it explicitly rather than letting the Codex exclusion note (task 2.1b)
  cause it to be waved past by name similarity.
