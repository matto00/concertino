## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

**Artifacts read in full:** `ticket.md`, `proposal.md`, `design.md` (D1–D5 + Risks),
`tasks.md`, `specs/delivery-squash-guard/spec.md`, plus the subject script
`core/scripts/squash-branch.sh` (243 lines, at `fc88cd0`) and its suite
`test/scripts/squash-branch.test.sh` (555 lines).

**Q1 — is D3's declaration-only scoping correct, or is there an equivalent hole?**
Enumerated every input that feeds the allow/refuse decision in the script as it
stands at `fc88cd0`:
- `MERGE_BASES` (L95), `BASE_TIP` (L110), `STAGED_FILES` (L120) — all from git
  (index / refs), not the worktree.
- `CHANGE_DIR_NORM` (L128) → allowlist arm (a) in `is_allowed` (L161-163) — from
  argv, not disk.
- `DECLARED_PATHS` (L131-152) → allowlist arm (b) — the ONLY worktree-disk read.
- Remaining worktree reads are diagnostic-only: `cat "$FILES_MODIFIED_PATH"` (L202)
  and the path interpolated into the L220 message.

So the decision depends on exactly one on-disk file, and D3's scoping is correct —
no equivalent index/worktree hole via another input. D3's stated rationale
(refusing on any dirty *declared source path* would spuriously stop ordinary runs)
also holds: nothing about a dirty source path affects the guard's verdict.
**D3 confirmed.** But see CR4: the two *diagnostic* reads are left pointed at the
worktree by the current tasks.

**Q3 — does D1's `git show :<path>` break the ordinary delivery path?**
Did not accept the plan's claim; measured it three ways.

(a) Mechanics, in a scratch repo:
```
git -C <wt> show :openspec/changes/x/files-modified.md   -> blob, exit 0
(after worktree-only edit) same command                  -> STALE staged content
git -C <wt> diff --quiet -- <path>                       -> exit 1 on divergence
git -C <wt> show :<untracked path>                       -> "exists on disk, but not
                                                            in the index", exit 128
```
Confirms `:<path>` is repo-root-relative under `-C` (design's Risks note is right),
that the blob is genuinely the stale one, and that D4's trigger is a distinguishable
exit-128 with a specific message.

(b) The existing suite is compatible: every scenario stages the declaration via
`commit_all()` (`git add -A` + commit, L39-43) before invoking the script —
scenarios 1/1b/1c, 2/2b/2c/2d, 3, 4 (`make_branch4`), 5a/5b. D1 therefore does not
mass-break the suite, and no task to repair existing tests is needed. Verified.

(c) Real runs: PR #119 (CON-163 — the immediately preceding real delivery of this
very script) has squash commit `2e9517f`, whose file list includes
`openspec/changes/validate-before-reset/files-modified.md`. So on the full workflow
path a staged blob does exist at squash time. **The plan's premise holds for the
full path.** However — PRs #117 (`f98f95b`) and #118 (three commits) contain **zero**
`openspec/changes/**` files of any kind, and there are no archive entries for those
tickets. Runs in this repo do reach a merged PR without the change dir tracked at
all. That is the gap behind CR1.

**Q2 — does the plan actually prevent `--allow-empty-declaration` becoming amnesty?**
Directionally yes: D5 is stated as a structural requirement, task 3.1 orders
independent evaluation, task 4.3 pins it with a behavioural test that must be
mutation-proven (4.6). But the tasks under-cover the spec by exactly one scenario —
see CR3. Also note the flag is parsed only as `${6:-}` (L77), so it cannot leak in
positionally; nothing else in the script consults it. The mechanism is adequate once
CR3 is closed.

**Q4 — disjoint from CON-164?** Read CON-164 from Linear: it adds `DRY_RUN=1`
gating the *reset + commit* (script L230-243) and asserts HEAD/index unchanged on a
would-pass branch. This change touches the declaration read (L130-152) and inserts
refusals before the L197 branch. Logically disjoint; only same-file textual
adjacency, already named out of scope in ticket/proposal/tasks 6.1. **Confirmed
disjoint.** No revision needed.

**Scope / AC coverage:** AC1→D1+task 1.1; AC2→D2+2.1; AC3→D3+2.3+4.5; AC4→4.1/4.2
+4.6 mutation proof; AC5→D5+3.1+4.3 (partial, CR3). No task exceeds the ticket.
The three out-of-scope items are named in all three artifacts consistently. No
`TODO`/`TBD`/deferred decision found.

### Verdict: REFUTE

The core design (D1 + D2 as both-not-either, D3's scoping) is sound and I could not
break it. The refutation is about four specific under-specifications, all cheap to
fix in the artifacts, two of which would otherwise be resolved by implementer guess.

### Change Requests

1. **D4 will convert a currently-passing real-run shape into a hard BLOCKER, and
   the design does not acknowledge it.** `design.md` Risks claims ordinary runs are
   protected by "D3's scoping and a test asserting the ordinary consistent path
   still commits". That mitigation does not cover the case where the change dir is
   present on disk but **entirely untracked** at squash time — today the guard reads
   the disk declaration and passes; under D4 it refuses. This is not hypothetical:
   PRs #117 and #118 in this repo merged with zero `openspec/changes/**` files in
   any commit. Because `core/roles/orchestrator.md:997` instructs that a non-zero
   exit is a `BLOCKER` escalated to a human rather than retried, this becomes a
   run-halting page. Required: (a) add this case to `design.md` Risks explicitly,
   and (b) require D4's diagnostic to print the concrete self-service remedy
   (stage the declaration — `git add <CHANGE_DIR>/files-modified.md` — and re-run),
   with task 4.4 asserting that remedy text is present, not merely that "a distinct
   diagnostic" fires.

2. **Unspecified case: declaration absent from the worktree but present in the
   index.** D2 defines divergence as "`git show :<path>` and the worktree file
   differ"; D4 covers on-disk-but-not-in-index. Neither covers the inverse — file
   deleted (or never written) on disk while a blob is staged. An implementer can
   read this two ways: (i) treat missing-on-disk as a divergence and refuse, or
   (ii) skip the divergence check when `[ -f "$FILES_MODIFIED_PATH" ]` is false and
   parse the blob, which is what the commit will capture. These give opposite
   behaviour on a real shape (executor deletes/renames the handoff after committing
   it). Decide it in `design.md` and pin it with a scenario in `tasks.md` §4 and the
   spec delta. Note (ii) also silently changes the existing "declaration missing"
   diagnostic at L205, which currently reports the worktree path as missing.

3. **D5's structural coverage is one scenario short of the spec it ships.** The
   spec delta's `--allow-empty-declaration does not suppress a declaration
   divergence` scenario is written over BOTH conditions ("diverges … **or** is
   present on disk but absent from the index"), but `tasks.md` 4.3 only covers the
   divergence half, and 4.6's mutation proof lists 4.1-4.4 (so the flag-plus-D4 case
   is never exercised at all). Given AC5 and D4's own rationale — that
   `--allow-empty-declaration` is precisely the *wrong* remedy on that branch —
   the untested half is the more dangerous one. Add a 4.3b scenario: declaration on
   disk but not in index, `--allow-empty-declaration` passed, still refuses and
   commits nothing; include it in 4.6's mutation set.

4. **Task 1.1 changes the validated source but leaves the reported source pointed at
   the worktree.** After D1, the L197-210 failure branch still `cat`s
   `$FILES_MODIFIED_PATH` as "raw files-modified.md content" (L200-206) and L220
   still names `$FILES_MODIFIED_PATH` as where declarations come from. D2 makes the
   two equal *in practice*, but that is exactly the coupling `design.md`'s own D2
   "Relationship to D1" note argues against relying on: if D2 is ever loosened, the
   guard would again validate one source and report another — the same defect class
   this ticket exists to remove, in the diagnostic layer. Extend task 1.1 (or add
   1.3) to print the staged blob as the raw content and to word L220 as the staged
   declaration. This is a wording/source change inside the lines already being
   touched, not a refactor, so it does not breach out-of-scope item 6.3.

### Non-blocking notes

- Divergence detection method is unspecified. Prefer `git diff --quiet --
  <CHANGE_DIR_NORM>/files-modified.md` (verified above: exit 1 on divergence) over
  comparing `"$(git show :path)"` with `"$(cat path)"` — command substitution strips
  trailing newlines, so a trailing-whitespace-only divergence would be silently
  missed by the string comparison.
- D5 is asserted behaviourally (a test that passes the flag and expects a refusal).
  A cheap genuinely-structural addition would be a grep asserting
  `ALLOW_EMPTY_DECLARATION` is not referenced anywhere inside the new refusal block.
  Optional; the behavioural test plus mutation proof already satisfies AC5.
- `git show` writes its "exists on disk, but not in the index" text to stderr with
  exit 128, while a missing-from-both file exits 128 with a different message. When
  implementing D4, branch on the file's on-disk presence rather than on `git show`'s
  exit code alone, which does not distinguish the two.
