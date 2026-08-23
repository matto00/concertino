# CON-132: Treat changes to the commit-gate chain as live-infrastructure changes, not ordinary edits

## Description

On 2026-08-21 a Concertino delivery run bricked its own repository. The main checkout became unusable for ~70 minutes and the cause took a multi-agent forensic investigation to find.

**No agent broke procedure.** That is the important part, and it is why this ticket is not about agent discipline.

The executor, working HEL-657 in a linked worktree, wrote a new pre-commit gate (`check-openspec-hygiene.selftest.mjs`) that builds fixture git repos with `git init`, wired it into `.husky/pre-commit`, and committed. One commit, `82d252f0`, contained all three:

```
 .husky/pre-commit                             |   1 +      <- +npm run check:openspec:selftest
 package.json                                  |   1 +
 scripts/check-openspec-hygiene.selftest.mjs   | 450 +++++
```

Husky reads `.husky/pre-commit` from the working tree, so the new gate was live for the very commit that introduced it. Its first-ever execution ran against the real repository. It inherited git's hook-exported `GIT_DIR` — from a linked worktree that is `<repo>/.git/worktrees/<name>`, whose basename is not `.git` — so `git init` re-initialised the real repo as bare.

**Following procedure is what detonated it.** The standing rule is never `git commit -n`. The executor honoured it and reported so explicitly. Had it bypassed the hook, the gate would not have run and the repo would have been fine. Stricter adherence made this more likely, not less. Any control framed as "agents must follow standard procedure" has no purchase on this incident.

The underlying leak is fixed on the helio side (shared allowlist-based child-git environment, plus a `core.bare` tripwire as the first gate). This ticket is about the workflow gap that let it reach a live repo at all.

## The gap

Concertino treats "add a line to `.husky/pre-commit`" as an ordinary file edit. It is not. A commit-gate is code that executes with git's own environment, on every subsequent commit, in every worktree, for every contributor. It is live infrastructure being modified from inside the thing it governs.

Two rules are missing, and the second is the one that would actually have caught this:

1. **Do not test live first.** A new or modified gate must be exercised in isolation — against a throwaway repo, with a hook-shaped environment — before it is wired into the chain that runs it. Today the first execution of a new gate is routinely the commit that introduces it.
2. **Check implications: what would this do in live?** The stronger and more general rule. Before a gate lands, state explicitly what it will do when run under real conditions: what it executes, what environment it inherits, what it writes, and what happens if it runs from a linked worktree rather than a main checkout. This incident's mechanism was fully visible to anyone who asked "what does `git init` do if `GIT_DIR` is already set?" — nobody asked, because nothing prompted them to.

Worth noting how much review this cleared: six design rounds, a cold skeptic, and an evaluator all examined this script. None caught it. Every reviewer reasoned about the script's *logic*, which was correct throughout. Environment inheritance is invisible in a diff — you cannot see `process.env` misbehaving by reading the code that spreads it. So this cannot be fixed by asking reviewers to be more careful; it needs a prompt that makes the question mandatory.

Note also that the footgun is invisible in ordinary testing: run the same script from a shell and it passes, because a main checkout exports no `GIT_DIR` and only a *relative* `GIT_INDEX_FILE`. Only a hook, from a worktree, reproduces it. So "I ran it and it worked" is not evidence for this class.

## Proposed scope

1. **Classify gate-chain changes.** Any diff touching `.husky/**`, the gate list in the hook, or a script the hook invokes gets flagged in planning as a live-infrastructure change, with the two rules above applied.
2. **An implications checklist for such changes**, answered in `design.md` rather than left to reviewer instinct: what does it execute; what env does it inherit and from where; does it write anything outside its own sandbox; does it behave differently from a linked worktree than from a main checkout; what happens on its first run.
3. **Isolation-first execution.** A new gate must be demonstrated against a throwaway fixture, under a hook-shaped environment, before the wiring commit. Red-before-green, as elsewhere.
4. **Consider staging the wiring.** Landing the script and the hook line in separate commits would have given one commit's worth of warning. Note the tradeoff: they must not be split in a way that leaves a worktree with a hook referencing a missing script, so ordering matters (script first, wiring second).

## Acceptance Criteria

- [ ] A diff touching the commit-gate chain is identified as such during planning, and the run cannot reach Delivery without the implications checklist answered.
- [ ] The checklist explicitly asks the linked-worktree question — what git exports into a hook from a worktree versus a main checkout — since that is the difference this incident turned on.
- [ ] A new or modified gate is exercised in isolation against a throwaway repo under a hook-shaped environment before the commit that wires it in, with that evidence recorded.
- [ ] Guidance states plainly that "I ran the script and it passed" is not evidence for a hook-invoked script, and why.
- [ ] The rules are enforced by the workflow rather than by agent recall — a run that skips them fails a gate, rather than depending on an agent remembering to apply them.

## Orchestrator notes (not part of the ticket; guidance for this delivery run)

This ticket is PROCESS/WORKFLOW DESIGN, not a code bugfix. The deliverable is changes to the workflow itself (role docs, planning artifacts, gate enforcement), evaluated against the "mechanically checkable, not agent-recall" bar. Prefer a script-based check (e.g. wired into assert-phase.sh or a new script under scripts/concertino/) that:
- detects a diff touching `.husky/**`, the hook's gate list, or a script the hook invokes,
- and refuses to let the run reach Delivery unless recorded evidence (an implications checklist filled into design.md, plus an isolation-first demonstration log/artifact) is present.

If a fully mechanical check turns out infeasible for some sub-part, that must be stated explicitly with reasoning, not silently downgraded to unenforced prose.

Verification for this ticket is a demonstration that the new gate mechanism actually blocks: show a simulated run touching `.husky/**` being stopped, and the same run proceeding once evidence is recorded. Any probe involving `git init` under a hook-shaped environment MUST run in a throwaway repo under a temp dir — never against a real repo (this repo included). State what an experiment would do to a real repo if the safeguard were absent, before running it.
