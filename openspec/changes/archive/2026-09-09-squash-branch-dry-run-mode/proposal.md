## Why

`squash-branch.sh` is a gate that can only be consulted by submitting to it. There is no invocation that answers *"would this pass?"* without also performing the squash on success, so an instruction as ordinary as "verify the guard passes, then hand back" is literally impossible to follow: the caller either commits (exceeding its instruction) or skips the check (not following it). A gate that cannot be cheaply consulted pushes callers toward reasoning about what it *would* say instead of asking it — which is strictly worse than a flag.

## What Changes

- `core/scripts/squash-branch.sh` honours a `DRY_RUN=1` environment variable, spelled exactly as helio's `scripts/release/cut-release.sh:81` spells it (`[ "${DRY_RUN:-0}" = "1" ]`), so there is one convention across the script suite.
- Under `DRY_RUN=1` the script runs **every** validation it runs today — merge-base computation and criss-cross refusal, base-advancement logging, prospective staged-set computation, the CON-162 staged-blob / on-disk / divergence checks, declaration parsing, and the allowlist comparison — and exits with the identical code it would have exited with without the flag, **for every validation outcome**. That qualification is deliberate and is the one place this change knowingly falls short of the ticket's AC3 as literally worded: two non-zero exits in the script (`reset` failed, `commit` failed) lie below the mutation point and report failures of git operations a dry run never performs, so no implementation can make them predictable from a dry run. The reachable instance is an empty prospective staged set; design.md D6 argues it as a Non-Goal rather than leaving it implicit.
- Under `DRY_RUN=1` the script performs no branch mutation: no `git reset`, no `git commit`, no `HEAD` movement, no index change.
- Output under `DRY_RUN=1` is the same diagnostic stream as the normal path, plus one unambiguous marker that this was a dry run and nothing was committed, so a transcript can never be misread as a completed squash.
- The change adds a mutation-guarded regression test proving the no-mutation property **on a branch that would pass** — the case an unguarded implementation would still commit — captured as a failable transcript.
- The guard's judgment is untouched: no refusal that fires today stops firing, and no allowlist or declaration semantics change.

## Capabilities

### New Capabilities

None. The consultation contract belongs to the existing squash-guard capability rather than to a capability of its own — it changes how the same guard may be invoked, not what it judges.

### Modified Capabilities

- `delivery-squash-guard`: adds a requirement that the guard is consultable without submitting to it — a dry-run invocation performing every validation and producing the same exit code and diagnostics while mutating nothing. The existing requirement that a refusal leaves the branch as it found it is complemented, not replaced: that one covers the refusal path only, whereas this covers the passing path, which is precisely where the current script commits.

## Impact

- `core/scripts/squash-branch.sh` — the source of truth (`scripts/concertino/squash-branch.sh` is a render target and is not hand-edited here; see CON-172).
- Callers of the squash step are unaffected by default: `DRY_RUN` unset preserves today's behaviour exactly, so the orchestrator's Delivery-phase invocation is unchanged and no prompt or role file must change for this to be safe.
- No dependency, API, or schema surface is touched. The change is confined to one shell script plus its spec delta and test evidence.
