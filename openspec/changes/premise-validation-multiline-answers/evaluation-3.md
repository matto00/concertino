## Evaluation Report — Cycle 3 (evaluation-3.md)

Commit under review: `ba3cf82`. Cycle scope was documentation plus one assertion label;
the diff matches that scope exactly. All measurements below are my own fresh runs.

### Phase 1: Spec Review — PASS

**No executable behaviour changed, confirmed mechanically.**
`git diff --name-only f65c4f2..ba3cf82` filtered to `^(core/scripts|scripts/concertino)/`
returns nothing. The only non-documentation hunk in `test/scripts/assert-phase.test.sh` is
PROOF 2.4's `check` label string plus its explanatory comment — no fixture, assertion,
expected value or control flow changed. Assertion count is unchanged at 132 (128 at cycle 1
plus GUARD 2.8's four from cycle 2), so nothing was added or dropped under cover of a rename.

**Cycle-2 CR1 — fixed, and the correction is accurate.** design.md Decision 4's second bullet
now states that a `TBD`-only answer is reported unanswered under *both* parsers whether it sits
on the marker line or below it, that the pre-fix parser reaches that verdict coincidentally via
its empty-first-line `""` branch while the fixed parser reaches it by actually reading `TBD`,
and that this is therefore preserved behaviour reached by a sounder route rather than a
tightening. That matches the four-case measurement I took in cycle 2 exactly. It also now
explains *why* GUARD 2.8 is a guard and not a proof, which closes the loop between the decision
record and the test labelling it justifies.

**proposal.md:23-28 — the same claim corrected, and the two artifacts now agree.** The former
"deliberate net *tightening* ... slips through today and will newly fail" is replaced with
wording that matches design.md's, and still cross-references Decision 4. I read both passages
against each other: no residual disagreement.

**The phrasing sweep landed, and I re-ran it independently.** Grepping the whole change
directory for `tighten|newly caught|newly fail|slips? through|slipped through|strictly`, every
surviving hit in a live artifact is either unrelated or correct:

- `design.md:3,16,25,27` and `proposal.md:51` — Decision 1's *template*-tightening discussion,
  a different subject entirely (the rejected alternative direction).
- `design.md:121,125` and `proposal.md:28` — the new corrected wording, which uses "not a
  tightening" and "nothing was newly caught" as negations.
- `ticket.md:21` — the ticket's own directions-considered list; immutable input, correctly
  untouched.
- `evaluation-1.md` / `evaluation-2.md` — my own reports, which raise the claim in order to
  refute it. Correctly untouched.

See the one non-blocking note below about three hits the executor's sweep summary did not
enumerate. Its *disposition* of them is nonetheless right.

**Both carried non-blocking items are closed.**
- PROOF 2.4 renamed to "multi-line answer parses correctly with no trailing newline in the
  file", with a comment stating plainly that this fixture's `Sibling collisions:` extent is
  still bounded by the following `**Verdict:**` marker and that the genuine field-runs-to-EOF
  path is covered by PROOF 2.7a through the same shared function. That is exactly the
  distinction I raised, and the test now claims only what it proves.
- `tasks.md` 2.2 corrected: it now says the empty-extent test fails identically under the
  pre-fix parser and is therefore correctly a GUARD with mutation-demonstrated failability.

**Hard constraints.** `pricing-table.json` and `report-cost.sh` appear in none of the three
commits (`git diff --name-only 11e0df5~1..HEAD`), and both remain untracked and unmodified in
the main checkout (mtimes still Aug 25 12:19). No `concertino sync` and no `cleanup.sh` was run
by the executor or by me.

### Phase 2: Code Review — PASS

Everything cleared in cycles 1 and 2 is re-confirmed undisturbed rather than re-derived, per the
orchestrator's direction, plus the fresh gate runs it asked for:

- `core/scripts/assert-phase.sh` vs `scripts/concertino/assert-phase.sh` — byte-identical.
  `core/scripts/lib/field-answers.js` vs its rendered copy — byte-identical. No re-render was
  needed this cycle and none was done.
- Every `test/scripts/*.test.sh` — green (a filter for any file not reporting `0 failed`
  returned nothing). `rendered-scripts-drift.test.sh` 18/18; `assert-phase.test.sh` 132/0.
- `npm test` (full suite including `node --test`) — rc=0.
- `openspec validate premise-validation-multiline-answers --type change` — valid.

The cycle-1 and cycle-2 findings stay closed: the extent rule, Verdict handling, the shared-lib
wiring with no private copy left behind, the failable parity assertions, and the honest
PROOF/GUARD labelling are all unchanged by this diff.

### Phase 3: UI Review — N/A

CLI/shell/JS repo, no UI-affecting files in any of the three commits. No dev servers started.

### Overall: PASS

No blocking defects. The one item below is a suggestion, not a change request — it should not
be treated as a reason to escalate the cycle budget.

### Non-blocking Suggestions

- **The sweep's summary under-reported its own hits, though its disposition was correct.** The
  commit message says the remaining hits are "Decision 1's unrelated template-tightening
  discussion and the ticket's original directions-considered list". It does not mention
  `skeptic-design-1.md:67`, `skeptic-design-2.md:29-30` ("is a real tightening and is correctly
  declared") and `skeptic-design-3.md:80-81`, which affirm the now-refuted claim. Leaving those
  files as-is is the right call — they are dated review rounds and rewriting them would falsify
  the record, the same reason my own evaluation reports were left alone. But the enumeration
  should have named them and said so, rather than implying they did not exist. If it is cheap,
  a one-line "superseded — see design.md Decision 4 as corrected in cycle 3" pointer on those
  three files would leave a future reader of the archived change with no affirmed false claim
  anywhere in the directory.
- `tasks.md` 2.4 still reads "Add a fixture whose last field's answer ends at EOF with no
  trailing newline", which is the same over-promise the test name was just corrected for, one
  file over. Purely cosmetic; the behaviour is covered and the test now describes itself
  accurately.
- (Carried, still non-blocking, unchanged since cycle 1.) The premise-validation spec delta's
  scenario "The last field's multi-line answer ends at end-of-file" has no fixture at the
  premise-validation site — a Verdict marker always follows there in practice. The code path is
  genuinely exercised by PROOF 2.7a at the gate-chain site through the identical shared
  function, so this is a coverage-locality observation, not a gap in behaviour.
