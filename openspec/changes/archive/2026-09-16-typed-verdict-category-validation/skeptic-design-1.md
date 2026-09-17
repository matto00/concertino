## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

1. **Spawn-cwd guard.** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/typed-verdict-category-validation/CON-189` — ambient cwd is the unrelated helio checkout (this session's launch dir), which is an expected non-worktree ambient for a subagent spawn, not a mismatch. Proceeded.

2. **Decision 3 / CON-171 lease placement claim — CONFIRMED against the live script.**
   - `core/scripts/emit-event.sh:282-296` (the `resolution_channel)` case, the only existing in-loop refusal) sits inside the `k=v` argument loop.
   - `core/scripts/emit-event.sh:373-385` is the auditor-lease release (`lease_release "$ROOT" "$TICKET" || true`), which runs strictly after the loop and after `TICKET` canonicalization.
   - The header comment at lines 55-65 states the release happens "on RECOGNITION of the call shape, regardless of whether the event write itself succeeds, is truncated, or is skipped by an early-exit / validation path below" — matching design.md's Context claim 3 verbatim in substance.
   - `resolution_channel` never appears on a `verdict role=auditor` call (it belongs to `escalation.answered`), so the claim that its placement precedent doesn't transfer to a verdict-field refusal is accurate. Decision 3's placement (validation strictly after line 385) is therefore the only placement consistent with the quoted CON-171 guarantee, and tasks 2.1/2.7 verify it mechanically (line-number check + lease-released-on-refusal assertion). Sound.

3. **Decision 2 / blast radius — plausible, correctly scoped, and the residual risk is disclosed rather than hidden.**
   - Confirmed helio's `scripts/concertino/emit-event.sh` is a separately-tracked rendered copy only updated at `concertino sync` (matches CLAUDE.md's own "render target" section for helio, independently known ground truth).
   - The one real risk — this run's own review-agent spawn prompts (rendered from `.claude/agents/concertino-*.md` at the last sync) not yet knowing to pass `category=`/`gate=`/40-char `head_sha=` once this worktree's emitter goes strict — is disclosed as a real, unmitigated-by-code risk and pushed to explicit spawn-prompt instructions recorded in tasks.md's "Run-Scoped Execution Notes." This is a real constraint on the orchestrator, not a design defect, and it's the correct call given "no code fix possible" — the emitter can't know what a stale role file will or won't send.

4. **Decision 1's cost (CON-185 zero-verdict hazard) — stated plainly, not glossed.** proposal.md's "Tension this change must resolve explicitly" section and design.md's Decision 1 "The cost, stated plainly" both name the hazard by its own ticket number and accept it on the tickets' explicit terms (CON-189 AC2's own wording, CON-187's own "worse than none" framing). This meets the binding constraint 3's requirement for an explicit resolution rather than a silent one.

5. **Decision 4 / CON-194 enforceability — verified against the ticket's own evidence, and the substituted mechanism is proportionate.** Ticket premise correction 4 states `role=` is caller-asserted with no identity access, and that on HEL-1109 the orchestrator emitted `role=skeptic` (impersonation, not a distinguishable orchestrator-role event) — this makes "reject an orchestrator-authored verdict by role" genuinely unimplementable, matching the design's Decision 4 reasoning exactly. The substituted mechanism (Decision 5's required `gate` on skeptic verdicts + Decision 6's widened doc prohibition) satisfies CON-194 AC1 ("prevented or made mechanically detectable" — the spec's own scenario states a same-ticket/role/gate duplicate becomes identifiable) and AC2 (orchestrator doc states it plainly) without overclaiming an identity check the code cannot provide. verdict-authorship spec.md's own "Authorship is enforced by instruction and detectability, not by an emitter identity check" requirement explicitly disclaims what it cannot do, rather than quietly restating the AC as satisfied — good discipline.

6. **Decision 5 scoping (gate required for skeptic only) — faithful to CON-194, not an under-delivery.** CON-194's own ticket text offers "the skeptic always populate `gate`" as its second option; the design takes exactly that, and premise correction 5 (historical `gate` population is unsound as a retroactive authorship signal) is honestly carried into the spec's "Note on a historical inference this does NOT support" — the design doesn't oversell what the field buys retroactively.

7. **Decision 7 / `read_raised_field()` scope claim — CONFIRMED by reading the function.** `core/scripts/emit-event.sh:442-465` shows `read_raised_field()` dispatches strictly over `kind === "escalation.raised"` events and only the three fields `raised_at`/`escalation_id`/`sub_questions` (falling through to `sub_questions` for anything else, exactly as CON-188's flagged pattern describes). `category`, `gate`, and `head_sha` are fields this change adds to `verdict` events only — a structurally disjoint event kind and field set. Decision 7's claim that this change is not CON-188's "fourth field" is accurate; filing the `read_raised_field()` tightening as a spinoff rather than folding it in is correct scope discipline, not scope-avoidance.

8. **AC coverage — traced, no gaps found in either direction.**
   - CON-189 AC1/AC2 → `verdict-category` spec's "Every verdict event carries a category" requirement + tasks 2.2/2.3.
   - CON-189 AC3 → `verdict-category` spec's third requirement + tasks 4.1.
   - CON-187 AC → `verdict-sha-binding` MODIFIED requirement + tasks 2.4/2.5.
   - CON-194 AC1 → `verdict-authorship`'s "gate" requirement + duplicate-detectable scenario + tasks 2.6.
   - CON-194 AC2 → `verdict-authorship`'s orchestrator-prohibition requirement + tasks 4.4.
   - No task does work uncovered by an AC; task 2.3 (validating `category` on non-verdict events too, never requiring it there) is a closed-enum consistency decision explicitly scoped in the spec's own scenario, not unrequested scope creep.

9. **Mutation-proof discipline (binding constraint 4) is designed in, not just asserted.** tasks.md section 5.1 requires every new refusal be shown RED against the pre-change script before green, with the baseline (`category=totally-bogus`, missing category, `head_sha=deadbeef` all exit 0 today) already recorded in ticket.md as the reference point. This is the CON-197 discipline correctly applied at the planning stage.

10. **`openspec validate "typed-verdict-category-validation" --type change`** — ran it directly (not `cmd | tail`), captured immediately: `Change 'typed-verdict-category-validation' is valid`, `EXIT:0`.

### Non-blocking notes

- Task 2.3 (validating `category` on non-verdict events, never requiring it) is a reasonable closed-enum-hygiene decision but is not requested by any AC; it's small and consistent with the spec's own stated scenario, so it's noted rather than treated as a defect.
- Decision 9's historical-tolerance test (task 5.3) is good discipline; worth the executor double-checking `lib/ui/screens/fleet/metrics.js`'s counting path specifically, since it's the one most likely to silently misclassify an uncategorized event as a distinct bucket rather than an "uncategorized" bucket — not a design defect, just an implementation-time watch item.

### Verdict: CONFIRM

No numbered change requests. The design's own load-bearing claims (CON-171 lease-ordering, the blast-radius argument, CON-194's enforceability limit, and the `read_raised_field()` scope disclaimer) all held up against direct inspection of the live script and the ticket's premise-validation evidence. All three tickets' acceptance criteria trace to a specific requirement and task. The exit-0-contract tension is resolved explicitly rather than glossed, and the cost of Decision 1 is stated plainly rather than hidden.
