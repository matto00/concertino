## Why

On 2026-08-21 a Concertino delivery run bricked its own repository for ~70 minutes: an executor added a new pre-commit gate script (which internally runs `git init` to build fixtures), wired it into `.husky/pre-commit`, and committed all three changes together. Husky ran the new gate's first-ever execution against the live repo from a linked worktree; it inherited the hook's exported `GIT_DIR`, and `git init` re-initialised the real repo as bare. No agent broke procedure — the standing "never `git commit -n`" rule is what triggered the hook that detonated the bug. Six design-gate rounds, a cold skeptic, and an evaluator all reviewed the script's logic and none caught it, because the defect is in environment inheritance, invisible in a diff, and only reproducible under a hook-shaped environment (linked-worktree `GIT_DIR`) that ordinary manual testing never exercises.

Concertino currently treats an edit to `.husky/pre-commit` (or a script it invokes) as an ordinary file change. It needs to be treated as a live-infrastructure change instead, with the workflow itself — not agent recall — enforcing that its implications are stated and it is proven safe in isolation before it can run live.

## What Changes

- Add a **mechanical classifier** for gate-chain changes: any diff touching `.husky/**`, `.husky/pre-commit`'s gate list, or a script that hook invokes (resolved via `package.json` `scripts` entries the hook calls) is flagged as a live-infrastructure change.
- Add a **Gate-Chain Implications Checklist** template section (design.md) that a flagged change must answer: what the gate executes, what environment it inherits and from where, whether it writes outside its own sandbox, whether it behaves differently from a linked worktree vs. a main checkout, and what happens on its first run.
- Add a **mechanical enforcement gate**: `assert-phase.sh delivery` (calling the new classifier `core/scripts/check-gate-chain-change.sh`) fails the run (blocking Delivery, before PR creation) if the diff is flagged as a gate-chain change and either the implications checklist or a per-script isolation-test transcript is missing/incomplete. A run that skips these obligations fails a script check, not a review comment.
- Add **isolation-first execution** requirement: a new/modified gate must be demonstrated against a throwaway fixture repo under a hook-shaped environment (`GIT_DIR` pointing at a `.git/worktrees/<name>`-style path) before the commit that wires it into `.husky/pre-commit`, producing a pass/fail corruption verdict for that specific script. The demonstration's evidence (a markdown transcript) is what the mechanical gate above checks for, per script.
- Update `core/roles/executor.md` and `core/roles/orchestrator.md` (surgically — CON-131/CON-133/CON-134 also touch these) to: (a) direct the executor to run the new isolation-test helper and record evidence before wiring a gate, (b) direct the orchestrator's Planning phase to flag gate-chain diffs early and require the design.md checklist be answered before advancing past the design gate, matching the mechanical Delivery-time check as a second, earlier tripwire.
- Add a helper script `core/scripts/test-gate-in-isolation.sh` that runs a target gate script once against a disposable `mktemp -d` fixture repo with `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE` set to mimic a Husky hook invoked from a linked worktree, and writes the per-script pass/fail evidence transcript the mechanical check consumes.
- Document staging guidance (script-first, wiring-second across two commits) in the checklist template's guidance text, with the explicit warning about never leaving a worktree with a hook referencing a missing script.

## Capabilities

### New Capabilities
- `gate-chain-live-infra-classification`: classifies a diff as touching the commit-gate chain, requires an answered implications checklist and isolation-test evidence, and mechanically blocks Delivery when either is missing for a flagged change.

### Modified Capabilities
(none — no existing spec's requirements change; `git-child-env-hardening` addressed the underlying env-leak on the helio side and is not itself modified here)

## Impact

- `scripts/concertino/` — two new scripts (`check-gate-chain-change.sh`, `test-gate-in-isolation.sh`) plus a new selftest for each.
- `scripts/concertino/assert-phase.sh` — delivery-phase check gains one additional mechanical gate call.
- `core/roles/orchestrator.md`, `core/roles/executor.md` — surgical additions describing when/how the new checklist and isolation-test evidence are produced and checked.
- `core/workflow-state.template.md` (maybe) — no new persisted field strictly required, since evidence lives in `design.md` + a recorded evidence file under the change dir, consistent with existing evidence-persistence conventions (`persist-evidence.sh`).
- No behavior change for any diff that does not touch the gate chain — the classifier is a no-op (fast PASS) for ordinary changes.
