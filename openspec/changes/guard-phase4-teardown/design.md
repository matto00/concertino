## Context

CON-171 asks for a guarantee that Phase-4 teardown never begins while a spawned agent is still writing into the worktree. The ticket lists three directions and offers an opinion — that having the auditor persist before merging "is the cheapest and removes the whole class" — while explicitly marking the question as not decided. This document evaluates all three on their merits and records why the chosen combination differs from the ticket's preference.

### Ground truth established before designing

The incident narrative was verified against `.concertino/runs/CON-163/` rather than taken on trust. Two findings, one of which changes the analysis:

1. **Confirmed:** the worktree was torn down mid-auditor. `.concertino/runs/CON-163/evidence/auditor-report.md` carries an explicit annotation that the original was destroyed, and `events.jsonl` records `gate.result gate=phase:cleanup status=fail first_error="worktree dir still present"` — the residual-file symptom the ticket describes. The recovered report is annotated as a reconstruction and is deliberately not treated here as primary evidence.

2. **Corrected:** the ticket states the auditor "emitted its `verdict=MERGE` event with **no** `ref` field". It did not. `events.jsonl` contains **zero** events with `"role":"auditor"` and no `agent.spawn agent=auditor`. The auditor's telemetry was lost in its entirety — it was killed before reaching any `emit-event.sh` call at all.

Finding 2 is load-bearing. The ticket's model of the failure is "the auditor completed its work but one late step degraded". The actual failure is "the auditor was killed at an arbitrary point in its post-merge sequence". A fix that reorders steps *within* that sequence therefore does not bound the loss; it only relocates which steps are exposed.

## Goals / Non-Goals

**Goals**
- Make it structurally impossible for `cleanup.sh --phase4` to destroy a worktree while the auditor's script-owned lease is held — a mechanical guarantee, not a convention, for the one role this change makes bracketed — and complement it with a best-effort process-cwd probe for any other live holder (corrected: an earlier draft of this bullet claimed the stronger "any live process" guarantee outright; see the Honest scope statement below for why that overstates what Signal B actually provides).
- Remove the prompt ambiguity that made an out-of-band merge observation read as a valid Phase-4 entry condition.
- Ship the rendered `scripts/concertino/` counterpart in the same commit, by direct copy.

**Non-Goals**
- Reordering the auditor's persist/merge sequence (Decision 1 explains why).
- A general-purpose process supervisor. The guard answers exactly one question — is anything live inside this directory — at exactly one call site.
- Any change to the executor, evaluator, or skeptic roles. They finish long before Phase 4 and are not implicated.

## Decision 1 — Evaluating the three directions

### Direction 2 (auditor persists before merging) — rejected as the primary fix

This is the ticket's preferred option, and it is the one this design declines. Three reasons, in descending order of severity.

**(a) It would persist a verdict that is not yet true.** The auditor's report is not merely a record of its checks; it contains a `### Verdict:` line, and the verdict is `MERGE` only if `gh pr merge` succeeds. `core/roles/auditor.md` already documents the case where it does not: "If `gh pr merge` itself fails after all four conditions passed (a race — the base moved, a check flipped between your read and the merge attempt), treat that as `BLOCKER`". Persisting the report before merging therefore means durably recording `Verdict: MERGE` for a run that may end `BLOCKER` with the PR still open. Making the evidence durable by making it potentially false is a bad trade — and the failure mode it introduces (a persisted report contradicting the emitted verdict) is quieter and harder to notice than the one it fixes.

Persisting a *second*, corrected copy afterwards would fix the falsity but reintroduces the original race for the corrected copy, which is the very thing being fixed.

**(b) It does not close the class; it moves the window.** The auditor still does work after the merge under any ordering: it must emit `verdict` with the durable `ref`, and it must return. Finding 2 above shows the CON-163 auditor never reached its emit call, so under persist-before-merge that run would have kept its report and *still* lost its verdict event — the dashboard would show a run with evidence but no auditor verdict. The window narrows; the class survives.

**(c) It is a convention, not a guarantee.** It is prose in a role document. It constrains one role's ordering and does nothing for any future agent that writes into a worktree near teardown. The ticket's own framing — "removes the whole class rather than one instance of it" — is, on inspection, truer of Direction 3 than of Direction 2.

The ticket's cost intuition is right: Direction 2 is the cheapest to write. It is not the cheapest to be wrong about.

### Direction 1 (state the Phase-4 entry condition precisely) — adopted, as necessary but insufficient

The prompt genuinely is ambiguous, and that ambiguity is what a reader acted on. "The auditor's `MERGE` verdict *is* the confirmation" is correct but reads as satisfiable by any observation that the merge occurred. Fixing the wording is cheap, targeted, and addresses the actual proximate trigger.

It is insufficient alone for the reason every prompt-only fix is: it constrains a reader who reads carefully. The same class of instruction has been restated repeatedly across this role document already (see the "Harness resume model" section's several passes at turn discipline), which is direct evidence that prose repetition alone has not been sufficient here before.

### Direction 3 (`cleanup.sh --phase4` refuses while a live process holds the worktree) — adopted, as the load-bearing fix

This is the only one of the three that is a mechanism rather than a convention. It holds regardless of which agent is inside the worktree, regardless of why the orchestrator decided to tear down, regardless of harness, and regardless of whether any prompt was read correctly. It converts an irreversible destructive operation into one with a precondition, which is the correct shape for an irreversible destructive operation.

### Chosen combination: 1 + 3

Direction 1 fixes the specific reasoning error; Direction 3 makes that error non-destructive when it recurs in some form not anticipated here. Direction 2 is declined for (a) above, not merely as redundant. This is recorded here because it contradicts the ticket's stated preference.

## Decision 2 — What "still working in the worktree" is actually detected

Design-gate round 1 refuted the first version of this decision, correctly. That version detected only processes whose `/proc/<pid>/cwd` resolves inside the worktree, and that predicate does **not** cover the CON-163 shape:

- `core/roles/auditor.md` never `cd`s into the worktree — every invocation passes `"$WORKTREE_PATH"` as an absolute argument (`check-merge-readiness.sh` at `:54`, `persist-evidence.sh` at `:230`).
- The report at `:204` is written with the harness's file-write tool, not a subprocess.
- Agent bash calls are per-call processes with cwd reset between calls, so **between tool calls a live agent holds no process inside the worktree at all** — which is exactly the state CON-163's auditor was in when it was killed.

A cwd probe would therefore have found nothing in the very incident this ticket exists for, while reliably finding the dev servers `cleanup.sh` has just killed — i.e. it would have produced only false positives. Detection is accordingly split into two signals with different jobs.

### Signal A (load-bearing): a script-owned auditor lease

The auditor's lifetime is bracketed by two canonical scripts it always runs, in order. The lease is taken and released by **those scripts**, not by prose in a role document — so it does not depend on any prompt being followed:

- **Acquired** by `check-merge-readiness.sh <WORKTREE_PATH> <BRANCH> <TICKET_ID>`, the auditor's first action and a hard precondition of merging. It runs before `gh pr merge` on every path. It is acquired on that first action **and on each re-invocation**: `core/roles/auditor.md:80-85` requires re-running this script up to three times when it returns `PENDING` (exit 3) because CI is still moving, so on a healthy PR with slow CI the acquire hook runs one to three times. Acquisition is therefore idempotent by requirement, not merely defensively.
- **Released once**, by `emit-event.sh verdict ... role=auditor verdict=<...>`, the auditor's single terminal action. Every terminal verdict — `MERGE`, `ESCALATE`, `BLOCKER`, `ESCALATION-RAISE` — goes through this one call (`auditor.md:232-239` makes the emit unconditional: "A verdict must always be emitted"), so every completing path releases.

The lease lives under `.concertino/runs/<TICKET_ID>/locks/auditor.lease` in the **main checkout**, not in the worktree: it must outlive the thing it protects in order to be checked at teardown time.

**Resolution of the lease root is the helper's job, not the caller's.** This is the one place where the guard could silently fail *open*, so it is pinned here. The two writers already resolve the main checkout with `git rev-parse --git-common-dir` (`check-merge-readiness.sh:138`, `emit-event.sh:96` — deliberately, per that script's own comment: "the MAIN checkout, never the worktree"). `cleanup.sh:129`, by contrast, sets `REPO_ROOT` from `git rev-parse --show-toplevel` relative to its own cwd. If the reader used `REPO_ROOT` and the two ever disagreed — cleanup invoked with a cwd inside a worktree, or from a sibling checkout — the lease file would simply not be found and the load-bearing guard would permit the destructive operation, silently. The shared helper of task 1.1 therefore resolves the run root **itself**, by the same `--git-common-dir` path the writers use; `cleanup.sh` must not pass its own `REPO_ROOT` in.

**The lease is matched on the worktree path, not on the ticket id.** `cleanup.sh:149` computes `T="${TICKET_ID:-${WORKTREE_PATH##*/}}"`, and `TICKET_ID` is a documented-optional fourth argument — so a call site that omits it infers `T` from a basename, which for a branch not ending in `<TICKET-ID>` is not a ticket id at all. Keying the lookup on `T` would turn that case into another silent no-op. Instead, `check-merge-readiness.sh` records the absolute `WORKTREE_PATH` it was given (it receives it as `$1`) into the lease, and `cleanup.sh` scans `<run-root>/.concertino/runs/*/locks/auditor.lease` for any lease whose recorded worktree matches the path it is about to destroy. This is exact, and independent of how `T` was derived.

**Failure to resolve the run root fails closed.** If the helper cannot resolve the run root at all, `cleanup.sh` refuses rather than proceeding, and says so. The asymmetry is deliberate: the operation being guarded is irreversible, an unresolvable root means the guard cannot answer its own question, and `--force-teardown` is right there for an operator who knows better. Note this is a different case from "root resolved, no lease found", which is a real answer and proceeds normally.

**The ticket key is canonicalised by the helper, identically on both sides.** The lease path embeds `<TICKET_ID>`, and the two hooks do not agree on that string today: `check-merge-readiness.sh` uses `TICKET_ID` raw (`:101`, and `:284` builds `runs/${TICKET_ID}/events.jsonl` from the raw value), while `emit-event.sh:296` uppercases it — that script's own comment there records lowercase-suffix branches passing non-canonical ids as a previously-observed occurrence. A lease acquired under one spelling and released under another is never released: a strand clearable only by `--force-teardown`, which is the same outcome Decision 4a exists to prevent, reintroduced through the key instead of the root. The helper therefore canonicalises the ticket identically on acquire and release, and that canonicalisation lives in the helper rather than at either call site, so the two cannot drift apart again.

**Acquisition happens after ticket-shape validation, not before it.** `check-merge-readiness.sh:122-125` rejects a malformed `TICKET_ID` and exits `FAIL`, and its worktree-dir-missing check at `:127-130` also exits before any lease should exist; `emit-event.sh:279` applies its own ticket-shape check and exits early when it fails — so a lease acquired under a malformed id, or for a worktree directory that was never real, could never be released by the designed seam. Acquisition is therefore placed after argument validation, ticket-shape validation, AND the worktree-dir-missing check, but before any substantive readiness check. This preserves the intended behaviour (a `FAIL` from a real readiness check still leaves the lease held, because the auditor is still alive) while making it structurally impossible to create a lease under a key the release path cannot address, or for a worktree that was never confirmed to exist.

**The lease records the acquiring pid** alongside the script, ticket, worktree path and ISO timestamp. Without it an operator facing a refusal cannot distinguish "the auditor is alive right now, wait five seconds" from "an auditor died an hour ago, override it" except by guessing from the timestamp. It costs nothing to record and makes the refusal message decisively actionable.

This covers the CON-163 sequence exactly: readiness ran (lease taken) → merge → report written → auditor killed before persisting/emitting → lease still present → teardown refuses. The recovered CON-163 report records `Condition 1-3 (check-merge-readiness.sh) — PASS`, so the acquire hook demonstrably ran in that incident before the kill.

A run with agent-merge disabled never calls `check-merge-readiness.sh`, so it never takes a lease and its teardown behaves exactly as it does today.

### Signal B (complementary): a cwd probe

The `/proc/<pid>/cwd` scan is kept, but demoted to what it can honestly do: catch a surviving dev server or a stray operator shell parked in the worktree. It is not what covers the agent case.

`/proc` is Linux-only. On a platform without it the probe degrades to "no holders found" and allows teardown — restoring exactly today's behavior rather than inventing a new failure. Signal A does not depend on `/proc` and is unaffected.

Rejected alternatives for Signal B: `lsof +D` walks the whole tree and is slow; `fuser -m` adds a dependency for a case `cleanup.sh` only uses `fuser` for at the far simpler `<port>/tcp` level; `git worktree remove` without `--force` refuses on a dirty tree, which is a different question.

### Self-exclusion, specified narrowly

Signal B excludes the **literal pid chain only**: the cleanup process, its PPid, that pid's PPid, and so on to pid 1. It never excludes siblings or other descendants of those ancestors. This distinction is load-bearing rather than pedantic: in this harness every agent's bash process shares the harness process as a common ancestor, so excluding "the ancestor chain and everything beneath it" would exclude every process the probe exists to find, making Signal B vacuous. The `/proc` walk must also tolerate pids vanishing mid-scan — a disappeared `/proc/<pid>/cwd` under `set -e` is a real race here, not a theoretical one.

### Honest scope statement

Signal A is a genuine mechanical guarantee for the auditor, because both its hooks are scripts that the auditor cannot skip. It is not a universal guarantee for any future role that writes into a worktree near teardown: such a role would need to take a lease too. Signal B is best-effort. `proposal.md` and the Risks section state this rather than claiming the guard is unconditionally "structurally impossible" to defeat — the earlier draft did make that claim and it was not true.

This also leaves Decision 1's rejection of Direction 2 resting on ground (a) — the false-verdict hazard — which is independently sufficient and does not depend on the "does not close the class" argument.

## Decision 3 — Bounded settle window, not an instantaneous probe

An instantaneous probe is wrong in the common case. `cleanup.sh` kills the dev and backend servers on this ticket's ports immediately before this point, and a process does not vanish the moment `fuser -k` returns. A single-shot check would intermittently refuse on a server that is already dying — turning a fix for a rare evidence loss into a frequent spurious block on every delivery. That would be a strictly worse trade.

The rule, stated once and precisely: **Signal B re-probes every 250 ms for up to 3 seconds, and refuses only if the holder set is non-empty at the moment that bound elapses.** Consequences of that rule, spelled out because the earlier draft was ambiguous between two readings: a holder seen at an early probe but gone by the bound does **not** refuse; a holder appearing newly mid-window refuses only if it is still present at the bound; the script never waits beyond the bound, because a teardown that hangs forever is its own incident. The 250 ms / 3 s values are defaults chosen to be longer than process reaping takes and shorter than a human notices; they are tuning constants, not contract.

**The bound is a wall-clock deadline, captured once, not a running sum of `sleep` durations (corrected post-implementation, evaluation cycle 1 CR-1).** The first implementation tracked elapsed time as `SETTLE_INTERVAL_MS × (number of sleeps)`, which counts only the `sleep` calls and silently ignores the cost of the probe itself (`worktree_holders`, a scan of every live pid). That cost is real and grows with the machine's own pid count and load — measured at ~9.5 s idle and ~10.9 s under load for the documented 3 s bound on a moderately busy machine, which is exactly the loaded-fleet-machine condition Phase-4 teardown actually runs under. The fix: capture `SETTLE_DEADLINE_MS = now_ms() + 3000` once before the loop, and compare `now_ms()` against that fixed deadline after each probe returns (this is the same check whether described as "after the probe returns" or "before sleeping," since the sleep is the next statement) — never accumulate. **This wall-clock deadline is the entire fix; nothing else contributes headroom.**

**`worktree_holders` resolves each candidate pid's `cwd` with a per-pid `readlink`, not a single batched call (corrected again, final-gate skeptic review round 1, CR-1).** A batched, single-call `readlink "${targets[@]}"` was tried as a companion optimisation in the same cycle-2 pass that fixed the deadline above, on the theory that it would cut the probe's own cost and so widen the deadline's margin further. It does not: `readlink` silently omits its output line not only for a pid that vanishes mid-scan but for **any** `/proc/<pid>/cwd` it cannot read, which in practice is every root-owned process — measured on a real host, reproduced twice: 581 candidate pids in, 252 output lines out. That mismatch triggered the batching's own alignment-safety fallback (a per-pid loop, kept for exactly this case) on essentially every real scan, meaning the "fast path" never actually ran in practice — the earlier version of this paragraph claimed it gave the deadline "more headroom against pid-count growth," which was not true as shipped, since the path providing that headroom was dead code. The per-pid `readlink` form was restored as the only implementation: it measures ~0.3 s for a full scan on a real host (584 pids) against the 3 s bound, which is already ample margin, and it removes a redundant, non-functioning code path from the highest-blast-radius script in this repo rather than carrying it for a benefit that does not materialise.

**The settle window applies to Signal B only.** Signal A's lease is not a race — it is an explicit, durable statement that an agent's bracketed lifetime has not closed. It is checked once, and refuses immediately, without waiting.

## Decision 4 — The refusal is overridable, loudly

A guard on an irreversible operation must have an escape hatch, or the first unkillable holder strands a delivered run permanently — the PR merged, the worktree undeletable, the ticket never closed. `--force-teardown` provides it.

Three constraints on the override:
- It is an explicit CLI flag. No environment variable, no default, no implicit condition reaches it. An override that can be triggered accidentally is not an override; it is a disabled guard.

**Parsing, specified exactly** (the existing opt-in has two entry forms and a first-argument requirement, so this cannot be left to the implementer). The `--phase4`-first / `CONCERTINO_PHASE4=1` opt-in semantics at `core/scripts/cleanup.sh:40-48` are unchanged; `--force-teardown` is consumed *after* that check. The legal forms are exactly:

```
cleanup.sh --phase4 [--force-teardown] <WORKTREE_PATH> <DEV_PORT> <BACKEND_PORT> [TICKET_ID]
CONCERTINO_PHASE4=1 cleanup.sh [--force-teardown] <WORKTREE_PATH> <DEV_PORT> <BACKEND_PORT> [TICKET_ID]
```

`--force-teardown` never precedes `--phase4`, because `--phase4` must remain the first argument for the opt-in guard to see it. After the flag is consumed, if the next argument still begins with `--`, the script fails loudly with a usage error rather than binding it as `WORKTREE_PATH` — without that, `CONCERTINO_PHASE4=1 cleanup.sh --force-teardwn ...` (typo) would silently become `WORKTREE_PATH="--force-teardwn"`.
- It reports what it is overriding. Silently skipping the check would destroy exactly the diagnostic information the operator needs.
- It is documented in the script's usage header alongside `--phase4`, so it is discoverable at the moment of refusal rather than by reading source.

## Decision 4a — Releasing inside `emit-event.sh`: seam and ordering

Putting a side effect into `emit-event.sh` deserves justification, because that script is documented as pure telemetry and is deliberately built never to fail a run: it "ALWAYS exits 0, including on internal error" (`:52`), and it has early `exit 0` paths and a ticket-validation guard that can skip the write entirely.

It is nonetheless the right seam. The auditor's last worktree-touching action is the report write, which precedes `persist-evidence.sh` and then the verdict emit; releasing at the emit closes the protected window at exactly the right instant, and no earlier hook exists that means "the auditor is finished".

Two constraints follow from that script's fail-silent posture, and both are requirements rather than implementation detail:

- **Release on recognition, not on successful write.** The lease is released when the call is recognised as an auditor `verdict` invocation, regardless of whether the event write itself succeeds or is skipped. The auditor is finished either way, and the alternative — releasing downstream of the write — would let a silently-dropped telemetry line strand a run behind a permanently-held lease clearable only by `--force-teardown`. A telemetry failure must never cause a strand; that is the one thing this script promises.
- **Release placement (corrected at design-gate round 4, non-blocking note 1): downstream of the main-checkout resolution, not upstream of it.** `TICKET` and `ROLE` are only parsed by the `k=v` argument loop at `:228-270`, and `TICKET` is only validated/canonicalised at `:279-296` — all of that is below `emit-event.sh:178`'s `ROOT="$(main_checkout)" || exit 0`. There is no way to recognise "this is an auditor verdict call" before line 178, so "upstream of :178" as originally stated here is not literally satisfiable. The release is instead placed at the earliest point downstream of :178 where both `TICKET` (canonical) and `ROLE` are known — i.e. immediately after the canonicalisation at `:296`, reusing the already-resolved `$ROOT` from :178 rather than re-resolving it. Consequence, stated plainly: when the main checkout is unresolvable, `main_checkout()` itself already `exit 0`s at :178 before any lease-release code can run, so that case degrades to the `--force-teardown` case rather than to a fail-open — the same tolerable degradation the original note anticipated, just reached from the other direction (the early exit forecloses the release, rather than a downstream release skipping past it).
- **Release never aborts or fails the call.** A failed release is swallowed exactly like a lost event, consistent with the script's existing "a lost event never fails the run" posture.

The header comment block that currently describes the script as side-effect-free telemetry is updated to document the release. An undocumented semantic side effect in a script documented as having none is precisely how this guard would be refactored away by someone acting reasonably on the documentation in front of them.

## Decision 5 — Failure reporting reuses the existing machinery

`cleanup.sh` already has a disciplined failure path: `fail()` as the single exit point, `print_result()` emitting one machine-parseable `RESULT` line on every path. The guard uses `fail()` rather than adding a second exit style, so the `RESULT` line correctly reports the worktree as not removed and the orchestrator's existing non-zero-exit handling (documented in `core/roles/orchestrator.md` Phase 4 as a `BLOCKER`) applies with no change.

The guard runs **before** any destructive step — before the worktree removal, before branch deletion, before the base fast-forward — so a refusal leaves the run in exactly the state it was in, fully retryable.

## Decision 6 — Rendering without `concertino sync`

CON-172 (`03c92be`) added `test/scripts/rendered-scripts-drift.test.sh`, which byte-compares every `core/scripts/**` file against its `scripts/concertino/**` counterpart. Changing `core/scripts/cleanup.sh` therefore requires updating the rendered copy in the same commit.

`concertino sync` must not be used: two untracked files in the main checkout (`scripts/concertino/pricing-table.json`, `report-cost.sh`) are pending an owner decision under CON-173, and a sync would render them into the tree and carry them onto `main` through this PR. The rendered copy is updated by direct `cp` instead — the same approach the CON-172 lane used. The drift gate then verifies the result, which is precisely what it exists to do. (Verified on this branch: the gate is green at HEAD and already exempts both CON-173 files, so the direct-copy path is sufficient.)

## Risks / Trade-offs

- **A refusal caused by a few seconds of overlap.** The benign case — the auditor finishes moments later and releases — needs no human and no override: a plain re-run of `cleanup.sh --phase4` succeeds. This is stated in the orchestrator role so a transient overlap does not escalate to a human by default.
- **False-positive refusal blocking a delivery.** For Signal B the realistic trigger is a just-killed dev server, mitigated by Decision 3's settle window. For Signal A it is a leaked lease from an auditor that died without emitting any verdict — which is not really a false positive: that is precisely the state in which evidence is at risk. Decision 4's override covers both.
- **Signal A is auditor-scoped, not universal.** A future role that writes into a worktree near teardown gets no protection unless it takes a lease of its own. Stated in Decision 2's scope note rather than papered over; the guard is not claimed to make teardown-during-write impossible in general.
- **Signal B is best-effort and Linux-only.** It does not cover an agent between tool calls at all, which is why it is not the load-bearing signal. Degrades to today's behavior on a platform without `/proc` rather than to a new failure.
- **A guard that is never exercised in the happy path is a guard that can rot.** Mitigated by the required test coverage: the suite must fail if the guard is deleted, which is the acceptance criterion rather than merely testing that cleanup still works.
- **Prompt-only half of the fix could drift.** Accepted: Direction 3 is what makes the drift non-destructive, which is the whole reason for adopting both.

## Migration Plan

None required. The guard is additive and passes silently when no holder exists, so every existing call site behaves identically on a run with nothing live in the worktree. `--force-teardown` is new and optional.

## Open Questions

None blocking. The one judgment call the owner may wish to revisit is the settle-window duration, which is a tuning constant, not a contract.
