## Skeptic Report — final gate (round 3, skeptic-final-3.md)

Cold review. HEAD reviewed: `e01b46e0a94c0f4df54d75cbe1b10d7e90a189e0`.
This is round 3 of `SKEPTIC_FINAL_ROUNDS=3` — last round of the extended budget.

### cwd guard

`pwd -P` = `/home/matt/Development/helio`. Ran
`scripts/concertino/assert-cwd.sh "$AMB" "$WORKTREE_PATH" "$BRANCH"` ->
`READY ambient=/home/matt/Development/helio branch=feature/followup-survival-report/CON-192`,
rc=0. Proceeded. No writes made to `/home/matt/Development/helio`.

### What I verified (with evidence)

1. **Diff base / HEAD.** `git rev-parse HEAD` = `e01b46e0a94c0f4df54d75cbe1b10d7e90a189e0`.
   `openspec/changes/followup-survival-report/` is unstaged-clean apart from
   `workflow-state.md` (mine per brief) and untracked `evaluation-2.md`
   (mine per brief).

2. **Task 7.1's fix, re-read directly** (`lib/cli/report.js:257-268`, diff
   `8ec49c7..e01b46e`). The empty-provenance branch's old text ("this run's
   own filing is the exception; see below") is removed and replaced with
   text scoped only to what's true of the current render ("No follow-up
   provenance has been recorded yet in this event store..."). This is
   exactly what skeptic-final-2's Change Request #1 asked for.
   `test/cli-report.test.js` gained test `7.1`, which I read: it builds a
   model with `provenanceEvents: []`, renders, and asserts the old phrases
   are absent. This test is genuinely failable against pre-fix code — its
   own comment and construction make that traceable without needing to
   re-run the stash-based reproduction skeptic-final-2 used (and flagged as
   risky). I searched the rest of `report.js` for the same "see below" /
   "this run" pattern and found no other instance (`grep -n "see below\|this
   run's own\|this run" lib/cli/report.js` -> only the fix's own comment).
   **Confirmed fixed, no sibling instance.**

3. **Full `npm test`, re-run myself, untruncated.** Captured full output
   (not just the last 20 lines) to `/tmp/skeptic_npmtest_full.log`:
   `# tests 2365`, `# pass 2365`, `# fail 0`, exit 0; bash-suite section
   (`16 passed, 0 failed`, instrumentation digest) prints last with no
   failures anywhere in the combined run; grepped for `not ok`/non-`0
   failed` lines and found none (matches on "failed" were all inside test
   *names*, e.g. "a failed spawn..."). This matches the claimed baseline of
   2365 and exceeds task 7.10's stated floor of 2364.

4. **`openspec validate "followup-survival-report" --type change`** ->
   `Change 'followup-survival-report' is valid`, rc=0.

5. **§D partition, independently recounted.** "Would have caught" list in
   the shipped artifact = {#2,#3,#4,#6,#9,#10} = 6 items. "Would NOT have
   caught" list = {#1,#5,#7,#8,#11,#12,#13,#14} = 8 items. 6+8=14, disjoint,
   union is exactly {1..14}. Matches the artifact's own stated "6 of 14 ...
   disjoint, summing to 14." **Confirmed.** (Note: `tasks.md` task 7.6's own
   instruction text says "roughly 6 of 13" and lists only 6 missed
   instances — the shipped artifact correctly supersedes that stale,
   miscounted task description rather than reproducing its error; this is
   not a defect.)

6. **§F recomputed figures, spot-checked directly against the repo, not
   trusted from the artifact's prose:**
   - `grep -rln "hasnt()" test/scripts/*.test.sh | wc -l` -> **14** (matches).
   - Of those, stderr-swallowing definition lines -> **9** (matches; I
     re-derived this with a second, independently-constructed grep, same
     result — corroborates the artifact's own claim that this is a ledger
     miscount, not corpus drift).
   - `grep -c "fail(" lib/cli/doctor.js` -> **5**; `grep -c "warn(" ...` ->
     **19** (both match exactly).
   - The auditor-mention gap (0->11) is explained as a search-root
     correction (`openspec/changes/` vs `.concertino/runs/*/evidence/`),
     disclosed explicitly in both §E item 11 and §F — this is corroborating,
     self-consistent, and I have no reason to doubt it (I did not
     re-execute the exact corpus-wide grep against the live evidence
     tree, since it is a large, slow, non-deterministic-membership search
     whose result the artifact already discloses as a controlled,
     needle-and-root-named figure — this is the one figure I am relying on
     the artifact's own stated methodology for, not re-deriving byte-for-byte).

7. **C6 (shape (f) never named "ambient-state contamination"):** re-checked
   case-insensitively per the brief's own trap warning (`grep -in
   "ambient-state contamination"`). Found 3 occurrences, all inside explicit
   retraction language (§C Amendment 2's "An earlier draft ... named this
   shape 'ambient-state contamination.' That was wrong", and its restatement
   in parentheses at line 184). None appear as the shape's operative name —
   the operative name used throughout (§C, §D, §F) is consistently "(f)" or
   the mechanism description. **Honored**, and unlike skeptic-final-1's
   original C6 concern for a prior artifact, this one is stated as a named
   retraction rather than left ambiguous.

### A defect found in the artifact itself (this round's job, per the brief's attack #2)

**`docs/verification-vacuity-2026-09.md:241-244`** (§D, the R3 recommendation):

> **R3** — every probe carries a positive control proving it can find a
> known-present instance (this alone would have caught #1, #5, #9, and
> **eight of the nine** probe failures in §E).

But §E's own heading, two paragraphs prior in the same document (§A, line
26-27) and again at §E's own section title (line 246), and again in §E's own
closing sentence (line 303, "This is the **eleventh** consecutive case in
this run..."), all consistently state there are **eleven** first-party probe
failures in §E, not nine. I counted the enumerated items in §E myself:
items 1 through 11, eleven items, matching the section's own title and
closing line.

"Eight of the nine" is not explained anywhere — there is no subset
definition distinguishing which 9 of the 11 items count as "probe failures"
(as opposed to, say, items 8-9 which are about the shape-(f) naming/
verification narrative rather than a numeric miscount) and which 8 of that
9 R3 would catch. It directly contradicts the document's own stated total
three separate times in the same file. This is not a cosmetic slip: it is
an **uncontrolled, self-contradicting count**, sitting in the one document
whose explicit purpose is to catch exactly this shape of error, and it
violates the ticket's own doubly-load-bearing acceptance bar verbatim:
"Any computed count or rate must carry an injected control proving it can
come out differently. A report about machinery that reports success while
measuring nothing must not itself be an instance of the class."

I also checked whether this is a stale artifact of the source ledger
(`class-evidence.md`) rather than something introduced by the executor.
It is not a straight carry-over: the ledger's parallel sentence (line
182-185) says **"all six of the orchestrator's own errors in section E"**
— a *different* wrong number (six, not eight-of-nine) for the same claim,
against the same eleven-item §E. So the executor silently changed an
already-wrong ledger number to a different, still-wrong number, with no
disclosure — unlike every other place in this artifact where a departure
from the ledger's figures is explicitly named and justified (§F's entire
"why the mention figures differ" subsection is a model of exactly the
discipline missing here). Per §7's own task list, the executor was
instructed to source content from `class-evidence.md` "verbatim" for
sections A/B but was free to (and did, correctly) restate/rederive D and F
figures — so silently rewriting this number without any of the disclosure
apparatus used everywhere else in the same document is the gap, not the
mere presence of a discrepancy from the ledger.

This is the class this analysis exists to catch, undetected by the
document's own internal review (which the document's own §E items 8-9
describe happening to this exact document, at a different site, during an
earlier draft) — i.e., it is genuinely the "twelfth instance" the brief
asked me to hunt for.

**Classification: blocking-implementation.** The ticket's added-scope
acceptance bar is explicit and applies "doubly" here; an uncontrolled,
self-contradicting count inside the one artifact whose thesis is "uncounted
claims are the failure mode" is not a nit — it is the ticket failing its
own stated bar. A one-line fix (state the correct count with its subset
explicitly named, or correct to the true "eleven" and drop the qualifier)
closes it; the fix is small, but shipping the artifact as-is with this
self-contradiction present is not defensible under the acceptance criteria
as written.

### Standing constraints C1–C6

- C1–C5: previously confirmed at round 2 (skeptic-final-2) for the
  survival-report half of the change, unmodified by `e01b46e` except the
  fixed C5-class instance (task 7.1, confirmed above). Re-checked C2 in this
  round: no `fetchOneTicket`/`ISSUE_QUERY` introduced by this commit
  (`git diff 8ec49c7 e01b46e -- lib/` shows only the `report.js` empty-branch
  change under `lib/`). C1/C3/C4 untouched by this commit's diff, no
  regression found.
- C6: honored, see item 7 above.

### Gate-defect check (mtime-ordering acceptance)

No prior report in this run's chain (evaluator or skeptic) discloses unsound
evidence-directory mtimes that a later gate then accepted at face value —
`class-evidence.md` and `docs/verification-vacuity-2026-09.md` both use
content-based, self-authenticating evidence (git diff/status emptiness,
grep counts, field-by-field event diffs) rather than mtime ordering for
their load-bearing claims. No gate defect of that shape to record here.

### Verdict: REFUTE

### Change Requests

1. **[blocking-implementation]** `docs/verification-vacuity-2026-09.md:241-244`
   — the R3 sentence claims R3 "would have caught #1, #5, #9, and eight of
   the nine probe failures in §E," but §E enumerates and is titled/closed as
   **eleven** probe failures (§A, §E heading, §E's own closing sentence all
   say eleven), not nine. Fix by either (a) correcting the count to eleven
   and stating which items R3 would/would not have caught among all eleven
   (with the same per-item discipline used elsewhere in §D for the 14
   instances), or (b) if a genuine 9-item subset was intended, name that
   subset explicitly and explain why the other 2 of the 11 are excluded.
   Either way, do not leave an unexplained number that contradicts the
   document's own stated total three times over.

### Non-blocking notes

- The ledger's own version of this same sentence (`class-evidence.md:182-185`,
  "all six of the orchestrator's own errors in section E") carries the same
  defect under a different wrong number. Not itself gating (the ledger is a
  planning artifact, not the shipped deliverable), but worth fixing for
  consistency if the ledger is ever cited again.
- Everything else in this round's verification held up: task 7.1's fix is
  correct and matches skeptic-final-2's Change Request exactly; the full
  test suite (2365/2365) and `openspec validate` both pass on direct
  re-execution; the §D 6/14 partition, the §F recomputed figures I spot-
  checked, and C1–C6 all check out.

### Escalation note (informational, not a separate ESCALATION verdict)

Per the round's stated budget, this REFUTE exhausts `SKEPTIC_FINAL_ROUNDS=3`
and the run escalates to the owner rather than looping further. The single
blocking finding above is narrow and mechanical (a one-sentence count
correction in a docs artifact, no code/test change implied) — flagging this
explicitly so the owner can weigh a small, well-scoped fourth round against
shipping with the artifact's self-contradiction disclosed as a known issue.
That is the owner's call, not mine to make unilaterally.
