## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Cold verification of CON-169 at 639c2b3 (base abd71b7). Every conclusion below is
from a command I ran myself in this worktree; the executor's, evaluator's and
round-1 skeptic's reports were read as claims only.

### What I verified (with evidence)

**Priority 1 — the round-1 loosening is closed (measured, not asserted).**
Built a three-parser harness in `/tmp/con169/`: `prefix.js` (the pre-fix inline
loop transcribed verbatim from abd71b7), `round1.js` (`git show
639c2b3~1:core/scripts/lib/field-answers.js`), and `current.js` (the shipped
lib). Ran 11 fixtures of my own devising through all three:

```
CASE                                                prefix    round1    current
R1-refute: bulleted empty (-)                       FAIL(1)   PASS      FAIL(1)
bullet * empty                                      FAIL(1)   PASS      FAIL(1)
bullet + empty                                      FAIL(1)   PASS      FAIL(1)
nested/indented bullet empty                        FAIL(1)   PASS      FAIL(1)
bullet-marker-only answer then NON-bulleted marker  FAIL(1)   FAIL(1)   FAIL(1)
empty, last field, trailing bullet residue          FAIL(1)   PASS      FAIL(1)
SUBSTANTIVE multi-line bulleted answer (must PASS)  FAIL(1)   PASS      PASS
MULTILINE plain (the whole ticket) (must PASS)      FAIL(1)   PASS      PASS
TBD on line below marker                            FAIL(1)   FAIL(1)   FAIL(1)
all answered same-line (baseline PASS)              PASS      PASS      PASS
dash-led substantive answer below marker (must PASS) FAIL(1)  PASS      PASS
```

Every column where round-1 loosened relative to pre-fix (`PASS` against
`prefix`'s `FAIL`) is now `FAIL` under `current` — including the `*` and `+`
list markers and the indented/nested variant the round-1 fixture did not cover,
and the last-field-with-trailing-residue case. **The loosening is closed for
every variant I could construct, not just the one fixture named in the REFUTE.**

**No over-swing.** The two "must still PASS" fixtures — a substantive
multi-bullet answer beneath its marker, and an answer whose first line begins
with a literal `-` followed by real content — both PASS under `current`.
`LIST_RESIDUE_ONLY` (`/^[-*+\s]*$/`) is a whole-string match, so any
non-list-marker character defeats it. Separately probed design.md's own example,
`**Claims checked:** -1 confirmed regression count` → `missing: []`. Correct.

**Priority 2 — the original bug is not reintroduced.** Rows "MULTILINE plain",
"SUBSTANTIVE multi-line bulleted", and "dash-led substantive" are all `prefix
FAIL` / `current PASS` — i.e. exactly the shapes the ticket exists to accept,
still accepted, with the pre-fix parser demonstrably rejecting them. Also ran
the shipped `core/scripts/assert-phase.sh setup` against this run's **real**
CON-169 evidence (`.concertino/runs/CON-169/evidence/premise-validation.md`, a
genuinely multi-line bulleted `Claims checked:` answer) → `PASS setup`.

**Priority 3 — the PROOF-in-reverse tests are genuinely RED under the round-1
parser.** I did not accept the label. I `cp`'d `round1.js` over both
`core/scripts/lib/field-answers.js` and `scripts/concertino/lib/field-answers.js`
and re-ran the suite:

```
  FAIL PROOF-IN-REVERSE 2.9: bulleted empty field is still caught
  FAIL PROOF-IN-REVERSE 2.9: names exactly Claims checked
  ok   PROOF-IN-REVERSE 2.10: bulleted empty checklist prompt is still caught
  FAIL PROOF-IN-REVERSE 2.10: names exactly the blank prompt
  133 passed, 3 failed
```

2.9 is RED in both halves. 2.10's *message* assertion is RED (the load-bearing
one, and the one design.md's testing strategy explicitly requires); its exit-code
half is not discriminating in that fixture (see non-blocking note 1). Both
lib copies restored via `git checkout --` immediately after; `git diff --stat
HEAD` confirms no stray edits remain.

**Priority 4 — documentation truthfulness, verified by probe not by reading.**
- `design.md` Decision 4 now states that whitespace-only answers **are** caught
  and that bullet-marker-only answers **are also caught** via `LIST_RESIDUE_ONLY`,
  and that it does not false-positive on `-1 confirmed…`. I probed all three:
  whitespace-only → `["Claims checked:"]` (caught), bulleted-empty → caught,
  `-1 confirmed…` → `[]` (not a false positive). All three claims are true.
- Decision 4's account of the TBD-below-marker case ("preserved behaviour reached
  by a sounder route", hence GUARD not PROOF) matches my matrix row: `prefix
  FAIL` / `current FAIL`. Correctly labelled.
- Both spec deltas (`specs/premise-validation/spec.md` lines 19-21 and 56-62;
  `specs/gate-chain-live-infra-classification/spec.md` lines 10, 36-39) state the
  residue rule and carry a scenario for the bulleted-empty case. Neither
  over-promises beyond what I measured.
- Decision 5's claim that `**Verdict:**` is added as a delimiter only is borne out
  by the diff (`missingFields(section, [...fields, "Verdict:"], …).filter(f => f !== "Verdict:")`).

**Priority 5 — gates.**
- Renders byte-identical: `diff -q` on both `assert-phase.sh` and
  `lib/field-answers.js` between `core/scripts/` and `scripts/concertino/` →
  IDENTICAL for both.
- `test/scripts/rendered-scripts-drift.test.sh` → **18 passed, 0 failed**.
- `test/scripts/assert-phase.test.sh` → **136 passed, 0 failed**.
- Full `test/scripts/` sweep (all 41 `*.test.sh`) → every file reported
  `0 failed`; sweep exit 0.
- `node --test` → **2253 pass, 0 fail**.
- `assert-phase.sh setup` against the real CON-169 evidence → `PASS setup`.

**Acceptance criteria traced.** AC1 → matrix "MULTILINE plain"/"SUBSTANTIVE
bulleted" rows + PROOF 2.x. AC2 → matrix empty/TBD/whitespace rows all FAIL.
AC3 → matrix "all answered same-line" PASS under both parsers; GUARD 2.6 with
mutation failability. AC4 → suite reports `PROOF 2.3: bold span inside prose does
not truncate`, `PROOF 2.7a: … (incl. EOF-terminated)`, `PROOF 2.5: out-of-order
fields`, and the verdict-validation checks, all `ok`. AC5 → design.md Decision 2
+ the diff fixes both call sites. AC6 → tests under `test/scripts/`, PROOF-vs-
GUARD discipline applied and independently verified above. AC7 → drift 18/18.

**Hard constraints.** `git diff --name-only abd71b7...HEAD | grep -E
'pricing-table|report-cost'` → no match; both files absent from all four commits.
In the main checkout they remain `?? scripts/concertino/pricing-table.json` /
`?? scripts/concertino/report-cost.sh` — still untracked, untouched. I did not
run `concertino sync` or `cleanup.sh`. All scratch lived in `/tmp/con169/`; the
only in-worktree mutations were the two temporary lib swaps, both reverted (`git
diff --stat HEAD` shows only the loop's own pre-existing `workflow-state.md`
edit, which is not mine).

### Verdict: CONFIRM

The round-1 blocking finding is closed by measurement across a broader fixture set
than the one that produced it, without over-swinging onto legitimate answers; the
original bug is not reintroduced; the new PROOF-in-reverse assertion is
demonstrably failable in the direction that matters; and the documentation now
matches the shipped behaviour on every claim I probed.

### Non-blocking notes

1. PROOF-IN-REVERSE 2.10's exit-code assertion (`RC == 1`) is not discriminating:
   under the round-1 parser the delivery gate still exits 1 for an unrelated
   reason in that fixture, so only its companion `has "…names exactly the blank
   prompt"` assertion goes red. The pair as a unit is genuinely RED and the
   message assertion is exactly the kind design.md's testing strategy mandates —
   but a future reader should not treat 2.10's RC line alone as the proof.
2. The header comment correctly records that `section.indexOf(marker)` binds only
   the first occurrence of a repeated marker. Unreachable from current templates;
   no action.
3. This run's own real `premise-validation.md` happens to put content on the
   marker line, so it passes under the pre-fix parser too — it is a useful
   end-to-end smoke check (and I ran it) but it is not itself a proof of the fix.
   The suite's fixtures are.
