## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Read `skeptic-design-1.md` (round 1's REFUTE, 3 findings) as a claim to
  re-verify, not fact.
- Read the revised `proposal.md`, `design.md`, `tasks.md`,
  `specs/fleet-failed-remediation/spec.md`, `specs/address-failure-skill/spec.md`,
  `ticket.md`.
- Re-verified round 1's finding 1 independently against the current code:
  `grep -n "'d'" lib/ui/screens/fleet/keys.js` → no output; `d` is genuinely
  unbound anywhere in that file today. `grep -n "'a'"` → only line 218, inside
  `if (focus === 'quickstart')`. Confirmed `a` is scoped, not top-level.
  The round-2 design's premise (drop the focus-mode idea; bind `a`/`d`
  top-level, mirroring `t`) is built on an accurate reading this time.
- Read the full current `handleKey` (`lib/ui/screens/fleet/keys.js`,
  all 300 lines) to check the proposed placement (design.md Decision 1's
  code snippet, "alongside the existing `t`/`l` bindings", tasks.md 3.1) for
  collisions against the `focus === 'queue'` (lines 177-199) and
  `focus === 'quickstart'` (lines 215-227) blocks — see Finding 1 below.
- Confirmed round 1's finding 3 (confirm-banner wiring) is now fully closed:
  `lib/ui/screens/fleet/render.js:280-296` and `lib/ui/watch.js:634` thread
  `forceStartConfirm`/`clearQueueConfirm`/`quitConfirm` through as render
  opts today; `sections.js`'s `buildHeadTail` (lines 206-334) reads them and
  prints banners via an `if/else if` chain (299/309/322). tasks.md 4.4
  explicitly targets adding `markDoneConfirm` to both the render-opts
  threading and a new `else if (markDoneConfirm)` branch in that same chain
  — distinct from 4.3's keypress/scroll-height wiring, and citing "skeptic
  gate round 1, finding 3" by name. This is complete and correctly targeted.
- Confirmed round 1's finding 2 (missing `grid.js`/`rows.js` visual-highlight
  wiring for a new `failedFocus` cursor) is resolved by removal: `grep -rn
  "failedFocus"` across the change dir returns only design.md:92 (explicitly
  listing it as what is now NOT needed) and the round-1 report itself — no
  planning artifact still requires wiring it in. Correct.
- Checked for dangling references to the dropped focus-mode approach across
  every current planning file (`grep -rn "FAILED-local focus mode\|focus ===
  'failed'\|failedFocus"` across `proposal.md design.md tasks.md
  specs/**/*.md ticket.md`) — see Finding 2 below.
- Checked the `ticket`-carrying action shape (`{ type: 'address-failure',
  ticket: ... }` / `{ type: 'open-mark-done-confirm', ticket: ... }`) for
  consistency across `design.md` (lines 82/85), `tasks.md` (3.1, 4.1),
  and `specs/fleet-failed-remediation/spec.md` (lines 8-9, 16, 21, 55) —
  consistent everywhere; no `index`-carrying leftover found.
- Read `lib/ui/controllers/fleet.js` (lines 1-135+) to confirm the
  `open-force-start-confirm`/`cancel-force-start`/`confirm-force-start` shape
  design.md/tasks.md 4.1 says `open-mark-done-confirm`/etc. will mirror is
  real and matches (lines 106-125).
- Read `lib/ui/app-state.js` for `markDoneConfirm`/`addressFailureNotice`
  collisions — none exist; both are genuinely new fields (tasks 4.2, 5.3 are
  sound).
- Read `docs/dashboard.md`'s drill-down key table (lines 104-125): `k`/`r`
  are "deliberately unreachable while EVIDENCE holds focus ... they return
  once focus moves to TICKET, TIMELINE, or GATES" — direct precedent
  confirming this codebase's own established discipline for exactly the
  class of gap in Finding 1 below (a destructive, row-scoped action must not
  fire against a selection the operator isn't currently looking at).
- Re-read Decisions 2-7 in full against `reducer.js`, `session.js`,
  `setup-worktree.sh` (spot-checked, not re-run line-by-line since round 1
  already verified these and the round-2 diff does not touch them) — no
  inconsistency introduced by the Decision 1 rewrite; Decision 2's confirm-
  banner sub-section is the only place Decision 2 references Decision 1's
  mechanism, and it correctly reflects the new no-focus-mode approach.
- Ran `openspec validate failed-run-remediation-controls --strict` →
  `Change 'failed-run-remediation-controls' is valid`.

### Verdict: REFUTE

### Change Requests

**1. The new top-level `a`/`d` bindings, as placed, leak through the
`focus === 'queue'`/`focus === 'quickstart'` blocks and can fire against a
stale, off-screen `runs[selected]` — reproducing the exact bug class this
codebase already guards against elsewhere, and design.md's own text
misdescribes the code structure that would prevent it.**

design.md's Decision 1 snippet places the new bindings "in its ordinary
`focus === 'runs'` path (i.e. after the `queue`/`quickstart` focus blocks,
alongside the existing `t`/`l` bindings)". This phrasing implies an
`if (focus === 'runs')` guard exists around that region — it does not.
Verified directly against `lib/ui/screens/fleet/keys.js`: the region from
line 130 (`if (prompt) return promptKey(...)`) through line 297 (end of
function) has no such guard; it is reached for any key not already
intercepted by the `focus === 'queue'` block (177-199) or
`focus === 'quickstart'` block (215-227), **regardless of the current
`focus` value**.

Both of those blocks are selective about which keys they claim:
- `focus === 'queue'` claims `j`/`k`/`f`/`t`/Escape, and explicitly
  suppresses `\r`/`l`/`n`/`N` (returns `null`) — but never mentions `a` or
  `d`.
- `focus === 'quickstart'` claims `j`/`k`/`a`/`t`/Escape, and explicitly
  suppresses `\r`/`l`/`n`/`N` — but never mentions `d`, and its `a` claim
  only protects `a`, not `d`.

So today (before this change), pressing `a` while `focus === 'queue'`, or
`d` while `focus === 'queue'` or `focus === 'quickstart'`, is already a
harmless no-op — both keys fall all the way through the current
`handleKey` and hit nothing. After this change, per the design as written,
that same keypress would instead resolve to `{ type: 'address-failure',
ticket: runs[selected].ticket }` or `{ type: 'open-mark-done-confirm',
ticket: runs[selected].ticket }` whenever `runs[selected]` happens to be a
FAILED row — which is entirely plausible, since entering queue/quickstart
focus never touches `selected` (the same "selected is left untouched" fact
Decision 1 itself relies on to justify not needing a new cursor). An
operator who selects a FAILED row, then digit-jumps into QUEUED or QUICK
START (`selected` unchanged underneath), then reflexively presses `a` or
`d` — intending nothing related to that FAILED row, since it is not even
what's on screen — would silently spawn `/concertino-address-failure`
(killing/replacing an existing tmux window) or open the mark-done confirm
banner for a row they are not looking at. `d`'s outcome is a manual,
sticky, dashboard-only override with no undo affordance (proposal.md's own
Non-Goals: "Reversing a `d` override, or a generic 'undo' affordance").

This is precisely the bug class `keys.js`'s own Enter/`l`/`n`/`N`
suppression inside both focus blocks exists to prevent (per that block's
own comment: "they would otherwise act on whatever `runs[selected]` was
pointing at before queue-focus was entered, which is not what the operator
is looking at"), and `docs/dashboard.md:121-125` documents the identical
discipline already shipped in the drill-down (`k`/`r` "deliberately
unreachable while EVIDENCE holds focus ... they return once focus moves to
TICKET, TIMELINE, or GATES"). Decision 1's claim to mirror `t` is
incomplete on this specific point: `t` is *safe* to leak through unguarded
because it is separately, explicitly bound *inside* both focus blocks
(lines 191, 224) rather than relying on fallthrough — so pressing `t` while
queue/quickstart-focused always resolves against the section actually in
view, never against a stale `runs[selected]`. `l` is separately protected
by being in the explicit suppression list. Neither protection exists for
the new `a`/`d` bindings as specified.

Required: `design.md` (Decision 1) and `tasks.md` (3.1, and the
`specs/fleet-failed-remediation/spec.md` requirement/scenarios it backs)
must specify one of:
  (a) An explicit `focus === 'runs'` condition added to the new `a`/`d`
      checks (making design.md's existing prose description literally true
      of the code), or
  (b) Explicit suppression of `a` and `d` added to both the
      `focus === 'queue'` and `focus === 'quickstart'` blocks (mirroring
      the existing `\r`/`l`/`n`/`N` suppression there),
and a task + spec scenario covering "`a`/`d` are no-ops while QUEUED/QUICK
START is locally focused, even when `runs[selected]` is a FAILED row" —
currently absent from both `tasks.md` and
`specs/fleet-failed-remediation/spec.md`'s "no-op on non-FAILED row"
scenario (which only covers `runs[selected].status !== 'failed'`, not the
focus-scoped case).

**2. `tasks.md` 8.1 still instructs documenting "the FAILED-local focus
mode" — a dangling reference to the approach Decision 1's revision
explicitly dropped.**

`tasks.md:117-119`:
> `docs/dashboard.md`: document the FAILED-local focus mode, the `a`/`d`
> keys (and their footer hints), and a new subsection on
> `/concertino-address-failure` — mirroring the existing QUEUED/QUICK
> START documentation shape.

`design.md`'s own Revision note (lines 11-23) states plainly that "this
revision drops the focus-mode approach entirely" and Decision 1 confirms
"no new focus mode, no new local cursor... no digit-jump changes". There is
no FAILED-local focus mode left anywhere in the current design for 8.1 to
document — this line is leftover text from the pre-revision draft that was
not updated when Decision 1 was rewritten. As written, whoever executes
task 8.1 would be instructed to document a mechanism that does not exist in
this change, either producing incorrect documentation or requiring them to
silently reinterpret the task.

Required: reword 8.1 to describe documenting the top-level, `status ===
'failed'`-conditioned `a`/`d` bindings (no focus mode), e.g. "document the
`a`/`d` keys (top-level, active on a selected FAILED row) and their footer
hints".

### Non-blocking notes

- Round 1's finding 1 (false "already claimed" premise) and finding 3
  (invisible confirm banner) are both now correctly and completely
  resolved — verified against the actual current code, not just the
  revised prose. Finding 2 (grid.js/rows.js highlight wiring) is correctly
  resolved by removal (no cursor left to highlight).
- The `ticket`-carrying action shape is applied consistently across
  design.md, tasks.md, and the spec delta; no `index`-carrying leftover.
- `specs/address-failure-skill/spec.md` is untouched and remains internally
  consistent with the revised Decision 1/2 text around it — nothing in it
  depends on the dropped focus-mode mechanism.
- Decisions 2-7 (the `run.override` event/`deriveStatus` precedence branch,
  retry-visibility refinement, `/concertino-address-failure` handoff
  design, the dashboard-only/FAILED-only scope decisions, and the CON-100
  follow-up) remain sound and consistent with the rewritten Decision 1 —
  spot-checked, no new inconsistency introduced by the round-2 revision.
