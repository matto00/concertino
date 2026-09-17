# Verification-vacuity class analysis — 2026-09

Written as added scope on CON-192 (owner-ruled `proceed-on-reviewer-preapproved-fix`
after the design-round budget was exhausted). Makes the "verification machinery
that reports success while measuring nothing" failure class legible as a
standing, citable artifact: verified instances, a tested shared signature, a
detection rule with its stated limits, and recommendations for separate
follow-up work.

**Source discipline.** Every instance and figure below is sourced from
`openspec/changes/followup-survival-report/class-evidence.md` (the
orchestrator's verified Planning ledger, design round 4) — this artifact does
not re-derive those findings. Section F's counted figures are the one
exception: per task 7.7, they were re-run fresh at write time rather than
copied, because the corpus is not static. Where a fresh count differs from the
ledger's, that is stated explicitly, not silently corrected away.

## A. What this is

A recurring shape found across this repo's own delivery history: a check, a
gate, or a probe reports success (or a confident number) while the thing it
was meant to verify was still broken, absent, or never actually measured. 14
verified instances are enumerated below (§B), a candidate five-shape
signature is tested against them and found to need two amendments (§C), a
two-rule detection heuristic is proposed and its coverage gaps are stated in
full rather than summarised (§D), the orchestrator's own eleven probe failures
while producing this analysis are recorded as first-party evidence (§E),
every counted figure carries a discriminating control (§F), and six
recommendations are listed as follow-up only — nothing here is fixed inline
(§G).

## B. Verified instances (14)

Status key: **VERIFIED** (reproduced firsthand this run), **PARTIALLY
VERIFIED** (some sub-claim not independently reproducible; stated), **CORRECTED**
(the original framing was found wrong and is stated as a correction, not
repeated), **NEW** (found in this run's own corpus, not in the ticket's
starting list).

1. **`openspec validate` believed dead (CON-197). VERIFIED.** `openspec
   validate ... | tail -2; echo $?` reports `0` — that is `tail`'s exit
   status, not the command's. Direct invocation (no pipe) reports the real
   exit `0`; a bogus change name reports exit `1`. The gate is live and
   failable; the measurement harness (the pipe) was wrong. Shape: exit
   status taken from the wrong process.
2. **CON-189's own RED baseline ran zero assertions. PARTIALLY VERIFIED.**
   The historical figure ("161 passed, not the cited 167") is not
   independently reproducible now. What is verified: `test/scripts/emit-event.test.sh:976-997`
   documents the defect in-code and self-derives the pre-change script via
   `git show <base>:core/scripts/emit-event.sh`, with an unresolvable
   git-show made a loud failure — because a silent skip is exactly what
   produced this finding originally. Shape: subject absent/unset. Status:
   fixed.
3. **`check-pr-mergeable.sh` PASSes on an empty `statusCheckRollup` (CON-207).
   VERIFIED** in source and by demonstration. The loop breaks on
   `[ -z "$PENDING_NAMES" ]`, with the comment "every check SUCCESS, or an
   empty rollup — condition 1 passes." An empty rollup yields an empty name
   list; control — a rollup with one `IN_PROGRESS` check yields `test (16)`,
   proving the check discriminates when fed a non-empty case. Shape: success
   inferred from absence of failure.
4. **CON-183's own self-test was unbounded. VERIFIED as fixed.** The suite
   now spawns a deliberately leaky parent and proves a naive post-reap
   `pgrep -P` is vacuous while the capture-before-kill shape still catches
   the leak — the fix is itself a failability demonstration. Shape: the
   check's own mechanism is the thing it guards.
5. **`find` is `bfs`, not GNU findutils. VERIFIED.** `bfs 4.1.1`;
   `find -newermt '-6 hours'` exits `1`; with `2>/dev/null` appended it
   returns 0 rows — indistinguishable from a genuine empty result. Control:
   a supported form returns 4 rows, proving the directory is not simply
   empty. Shape: subject absent + success from absence of failure.
   Environmental; not fixable in-repo.
6. **CON-191's digest walked the directory non-recursively. VERIFIED as
   fixed.** `test/scripts/instrumentation-digest.test.sh` now carries
   nested-`lib/` cases (4b.1–4b.3), and `setup-worktree.sh:223` records that
   "a patch to a nested `lib/*.sh` file moved the digest not at all." Shape:
   wrong subject scope.
7. **`check-merge-readiness.test.sh`'s `SCRIPT=` points at `core/scripts/`.
   CORRECTED — the ticket's original framing is wrong.** Pointing at
   `core/` is the repo-wide convention, not an anomaly: 24 of the 25
   `SCRIPT=`-setting suites do it (only
   `premise-validation-demonstration.test.sh` reads the rendered copy), and
   `rendered-scripts-drift.test.sh` (CON-172) byte-compares every core file
   against its render, reporting a missing counterpart separately from a
   mismatch. The real defect is not in that test — it is reviewer mutation
   technique: mutating the rendered copy while the test reads `core/` yields
   a false green for the reviewer, not for CI.
8. **NEW. A non-discriminating assertion producing a false green**
   (`2026-07-30-doctor-roles-divergence-check`, `test/scripts/doctor-artifacts.test.sh:89`).
   Corrected after design round 4 — an earlier draft of the ledger
   mis-described both the location and the mechanism. Read directly: the
   assertion `has "detects diverged roles file" "differs from" "$OUT"`
   matches ANY divergence — the `roles` note, a `scripts`/`laws`/
   `workflow-state.template.md` note, and even the unrelated artifact
   warning `differs from core: ...`. Because the fixture compares `$ROOT`'s
   working tree against a worktree at `HEAD`, any uncommitted `core/**` edit
   satisfies it with the bug fully present — reproduced twice, with two
   different unrelated dirty files, yielding "11 passed, 0 failed." Ambient
   dirt is the easiest TRIGGER, not the mechanism: the same false green
   would arise from two simultaneous, fully-committed divergences with no
   ambient state at all. Shape: **(f)** — see §C.
9. **NEW. `hasnt()` returns green for a MISSING file.** Demonstrated
   firsthand: a negated `grep -qF ... 2>/dev/null` reports the same "ok" for
   a file that does not exist as for a file that exists and is clean; the
   discrimination control (file exists AND contains the string) correctly
   reds. So a render that produced NO file is indistinguishable from a
   correct one. Live counts (re-verified §F): 14 suites define such a
   helper. The purest form of the class —
   `fix-openspec-validate-cli-syntax/design.md` names this exact hazard: "a
   test that renders nothing would report all-green."
10. **NEW. A dead assertion** (`2026-08-22-fix-squash-merge-base-guard`): "it
    asserts nothing; delete it." Shape: assertion with no subject.
11. **NEW. Absent prerequisite yields false greens**
    (`validate-committed-declaration-blob`): a missing `core/scripts/lib/`
    produces "21 confusing red assertions plus several false greens." Shape:
    subject absent.
12. **NEW. A self-disabling gate** (`rendered-scripts-drift-gate`):
    `RENDERED_SCRIPTS_DRIFT_SOURCE_ONLY=1` turns the gate off. The reviewer
    correctly judged it cannot cause a false green on a drifted file while
    unset, so it is a note rather than a REFUTE. Shape: the check's own
    mechanism is what it guards.
13. **NEW. `concertino doctor` detects every artifact problem but never
    gates on it.** Static: errors are pushed only by `fail()` — 5 call
    sites, all tooling-presence (node missing, invalid JSON config,
    claude/codex/opencode CLI missing) — against 19 `warn()` sites;
    `missing:`, `differs from core:` and `not rendered:` are all warnings
    (re-verified §F, matches exactly). Runtime (probe gated on reaching
    `checkArtifacts()`): rc=0 in all four states — clean, deleted agent
    file, drifted copied asset, deleted copied asset — while the text
    correctly names each problem. Byte counts varied across states, proving
    the probe responded to tree state rather than short-circuiting.
    Severity: LATENT — nothing consumes doctor's exit status (no npm
    script, no CI, no `gates` entry in any of the 4 tracked example
    configs); `CONTRIBUTING.md` addresses a human reader, not a gate. Shape:
    success inferred from absence of failure, at the CONSUMER boundary.
14. **NEW — found during this run's own design round 4. `emit-event.sh`
    reported a non-zero exit while having successfully appended the
    event.** The round-4 skeptic's verdict appears TWICE in `events.jsonl`
    (t=1789623431968 and t=1789623437301), byte-identical apart from the
    timestamp — same `ref`, `head_sha`, `category`/`gate` — against a single
    `skeptic-design-4.md` report. The emitting role reported that "the first
    call actually succeeded despite exit 1 reported by the outer wrapper,"
    so it retried and double-appended. A field-by-field diff of the two
    events is identical; a control diff against the round-3 CONFIRM
    correctly reports them as different, proving the comparison
    discriminates. Shape: the **inverse** of (b) — a success that reported
    failure — which matters because this whole class is usually discussed
    in one direction only. Consequence: verdict *event* counts and verdict
    *review* counts diverge (7 skeptic events for 6 actual reviews), so any
    per-verdict metric must de-duplicate on `(gate, round, ref)` rather than
    count rows. See recommendation S6.

## C. Testing the candidate signature

The ticket proposed five shapes: **(a)** subject absent/unset; **(b)** success
inferred from absence of failure; **(c)** measures a copy rather than the
artifact in use; **(d)** the check's own mechanism is the thing it guards;
**(e)** exit status from the wrong process.

**It largely holds, with two required amendments, and it is not a
partition.**

- **Not disjoint.** Several instances occupy two shapes at once: #5 is both
  (a) and (b); #9 is both (a) and (b); #13 is (b) relocated to the consumer.
- **Amendment 1 — restate (c).** As written it mis-describes #7. The tests
  correctly read `core/`, with a drift gate as backstop. The real shape is:
  *the mutation used to prove failability targets a different artifact than
  the check reads.* That is a property of the reviewer's procedure, not the
  check's.
- **Amendment 2 — a sixth shape is required, named for its mechanism.** #8
  resists all five: its subject was present, its exit status was correct,
  it read the right artifact (doctor's stdout), and its mechanism was not
  self-referential.

  An earlier draft of this analysis named this shape **"ambient-state
  contamination." That was wrong**, and design round 4 REFUTED it: ambient
  dirt is merely the easiest way to trigger the defect, not the defect
  itself. The real mechanism, per the source cited in §B.8, is that the
  assertion's predicate is **overbroad** — it matches a symptom
  (`"differs from"`) that several unrelated conditions also produce.

  Proposed shape **(f): the assertion is not specific to its claimed
  subject, and accepts any co-occurring symptom as proof of that subject.**
  ("Ambient-state contamination" appears in this artifact only as this
  explicit retraction — standing constraint C6 — never as the shape's name.)

  Why (f) is not merely a sharper (b): (b) is "no positive result was
  required at all"; (f) is "a positive result WAS required, but the
  predicate admits the wrong ones." These are distinct failure modes with
  distinct fixes — (b) needs an assertion at all, (f) needs a narrower one.
  Recorded here because the correction itself is an instance of this
  analysis's own bar: a mischaracterised shape is as much a defect as an
  overstated rule.

## D. Detection rule, and the limits it must state

Rule as proposed: **R1** — demonstrate failability by mutation (mutate the
guarded thing, confirm red). **R2** — count the assertions that actually
executed, never trust the pass line alone.

**Would have caught — 6 of the 14 enumerated instances:**
- **#2** (R2 — zero assertions actually ran)
- **#3** (R1 — feed an empty rollup)
- **#4** (R1 — indeed the fix IS an R1 demonstration)
- **#6** (R1 with the nested target)
- **#9** (R1 — mutate to the missing-file case)
- **#10** (R1 — nothing reds)

**Would NOT have caught — stated in full, because an overstated rule is the
same failure class this analysis documents:**
- **#1.** The gate was failable and its assertions ran; the error lived in
  the measurement harness (a pipe swallowing exit status). R1 and R2 both
  PASS while the human conclusion is wrong.
- **#5.** Environmental tool substitution (GNU `find` vs. `bfs`). Nobody
  thinks to mutate `find` itself.
- **#7.** R1 performed against the wrong artifact produces a false NEGATIVE
  about the test — no red appears, so a reviewer blames the test rather
  than their own mutation target.
- **#8.** R1 on a clean tree correctly reds; the false green requires a
  dirty tree. R1 does not explore ambient state.
- **#11.** An absent prerequisite yields false greens only when the
  prerequisite is actually absent — configuration-space vacuity. R1 does
  not explore configuration space.
- **#12.** R1 with the variable unset shows a failable gate; the vacuity
  exists only in the configuration where it is set. Same family as #11.
- **#13.** R1 shows doctor correctly PRINTS the problem. The gap is that no
  consumer reads its exit code. R1 tests the detector, not the consumer
  contract.
- **#14.** The emitter reported failure while having succeeded — the
  INVERSE direction, which neither rule addresses at all, since both R1 and
  R2 assume the risk is a false green, never a false red.

**So R1+R2 catch 6 of 14 — the partition is 6 caught / 8 missed, disjoint,
summing to 14** — and systematically miss five whole families:
measurement-harness error (#1), environmental substitution (#5),
configuration-space vacuity (#11, #12), consumer-contract gaps (#13), and
non-discriminating assertions (#8, shape (f) — named for its mechanism, see
§C Amendment 2 for why the retracted "ambient-state contamination" label is
never used as the name), plus #14's inverse case standing entirely outside
the rule's assumed direction.

**Proposed additions (recommend only — see §G):** **R3** — every probe
carries a positive control proving it can find a known-present instance.
Applied to the two numbering systems separately, so the claim is derived
rather than asserted: it would have caught §B instances **#1**, **#5** and
**#9**, and **eight of the eleven** §E probe failures — items 1, 2, 3, 5, 6,
7, 10 and 11 — while missing items 4, 8 and 9 (item 4 was resolved by reading
the code rather than by any control, item 8 is a naming/reasoning error and
not a probe at all, and item 9 required an in-context read that no
positive-control-on-a-needle would supply). 8 caught + 3 missed = 11, the
count §E actually contains. **R4** — name the consumer of the signal
(catches #13).

## E. First-party evidence: the orchestrator's own eleven probe failures this run

Recorded because they are the strongest available evidence for the class —
produced *while analysing the class itself*, each caught ONLY by a control,
never by a gate.

1. A strict `origin_kind:` needle reported **0** matching tickets; the real
   text is backticked, so the true count was **1**. (Became standing
   constraint C1.)
2. `grep -c '[n]pm test'` reported **5** running processes; `pgrep -x npm`
   reported **0** — the first probe was counting other lanes' poller
   command-line text, not real processes.
3. A "shape-B" regex reported **16** exposed suites; it also matched
   `has()`, so the figure was contaminated and was discarded, not cited.
4. "EXPOSED: 2" was wrong: `sync-core-resolution.test.sh` checks `sync
   exits zero` at five separate points, so the genuinely unguarded count
   was lower than first reported.
5. `grep -c '\.err('` reported **0** error sites in `doctor.js`; errors are
   actually added by `fail()`, of which there are 5.
6. The first doctor probe returned a constant **604 bytes** across four
   different tree states while printing green checkmarks — it had bailed at
   the config check and never reached `checkArtifacts()` at all.
7. A `jq` expression counting design-gate verdicts reported **0** because
   escaped quotes broke the filter; the real count was **5**. The command
   errored and the zero was printed anyway.
8. This ledger's own shape (f) was first named for an incidental trigger
   ("ambient-state contamination") rather than its mechanism, and was
   REFUTED at design round 4 (§C, Amendment 2). The analysis of the class
   produced an instance of the class — which is precisely why the
   acceptance bar demands a control on every claim, not only on every
   count.
9. The verification of the shape-(f) correction itself was incomplete. It
   counted occurrences of the retracted name "ambient-state contamination"
   and confirmed the shape's **definition** had been fixed, but never
   inspected §D's missed-family list — which still carried the retracted
   name at that point. The count-based check passed while the document
   remained self-contradictory across two sections. Caught only by a later
   in-context re-read, not by the count. This is the same shape as
   instance #9 of §B (`hasnt`'s defect) at the level of a document rather
   than a test: a check whose subject was narrower than the claim it
   licensed.
10. This ledger's own `hasnt` stderr-swallow count of 8 (§F) was a miscount;
    the correct figure is 9, and the discrepancy was initially
    mis-attributed to corpus drift even though `test/scripts/` had not
    changed at all this run — `git diff --name-only 5a8edb8 --
    test/scripts/` and `git status --short -- test/scripts/` both returned
    nothing. Two independent needle shapes (the definition-line shape used
    in §F and a second, independently-constructed shape) both yield 9.
11. This ledger's "0 auditor reports mention the class" (§F) was a scope
    artifact, not a finding about auditors: the searched root
    (`openspec/changes/`) held only 4 auditor files, while the evidence
    root (`.concertino/runs/*/evidence/`) holds 69, of which 11 match the
    same needle. The figure was then used as evidence for the claim that
    authorship counts cannot measure gate detection — a claim that still
    holds on its own logic (gates author no reports), but whose cited
    evidence was a scope artifact, not a measurement of auditors.

This is the eleventh consecutive case in this run where a *count* reported
success while the thing it purported to measure was still broken, and it
was found by reading, not by grepping. That is this artifact's own thesis —
so its author's own errors earn their place here in full, not trimmed for
tidiness.

## F. Computed numbers, each with its control

Re-run fresh at write time (task 7.7) rather than copied from
`class-evidence.md`. The corpus is not static — design round 4 could not
reproduce the ledger's own mention counts byte-for-byte, and the figures
below are expected to differ from the ledger's for the same reason: this is
stated explicitly rather than silently reconciled.

**`hasnt()` exposure.**
- Files defining a `hasnt()` helper under `test/scripts/`:
  `grep -rln "hasnt()" test/scripts/*.test.sh | wc -l` → **14**.
  Control: an impossible helper name (`impossible_helper_zzz_xyz`) →
  **0**, proving the search is not vacuously matching everything.
- Of those 14, files whose `hasnt` definition line swallows stderr
  (`2>/dev/null` on the definition itself): **9**. The ledger stated 8; that
  is a miscount in the ledger, not corpus drift — `test/scripts/` has not
  changed since the ledger was written (`git diff --name-only 5a8edb8 --
  test/scripts/` and `git status --short -- test/scripts/` both return
  nothing), and two independently-constructed needle shapes both compute 9.
  See §E items 10/11.
- Of those 14, files with no `[ -f ` / `[ -s ` existence-guard anywhere in
  the file: **5**. (This is a coarser per-file heuristic than the ledger's
  per-callsite classification — reported as such rather than reproducing a
  callsite-level figure this run did not independently re-derive.)

**`concertino doctor` gating.** `grep -c "fail(" lib/cli/doctor.js` → **5**;
`grep -c "warn(" lib/cli/doctor.js` → **19**. Matches the ledger exactly.
Controls: the literal `fail(`/`warn(` definitions are present (grep for
`function fail`/its assignment → 1 hit, not 0); an impossible reporter name
(`impossible_reporter_zzz`) → **0**.

**Class mentions in the corpus.** Re-run fresh with an explicit,
self-chosen needle (`vacuous|vacuity`, case-insensitive), searched against
the evidence root `.concertino/runs/*/evidence/openspec/**` — the root
matters and is named explicitly below, per the correction in §E item 11 —
across every `skeptic-*.md`, `evaluation-*.md`, and `auditor-*.md` report
plus every `proposal.md`/`design.md`/`tasks.md` planning artifact under that
root, counting FILES matching, not occurrences:
- skeptic reports: 41 of 297 mention the class
- evaluation reports: 21 of 110
- auditor reports: **11 of 69** (root: `.concertino/runs/*/evidence/`,
  which holds all 69 auditor reports; a narrower root such as
  `openspec/changes/` holds only 4 auditor files total and returns 0 — the
  ledger's originally-stated 0 was this narrower-root artifact, retracted
  by name in §E item 11, not a finding about auditors)
- planning artifacts: 18 of 249

Controls: an impossible needle (`impossible_needle_zzz_xyz_never_present`)
→ **0** matches in either root; the word "the" across the same
skeptic-report set → **297 of 297**, proving the class needle (41 of 297)
is genuinely selective rather than matching everything.

**STATED LIMIT, unchanged from the ledger, sharpened by §E item 11:** these
are MENTION counts, not verified-instance counts; any such count is a
function of the search root as well as the needle, so a mention count must
name its root; and authorship counts cannot measure automated gate
detection (gates author no reports at all — the auditor-report figure above
reflects auditor *prose* discussing the topic, not an auditor gate that
fired on it). "No gate ever caught one of these" remains an inference from
this corpus, not a direct measurement.

**Why the mention figures differ from the ledger's own (54/25/0/22).** This
artifact used a different, self-chosen needle at a different point in time
— task 7.7 explicitly requires re-running the commands rather than copying
the prior numbers, precisely because a copied figure decays into an
unverifiable claim the moment the needle, the root, or the corpus changes.
The skeptic/evaluation/planning gaps against the ledger's 54/25/22 are
attributable to the needle difference (genuine, expected drift, per the
instruction above). The auditor gap (0 → 11) is NOT drift: it is the
search-root correction in §E item 11, stated there as a retraction rather
than left as an unexplained number change. The `hasnt` stderr-swallow gap
(8 → 9) is similarly NOT drift: it is a ledger miscount, stated in §E
item 10 — `test/scripts/` provably had not changed.

## G. Recommendations (recommend only — no fixes applied here)

Each of the following is scoped-out follow-up work, not implemented in this
change. **No Linear tickets were filed for these by this executor** — the
delivery coordinator is filing the subset it has selected separately;
creating duplicates here would be worse than leaving them as prose.

- **S1.** Give the stderr-swallowing `hasnt()` helpers a file-exists
  precondition, or make `hasnt` fail outright on a missing file, closing
  instance #9's exposure.
- **S2.** Decide `concertino doctor`'s gating contract: exit non-zero on
  artifact warnings, add a `--strict` flag, or document explicitly that its
  exit code is not a gate today (instance #13).
- **S3.** Already tracked separately: CON-207 (`check-pr-mergeable.sh`
  empty-rollup PASS, instance #3).
- **S4.** Add R3 (positive control) and R4 (name the consumer) to the
  repo's verification law (`.concertino/laws/`), per §D's stated coverage
  gaps.
- **S5.** `concertino answer` cannot currently target a specific escalation
  when several are outstanding (`answer.json` is per-ticket, written
  `wx`), which blocked recording an escalation answer through the
  sanctioned path during this very run. Demonstrated, not merely asserted.
- **S6.** Investigate the `emit-event.sh` exit-status/append mismatch
  behind instance #14 (append succeeded, non-zero reported, caller
  retried, event duplicated), and make any per-verdict metric de-duplicate
  on `(gate, round, ref)` rather than counting raw rows.
