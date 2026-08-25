## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

**1. `core/roles/orchestrator.md` corrected text — read directly (`git show b5e4a13 -- core/roles/orchestrator.md`).**
The offending sentence ("waiting costs nothing: your session persists and will receive the sub-agent's result whenever it arrives") is gone, replaced by a persistence-only framing that explicitly negates an automatic wake signal: *"It is not a license to end your turn before that call returns, and it does not mean a result 'arrives' by any channel other than that same call resolving — there is no automatic wake signal, no notification you receive independent of the call itself returning."* The accurate mechanical content (nested-sub-agent early return is fatal; CON-10 history; poll-the-artefact fallback) is preserved verbatim. The closed 3-item enumeration of legitimate turn-ending conditions is present in the very next paragraph, immediately beside the correction, with the "in progress / working / will report back" anti-pattern named and the "no third option" closer. Matches the spec delta's requirement text.

**2. `lib/cli/render.js` `harnessResume` Claude branch — read the one-line diff directly.**
Before: `waiting is free — your session persists and receives the sub-agent's result whenever it arrives.` After: `waiting is free — but that describes your session persisting across the blocking call, not permission to end this turn before that call returns; nothing arrives by any channel other than that same call resolving.` The block's distinct accurate content (return-value-is-authoritative; poll-the-artefact-or-escalate fallback) is untouched. Only the Claude fallback `return` changed; `codex`/`opencode` early returns untouched (confirmed in the diff hunk).

**3. Fresh render, by me.** `node bin/concertino sync --config=config/examples/helio.json --out=<scratch>` → rendered `.claude/agents/concertino-orchestrator.md`, 1748 lines. Source-sourced passage at rendered lines 64–104; `{{block:harnessResume}}`-sourced passage at rendered line 150. **Both carry the same framing** — "waiting is free = session persists across the blocking call, never permission to end the turn; nothing arrives by another channel." The rule is stated once coherently: the block's version is a shorter restatement in the *identical* framing plus its own distinct call-mechanics content, not a second conflicting framing. The doc's own line ("The spawn/resume instructions below each restate this at the point you need it") makes the restatement intentional and non-contradictory. Confirmed by reading both passages in full, not by grep.

**4. 8-block audit, re-run by me, both directions.**
`grep -n '{{block:' core/roles/orchestrator.md` → exactly 8 distinct names: `harnessResume`(121), `ticketProvider`(185), `specScaffold`(456), `specArtifacts`(472, +inline ref 581), `standaloneTicket`(843), `specArchive`(970), `agentMergePermissionCheck`(1007), `hygiene`(1105). `grep -n "case '" lib/cli/render.js` → every one of the 8 has an explicit `case`; none falls through to `default: return '{{block:' + name + '}}'` (and no unrendered `{{block:` string survives in the rendered artifact). `subagentEscalationNotify` has a case but is genuinely not interpolated by `orchestrator.md` — confirmed by the grep above.
Audit-term grep against the **rendered post-sync artifact** (`notif|report back|let me know|will send|wait for it to|whenever it arrives|will receive|costs nothing|free at the top level|persists`) → 9 hits, all read in full context: lines 72/80/97/110/146/148/699/703 are negations or accurate descriptions of the *absence* of a wake signal; line 1298 ("It costs nothing when you don't own that channel either") is about posting to the human chat transcript, unrelated. No live implying-notification language remains.

**5. Two edge items.**
- `core/roles/orchestrator.md` rendered line 739 ("returns directly; free at the top level, fatal as a sub-agent (a suspended you gets no notification, and the skeptic you spawned is orphaned)") — read in full context. It is immediately followed by *"If you can't wait inline, or you otherwise find yourself not holding a verdict, poll for the skeptic's report file, or escalate — on this ordinary spawn path there is no other way the verdict reaches you."* No license framing, no implied arriving signal. **Correctly judged in-scope-but-fine.**
- `adapters/codex/header.md:21` — read directly; it is the Codex sequential-flow branch's own copy, and its very next sentence says the failure mode *"does not apply to this default sequential flow."* Untouched in the diff. **Correctly judged out of scope** (CON-135), consistent with the ticket's "Claude Code adapter only" constraint.

**6. Gates, run fresh by me in `WORKTREE_PATH`.**
- `openspec validate orchestrator-no-wait-anti-pattern --strict` → `Change 'orchestrator-no-wait-anti-pattern' is valid`.
- `npm test` → **exit 0**. Grepped the full log: zero `not ok` lines, zero `N failed` with N>0.
- `git diff main...HEAD --name-only` → only `core/roles/orchestrator.md`, `lib/cli/render.js`, and this change's own directory. No scope creep.

**7. POLLING DEMONSTRATION — independently corroborated.** Every recorded observation in `workflow-state.md` checks out against ground truth I derived myself:
- `skeptic-design-4.md` sha256 = `6e653d1c0d8a5f820b2703ffe88dacd1842ef7dc1ff936e70523c15f3a46c986` — **matches exactly**; file contains `### Verdict: CONFIRM` (line 86).
- Executor commit `b5e4a13cdac792473ce670d4d12bfe5e97b6cbcb`, message and committer timestamp `2026-08-25T08:56:42-07:00` — **all match** `git log`.
- The loop's `BEFORE_SHA=869789f240e19379fa34b7a6e7dcfc3bc23c89af` is **exactly `b5e4a13^`** — a detail that would be hard to fabricate and that confirms the polling baseline was taken from the real pre-executor HEAD.

### Assessment of the core acceptance criterion (ticket AC #3)

Asked directly: is the `POLLING DEMONSTRATION` block real evidence, or an assertion dressed up as one? My judgement: **substantially real, and partial — honestly so.**

Real, because it is *checkable and it checks out*. Every artifact named (file path, sha256, verdict text, commit SHA, commit message, parent SHA, two timestamps) is independently verifiable and I verified all of them. That is categorically different from "polling is possible" — these are the fingerprints of an actually-executed artifact inspection, and the parent-SHA baseline in particular could only come from a loop genuinely armed before the executor committed.

Partial, in one specific way that no one could have fixed: **neither instance is a case where a notification genuinely failed to arrive.** Instance 1 explicitly records that the notification *did* arrive afterward; instance 2 records polling *before* consuming the call's return value. So what is demonstrated is that the orchestrator established terminal state from artifacts independently and did not end its turn to wait — not that it survived a lost notification, because no notification was lost during this run. A dropped notification cannot be manufactured on demand.

The unverifiable residue is the **ordering** claim ("I polled before consuming the return value"). Nothing outside the orchestrator's own transcript attests to that ordering; the artifacts prove the polling happened, not that it was primary. I flag this as a limit, not a defect.

The ticket anticipated exactly this: *"If a full end-to-end demonstration isn't achievable, executor/evaluator must say so plainly and describe exactly what was verified vs. not."* The evaluator's report does say so plainly and accurately. The design gate (rounds 1–4, with a human-authorized extended round 4) deliberately redefined the demonstration into this artifact-recorded shape and CONFIRMed it. On that agreed shape, **AC #3 is satisfied** — sufficient for delivery, and I would not hold the change for the un-manufacturable stronger version.

### Verdict: REFUTE

One stable, reproduced gap. Not a judgement call — this change's *own* spec delta prescribes the outcome.

### Change Requests

1. **The executor's report is missing the "What was verified / what was not verified" section that this change's own spec delta makes mandatory — and contains a dangling forward-reference to it.**
   - `openspec/changes/orchestrator-no-wait-anti-pattern/files-modified.md:4` ends with *"…rather than copied from a pre-existing tracked file; **see \"What was verified\" below**)."* — and there is no such section anywhere in the file. `files-modified.md` is 5 bullets and stops.
   - `grep -n "What was" *.md` across the change dir returns the section header in `evaluation-1.md:40` only. I also searched the persisted evidence dir (`/home/matt/Development/concertino/.concertino/runs/CON-140/evidence/…`) and the whole filesystem for any other CON-140 executor report — there is none. The evaluator's section exists and is good; the **executor's does not exist at all**.
   - `tasks.md:26` marks task 4.3 `[x]` ("The executor's **and** evaluator's own reports … must **each** contain an explicit, separately-headed …"). That checkbox is false as marked.
   - The ADDED requirement *"Executor and evaluator reports state what was and was not verified for this capability"* (`specs/orchestrator-turn-discipline/spec.md`) says: *"Any executor or evaluator report addressing this capability's change SHALL contain an explicit, separately-headed 'What was verified / what was not verified' section"*, and its scenario says the final-gate skeptic **SHALL treat this as a defect requiring REFUTE**. I am applying the rule the change itself wrote. Shipping a change whose own new requirement it violates — in the one place a reader would look to check it — is not acceptable, particularly for a ticket whose entire premise is that documented rules get contradicted by adjacent reality.
   - **Fix:** append a separately-headed `### What was verified / what was not verified` section to `files-modified.md` (or add a proper `execution-1.md`), stating (a) the concrete artifact/polling observations the executor made for its own work — e.g. the scratch-dir before/after render diff at both the source-sourced and `{{block:harnessResume}}`-sourced locations, the 8-block both-directions enumeration, the rendered-artifact audit-term grep and the judgement of each hit, `openspec validate --strict` and `npm test` results — and (b) plainly, what could not be demonstrated end-to-end (that a doc change cannot prove future model behavior; that the executor cannot perform or observe the orchestrator-owned demonstration in tasks 4.1/4.2). Then resolve the dangling "see 'What was verified' below" reference so it points at something real.

### Non-blocking notes

- Rendered line 150 (the `harnessResume` block) reads *"waiting is free — **but** that describes … . **But** if you are yourself running as a sub-agent …"* — two adjacent sentences opening with "but". Purely cosmetic; the meaning is unambiguous and the framing is correct. Worth smoothing if the file is touched anyway, not worth a round on its own.
- The rendered document now states the never-end-your-turn rule at ~line 64, again at ~line 105 (enumeration), again at ~line 150 (block), and again at each spawn site. This is deliberate and the framings are now consistent, so it is not the CON-140 defect — but it is worth noting for a future ticket that the marginal value of restatement #6 is low, and the *contradiction* was the real fix. That is precisely the insight this change encodes, so: consistent with its own thesis.
