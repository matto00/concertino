# Verification-machinery failure class — verified evidence ledger (CON-192 added scope)

Written by the orchestrator during Planning (design round 4). Every entry below was
verified firsthand in this run unless explicitly marked otherwise. The executor turns
this into the shipped artifact; it must NOT re-derive these findings, and must not
promote any entry marked unreproducible into a confident claim.

## A. Instances from the ticket's starting set (all seven checked)

1. **`openspec validate` believed dead (CON-197).** VERIFIED and reproduced:
   `openspec validate ... | tail -2; echo $?` -> `0` (that is `tail`'s status);
   direct invocation -> real exit `0`; a bogus change name -> exit **1**. So the gate
   is live AND failable. Shape: exit status taken from the wrong process.
2. **CON-189's own RED baseline ran zero assertions.** PARTIALLY VERIFIED. The
   historical figure ("161 passed, not the cited 167") is NOT independently
   reproducible now. What IS verified: `test/scripts/emit-event.test.sh:976-997`
   documents the defect in-code and now self-derives the pre-change script via
   `git show <base>:core/scripts/emit-event.sh`, with an unresolvable git-show made a
   LOUD failure precisely because "a silent skip is what produced this finding."
   Shape: subject absent/unset. Status: fixed.
3. **`check-pr-mergeable.sh` PASSes on an empty `statusCheckRollup` (CON-207).**
   VERIFIED in source and by demonstration. The loop breaks on
   `[ -z "$PENDING_NAMES" ]` with the comment "every check SUCCESS, **or an empty
   rollup** - condition 1 passes". Demonstrated: an empty rollup yields an empty
   name list; control - a rollup with one `IN_PROGRESS` check yields `test (16)`.
   Shape: success inferred from absence of failure.
4. **CON-183's own self-test was unbounded.** VERIFIED as fixed: the suite now spawns
   a deliberately leaky parent and proves a naive post-reap `pgrep -P` is vacuous
   while the capture-before-kill shape still catches the leak. The fix is itself a
   failability demonstration. Shape: the check's own mechanism is the thing it guards.
5. **`find` is `bfs`, not GNU findutils.** VERIFIED: `bfs 4.1.1`;
   `find -newermt '-6 hours'` exits **1**; with `2>/dev/null` it returns **0 rows**,
   indistinguishable from a genuine empty result. Control: a supported form returns
   4 rows, proving the directory is not simply empty. Shape: subject absent +
   success from absence of failure. Environmental; not fixable in-repo.
6. **CON-191's digest walked the directory non-recursively.** VERIFIED as fixed:
   `test/scripts/instrumentation-digest.test.sh` now carries nested-`lib/` cases
   (4b.1-4b.3), and `setup-worktree.sh:223` records that "a patch to a nested
   `lib/*.sh` file moved the digest not at all." Shape: wrong subject scope.
7. **`check-merge-readiness.test.sh`'s `SCRIPT=` points at `core/scripts/`.**
   **THE TICKET'S FRAMING IS WRONG — CORRECTED.** Pointing at `core/` is the
   repo-wide CONVENTION, not an anomaly: **24** of the 25 `SCRIPT=`-setting suites
   do it (only `premise-validation-demonstration.test.sh` reads the rendered copy),
   and `rendered-scripts-drift.test.sh` (CON-172) byte-compares every core file
   against its render, reporting a missing counterpart separately from a mismatch.
   The real defect is not in that test: it is **reviewer mutation technique** -
   mutating the rendered copy while the test reads `core/` yields a false green for
   the reviewer, not for CI.

## B. Instances the ticket does NOT list (found in the corpus, verified firsthand)

8. **A non-discriminating assertion producing a false green**
   (`2026-07-30-doctor-roles-divergence-check`, defect located in
   `test/scripts/doctor-artifacts.test.sh:89`). CORRECTED after design round 4; an
   earlier draft of this ledger mis-described both the location and the mechanism.
   The source's own diagnosis, read directly: *"the assertion does not discriminate
   `roles`. `has "detects diverged roles file" "differs from" "$OUT"` matches ANY
   divergence: the `roles` note, a `scripts`/`laws`/`workflow-state.template.md`
   note, and even the unrelated artifact warning `differs from core: ...`"*. Because
   the fixture compares `$ROOT`'s working tree against a worktree at `HEAD`, any
   uncommitted `core/**` edit satisfies it with the bug fully present - reproduced
   twice, with two different unrelated dirty files, yielding **"11 passed, 0
   failed"**. So ambient dirt is the easiest TRIGGER, not the mechanism: the same
   false green would arise from two simultaneous fully-committed divergences with no
   ambient state at all. Shape: **(f)** - see C.
9. **`hasnt()` returns green for a MISSING file.** DEMONSTRATED BY ME: a negated
   `grep -qF ... 2>/dev/null` reports the same "ok" for a file that does not exist
   as for a file that exists and is clean; the discrimination control (file exists
   AND contains the string) correctly reds. So a render that produced NO file is
   indistinguishable from a correct one. Live counts: **14** suites define such a
   helper, **8** swallow stderr, **5** have no `[ -f`/`[ -s` guard. The purest form
   of the class. (`fix-openspec-validate-cli-syntax/design.md` names this exact
   hazard: "a test that renders nothing would report all-green.")
10. **A dead assertion** (`2026-08-22-fix-squash-merge-base-guard`): "it asserts
    nothing; delete it." Shape: assertion with no subject.
11. **Absent prerequisite yields false greens** (`validate-committed-declaration-blob`):
    a missing `core/scripts/lib/` produces "21 confusing red assertions plus
    several false greens." Shape: subject absent.
12. **A self-disabling gate** (`rendered-scripts-drift-gate`):
    `RENDERED_SCRIPTS_DRIFT_SOURCE_ONLY=1` turns the gate off. The reviewer correctly
    judged it cannot cause a false green on a drifted file while unset, so it is a
    note rather than a REFUTE. Shape: the check's own mechanism is what it guards.
13. **NEW (mine): `concertino doctor` detects every artifact problem but never gates
    on it.** Static: errors are pushed only by `fail()`, with **5** call sites, ALL
    tooling-presence (node missing, invalid JSON config, claude/codex/opencode CLI
    missing) against **19** `warn()` sites; `missing:`, `differs from core:` and
    `not rendered:` are all warnings. Runtime (probe gated on reaching
    `checkArtifacts()`): rc=**0** in all four states - clean, deleted agent file,
    drifted copied asset, deleted copied asset - while the text correctly NAMES each
    problem. Byte counts varied (1272/1305/1339/1329), proving the probe responded to
    tree state. **Severity: LATENT** - nothing consumes doctor's exit status (no npm
    script, no CI, no `gates` entry in any of the 4 tracked example configs);
    CONTRIBUTING.md addresses a human reader. Shape: success inferred from absence of
    failure, at the CONSUMER boundary.

14. **NEW (found during this run's own design round 4): `emit-event.sh` reported a
    non-zero exit while having successfully appended the event.** The round-4
    skeptic's verdict appears **twice** in `events.jsonl`
    (t=1789623431968 and t=1789623437301), byte-identical apart from the timestamp -
    same `ref`, same `head_sha`, same `category`/`gate` - against a single
    `skeptic-design-4.md` report. The emitting role reported that "the first call
    actually succeeded despite exit 1 reported by the outer wrapper," so it retried
    and double-appended. Verified by me: a field-by-field diff of the two events is
    identical, and a control diff against the round-3 CONFIRM correctly reports them
    as different, so the comparison discriminates. Shape: the **inverse** of (b) - a
    success that reported failure - which matters because the whole class is usually
    discussed in one direction only. Consequence: verdict *event* counts and verdict
    *review* counts diverge (7 skeptic events for 6 actual reviews), so any
    per-verdict metric must de-duplicate on `(gate, round, ref)` rather than count
    rows. See S6.

## C. Testing the candidate signature (this is itself a finding)

The ticket proposes five shapes: (a) subject absent/unset; (b) success inferred from
absence of failure; (c) measures a copy rather than the artifact in use; (d) the
check's own mechanism is the thing it guards; (e) exit status from the wrong process.

**It largely holds, with two required amendments, and it is not a partition.**

- **Not disjoint.** Several instances occupy two shapes at once: #5 is both (a) and
  (b); #9 is both (a) and (b); #13 is (b) relocated to the consumer.
- **Amendment 1 - restate (c).** As written it mis-describes #7. The tests correctly
  read `core/`, with a drift gate as backstop. The real shape is: *the mutation used
  to prove failability targets a different artifact than the check reads.* That is a
  property of the REVIEWER's procedure, not the check's.
- **Amendment 2 - a sixth shape is required, named for its mechanism.** #8 resists
  all five: its subject was present, its exit status was correct, it read the right
  artifact (doctor's stdout), and its mechanism was not self-referential. **An
  earlier draft named this shape "ambient-state contamination." That was wrong** and
  design round 4 REFUTED it: ambient dirt is merely the easiest way to trigger the
  defect, not the defect. The real mechanism, per the cited source, is that the
  assertion's predicate is **overbroad** - it matches a symptom (`"differs from"`)
  that several unrelated conditions also produce. Proposed shape **(f): the
  assertion is not specific to its claimed subject, and accepts any co-occurring
  symptom as proof of that subject.**
  Why this is not just a sharper (b): (b) is "no positive result was required at
  all"; (f) is "a positive result WAS required, but the predicate admits the wrong
  ones." Distinct failure modes with distinct fixes - (b) needs an assertion, (f)
  needs a narrower one. Recorded here because the correction itself is an instance of
  this analysis's own bar: a mischaracterised shape is as much a defect as an
  overstated rule.

## D. Detection rule, and the limits it must state

Rule as proposed: **R1** demonstrate failability by mutation (mutate the guarded
thing, confirm red); **R2** count the assertions that actually executed, never trust
the pass line.

**Would have caught — 6 of the 14 enumerated instances:** #2 (R2 - zero
assertions), #3 (R1 - feed an empty rollup), #4 (R1 - indeed the fix IS an R1
demonstration), #6 (R1 with the nested target), #9 (R1 - mutate to the
missing-file case), #10 (R1 - nothing reds).

**Would NOT have caught — and this must be stated, because an overstated rule is the
same failure class:**
- **#1.** The gate was failable and assertions ran; the error lived in the
  measurement harness (a pipe swallowing exit status). R1 and R2 both PASS while the
  human conclusion is wrong.
- **#5.** Environmental tool substitution. Nobody thinks to mutate `find`.
- **#7.** R1 performed against the wrong artifact produces a false NEGATIVE about the
  test (no red appears, so you blame the test rather than your mutation target).
- **#12.** R1 with the variable unset shows a failable gate; the vacuity exists only
  in the configuration where it is set. R1 does not explore configuration space.
- **#13.** R1 shows doctor correctly PRINTS the problem. The gap is that no consumer
  reads its exit code. R1 tests the detector, not the consumer contract.
- **#8.** R1 on a clean tree correctly reds; the false green requires a dirty tree.
  R1 does not explore ambient state.

Also missed: **#11** (an absent prerequisite yields false greens only when the
prerequisite is absent - configuration-space vacuity) and **#14** (the emitter
reported failure while having succeeded - the INVERSE direction, which neither rule
addresses at all, since both assume the risk is a false green rather than a false
red).

So R1+R2 catch **6 of 14** (the partition is 6 caught / 8 missed, disjoint and
summing to 14) and systematically miss five whole families:
measurement-harness error, environmental substitution, configuration-space vacuity,
consumer-contract gaps, and non-discriminating assertions (shape (f) — named for its
mechanism; see section C, Amendment 2, for why the earlier "ambient-state
contamination" label was retracted).

**Proposed additions (recommend only):** **R3** — every probe
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

Recorded because they are the strongest available evidence for the class - produced
while analysing it, each caught ONLY by a control, never by a gate:

1. Strict `origin_kind:` needle reported **0** matching tickets; the real text is
   backticked, so the true count was **1**. (Became constraint C1.)
2. `grep -c '[n]pm test'` reported **5** running processes; `pgrep -x npm` reported
   **0** - it was counting other lanes' poller command-line text.
3. A "shape-B" regex reported **16** exposed suites; it also matched `has()`, so the
   figure was contaminated and was discarded, not cited.
4. "EXPOSED: 2" was wrong: `sync-core-resolution.test.sh` checks `sync exits zero` at
   five points, so the genuinely unguarded count is lower.
5. `grep -c '\.err('` reported **0** error sites in `doctor.js`; errors are added by
   `fail()`, of which there are **5**.
6. The first doctor probe returned a constant **604 bytes** across four different
   tree states while printing green checkmarks - it had bailed at the config check
   and never reached `checkArtifacts()` at all.
7. A `jq` expression counting design-gate verdicts reported **0** because escaped
   quotes broke the filter; the real count was **5**. The command errored and the
   zero was printed anyway.
8. This ledger's own shape (f) was named for an incidental trigger rather than its
   mechanism, and was REFUTED at design round 4 (see section C, Amendment 2). The
   analysis of the class produced an instance of the class - which is precisely why
   the acceptance bar demands a control on every claim, not only on every count.
9. The verification of the shape-(f) correction itself was incomplete. It counted
   occurrences of the retracted name "ambient-state contamination" and confirmed the
   shape's definition had been fixed, but never inspected section D's missed-family
   list - which still carried the retracted name. The count-based check passed while
   the document remained self-contradictory across two sections. Caught only by a
   later in-context re-read, not by the count. This is the same shape as instance #9's
   `hasnt` defect at the level of a document rather than a test: a check whose subject
   was narrower than the claim it licensed.
10. This ledger's own `hasnt` stderr-swallow count of 8 was a miscount; the correct
    figure is 9, and the discrepancy was initially mis-attributed to corpus drift even
    though `test/scripts/` had not changed at all this run (`git diff --name-only
    5a8edb8 -- test/scripts/` and `git status --short -- test/scripts/` both returned
    nothing). Two independent needle shapes both yield 9.
11. This ledger's "0 auditor reports mention the class" was a scope artifact, not a
    finding about auditors: the searched root (`openspec/changes/`) held only 4
    auditor files, while the evidence root (`.concertino/runs/*/evidence/`) holds 69,
    of which 11 match the same needle. The figure was then used as evidence for the
    claim that authorship counts cannot measure gate detection - a claim that still
    holds on its own logic (gates author no reports), but whose cited evidence was a
    scope artifact, not a measurement of auditors.

## F. Computed numbers, each with its control

- **hasnt exposure:** 14 define / 8 swallow stderr / 5 no exists-guard / 2 both -> of
  those 2, both are further mitigated by return-code checks, so **0 fully unguarded**.
  Controls: zero control (`assert-cwd`, `codex-role-render` -> 0) and an impossible
  helper name -> 0.
- **doctor gating:** 5 `fail()` sites vs 19 `warn()` sites. Controls: definition line
  found -> 1; impossible reporter name -> 0.
- **Class mentions in the corpus:** 54 skeptic reports, 25 evaluation reports, 0
  auditor reports, 22 planning artifacts. Controls: impossible needle -> 0; the word
  "the" -> 422 of 422 skeptic files, versus 54 for the class needle, proving
  selectivity. **STATED LIMIT: these are MENTION counts, not instance counts, and
  authorship counts cannot measure gate detection** (gates author no reports), so
  "no gate ever caught one" is an inference, not a measurement.

## G. Recommendations (recommend, do not implement — each becomes its own ticket)

- **S1.** Give the 8 stderr-swallowing `hasnt()` helpers a file-exists precondition,
  or make `hasnt` fail on a missing file.
- **S2.** Decide `doctor`'s gating contract: exit non-zero on artifact warnings, add
  `--strict`, or document explicitly that its exit code is not a gate.
- **S3.** Already tracked: CON-207 (`check-pr-mergeable.sh` empty-rollup PASS).
- **S4.** Add R3 (positive control) and R4 (name the consumer) to the repo's
  verification law.
- **S5.** `concertino answer` cannot target a specific escalation when several are
  outstanding (`answer.json` is per-ticket, written `wx`), so this run's blocker #1
  could not be recorded through the sanctioned path. Demonstrated, not asserted.
- **S6.** Investigate the `emit-event.sh` exit-status/append mismatch behind instance
  14 (append succeeded, non-zero reported, caller retried, event duplicated), and
  make any per-verdict metric de-duplicate on `(gate, round, ref)` rather than
  counting rows.
