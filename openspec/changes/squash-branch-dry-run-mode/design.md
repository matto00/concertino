# Design — squash-branch.sh dry-run mode (CON-164)

## Context

At the base commit for this change (`origin/main` = `2101a78`), `core/scripts/squash-branch.sh` has the following structure, verified by reading the file rather than any prose summary:

1. Argument binding, worktree existence check.
2. D1 — merge-base computation; ambiguous (criss-cross) merge-base is a loud stop.
3. D3 — base-advancement logging (never gates).
4. Prospective staged-file-set computation via `git diff --cached --name-only <merge-base>` — computed *without* moving HEAD.
5. CON-162 declaration handling: on-disk presence, staged blob presence, the on-disk-but-unstaged refusal (D4), the index/worktree divergence refusal (D2/D7), and the index-only INFO note (D4a).
6. Declaration parsing (D2a/D2a-ii) and allowlist construction.
7. Unconditional printing of staged count + list.
8. The two guard refusals: no-usable-declaration-with-outstanding-files, and staged-set-exceeds-declared-union.
9. **Only then**: `git reset --soft <merge-base>`, then `git commit`, then `READY`.

The single most important structural fact for this change is that step 9 contains the **only** mutation in the script, and every *validation* — and therefore every *guard refusal* — lives strictly above it. That is not incidental: it is exactly what CON-163 (`fc88cd0`) established, and the shipped spec requirement "A refusal leaves the branch exactly as it found it" depends on it.

That fact must be stated at exactly this width and no wider. Two non-zero exits do live **below** the mutation point:

- `core/scripts/squash-branch.sh:284–287` — `git reset --soft <merge-base>` itself failed.
- `core/scripts/squash-branch.sh:289–292` — `git commit` itself failed after the guard had already passed.

Neither is a guard verdict. Both report failure of a git operation that a dry run, by construction, never performs and therefore cannot predict. So the correct claim — the one this design actually relies on — is: **dry and wet invocations produce identical exit codes and identical diagnostics for every validation outcome.** The claim "identical on every path" is false, and an earlier draft of this document asserted it; it is recorded here explicitly so a later reader does not re-derive it.

## Goals

- Make the guard consultable without submitting to it.
- Preserve exit-code and diagnostic identity between dry and wet invocations **for every validation outcome** — that is, for every guard verdict. Not for every path: see §Context and D6 for the two exits below the mutation point that no dry run can predict.
- Change no judgment: every refusal that fires today must still fire.

## Non-Goals

- Changing the guard's strictness, the allowlist semantics, or the declaration grammar.
- Addressing CON-170 (branch left at merge-base when the `git commit` itself fails after the guard passed). That defect lives *below* the mutation boundary and is a distinct concern; this change neither fixes nor worsens it. Under `DRY_RUN=1` the CON-170 window is simply not entered, but that is a side effect, not a fix — the wet path is unchanged.
- Editing the rendered copy at `scripts/concertino/squash-branch.sh` (CON-172). Source of truth is `core/`.

## Decisions

### D1 — Spelling: `DRY_RUN=1` as an environment variable, not a positional argument or a flag

The script binds `$1`–`$5` positionally and reads `$6` as the single optional literal `--allow-empty-declaration`. Adding a second optional positional would force real argument parsing (order-independence between two optional flags), which is a change to the calling contract with no upside here.

An environment variable avoids that entirely and matches the convention the ticket cites, which was verified against helio `scripts/release/cut-release.sh:81`: `if [ "${DRY_RUN:-0}" = "1" ]`. The comparison is an exact string match against `1`, not a general truthiness test — so `DRY_RUN=true`, `DRY_RUN=yes` and `DRY_RUN=0` all mean "not a dry run". This is deliberately copied rather than improved upon: one spelling across the suite is the ticket's stated point, and a script that accepted more spellings than its sibling would be the same inconsistency in the opposite direction.

The variable is read once, near the argument binding, into a normalized `DRY_RUN_MODE` 0/1 integer, mirroring how `ALLOW_EMPTY_DECLARATION` is already normalized. The script runs under `set -u`, so the `${DRY_RUN:-0}` default is required, not optional.

### D2 — One branch point, immediately above the mutation

The dry-run early return is inserted at exactly one place: after the guard block (step 8 above) and before `git reset --soft` (step 9).

This placement is the whole design, and it follows from the CON-163 structure rather than being an independent choice:

- **Exit-code identity on every refusal path is structural.** Every refusal is above the insertion point, so a dry run reaches those `exit 1`s by executing literally the same code, in the same order, with no dry-run conditional anywhere near them. There is no parallel "dry-run refusal path" that could drift out of sync with the real one, because there is no second path at all.
- **Diagnostic identity is likewise structural.** Every `echo` in the script, including the unconditional staged count and list, is above the insertion point.
- **Only the guard-passed path differs**, by substituting an early `exit 0` for reset-then-commit. Where the wet path's reset and commit both succeed, both invocations exit 0. Where either git operation itself fails, the wet path exits 1 from lines 284–287 or 289–292 while the dry run has already exited 0 — see D6, which decides that case deliberately rather than leaving it implicit.

Rejected alternative: guarding the `reset` and `commit` calls individually with `if [ "$DRY_RUN_MODE" -ne 1 ]`. That leaves the script running past the boundary into the `READY squash commit created on ...` message, which would then either lie or need its own conditional. A single early return keeps exactly one dry-run conditional in the file.

### D3 — Output marker: distinct wording, on the same success channel

On a passing dry run the script prints a `READY`-prefixed line that is unmistakably not the wet one:

```
READY dry run: guard passed, nothing committed (DRY_RUN=1)
```

`READY` is retained as the prefix because callers and the surrounding tooling key off `READY`/`FAIL` prefixes, and a dry run that passed genuinely is a `READY` outcome. The trailing text is what distinguishes it, and it states both facts a reader needs: the guard passed, and nothing was committed. The wet path's message (`READY squash commit created on <branch>`) is untouched, so no existing transcript-matching breaks.

The refusal paths get no marker at all, deliberately: their output must be byte-identical to the wet refusal, per the spec requirement, and a dry-run banner would violate that for no benefit — a refusal committed nothing either way, so there is nothing to disambiguate.

### D4 — Testing: mutation-guarded, on the passing path

The ticket is explicit that a test on the refusal path alone would miss the defect, and it is right: on a refusing branch the current script already mutates nothing (CON-163), so such a test would pass against the *unmodified* script and prove nothing about `DRY_RUN`.

The new scenario therefore builds a fixture branch whose guard **would pass** — a declared `own-file.txt` plus a consistent staged `files-modified.md`, the same shape as the existing 4.5 regression fixture — and asserts across a `DRY_RUN=1` invocation:

- exit code is 0;
- `git rev-parse HEAD` is identical before and after;
- the index is identical before and after, captured as `git write-tree` (the staged tree hash) **and** `git status --porcelain`. Both are needed: `write-tree` catches a change to staged content, `status --porcelain` catches worktree/staging-area movement that could leave the same tree hash;
- the commit count on the branch is unchanged, so no squash commit was created;
- output contains the dry-run marker and does not contain the wet `squash commit created` wording.

A second dry-run scenario covers a refusing branch, asserting exit 1 and that the refusal text matches what the same fixture produces without the flag — this is the exit-code-and-diagnostic-identity claim, tested by running the same fixture both ways and comparing, rather than by hardcoding an expected string.

A third, cheap assertion covers D1's exact-match semantics: `DRY_RUN=true` on the passing fixture must commit, proving the script did not silently adopt a looser truthiness test than `cut-release.sh` uses.

### D4a — Failability (the mutation proof)

Per this repo's established convention (`Scenario 2d` in the existing test file, and the "demand the red" law), the no-mutation assertion must be shown to be failable rather than vacuous. The test snapshots the real script, mutates it in place to delete the dry-run early return — the precise defect the ticket describes, an implementation that accepts the flag but commits anyway — re-runs the passing fixture with `DRY_RUN=1`, and asserts HEAD **moved**. It then restores from the snapshot.

The existing file already provides the safe machinery for this: a `PRISTINE_SCRIPT` snapshot taken at start-up (not from git HEAD — CON-151's fix, which matters precisely because this run has an uncommitted edit to that very file) plus an `EXIT` trap that restores it unconditionally. The new scenario reuses that machinery rather than adding a second restoration mechanism.

### D5 — Blast radius on existing callers

`DRY_RUN` unset is the default in every existing caller, so the orchestrator's Delivery-phase invocation, the rendered copy's callers, and the existing 30-odd assertions in `squash-branch.test.sh` all take the wet path unchanged. No prompt, role file, or documented procedure needs to change for this to be safe. Documenting the new affordance in the orchestrator's Delivery step is deliberately **out of scope** here: it is a prompt change whose value depends on decisions about when a caller should consult the gate, and folding it in would widen a one-script change into a workflow change without a ticket asking for it.

One consequence worth stating plainly: the script's usage comment block is part of its interface, and it currently documents only positional arguments. The dry-run affordance is added to that block, since a flag discoverable only by reading the implementation is barely an improvement on no flag.

### D6 — The empty-prospective-staged-set case, decided deliberately

There is one reachable input on which dry and wet exit codes genuinely diverge, and it is named here rather than left to be discovered later.

When the prospective staged set is **empty**, the guard passes: `UNEXPECTED` is empty, so neither the no-usable-declaration refusal nor the staged-set-exceeds-declaration refusal fires, and control reaches the reset. The wet path then resets and runs `git commit` with nothing staged; the script passes no `--allow-empty`, so git exits non-zero and the script reports `FAIL git commit failed after guard passed` (line 289–292). A dry run on that same input exits 0 having truthfully reported that the guard passed.

**This is a Non-Goal, deliberately.** Three reasons:

1. The dry run is not wrong. It is a guard-consultation affordance, and the guard genuinely did pass. Reporting "the guard passed" on an input where the guard passed is the correct answer to the question being asked.
2. The divergence is a pre-existing wet-path defect, not one this change introduces. An empty squash failing at the commit step — and leaving the branch reset to merge-base when it does — is precisely CON-170's territory. It is visible today with `DRY_RUN` unset.
3. Fixing it here would require changing the wet path, and the only obvious fixes are both unrequested behaviour changes: adding `--allow-empty` (which would make empty squashes silently succeed — a real semantic change nobody asked for), or adding a pre-commit emptiness refusal (which would be a *new refusal*, and this ticket forbids changing the guard's judgment in either direction).

The obligation this design does accept is honesty: the spec requirement and the proposal are scoped to validation outcomes rather than claiming an identity that this input falsifies, and `tasks.md` §4.3 carries an explicit instruction not to "fix" this while implementing.

## Gate-chain implications

Verified, not assumed: `scripts/concertino/check-gate-chain-change.sh` classifies a change as gate-chain-affecting when it touches a path under `.husky/` or a script file referenced from `.husky/pre-commit`'s command list. `core/scripts/squash-branch.sh` is neither — it is invoked by the orchestrator during the Delivery phase, not by the pre-commit hook. This change therefore does not require a Gate-Chain Implications Checklist, and the Delivery-phase `assert-phase.sh delivery` check should not demand one. If that check does fire, the classification above is wrong and the discrepancy must be investigated rather than worked around.

## Risks

- **Risk: the guard protecting this very delivery is the stale rendered copy, not the code being changed (CON-172).** `core/scripts/squash-branch.sh` and `scripts/concertino/squash-branch.sh` were confirmed to diverge at `2101a78`. The orchestrator's Delivery step invokes the rendered copy. Consequence: this change's own squash is guarded by the *old* behaviour, and a defect introduced into `core/` would not be caught by this run's own delivery. Mitigation: the test suite exercises `core/` directly (`SCRIPT="$ROOT/core/scripts/squash-branch.sh"`), so correctness of the changed file is established by tests rather than by this run's delivery happening to succeed. This risk is inherent to the render split and is CON-172's to fix, not this ticket's; it is recorded here so no reviewer mistakes a green delivery for evidence about `core/`.
- **Risk: the test suite mutates the real script in place.** Already true today and already mitigated by the snapshot-plus-trap machinery; the new scenario adds one more mutation window. It reuses the existing trap rather than introducing a new one, so an interrupted run restores the same way it does now.
