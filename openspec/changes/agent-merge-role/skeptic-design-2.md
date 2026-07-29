## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- Read `skeptic-design-1.md` in full to get the exact 5 numbered change
  requests from round 1.
- Re-read `proposal.md`, `design.md`, `tasks.md`, and
  `specs/agent-merge/spec.md` in full, fresh, from
  `openspec/changes/agent-merge-role/` (not from the orchestrator's summary).
- Checked each of round 1's 5 items against the current artifacts and, where
  the artifact makes a claim about existing source, against that source:
  1. **Codex ordering** — `design.md:86` and `tasks.md:2.3` now correctly
     place the auditor as a **seventh** stage, strictly after today's step 6
     (confirmed today's `adapters/codex/prompt.md` has exactly 6 numbered
     steps via `grep -n "^[0-9]\." adapters/codex/prompt.md`, steps 1–6,
     step 6 being "Orchestrator — squash, archive, push, open PR..."). This
     part of the fix is correct. **However**, `proposal.md:11` was not
     updated and still reads "`adapters/codex/prompt.md` gains a **sixth**
     sequential stage" — see Change Request 1 below.
  2. **Phase 4 entry condition + Guardrails** — confirmed via
     `grep -n "After the human confirms merge\|Post-merge cleanup requires
     human confirmation" core/roles/orchestrator.md` that the two exact
     lines quoted in round 1 (line 269 heading, line 404 guardrail) still
     exist verbatim in current source. `tasks.md:3.6` now schedules editing
     both, and `design.md`'s Decision 4 (lines 66–67) states the exact new
     wording for both. Fixed.
  3. **`lib/ui/format.js` `ROLE_COLOUR` + Impact-list file** — confirmed via
     `Read lib/ui/format.js` that `ROLE_COLOUR` currently has no `auditor`
     key and that `red` is genuinely unused among its current six colour
     helpers (`blue`, `cyan`, `yellow`, `magenta`, `dim`, `green` are all
     already assigned). `tasks.md:5.5` now schedules the `auditor: red`
     addition. `proposal.md`'s Impact list (line 28) now reads
     `lib/ui/format.js (ROLE_COLOUR gains an auditor entry)` with no
     `fleet.js` mention. Fixed.
  4. **`mergeStateStatus` fail-closed on `UNKNOWN`/unenumerated values** —
     `design.md`'s Decision 1 item 2 and `tasks.md:1.3` now explicitly state
     "every other value... fails closed... never falls through to a pass."
     This part is fixed. **However**, `specs/agent-merge/spec.md`'s
     requirement text and scenarios (lines 22–47) were not updated — no
     scenario covers `UNKNOWN`/`DRAFT`/an unenumerated `mergeStateStatus`
     (confirmed via `grep -n -i "unknown\|draft\|unenumerated\|not yet
     determined" specs/agent-merge/spec.md`, zero matches), and
     `tasks.md:7.2`'s manual-verification list ("all-pass, pending CI,
     failed CI, behind-base, and review-required cases") likewise omits it.
     Round 1 explicitly asked to "add a spec scenario for" this case — that
     part of the fix is missing. See Change Request 2 below.
  5. **`models.auditor` schema addition** — confirmed via `Read
     config/concertino.schema.json` (lines 146–157) that `models.properties`
     currently enumerates only `orchestrator`/`executor`/`evaluator`/
     `skeptic`/`codex` under `additionalProperties: false`, with no
     `auditor` key. `tasks.md:4.1` now explicitly schedules adding
     `auditor` to `models.properties`, separately from `tasks.md:4.2`'s
     `withDefaults()`/`buildConfig()` runtime-defaults edit. Fixed.
- Searched all four artifacts for `TODO`/`TBD`/"figure out later" — none
  found.
- Cross-checked for new contradictions beyond the round-1 list by grepping
  all four artifacts for "sixth"/"seventh"/"fifth stage"/"sequential
  stage" mentions together — this is what surfaced Change Request 1.

### Verdict: REFUTE

Items 2, 3, and 5 from round 1 are genuinely and fully fixed. Item 1 is
fixed in `design.md`/`tasks.md` but the fix was not propagated to
`proposal.md`, which still states the old (buggy) stage count. Item 4 is
fixed in `design.md`/`tasks.md` but the spec-level and verification-level
parts of the originally-requested fix ("add a spec scenario for... UNKNOWN")
were not done. Both remaining gaps are narrow and mechanical to close.

### Change Requests

1. **`proposal.md:11` still says the auditor lands on codex's "sixth"
   stage, contradicting the now-corrected `design.md:86` and
   `tasks.md:2.3`, which both say "seventh."** Literal text: `` `adapters/
   codex/prompt.md` gains a sixth sequential stage ``. Today's
   `adapters/codex/prompt.md` already has 6 numbered steps (1–6, confirmed
   by direct read), so "gains a sixth" is not just stale wording — read
   literally it reintroduces the exact round-1 bug shape (the auditor
   displacing or preceding step 6's PR creation, since a "sixth" stage
   would have to land at or before the existing position 6). Fix: change
   `proposal.md:11` to say "seventh" (or otherwise phrase it so it can only
   be read as strictly after today's step 6), matching `design.md` and
   `tasks.md` verbatim. This is exactly the kind of cross-artifact
   contradiction round 1 flagged — it is not new, but the round-2 pass
   fixed two of the three planning artifacts and missed the third.

2. **The `mergeStateStatus` fail-closed fix from round 1 item 4 only
   landed in `design.md`/`tasks.md`, not in the spec or the verification
   task list.** Round 1 explicitly asked to "add a spec scenario for" the
   `UNKNOWN`/`DRAFT`/unenumerated case, in addition to stating the
   philosophy in Decision 1. `specs/agent-merge/spec.md`'s "check-
   merge-readiness.sh deterministically evaluates..." requirement (lines
   22–47) still only documents `CLEAN` (pass), `BLOCKED`+`REVIEW_REQUIRED`,
   and `BEHIND`/`DIRTY` (fail) — there is no scenario for the transient
   `UNKNOWN` state (which GitHub returns immediately after the very
   `git push`/`gh pr create` this same run just performed) or any other
   unenumerated value. Separately, `tasks.md:7.2`'s manual test-case list
   ("all-pass, pending CI, failed CI, behind-base, and review-required
   cases") also has no entry for it, so there is no verification signal
   that the executor actually implemented the fail-closed behavior the
   design now (correctly) requires. Fix: add a scenario to `specs/
   agent-merge/spec.md` (e.g. "An undetermined or unrecognized
   mergeStateStatus fails closed") mirroring the existing "stale branch...
   fails as not mergeable" scenario, and add the `UNKNOWN`/unenumerated
   case to `tasks.md:7.2`'s manual-exercise list.

### Non-blocking notes

- `proposal.md:11`'s claim that `adapters/codex/agent.toml.tmpl`'s
  worker-dispatch list "gains a fifth entry" is confusing against
  `design.md`'s Decision 7, which describes that same list as going from
  `['executor', 'evaluator']` to (implicitly) three entries. It reads as if
  "fifth" refers to the auditor being the fifth role overall rather than
  the list's new length — worth one clarifying word so a reader doesn't
  expect a 5-item worker-dispatch list.
- Round 1's non-blocking note about Decision 6's flag-quoting placement was
  addressed well — `design.md`'s Decision 6 and `tasks.md:5.2`/`5.3` now
  both spell out the exact substitution (`{{TICKET}}` → `<ticket>
  --agent-merge`) and explicitly warn against appending after the closing
  quote.
