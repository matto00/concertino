## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

- Read `skeptic-design-2.md` (round 2's REFUTE, 2 findings) as a claim to
  re-verify, not fact.
- Read the revised `design.md`, `tasks.md`,
  `specs/fleet-failed-remediation/spec.md` in full.

**Finding 1 (leak through queue/quickstart focus) — re-verified as closed:**

- Read the full current `lib/ui/screens/fleet/keys.js` (all 301 lines).
  Line 94: `const focus = (state && state.focus) || 'runs';` — `focus`
  defaults to `'runs'` when unset, matching `app-state.js:172`'s own
  `focus: 'runs'` default.
- Confirmed the `focus === 'queue'` block (lines 177-199) does not claim
  `a` or `d` anywhere in its body, and the `focus === 'quickstart'` block
  (lines 215-227) claims `a` (line 218, unconditionally, inside that block)
  but not `d`. Neither block's fallthrough guards (`\r`/`l`/`\x1b[C`/`n`/`N`
  suppression at lines 198 and 226) mention `a`/`d` either. So absent a
  guard, both keys would fall through to the region after line 227,
  reached regardless of `focus`'s value.
- Confirmed the new bindings design.md's Decision 1 snippet specifies
  (`if (key === 'a' && focus === 'runs' && runs[selected] && ...)`, and the
  `d` equivalent) genuinely close this: with `focus === 'runs'` explicit in
  the condition, the new checks evaluate `false` whenever `focus` is
  `'queue'` or `'quickstart'`, regardless of `runs[selected]`'s status —
  the keypress falls through to the function's final `return null;`
  (line 297) exactly as it does today for any other unbound key in that
  focus state. Traced both paths by hand against the actual line numbers:
  - `focus === 'queue'`, key `'d'`: not claimed by the queue block (no `d`
    branch there), not claimed by the quickstart block (`focus` guard on
    that block itself is false), not claimed by `CLEAR_QUEUE_KEY`/`n`/`N`/
    `s`/`v`/`q`/`j`/`k`/`\r`/`l`/`t`, falls to the new `d` check —
    `focus === 'runs'` is false → skipped → `return null`.
  - `focus === 'quickstart'`, key `'d'`: not claimed inside the quickstart
    block (only `j`/`k`/`a`/`t`/Escape/suppressed keys are), falls through
    past line 227 the same way, reaches the new `d` check —
    `focus === 'runs'` is false → skipped → `return null`.
  - `focus === 'quickstart'`, key `'a'`: claimed and returned at line 218
    (`quickstart-add`) before ever reaching the new top-level check — no
    change in behavior for this case, correctly untouched.
  - `focus === 'queue'`, key `'a'`: not claimed by the queue block, falls
    through to the new `a` check, `focus === 'runs'` false → skipped →
    `return null` (harmless no-op today and after this change, matching
    the "before this change" baseline round 2's report established).
- This confirms design.md's "Design-gate round 2 correction" paragraph and
  the code snippet accurately describe the fix, and that the fix actually
  works as claimed against the real file structure — not just against the
  revised prose.

**No new problem introduced — confirmed `focus === 'runs'` is not
over-excluding a legitimate fourth value:**

- `grep -n "focus" lib/ui/app-state.js` → only two hits for the fleet
  screen's `state.focus`: the field declaration (`focus: 'runs'`, line
  172) and the render-opts pass-through (`focus: S.focus`, line 291). No
  third initial value anywhere.
- `grep -rn "\.focus\s*=\|focus:" lib/ui/*.js lib/ui/**/*.js
  lib/ui/screens/fleet/*.js lib/ui/controllers/*.js` → every assignment to
  the fleet screen's `S.focus` (`lib/ui/controllers/fleet.js:70,81,99,139,
  152,174,247`, plus `watch.js:649-652,672`'s read-and-reset) sets it to
  only `'runs'` or `'queue'` or `'quickstart'` — no fourth value assigned
  anywhere. The other `focus`-named fields in that grep
  (`settings.js`'s `sections`/`fields`, `drilldown.js`'s `DRILL_PANELS`-
  based panel focus) belong to entirely separate state objects
  (`S.settings.focus`, the drilldown's own focus concept), not
  `state.focus` as read by `keys.js`'s `handleKey` — confirmed by
  `keys.js` importing nothing from those modules and reading `state.focus`
  directly (line 94). So `focus === 'runs'` correctly and exhaustively
  covers "not queue, not quickstart" for this specific state field; no
  legitimate case is wrongly excluded.

**Finding 2 (dangling "FAILED-local focus mode" reference in 8.1) —
re-verified as closed:**

- `tasks.md:127-131` now reads: "document the `a`/`d` keys — top-level,
  active only when a FAILED row is selected and no other section is
  locally focused (and their footer hints) — and a new subsection on
  `/concertino-address-failure`. No focus mode to document (dropped in
  design-gate revision — see design.md's Decision 1)." This accurately
  describes the actual mechanism (top-level binding, `focus === 'runs'`
  gate stated in plain language as "no other section is locally focused")
  and explicitly forecloses the dropped focus-mode reading rather than
  leaving it ambiguous. `grep -rn "FAILED-local focus mode\|focus ===
  'failed'\|failedFocus"` across every file in the change dir → zero
  hits. Fully resolved.

**New scenario in spec.md — checked for well-formedness/consistency:**

- `specs/fleet-failed-remediation/spec.md`'s first requirement (lines 1-16)
  now states the `focus === 'runs'` condition explicitly in its normative
  text and gained a fourth scenario (lines 35-42): "`a`/`d` are no-ops
  while QUEUED or QUICK START is locally focused, even if the (off-screen)
  selected row is FAILED" — GIVEN `runs[selected].status === 'failed'` AND
  `focus` is `'queue'` or `'quickstart'`, WHEN `a`/`d` pressed, THEN both
  return `null`. Same GIVEN/WHEN/THEN shape as the other three scenarios
  in that requirement; correctly exercises the previously-missing case
  (focus-scoped no-op, distinct from scenario 3's "wrong status" no-op).
  The four scenarios jointly cover: focus=runs+failed (a resolves),
  focus=runs+failed (d resolves), focus=runs+not-failed (both no-op),
  focus=queue-or-quickstart+failed (both no-op) — an exhaustive partition
  of the condition space that matters for this requirement.

**Light spot-check of everything round 2 already confirmed sound:**

- Decisions 2-7 in the current `design.md` read identically in substance
  to what round 2's report describes verifying (the `run.override` event/
  `deriveStatus` precedence branch, the retry-visibility refinement, the
  `/concertino-address-failure` handoff design via
  `core/roles/orchestrator.md`'s new entry point, the dashboard-only/
  claude-code-only/FAILED-only scope decisions, and the CON-100 filing) —
  this round's diff is confined to Decision 1's own section, its
  surrounding "Design-gate round 2 correction" paragraph, tasks.md 3.1/3.2/
  8.1, and the spec.md requirement/scenario Finding 1 concerns. No other
  section of any planning artifact shows any textual change bearing on
  those decisions.
- `specs/address-failure-skill/spec.md` — confirmed present (110 lines),
  untouched by this round's revision (round 2 already verified it does not
  depend on the dropped focus-mode mechanism).
- The confirm-banner wiring (round 1 finding 3 / round 2's confirmation of
  it) — `tasks.md` 4.4 still carries the identical citation and content
  round 2 verified as complete and correctly targeted; no regression
  visible in this round's diff.
- Ran `openspec validate failed-run-remediation-controls --strict` (via
  `/usr/bin/openspec`, not the stale `npx` wrapper which errored on a
  missing local binary) → `Change 'failed-run-remediation-controls' is
  valid`.

### Verdict: CONFIRM

### Non-blocking notes

- Round 2's two findings are both now genuinely resolved against the real
  code and the real files, not merely against revised prose — the
  `focus === 'runs'` guard was traced hand-by-hand against every reachable
  path in `keys.js`'s actual `handleKey`, and `state.focus`'s value space
  was confirmed exhaustive (only `'runs'`/`'queue'`/`'quickstart'`, no
  fourth value anywhere in this codebase) via direct grep of every
  assignment site.
- This is now three design-gate rounds on the same ticket; nothing further
  found. Ready for implementation.
