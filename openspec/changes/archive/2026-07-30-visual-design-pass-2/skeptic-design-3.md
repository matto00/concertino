## Skeptic Report — design gate (round 3)

### What I verified (with evidence)

**Artifacts read as claims, then checked against code:** `ticket.md`, `proposal.md`,
`design.md`, `tasks.md`, `specs/dashboard-visual-design/spec.md`, plus
`skeptic-design-2.md` and the baseline `openspec/specs/dashboard-visual-design/spec.md`.

**Ground-truth reads:** `lib/ui/format.js` (full), `lib/ui/layout.js` (full),
`lib/ui/screens/launchpad.js` (`epicRow`/`ticketRow`/`renderLaunchPad` incl. the
`box()` call sites and the final `f.truncate` at :375), `lib/ui/screens/fleet.js`
(cited lines), `test/layout-colour.test.js`, `test/format-colour.test.js`.

**Executable probe (round 2's method, repeated independently).** I implemented the
revised design verbatim into a scratch copy of `lib/` — `format.js`: `SUPPORTS_256`,
`fg()` dispatch, `running: cyan`, and `bgFill` exactly as design.md Decision 4
point 2 writes it (including the `s.split('\x1b[0m').join('\x1b[0m' + open)`
reset-rewrite); `layout.js`: `borderColour(false) → f.dim` plus the `body`/`fillRow`
snippet at design.md:90-93; `launchpad.js`: tasks 5.1, 5.1a, 5.2 — then rendered the
real launch pad with `isTTY` forced and walked each line like a terminal, marking
per-column whether a background fill (`48;5;N` or SGR `7`) is active. **Every result
below was reproduced on two consecutive runs at both colour tiers.**

**CR1 — per-column fill coverage, the exact check round 2 used** (`#` = fill active):

```
                                                     round 2      round 3
A epics focused, plain epic row, cols=80             32/32  OK    32/32  gaps=0
B tickets focused, priority High (no inner colour)   43/43  OK    43/43  gaps=0
C tickets focused, '▲ running' (inner colour+reset)  72/76 FAIL   43/43  gaps=0
D tickets focused, unknown priority (inner dim)      12/43 FAIL   43/43  gaps=0
E2 both inner colours at once, cols=80                  —         43/43  gaps=0
E  both inner colours, cols=50 (downstream re-cut)      —         14/14  gaps=0
```

Identical at the 256 tier and the basic (reverse-video) tier. The two states round 2
measured as broken now fill every column with zero internal gaps. Raw line for
round 2's worst case (D), showing the re-open doing the work:

```
\x1b[48;5;236m\x1b[38;5;253m  ▸ [ ] \x1b[2m?   \x1b[0m\x1b[48;5;236m\x1b[38;5;253m CON-1     spec-d… Todo        \x1b[0m
```

**CR5/CR6 — truncation safety, measured at the `box()` seam.** `box(width=30,
fillRow=0)` given over-wide content carrying *two* inner colour-and-reset pairs:
filled row = 28/28 inner columns, `visibleLength` exactly 30, and the fill's closing
`\x1b[0m` sits immediately before the right border's escape — which is precisely the
property CR6 asked the spec scenario to be restated to. Re-truncating that finished
line a second time (mirroring `launchpad.js:375`) to 20 columns yields a line ending
in `\x1b[0m` with no background active past the cut. Swept **all cut points n=1..40:
0 cases left the background active at end of string.** The non-`fillRow` row in the
same box carries zero fill. Both tiers.

**Width budget (baseline requirement "No rendered line exceeds its visible-column
budget").** 1143 rendered lines across `cols ∈ {50,51,60,78,79,80,100,120,200}` ×
both panes focused × three ticket selections (incl. CJK titles and a 90-char title),
plus the fleet screen: **0 over-budget lines**, at both tiers.

**CR2 — test determinism, reproduced and then verified fixed.**

```
                                    layout-colour + format-colour
BASELINE (unpatched worktree)
  TERM/COLORTERM unset             pass 12  fail 0
  TERM=xterm-256color              pass 12  fail 0
  COLORTERM=truecolor              pass 12  fail 0
PROBE (design implemented, tests untouched)   ← reproduces round 2 exactly
  TERM/COLORTERM unset             pass 10  fail 2
  TERM=xterm-256color              pass  5  fail 7
  COLORTERM=truecolor              pass  5  fail 7
PROBE + tasks.md 7.2's pinning only (delete TERM/COLORTERM before re-require)
  TERM/COLORTERM unset             pass 10  fail 2
  TERM=xterm-256color              pass 10  fail 2   ← deterministic
  COLORTERM=truecolor              pass 10  fail 2   ← deterministic
```

The 7.2 mitigation, applied exactly as written, collapses all three environments to
an identical result, and the 2 residual failures are exactly the two
`borderColour(false)` assertions task 7.1 names. So all seven affected assertions are
accounted for: five by 7.2, two by 7.1.

**Full suite, probe vs. baseline** (`node --test`, the project's own command):
baseline **668 pass / 0 fail**; probe with only 7.2's pinning applied **666 pass /
2 fail**, the two failures being those same `borderColour(false)` assertions. No
other test in the repo is falsified — tasks.md 7.1/7.2/7.11's enumeration is
complete, which is the specific completeness failure round 2 refuted on.

**"Must not regress" constraints (ticket.md:51-56), each executed.** With `isTTY`
false but `TERM=xterm-256color COLORTERM=truecolor` set: `SUPPORTS_256 === false`,
`bgFill('x') === 'x'`, `cyan('x') === 'x'`, and a `fillRow` box row renders
`"┃ abc      ┃"` with zero escape bytes — the `isTTY` gate still wins over capability
detection. Structural focus intact: `┏`/`┃` vs `┌`/`│` still differ under a pipe.
Border/content separation intact: `borderColour` is still applied only to `set.v`,
and the probe confirms the fill neither clobbers the row's own inner ANSI (cases C/D
preserve it) nor strands a reset mid-line (0 leaks over 40 cut points) — the exact
guarantee round 1's version of this design broke.

**Line citations spot-checked against code:** `launchpad.js:191` (hardcoded
`f.yellow(status)`) ✓, `:375` (final `f.truncate`) ✓, `:158`/`:187` (epicRow/ticketRow
span) ✓, `fleet.js:55`/`:80`/`:90`/`:102`/`:334`/`:351` ✓, `fleet.js:141-144`
(status values) ✓, `format.js:270` (`open = m[0] !== '\x1b[0m'`) ✓,
`drilldown.js:284` ✓. `layout.js:117` is actually `:116` (immaterial).

**Spec-delta hygiene.** Baseline "Selection and focus are visually distinct states"
(`:52-59`) and "Status colour is consistent across screens" (`:89-94`) each have
exactly one scenario; both MODIFIED blocks reproduce the baseline requirement text
verbatim before extending it and preserve that scenario, so neither delta silently
drops baseline coverage. `npx openspec validate visual-design-pass-2 --strict` →
`Change 'visual-design-pass-2' is valid`, exit 0 (re-run myself).

**Round-2 CR-by-CR result:**

| CR | Required | My finding |
|----|----------|-----------|
| 1 | Make the fill invariant structural, not conventional; add a test for the two broken states | **CONFIRMED, measured.** `bgFill`'s reset-rewrite closes the gap: 43/43 columns for both `▲ running` and unknown-priority, and for both at once, at both tiers. Design.md no longer claims content is unstyled — it now explicitly keeps inner colour (point 4) and makes safety a property of `bgFill`. Tasks 2.2 + 7.5 encode the fix and a test that would actually have caught the round-2 defect ("a test that only checks 'some fill is present' would not have caught it"). Decision 4 point 2's sequential-open/close argument for why `truncate`'s boolean `open` stays correct is sound and I verified its conclusion empirically rather than trusting it. |
| 2 | Pin `TERM`/`COLORTERM` in design.md; enumerate all seven falsified assertions in tasks.md | **CONFIRMED.** Decision 1's testing note prescribes `delete process.env.TERM; delete process.env.COLORTERM;` before the cache clear/re-require, additive to the `isTTY` forcing. Tasks 7.2 names all five newly-environment-dependent assertions by file:line plus the two in 7.1 and states the "all seven" acceptance condition. Verified implementable and sufficient: applying only 7.2 makes the suite identical in all three environments. |
| 3 | Add the baseline "Selection and focus…" requirement to MODIFIED and broaden its enumeration | **CONFIRMED.** `spec.md:27-35` now carries it under `## MODIFIED Requirements`, reading "via bold text, the pane's accent colour, and/or a background fill". Verified against baseline `:53` that this is the same requirement, minimally broadened, scenario preserved. |
| 4 | Give the 256-tier fill a theme-independence story and record the choice | **CONFIRMED.** `bgFill` now pairs bg `48;5;236` with fg `38;5;253`, stated in design.md Decision 4 point 2 (with the reasoning inline), the Risks bullet at :172, `spec.md:57`, and tasks 2.2/7.4. Probe confirms the foreground is actually emitted, so the pair is self-consistent on a light-themed 256-colour terminal. |
| 5 | Replace the false "never passed through truncate" claim with the real guarantee, naming both downstream sites | **CONFIRMED.** Decision 4 point 3 now says the round-1 claim "is false", names `layout.js:117` (`hsplit`'s `padTo`) and `launchpad.js:375`, and states the actual guarantee. Both sites verified present; the guarantee verified by the 40-cut-point sweep. |
| 6 | Restate the truncation-survival scenario as the property actually guaranteed, and align task 7.5 | **CONFIRMED.** `spec.md:77-87` is retitled "A filled row's fill closes before the border, and survives further re-truncation" and its THEN now asserts fill-reset-before-border plus reset-re-appended-at-cut. Both halves measured true. Task 7.7 (not 7.5 — the alignment moved there, correctly, since 7.7 owns the `box()`/`fillRow` tests) covers both cases including a deliberate second re-truncation. |
| 7 | Route `launchpad.js:191`'s hardcoded yellow through the shared vocabulary, or carve it out | **CONFIRMED.** Task 5.1a, design.md Decision 4 point 4, `spec.md:20-25`'s new scenario, and task 7.9 all specify `f.STATUS_COLOUR.running(status)`. Probe renders `\x1b[38;5;80m▲ running` (cyan), matching what `fleet.js:102` and `drilldown.js:284` would emit for `running`. The `priorityCol` `f.dim` carve-out is stated with a reason (`dim` is in neither table) rather than left implicit. |

---

### Verdict: CONFIRM

Round 2's blocker is genuinely closed, and closed by the stronger of the two options
round 2 offered. Making `bgFill` itself nesting-safe rather than constraining its
callers is the right call: I measured full-width coverage on the two states that were
broken, on both of them simultaneously, at both colour tiers, and at the narrow width
where `launchpad.js` re-truncates `box()`'s output — and the hazard is now
unreachable for any future caller rather than resting on a convention the one
existing caller already violated. The design's supporting argument (sequential
open/close, never two concurrently open spans needing two resets) is also correct as
reasoning, but I did not take it on faith: the 40-cut-point sweep found zero cases
leaving the background open, and the full 668-test suite shows the change falsifies
exactly the two assertions tasks.md says it does and nothing else.

The remaining six change requests are addressed substantively, not cosmetically. CR2
in particular is answered with a mitigation I verified actually works rather than one
that merely sounds right — and the "all seven, not two" completeness condition is now
written into the task itself. CR3 and CR6 are real spec repairs: the MODIFIED
requirement no longer leaves the delivered behaviour contradicting a live baseline
requirement, and the truncation scenario now asserts something that is true. CR4's
foreground pairing removes the dark-on-dark failure mode. CR5 and CR7 replace a false
claim and a self-contradiction with accurate ones.

The three "must not regress" constraints from the ticket — structural focus, the
`isTTY` gate, and border/content colour separation — all hold under execution, not
just assertion. Nothing in the artifacts is a placeholder, and Open Questions can
honestly stay "None": none of round 2's change requests were converted into deferred
questions, which is what I checked for.

This is sound enough to implement. The notes below are for the executor and the final
gate, and none of them blocks handoff.

### Non-blocking notes

- **Unify the fill's escape notation before writing task 7.4's test.** design.md
  Decision 4 point 2's code emits **two** escapes (`'\x1b[48;5;236m\x1b[38;5;253m'`),
  while `spec.md:57`, tasks 2.2, task 7.4, and the Risks bullet at design.md:172 all
  write the **single** combined form `48;5;236;38;5;253`. They are functionally
  identical (the `ANSI` regex matches both; `visibleLength` strips both; `truncate`'s
  `open` flag treats both as openers — I checked), but a test asserting the literal
  string `48;5;236;38;5;253` fails against design.md's snippet. Pick the single-escape
  form (it matches the spec's own wording and every task) and make design.md's code
  match. Self-revealing if got wrong, hence a note and not a change request.
- **Look hard at the basic tier's inner colour during task 8.1.** Under the SGR-7
  fallback, an inner *foreground* escape inside the fill renders as a *background*
  block, because reverse video swaps fg/bg: probe case C at the basic tier is
  `\x1b[7m … \x1b[36m▲ running\x1b[0m\x1b[7m   \x1b[0m`, so on a 16-colour terminal
  the running status word becomes a cyan block with hole-punched text rather than
  cyan text. Coverage is correct and it stays legible, and this is a direct,
  unavoidable consequence of the CR1 fix preserving inner colour — but it is a new
  visual behaviour the design does not mention, and it is exactly what task 8.1's
  "`COLORTERM` unset" eyeball should be pointed at. No such effect at the 256 tier,
  where the inner colour overrides only the foreground and the `236` background
  persists (verified).
- **One ticket candidate is neither delivered nor declared a Non-Goal.**
  `ticket.md:49` lists "Spacing and density: rhythm between sections, alignment of
  columns across sections". Nothing in design.md or tasks.md addresses it, and
  proposal.md's last Non-Goal defers a spacing pass only "beyond `fleet.js`,
  `drilldown.js`, and `launchpad.js`" — which reads as though `fleet.js` spacing were
  in scope when no task delivers it. The ticket calls its list "Candidate work" and
  hands scope judgement to this gate, and two prior rounds already settled scope, so
  I am not reopening it: just tighten that Non-Goal to say spacing/density is out for
  every screen this round, or open the follow-up ticket.
- **"the latter" is now harder to parse in the MODIFIED requirement.** `spec.md:29`
  reads "…via bold text, the pane's accent colour, and/or a background fill; the
  latter SHALL remain visible…". The antecedent is "a selected row within an
  unfocused pane" (it was unambiguous in the baseline at `:53`), but the inserted
  three-item list now sits between them, so "the latter" can be misread as "a
  background fill". Inherited phrasing, not introduced meaning — worth a two-word fix
  ("the unfocused pane's selection SHALL remain visible…") while the file is open.
- **`spec.md:5`'s "every colour used SHALL correspond to an entry in `ROLE_COLOUR` or
  `STATUS_COLOUR`" now coexists with `bgFill`'s `236`/`253` greys**, which are in
  neither table. Defensible — the clause is qualified by "for decoration alone" and
  the fill encodes selection+focus, plus the more specific ADDED requirement
  authorises those exact values — and `f.dim`/`f.bold` have always lived outside the
  tables. Flagging only because design.md invokes this very clause to justify the CR7
  fix, so a later auditor may ask why it binds the status word but not the fill. A
  clause naming weight/fill attributes as out of the tables' scope would settle it.
- **Carried from round 2, still unaddressed and still not a blocker:** `dim` is not
  mapped to a real 256-colour grey (`38;5;240`-ish). After this change, Decision 5's
  borders, Decision 6's phase/elapsed, `done`, and the priority `?` marker all lean
  on SGR 2 — the attribute terminals render most inconsistently. Worth a follow-up
  ticket, not this one.
- `layout.js:117` in design.md Decision 4 point 3 is actually `layout.js:116`.
  Immaterial; the call it names is the right one.
