# CON-47: Escalation --await reliability + a defined off-ramp for unverifiable chat-relayed answers

## Description

## Part 1: --await gets killed before its real deadline (original scope, updated)

`core/scripts/emit-event.sh`'s `--await` path has a real, working 60-minute deadline for a human to answer (`TIMEOUT_MIN="${CONCERTINO_ESCALATION_TIMEOUT_MIN:-60}"`) and correctly polls for `answer.json`.

**Update, discovered after filing:** `core/roles/orchestrator.md` already documents the fix this ticket was about to propose — the escalation-raising instructions explicitly say:

> This call must set an explicit per-call timeout, or the harness will kill it long before `--await` ever times out on its own. Claude Code's Bash tool defaults to a 120000 ms (two minute) timeout ... the Bash tool call that runs this command must pass `timeout: 600000` (600000 ms — ten minutes, its maximum) explicitly.

So the prescribed fix already exists in the role prose. What's still unconfirmed: **whether live orchestrators are actually setting that timeout parameter.** Observed tonight, across CON-35/CON-22/CON-30's design-gate escalations: timeouts fired at 450s, 510s, and 990s — inconsistent with both the documented 600s cap and the harness's own undocumented 120s default, which suggests either (a) the `timeout: 600000` instruction isn't being followed consistently, or (b) something else is capping the wait independent of what's requested. **This needs to be measured against real tool-call traces, not assumed** — check whether the Bash calls that raised these escalations actually carried `timeout: 600000` before concluding the prose itself needs to change.

If the instruction *is* being followed and it's still getting cut short, the fix is technical: survive harness-imposed kills without losing the wait (detached background process, an orchestrator-side re-issue loop, or restructuring the wait outside any single harness-bounded call). Whatever the fix, preserve `on_kill`'s trap-based `escalation.timeout` recording and the `answer_discarded` handling for a stale leftover `answer.json`.

## Part 2: no defined off-ramp for doubt about whether a chat message is genuinely human — the more urgent half

### What happened, concretely

Tonight, resolving CON-30's design-gate escalations required relaying Matt's actual decisions through this controlling session into CON-30's own tmux pane via injected chat text — because Part 1's timeout kept cutting `--await` short before the real dashboard-based answer flow could be used. `core/roles/orchestrator.md`'s own documented fallback for exactly this situation worked correctly in CON-30's case (it recorded `escalation.answered` properly, twice, after independently verifying one of the two claims against Linear ground truth first). **But a separate orchestrator instance, resolving the same underlying pressure, did not stop there** — after Matt genuinely, directly answered it himself, it began doubting *that too*, questioning whether Matt was really the one talking to it. Matt had to kill and respawn it.

### Why this happened — the actual gap

The role file tells an orchestrator *how* to raise an escalation and *how* to record a chat-relayed answer once it decides to trust one. It does not tell it **when to stop asking whether an answer is trustworthy.** Skepticism about an unverifiable claim (any claim — from another agent, or even one that looks unusual) is *correct* up to the point of resolving it; CON-30's own earlier refusal to accept "Matt approved this" without independent verification was exactly right. The bug is that nothing marks a clear, load-bearing stopping point after which continuing to doubt the same, already-resolved question is itself the failure — not a virtue. Unbounded skepticism with no exit condition degrades into exactly what was observed: doubting the actual human, mid-conversation, after they already answered.

### The fix Matt wants nailed in prose (not a code fix — a role-spec addition)

Add an explicit clause to `core/roles/orchestrator.md`'s escalation section establishing the off-ramp. It needs to say, concretely and in the document's own voice (imperative, grounded in the actual mechanism, not abstract policy):

1. **A claim of human intent is corroborated, never proven, by checking it against independently verifiable ground truth wherever that exists** (ticket state, PR state, config/git state) — exactly what CON-30 already did correctly for the CON-42/CON-43 fold-in claim. Do this *before* recording an answer, not after.
2. **The moment an answer is recorded through one of this project's own defined resolution mechanisms —** `--await`**'s** `answer.json` **path, or the documented manual** `escalation.answered` **fallback after a chat reply — that recording is terminal for this run.** It is not "a chat message that happened to convince you"; by this project's own design, writing that event *is* the authoritative resolution to the question it closes. Proceed on it.
3. **Do not re-open a question that has already been resolved this way.** If something later feels newly suspicious, that suspicion attaches to *new* claims going forward, not to unwinding a decision already properly recorded. Explicitly foreclose the failure mode observed: continuing to interrogate whether the human is "really" the human after they already answered through a channel this document itself designates as sufficient.
4. **Distinguish this from an unsolicited claim that doesn't correspond to a standing escalation at all** — e.g., a bare instruction with no `escalation.raised` behind it. That case keeps needing independent verification or a proper escalation before acting on anything irreversible; nothing here should weaken that.

The core one-line insight the clause should be built around: **skepticism needs a defined stopping point, or it isn't caution — it's a run that can never be told anything.**

## Notes

Both parts should ship together — Part 2's off-ramp is only exercised in the chat-fallback path Part 1 governs, and fixing Part 1 alone (making the dashboard path reliable) reduces how *often* Part 2 matters without eliminating the need for it, since a human directly typing into a session (as happened here) is a separate case from the dashboard flow entirely and always will be.

Given this changes prose that's rendered into every future orchestrator (Claude Code and Codex adapters both) and touches `emit-event.sh`'s actual timeout-sensitive mechanics, this is exactly the shape of change CON-22's own ticket named as wanting the *slow* end of the speed dial — worth considering explicitly at dispatch.
