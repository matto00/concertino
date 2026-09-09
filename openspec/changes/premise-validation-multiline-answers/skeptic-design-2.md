## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

**Round-1's blocking item — the sharing mechanism. Remedied; verified sound.**
- `core/scripts/assert-phase.sh:153` and `:289` are indeed two separate single-quoted
  `node -e` programs in different `case` branches (read both bodies in full). No in-file
  function could span them — round 1's finding was correct and the revised plan's
  file-based `require()` is the right remedy.
- The `SCRIPT_DIR` idiom the plan cites is real: `assert-phase.sh:29` computes it and
  `:31` already sources `lib/git-child-env.sh` from it. Passing the absolute lib path as
  an argv element (tasks 1.5) does avoid introducing shell quoting into the single-quoted
  JS body — both existing programs already take `process.argv[1]` this way.
- The render claim is **correct**, and I checked it rather than taking it: `lib/cli/emit.js:447-450`
  iterates `listFilesRecursive(core/scripts)` and does a plain `copy()` with **no `renderBody`**,
  chmod 0755 applied only to `*.sh`. So a `.js` file under `core/scripts/lib/` is copied
  byte-for-byte, not template-substituted — a real hazard for JS source, and it is absent.
  `scripts/concertino/lib/` exists today (`auditor-lease.sh`, `git-child-env.sh`,
  `git-child-env.selftest.sh`). Note `field-answers.js` would be the **first** `.js` file
  under `core/scripts/**` (verified: `find core/scripts -name '*.js'` is empty) — that is
  fine, but it is a genuinely new render-target shape, not an existing one.

**Decisions 1, 3, 4, 5 — checked against the live parser at `:167-181` and `:305-313`.**
- Decision 3 (delimit by *enumerated* markers, not a generic `\*\*.*?:\*\*` regex, and not
  blank lines) is the right call and does discharge AC 4's bold-span case by construction.
- Decision 5 is consistent with the code: `**Verdict:**` has its own
  `match(/\*\*Verdict:\*\*\s*([^\n]*)/)` at `:178`, untouched, while being added to the
  delimiter set so `Sibling collisions:` cannot swallow it. Coherent.
- _Superseded, see design.md Decision 4 as corrected (final-gate skeptic, CON-169): measurement showed no tightening — the pre-fix parser already rejected this case too, by a different route._
- Decision 4's "newly caught" consequence (a `TBD` on the line *below* the marker now
  fails, where before it slipped through) is a real tightening and is correctly declared
  rather than hidden.
- Decision 2 (fix both sites) is well-reasoned and AC 5 requires exactly this explicit call.

**Spec deltas** — both `premise-validation` and `gate-chain-live-infra-classification`
restate the answer-extent rule in normative language with scenarios covering multi-line,
empty-extent, bold-span and EOF cases. They match the design. No contract gap found.

**AC coverage trace** — AC1→tasks 1.1/1.3; AC2→1.2/2.2; AC3→2.6; AC4→2.3/2.4 + Decision 3/5;
AC5→Decisions 1 and 2; AC6→tasks 3.1-3.3; AC7→tasks 4.1/4.2. All traceable.

**The drift-count claim — measured, and it is wrong.** (reproduced, not a single reading)
- Baseline: `bash test/scripts/rendered-scripts-drift.test.sh` → `18 passed, 0 failed`.
- I then created `core/scripts/lib/field-answers.js`, `cp`'d it to
  `scripts/concertino/lib/field-answers.js` — exactly the end state tasks 4.1/4.2 produce —
  and re-ran: **`18 passed, 0 failed`**, not 19. I removed both files afterwards
  (`git status --porcelain` clean apart from the change dir).
- The reason is structural, visible in the test source: the file enumeration lives *inside*
  `run_drift_check`, which emits **one** `ok`/`bad` (assertion 1.1) for the entire real tree
  regardless of how many files it walks. The other 17 assertions run against synthetic
  `mktemp` scratch trees that never contain `core/scripts` at all. The assertion count is
  invariant to the number of rendered files, by design.

### Verdict: REFUTE

One blocking item. It is narrow — the parser design itself is sound and I would otherwise
confirm — but it is written into `tasks.md` as a required completion condition, so an
implementer who follows the plan literally is pushed toward either a false stall or an
unwarranted edit to a sibling gate's test.

### Change Requests

1. **The drift-gate assertion-count expectation is factually wrong, and `design.md`
   contradicts itself about it.** `design.md` Decision 2 ("How the two sites actually share
   the logic") asserts: *"its assertion count rises by one (18 → 19) when the new lib file is
   added. That is the gate correctly noticing a new render target"* — while `design.md`'s own
   **Render obligation** section, ~20 lines later, states the opposite: *"`test/scripts/rendered-scripts-drift.test.sh`
   must remain 18/18."* `tasks.md` 4.3 then encodes the wrong one as an acceptance condition:
   *"with its count raised by one for the new lib file (expected 19/19, not 18/18)"*.

   Measured ground truth (above): adding `core/scripts/lib/field-answers.js` plus its rendered
   copy leaves the suite at **18/18**. `run_drift_check` reports the whole real-tree walk as a
   single assertion (1.1); the remaining 17 are scratch-tree mutation checks that never touch
   `core/scripts`. A per-file assertion count is not how that test is built.

   Required revisions:
   - `design.md`, Decision 2, final paragraph ("Consequence to expect: …18 → 19…"): correct it.
     The accurate statement is that the drift gate stays **18/18 green**, because the new lib
     file is covered by assertion 1.1's whole-tree walk rather than by an assertion of its own;
     the gate would go **red at 1.1** (`never rendered:`) if task 4.2's `cp` were skipped. That
     — not a count change — is the evidence that the gate noticed the new render target, and it
     is worth stating that way since it is the check that actually protects task 4.2.
   - `tasks.md` 4.3: replace "expected 19/19, not 18/18" with 18/18 green, and add the
     failability check that the corrected reasoning makes available and that is currently
     missing from the plan: **before** performing task 4.2's `cp`, run the drift test and
     confirm it is RED naming `lib/field-answers.js` under `never rendered:`, then `cp` and
     confirm it returns to 18/18 green. That converts task 4.2 from an asserted step into a
     demonstrated one, consistent with the change's own "Testing strategy" section and the
     CON-170 precedent it cites.
   - Remove the resulting duplication so the two statements in `design.md` cannot drift apart
     again — state the drift consequence once.

### Non-blocking notes

- `specs/premise-validation/spec.md`, scenario *"The final field's answer ends at end-of-file"*,
  is worded as *"the `**Verdict:**` line is followed by a substantive trailing field answer"*.
  That exercises the section-end fallback, so it is not wrong, but it describes an unusual
  document (a required field placed *after* the verdict) rather than the plain case AC 4 names
  — the last field's answer running to EOF with no trailing newline. Consider rewording to the
  plain case, or keeping both.
- `field-answers.js` will be the first `.js` under `core/scripts/**`. Worth a one-line comment
  in the new file noting it is copied verbatim by `emit.js` (never `renderBody`-substituted),
  so a future editor does not assume template placeholders are available there.
- Tasks 1.6 ("parity assertion that both call sites resolve the lib to the same file") is a good
  instinct; consider stating what form it takes (a test asserting both `node -e` bodies contain
  the same `require` of the `SCRIPT_DIR`-derived path) so it is not left to interpretation.
