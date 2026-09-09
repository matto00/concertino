## Evaluation Report — Cycle 2 (evaluation-2.md)

Amended commit `400a95d` (was `2086609`), same branch, still a single commit.
Repo: concertino (bash-only; no UI surface).

### Phase 1: Spec Review — PASS

Issues: none.

`core/scripts/squash-branch.sh` is **byte-identical** to cycle 1
(`git diff 2086609..HEAD -- core/scripts/squash-branch.sh` is empty), so every Phase-1
finding from evaluation-1.md (AC1–AC5, spec delta, task marks, D1–D7 conformance) carries
over unchanged and was not re-litigated. The delta is confined to:

- `test/scripts/squash-branch.test.sh` — 4.2/4.3/4.3b/4.4b assertion tightening.
- `openspec/changes/.../mutation-transcript.md` — appended Cycle 2 addendum; the original
  content is untouched (verified: the diff is pure addition after line 207).
- `openspec/changes/.../files-modified.md` — both entries amended to describe the cycle-2
  work. The declaration is accurate and complete for the amended commit.
- `openspec/changes/.../evaluation-1.md` — my own cycle-1 report, swept into the commit.
  Covered by the `<CHANGE_DIR>/**` workflow-artifact allowlist, so it does not need to be
  named in `files-modified.md`; not scope creep.

Scope still clean: no dry-run flag (CON-164), no edit to `scripts/concertino/squash-branch.sh`
(CON-172), no unrelated refactor, no change to `core/scripts/lib/`.

### Phase 2: Code Review — PASS

**Fresh gate run on `400a95d`** (mine, not the executor's): `npm test` → `EXIT=0`,
`squash-branch.test.sh: 39 passed, 0 failed`, zero `FAIL` lines across the full run.

**1. Early-death mutation re-run independently.** In isolated copies at `/tmp/con162-eval2`
(the delivery worktree was never mutated), I built two trees differing ONLY in the test file —
`old` = the test file at `2086609`, `new` = the test file at `400a95d`, both against the same
(unchanged) script — then removed `core/scripts/lib/git-child-env.sh` from each:

| | 4.2 | 4.3 | 4.3b | 4.4b | totals |
|---|---|---|---|---|---|
| old test file | green | green | green | red | 18 passed, 21 failed |
| new test file | **RED** | **RED** | **RED** | **RED** | 15 passed, 24 failed |

Confirmed on both counts: those three assertions genuinely went green before and genuinely
go red now, and my totals match the executor's addendum (`15 passed, 24 failed`) exactly.

**2. An additional discriminator the executor did not claim.** The early-death shape does not
actually discriminate 4.4b (it was already red there under the old assertion, since the whole
output was the loader error). To check the 4.4b tightening was not cosmetic, I re-ran the
cycle-1 "D4a no-parse" mutation (gate the blob parse on `FILE_ON_DISK -eq 1`), which produces
a refusal from the *generic* branch whose output still lists `sneaky.txt`:

- old test file: `38 passed, 1 failed` — 4.4b's message assertion stayed **green** (matched
  the incidental staged-files listing).
- new test file: `37 passed, 2 failed` — 4.4b now goes **RED**.

So the 4.4b anchoring closes a real hole, not just a stylistic one.

**3. Brittleness / tautology check — no concerns.**
- The three greps target text unique to the branch each scenario names: `differs between the
  staged index and the worktree` exists only in the D2 divergence refusal; `no staged blob in
  the index` only in the D4 not-in-index refusal (the generic branch's near neighbour reads
  `no staged declaration blob exists at ...`, which this pattern does **not** match — I checked
  specifically, because a pattern that matched both would have made 4.3b tautological);
  `exceeds the run's declared touched-file set` only in the allowlist refusal.
- None is so loose it matches something incidental (proven by the four mutations above going
  red), and none is a whole-sentence exact match that a minor reword would break — each is a
  substring, case-insensitive, matching the convention 4.1 and 4.4 already used. The coupling
  to diagnostic wording is deliberate and is the point of the change request.
- Assertions are conjunctions (`exit non-zero` AND `message`), so neither half was weakened.
- `bad` messages were correctly updated from the now-false hardcoded `exit=0` to `exit=$RCxx`,
  so a failure report no longer misstates the observed exit code.

**4. Tree integrity.** `git status --porcelain` in the delivery worktree is empty;
`git diff main..HEAD -- core/scripts/lib/` is empty, so `git-child-env.sh` was genuinely
restored and nothing else was disturbed by any mutation run. My own probes ran entirely under
`/tmp`, which I removed afterwards.

### Phase 3: UI Review — N/A

Bash-only change in the concertino repo; no `frontend/**`, no API/schema/spec runtime surface.
No dev servers were started.

### Overall: PASS

### Change Requests

None.

### Non-blocking Suggestions

- The Cycle 2 addendum describes 4.4c and 4.5 as "the newly-tightened 4.4c/4.5". Neither was
  tightened this cycle — they assert exit 0, so they go red under the early-death mutation
  regardless. Minor factual slip in an evidence document, worth correcting on any future touch
  since mutation transcripts are read as ground truth.
- The addendum credits the early-death mutation with proving 4.4b's tightening; it does not
  (4.4b was already red there). The D4a no-parse mutation in section 2 above is the probe that
  actually discriminates it — worth folding in if the transcript is revised.
- Still open from cycle 1 (unaddressed, and correctly so — it was never a required change):
  the suite has no up-front assertion that `core/scripts/lib/` is present, so a missing loader
  still produces ~24 confusing red assertions rather than one clear prerequisite failure.
