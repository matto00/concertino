# CON-193: Support agentMerge.protectedPaths so a repo can exclude specific paths from agent-merge

## Description

`agentMerge.enabled` is a global boolean (`lib/config.js:203-206` — the ticket
cites `:193`, which is stale by ten lines; the substance is unchanged). A
repository can allow agent-merge for everything or nothing. There is no way to
say "the Auditor may merge ordinary work, but changes to *these* paths need a
human."

That gap matters wherever a repo has files whose whole purpose is to constrain
the agents. If the agents can merge a change to the constraint without a human
seeing it, the constraint is advisory.

### Concrete case

A new consuming repo keeps an append-only record and a set of rules, and needs
three path groups excluded from agent-merge: the record directory and its
schema registry, the rules document itself, and the escalation and guard
scripts. Without an exclusion, an ordinary PR could remove the escalation
machinery entirely and the Auditor would merge it on green CI and satisfied
acceptance criteria, because nothing in the diff looks wrong. The human would
never see the argument for removing it.

### Current workaround, and why it should not stay

The consuming repo carries a local `scripts/check-protected-paths.sh` bound to
the Auditor via `canonicalDocs`, which exits 2 on a protected diff so the
Auditor escalates instead of merging. It works, but it is a local divergence
the core knows nothing about; it depends on a `canonicalDocs` entry surviving
every `concertino sync`; the enforcement is prose-bound (the Auditor is *told*
to run it); and every repo that needs this reinvents it.

### Proposed scope

```jsonc
"agentMerge": {
  "enabled": true,
  "protectedPaths": ["record/**", "CHARTER.md", "scripts/check-*.sh"]
}
```

When the run's diff against the review base touches any `protectedPaths` glob,
the Auditor must escalate for human merge rather than merging, with a message
naming the matched paths. Enforcement belongs in the same deterministic place
as the other pre-merge checks (alongside `check-merge-readiness.sh` /
`check-pr-mergeable.sh`), not only in role prose.

## Acceptance criteria

1. `protectedPaths` is schema-validated and defaults to `[]` (current behavior
   unchanged when unset).
2. A run whose diff touches a protected glob escalates instead of
   agent-merging, naming the paths.
3. A run whose diff touches none merges as it does today.
4. The check is a script the Auditor cannot satisfy by assertion, mirroring the
   existing pre-merge check contracts.

## Verification constraints carried into this run

These are recorded here because they bound how AC2/AC4 may be evidenced, and
the evaluator and final-gate skeptic trace acceptance criteria from this file.

- **Mutation proof is mandatory.** Every new failure arm must be shown to fail
  when the guard is removed or inverted. A `protectedPaths` guard that cannot
  actually block a protected path is the failure class this batch catalogued 14
  times (`docs/verification-vacuity-2026-09.md`); it must not become the 15th.
- **Do not build on `check-pr-mergeable.sh`'s correctness.** CON-207 (open,
  Urgent) reports it returning PASS on an empty `statusCheckRollup` — zero
  registered checks read as green. The protected-paths verdict must not depend
  on that predicate.
- **The auditor runs in a worktree that has no config.** Verified empirically
  on this run's own worktree: the 30 tracked `scripts/concertino/*.sh` are
  present, but `.concertino.env`, `speeds.json`, `concertino.config.json` and
  `AGENTS.md` are all absent (`.gitignore` lines 5, 10, 18). Any delivery
  mechanism that reads the glob list from a worktree-local env file or config
  file resolves to EMPTY there, i.e. fails OPEN in exactly the place the guard
  must hold. Main-checkout resolution via `git rev-parse --git-common-dir` is
  the established precedent (`check-merge-readiness.sh:208-222`, itself copied
  from `emit-event.sh`'s `main_checkout()`).
- **Agent-merge is unexercised in this repository today.** `agentMerge.enabled`
  is `true` in config, but the owner ruled `AGENT_MERGE=false` for this entire
  batch, so no auditor has run and every merge has been manual. Nothing in this
  change may be described as battle-tested; its evidence is tests and mutation
  transcripts, not field use.
- **The rendered copy is byte-compared.** `scripts/concertino/**` is tracked
  here and `test/scripts/rendered-scripts-drift.test.sh` byte-compares it
  against `core/scripts/**`, so any script change must appear in both. Note
  `concertino.config.json` is absent from the worktree, so `concertino sync`
  cannot be run from inside it.
- **`check-merge-readiness.test.sh` points `SCRIPT=` at `core/scripts/`**
  (line 20). Mutating only the rendered copy yields a false green.
- **Emitter strictness.** A `verdict` event is refused unless it carries a
  `category` from mechanical/spec-divergence/design-judgment/intent-mismatch;
  skeptic verdicts must also carry `gate`; a stated `head_sha` must be exactly
  40 hex chars (an omitted one stays legal). CON-215: `emit-event.sh` has been
  observed exiting 1 *after* appending — never retry a verdict emit without
  first checking the log, or the chain gets a duplicate.
