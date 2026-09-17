## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Scope: ADDED SCOPE ONLY (`verification-vacuity-analysis`). The survival-report
half's round-3 CONFIRM and cycle-1 PASS are not re-litigated here.

### What I verified (with evidence)

- **cwd guard**: `assert-cwd.sh` returned `READY ambient=.../helio branch=feature/followup-survival-report/CON-192 rc=0` — proceeded.
- **Instance 7 (SCRIPT= convention)**: independently re-grepped `test/`. 25 files set
  `SCRIPT=`; 24 point at `core/scripts/...`, exactly one
  (`test/scripts/premise-validation-demonstration.test.sh`) points at the rendered
  copy (`scripts/concertino/assert-phase.sh`). Matches the claimed 24/25 exactly.
- **Instance 13 (doctor)**: `grep -n "fail(" lib/cli/doctor.js` → 5 sites, all
  tooling-presence (`node`, JSON config parse, `claude`/`codex`/`opencode`).
  `grep -n "warn(" lib/cli/doctor.js` → 19 sites including the three artifact
  lines (`missing:`, `differs from core:`, `not rendered:`). `errs` (fed only by
  `fail()`) is the sole driver of `process.exit(1)` at line 377 — `warns` never
  affects exit status. Grepped `.github/workflows/*.yml` and `package.json` for
  any `doctor` invocation — none found. The "latent, no consumer" claim holds.
- **Instance 9 (hasnt)**: 14 files define a `hasnt()` matching the described
  negated-grep pattern, all 14 using `grep -qF ... 2>/dev/null` (stderr swallowed
  at the call site in every case I sampled). Consistent with the claimed 14.
- **Instance 2 (CON-189 RED baseline)**: read `test/scripts/emit-event.test.sh:970-997`
  directly — the self-derived pre-change script via `git show <base-sha>`, the
  loud-failure-on-unresolvable-git-show comment, and the "silent skip is what
  produced this finding" framing are all present verbatim as claimed. The
  "partially verified / unreproducible historical figure" honesty label is
  correctly applied — I did not attempt to reproduce the 161-vs-167 figure either,
  matching the artifact's own disclosed limit.
- **Instance 8 and the sixth-shape claim (Section C, Amendment 2)** — read the
  actual source, `openspec/changes/archive/2026-07-30-doctor-roles-divergence-check/skeptic-final-1.md:91-96`,
  rather than trusting the ledger's paraphrase. Finding below.

### Finding: Shape (f)'s framing is not supported by its own cited source

Section C claims instance #8 requires a sixth shape, "the check's subject is
contaminated by ambient state," on the grounds that "it measured the right
artifact... the defect was that ambient state... changed what the check
measured."

The actual root-cause diagnosis in the cited source (`skeptic-final-1.md`,
Change Request 2) is different and more specific:

> "the assertion does not discriminate `roles`... `has "detects diverged roles
> file" "differs from" "$OUT"` matches *any* divergence... Because the
> fixture's baseline is `$ROOT`'s working tree vs. a worktree at `HEAD`, any
> uncommitted `core/**` edit satisfies it with the bug fully present
> (reproduced twice above)."

The defect is a **non-discriminating assertion** — the check matches any
occurrence of the substring `"differs from"` rather than the specific
`roles`-divergence condition the test claims to prove. That an unrelated
dirty file is *one* way to trigger it does not make ambient state the
essential mechanism: the same assertion would produce an identical false
green from any *other* legitimate, non-ambient source of a `"differs from"`
line — e.g. two simultaneous, both-committed divergences (one in `roles`,
one in `scripts`/`laws`) with zero uncommitted state anywhere, since the
assertion cannot tell them apart. The two reproductions cited in the source
(`core/scripts/emit-event.sh` dirty, and separately `core/laws/systematic-
debugging.md` dirty) already demonstrate the trigger is "any divergence
notice," not "any ambient dirt" per se — dirt is just the easiest way to
manufacture one.

This also undercuts "it measured the right artifact" — the check read the
right *artifact* (doctor's stdout) but asserted against the wrong, overbroad
*predicate* within it. That is a distinct defect from "ambient contamination"
and is better named for what it structurally is: **the assertion is not
specific to its claimed subject and accepts any co-occurring symptom as
proof of that subject** — a generalization that would still fit as a
sharpened restatement of shape (b) ("success inferred from absence of
[the specific] failure [being checked]"), or, if kept as new, should be named
by its real mechanism (non-discriminating match), not by the incidental
trigger (ambient state) used in the one demonstration available.

This matters here specifically because the ticket's own bar is "an overstated
rule is the same failure class as the bugs it describes" — the same standard
applies to a mischaracterized *shape*, not only an overstated *rule*. Task 7.5
instructs the executor to reproduce "shape (f) (ambient-state contamination)"
verbatim into the tracked artifact without re-deriving it. As currently
worded, that ships an inaccurate causal claim into `docs/verification-vacuity-2026-09.md`
— exactly the kind of artifact this analysis exists to prevent.

### Other attack surfaces checked, no defect found

- **Section D honesty (R1+R2 coverage)**: spot-checked #1, #5, #13 — the "would
  NOT have caught" reasoning for each matches what's independently verifiable
  in the corresponding source material (pipe-swallowed exit status for #1;
  `bfs` substitution for #5; doctor's exit code never consumed for #13). No
  over- or under-statement found in the sampled subset.
- **Spec falsifiability**: the five requirements in `specs/verification-vacuity-analysis/spec.md`
  each have a concrete, checkable scenario (evidence-per-instance, disjointness
  disclosure, per-instance non-coverage enumeration, control-per-count,
  recommend-not-implement). None of the five could be satisfied by a vacuous
  artifact that merely asserts "N instances found" without evidence — the
  scenarios require the evidence and the individually-named non-coverage list,
  which are the two places a lazy artifact would try to hand-wave.
- **class-evidence.md's own vacuity risk (attack #6)**: Section E (the
  orchestrator's own six probe failures) and the explicit "STATED LIMIT" on
  mention-vs-instance counts in Section F are genuine self-directed controls,
  not decoration — I was able to reproduce the SCRIPT= and doctor fail/warn
  counts independently and they held. The one place the ledger's own diligence
  broke down is the shape-(f) causal claim above.
- **Task 7 verification language**: none of 7.1–7.10's stated verifications
  would pass while measuring nothing — each names a concrete grep/count/assert
  target (13 numbered findings, both markers verbatim, all six probe failures
  present, no figure without a control, `files-modified.md` updated, assertion
  count non-decreasing). 7.6 does need updating regardless of the shape-(f)
  finding: it already correctly lists "#1, #5, #7, #8, #12, #13" as NOT caught
  by R1+R2 (independent of how #8 is ultimately shaped), so that count is fine.

### Verdict: REFUTE

### Change Requests

1. **[blocking-implementation]** Correct Section C's Amendment 2 and the
   corresponding task 7.5 wording before the executor writes the tracked
   artifact. Either (a) restate shape (f) by its actual mechanism — "the
   assertion does not discriminate its claimed subject from other conditions
   that produce the same textual symptom" — with ambient state named as one
   trigger among others (not the defining one), or (b) fold instance #8 into
   a sharpened restatement of shape (b) rather than adding a sixth shape, if
   on reflection the orchestrator judges non-discriminating-assertion is
   better understood as a specialization of "success inferred from absence
   of failure" (generalized to "of the specific, claimed failure"). Either
   resolution is acceptable; shipping the current "ambient-state
   contamination" framing verbatim is not, because it doesn't match its own
   cited source and would ship an unverified causal claim into a tracked
   artifact whose entire purpose is catching exactly that.

### Non-blocking notes

- Section F's mention-count figures (54/25/0/22 skeptic/evaluation/auditor/
  planning; 422/422 for "the") were not independently reproduced byte-for-byte
  here (a different ad hoc grep on my end returned different totals against a
  larger current file count, likely because the corpus has grown since the
  ledger was written and/or the exact needle differs from my sample regex).
  This is not cited as a defect — the artifact's own stated limit already
  covers the mention-vs-instance distinction — but the executor should
  re-run Section F's exact commands at write time rather than copying the
  numbers, since the corpus is not static.
