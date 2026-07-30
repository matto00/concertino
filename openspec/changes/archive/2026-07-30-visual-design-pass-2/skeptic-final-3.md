## Skeptic Report — final gate (round 3)

Cold spawn. Every conclusion below is derived from the committed tree, gates I ran
myself, renders I produced myself, and 17 single-change mutations I applied to a
scratch copy. I read `skeptic-final-1.md`, `skeptic-final-2.md`, `files-modified.md`
and `b5f8e0c`'s commit message as **claims to verify**, not as findings to inherit —
every round-2 change request was re-tested from scratch by reversion rather than by
reading the delivered assertion and assuming it means what it says. I also re-ran
the checks the orchestrator reported, rather than relying on them.

Reviewed: `b5f8e0c` on `feature/visual-design-color-hierarchy/CON-30`
(`0ee1767` → `9b81213` → `b5f8e0c`), diffed as `git diff main...HEAD`.

### What I verified (with evidence)

**Gates (`concertino.config.json` → one gate, `test` / `npm test`, `when: always`)**

Run fresh in the worktree, not from the evaluator's or orchestrator's report:

- `npm test` → exit 0 (`node --test` plus 16 shell suites; final shell suite
  `22 passed, 0 failed`).
- `node --test` → `ℹ tests 684 / ℹ pass 684 / ℹ fail 0`.
- `TERM=xterm-256color COLORTERM=truecolor node --test` → `684 / 684 / 0`.
- `env -u COLORTERM TERM=dumb node --test` → `684 / 684 / 0`.
  (Task 7.2's claim — that the tier-sensitive assertions are pinned and no longer
  ambient-environment-dependent — holds under all three.)
- `npx openspec validate visual-design-pass-2 --strict` → `Change 'visual-design-pass-2' is valid`.
- `tasks.md` → 0 unchecked boxes.
- Worktree carries no uncommitted code change (only `workflow-state.md` bookkeeping
  and the untracked `skeptic-final-2.md`). My scratch copy was diffed back against
  the worktree after the last mutation: `lib/` identical.

**Production code — traced against ticket, spec delta, and design decisions**

I read `git diff main...HEAD -- lib/` in full. The four production files
(`format.js`, `layout.js`, `screens/fleet.js`, `screens/launchpad.js`) implement all
six design decisions, and every ticket AC traces to behaviour I observed in my own
renders:

| Ticket AC / constraint | Traced to | Verified how |
| --- | --- | --- |
| Widen the palette, honest capability detection + fallback | `format.js:4-7`, `13-22` | Rendered fleet + launch pad at `basic` and `256`: `ESC[36m` vs `ESC[38;5;80m` |
| `running` and `done` get distinct treatments at row level | `format.js:44`; `fleet.js:102` | Fleet render: running bar `ESC[38;5;80m▪▪▪…`, done bar `ESC[2m░…`, failed `ESC[38;5;203m`, unknown falls back to `ESC[2m` |
| Background colours → selected-row highlight | `format.js:311-325`, `layout.js:92-95`, `launchpad.js:314-315` | Launch-pad render, both panes, both tiers (below) |
| Dim the unfocused chrome | `layout.js:39` | Every unfocused border renders `ESC[2m│ESC[0m` in my render |
| Typographic hierarchy | `fleet.js:55, 80, 90` | Fleet render: `ESC[1mCON-1`, `ESC[2mExecution`, `ESC[2m6m` — four distinct weights per row |
| Constraint: structural focus survives a colourless terminal | `layout.js:23` `BORDERS` untouched in diff | Non-TTY render: `┏━┓` vs `┌─┐` still distinct with **zero** escapes emitted |
| Constraint: all colour routes through the `isTTY` gate | `format.js:312` `if (!TTY) return s;` | Non-TTY render of both screens: no `\x1b` anywhere |
| Constraint: `borderColour` colours border chars only | `layout.js:39` separation unchanged | Fill escape sits strictly between the two border characters in every rendered row |
| Constraint: degradation stays honest | `bgFill` basic fallback; `degrade()` path untouched | Width-budget sweep at cols 50/60/78/100/120/200 × both panes: **zero** lines exceed budget |

**Design judgement (my own, on rendered output — this is the part the evaluator defers)**

I rendered the launch pad (both panes focused, four tickets incl. an unknown-priority
row and a `▲ running` row, three epics incl. the `─ unassigned ─` bucket) and the
fleet screen (needs-you / running / failed / done / unknown) at the basic tier, the
256 tier, and non-TTY.

- **Focus is unmistakable and multiply-encoded.** Heavy border characters + bold cyan
  border + a filled selected row on the focused side; plain characters + dim border +
  a dim selected row on the other. Removing colour entirely still leaves the
  character-set distinction, so Decision 2 is genuinely additive.
- **Theme parity holds by construction, at both tiers.** The 256 fill is an explicit
  pair (`48;5;236` background + `38;5;253` foreground), so it does not inherit the
  terminal's default foreground; the basic fallback is SGR 7, theme-independent by
  definition. Neither tier can produce an unreadable fg/bg collision on a light theme.
  This is the right call and it is what a hardcoded `48;5;236` alone would have got wrong.
- **The steady state is no longer grey.** The ticket's core complaint is answered:
  a healthy fleet now reads cyan-running / dim-done / bold-ids rather than uniform grey.
- **Spacing rhythm and column alignment survive.** The priority column, id column and
  status column stay aligned across filled, dim and plain rows at every width I tried,
  including the CJK case the existing suite covers.
- **Cyan reuse (focused border / running bar / `▲ running`) reads fine.** Vertical
  chrome vs. inline text, plus the border's bold, separate them adequately.

I would ship the rendered result. **The production code is ships-quality** — I found
no visual or behavioural defect in it, and nothing rounds 1–2 missed on that side.

**Mutation testing — 17 single-change reversions, full 684-test suite each**

Scratch copy at `/tmp/.../scratchpad/mut2` (the worktree was never modified). Baseline
re-confirmed at 684/684 before the run and after every restore. Every *not-caught*
result was reproduced at least twice before I drew a conclusion from it.

| # | Mutation | Result |
| --- | --- | --- |
| mA | `ticketRow` unfocused-selected loses `f.dim` (round-2 M18) | **caught** (1 fail) |
| mB | `fillRow` ungated from pane focus, both panes (round-2 M15) | **NOT caught** (684/684, ×3) |
| mB2 | `fillRow` ungated, tickets pane only | **NOT caught** (684/684) |
| mC | `epicRow` outer bold restored (round-2 M3) | **caught** |
| mD | `ticketRow` outer bold restored (round-2 M4) | **caught** |
| mE | both rows' outer bold restored (round-2 M9) | **caught** (2 fails) |
| mF | `box()` fills *every* row (round-2 M10) | **caught** — (b) |
| mG | fill covers inner only, padding outside (round-2 M14) | **caught** — (a) + (c) |
| mH | fill removed entirely (`filledBody = body`) | **caught** (6 fails) |
| mI | `bgFill` drops its trailing reset (round-2 M11) | **caught** — now by (a) + (c) too |
| mJ | `bgFill` loses nesting-safety | **caught** (3 fails) |
| mK | tickets pane never filled | **caught** (3 fails, incl. `:405`) |
| mL | **epics pane never filled** | **NOT caught** (684/684, ×2) |
| mM | fill excludes the right padding column only | **caught** — (a) + (c) |
| mN | `truncate` stops re-appending the closing reset | **caught** — (d) + 2 |
| mO | `borderColour(false)` back to identity | **caught** (4 fails) |
| mP | `STATUS_COLOUR.running` back to `dim` | **caught** (3 fails) |

**Round-2 change requests, re-checked individually by reversion**

| Round-2 CR | Status | Evidence |
| --- | --- | --- |
| 1 — `:707` vacuous assertion → dim **and** no-fill | **half fixed** | dim half live (mA caught). **No-fill half still inert** — mB/mB2 → see CR1 below |
| 2 — "no outer bold" for both panes | **fixed** | mC, mD, mE all caught; `test/launchpad.test.js:643, 656` |
| 3 — layout `fillRow` (a)(b)(c)(d) tautological | **fixed** | mF→(b), mG/mM→(a)+(c), mI→(a)+(c), mN→(d), mH→(a)+(c)+(d) |
| 4 — `:405` asserted pre-change behaviour | **fixed** | now asserts `/\x1b\[7m/`; mK and mH both catch it |
| 5 — two stale comments in `launchpad.js` | **fixed** | `:155` "fill (background highlight) in the focused pane, dim in the unfocused one"; `:181` "decides fill vs. dim" — both now match the code |
| 6 — `files-modified.md:15` overstates coverage | **not fixed** | rewritten, but still claims the no-fill check — see CR3 |

Five of six are genuinely fixed and I verified each by reversion, not by reading.
Round-2 CR3 in particular is now thoroughly load-bearing: seven distinct mutations of
the fill pipeline are each caught by a named layout assertion.

### Verdict: REFUTE

To be explicit about proportion, because this exhausts the granted budget: **the
production code ships, and I found nothing wrong with it.** All six design decisions
are correctly implemented, every ticket AC traces to output I rendered and looked at,
the visual result is good at both colour tiers and degrades honestly to a colourless
pipe, and 15 of my 17 mutations are caught. Round 3 closed five of round 2's six
change requests properly.

I am refuting on the sixth, which is the same assertion round 1 (CR4) and round 2
(CR1) each asked for and which is *still* structurally incapable of failing —
plus the one uncovered spec scenario the same fix sits next to, and the doc line that
asserts the fix landed when it did not.

The delivered assertion at `test/launchpad.test.js:744` is not merely weak; it is a
tautology. `ticketMatch[0]` is provably the constant string
`"\x1b[2m ▸ [ ] High CON-1"` (I printed it), because the regex at `:741` is lazy
(`[^\x1b]*?`) with an optional tail, so it stops at `CON-1`. `bgFill` opens *before*
the row's `f.dim`, so the escape being searched for cannot appear inside the searched
substring under any implementation. The consequence is measured, not theoretical:
ungating `fillRow` from pane focus — undoing task 5.2 and violating spec.md:29's
"SHALL NOT use the same emphasis as a selection in the focused pane" — leaves the
suite at 684/684 (mB, three reproductions; mB2, tickets pane alone). This matters
more than a normal inert assertion because the `// CR1:` comment above it now makes
the gap *look* closed to the next reader.

Under this project's Iron Law ("the test fails before the fix and passes after — show
both"), that is not verification, and `b5f8e0c`'s commit message and
`files-modified.md:15` both state that it is.

The residual work is small and entirely mechanical: roughly ten lines in one test
file plus one documentation line. No production-code change is implied by any of it.

### Change Requests

1. **`test/launchpad.test.js:741-744` — the no-fill half of round-2 CR1 is still a
   tautology.** In `test('the unfocused pane\'s selected row uses dim, not bold+fill …')`,
   the subject of the `doesNotMatch` at `:744` is `ticketMatch[0]`, which the lazy
   regex at `:741` fixes to exactly `"\x1b[2m ▸ [ ] High CON-1"` — a string that begins
   at the dim escape and ends at the identifier, and therefore cannot contain the fill
   escape that `bgFill` emits *ahead* of the dim. Scope the no-fill check to the
   **whole right-hand (tickets) pane segment** of the joined `hsplit` line, not to a
   substring that starts after the fill would open. Concretely: split `combined` at the
   pane gap (or slice from the tickets pane's left border character onward) and assert
   `doesNotMatch(ticketsSegment, /\x1b\[7m/)`. Do **not** assert on the whole joined
   line — the focused epics pane's own legitimate fill is on that same line
   (I confirmed `/\x1b\[7m/.test(combined)` is `true` on unmutated `HEAD`), which is
   the anchoring trap that produced this version.
   Proof it is required: with `launchpad.js:315` changed from
   `fillRow: ticketsFocused ? selectedRightRow : null` to `fillRow: selectedRightRow`,
   the suite stays 684/684 (mB2). The same holds when both panes are ungated (mB,
   reproduced three times). The `assert.ok(ticketMatch, …)` at `:742` is fine and does
   carry the dim half — keep it.

2. **The spec scenario "The launch pad's focused-pane selected row is filled, not
   merely bold" (`specs/dashboard-visual-design/spec.md:61-66`) has no assertion that
   can fail.** That scenario's WHEN is explicitly `lp.pane === 'epics'`, and nothing
   covers the epics pane's fill: setting `launchpad.js:314`'s
   `fillRow: epicsFocused ? selectedLeftRow : null` to `fillRow: null` leaves the suite
   at 684/684 (mL, reproduced twice). The tickets-pane analogue *is* covered
   (mK → 3 failures incl. `test/launchpad.test.js:405`), so this is the missing half
   of a property that is otherwise guarded — and the epics pane is precisely where
   round 1 found the one real production defect. Add an assertion that the selected
   **epic** row carries the `bgFill` escape when `lp.pane === 'epics'` (scoped to the
   left-hand pane segment, for the same reason as CR1).

3. **`openspec/changes/visual-design-pass-2/files-modified.md:15` still asserts a fix
   that did not land.** It reads "CR1 replaced vacuous unfocused-selection assertion
   with real dim + **no-fill** checks". The dim check is real; the no-fill check is
   inert per CR1. Correct the line once CR1 lands. (The rest of that line — CR2's
   direct `epicRow`/`ticketRow` tests and CR4's `:405` update — is accurate; I verified
   both by reversion.)

### Non-blocking notes

- `test/launchpad.test.js:657-659` — the `ticketRow` direct test destructures
  `renderLaunchPad: renderColoured` and requires `f`, then uses neither. Harmless
  (no lint gate is configured in `package.json` or `.github/workflows/publish.yml`),
  but it is dead weight in a test whose whole point is precision. `:644` gets this right.
- `test/launchpad.test.js:741`'s regex hard-depends on `priority: 2` rendering as
  `High`, which happens to fill `PRIORITY_WIDTH` (4) exactly, so exactly one space
  separates it from `CON-1`. A change to `PRIORITY_WIDTH` would break the match — but
  it would break it *loudly* (`assert.ok(ticketMatch)` fails), so this is fragile-but-
  fail-safe, not silent. Worth anchoring on the pane segment instead while doing CR1.
- `lib/ui/screens/launchpad.js:155` is now 103 columns, against the file's otherwise
  consistent ~76-column comment rhythm. Purely cosmetic; the content is correct.
- `test/layout-colour.test.js:60` (a) and `:80` (c) both also fail under mO
  (`borderColour(false)` → identity), because their regexes require `\x1b[0m\x1b[2m[│┃]`.
  That is over-coupling, not inertness — it can only produce false *failures*, never
  false passes, so it is not blocking.
- **Unfocused selected row's `▲ running` does not fully recede.** In my basic-tier
  render of `pane: 'epics'`, the unfocused tickets row is
  `ESC[2m ▸ [ ] High CON-1 … ESC[36m▲ runningESC[0m  ESC[0m` — the inner status colour's
  reset ends the outer `f.dim`, so the status word renders full-brightness. It is still
  clearly distinguishable from an unselected row (marker + dimmed prefix), and this is
  pre-existing `f.dim`-over-inner-colour behaviour rather than anything this change
  introduced (the status was hardcoded `f.yellow` before). Not a regression; noting it
  because `bgFill`'s nesting-safety solved exactly this problem for the *focused* side
  and `f.dim` has no equivalent.
- **Fleet typographic hierarchy is still unguarded** (round 2's identical note, still
  true): reverting `fleet.js:90`'s `f.bold` or `:55`'s `f.dim` would not fail the suite.
  Tasks 7.3–7.10 never asked for these, so it is out of scope for a change request.
- `skeptic-final-2.md` is untracked in the worktree. `skeptic-final-1.md` is committed;
  for a consistent record, round 2's and round 3's reports should be committed too.
- **Base has moved:** `main` is ahead of this branch's base. Warn-only per CON-31; my
  review used three-dot `main...HEAD`, so nothing above is affected by it.
