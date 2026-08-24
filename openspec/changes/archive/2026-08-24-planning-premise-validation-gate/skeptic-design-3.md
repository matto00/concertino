## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

**Round-2 finding (fixed bare staging filename / misstated emit-event.sh behavior) — revision is correct.**
- `scripts/concertino/persist-evidence.sh` lines 98-134: `SRC_ABS` → `SRC_TOPLEVEL` (`git -C "$SRC_DIR" rev-parse --show-toplevel`) → `SRC_REL="${SRC_ABS#"$SRC_TOPLEVEL"/}"`, then `DEST_PATH="${ROOT}/.concertino/runs/${TICKET_ID}/evidence/${SRC_REL}"`. Confirms design.md Decision 2's core claim exactly: destination preserves the source's toplevel-relative path, so landing at `evidence/premise-validation.md` **requires** the source to be a bare filename at the main checkout's toplevel. A temp-dir-per-ticket source is genuinely unavailable for this artifact — not an excuse.
- `scripts/concertino/emit-event.sh` lines 385-408: `write_escalation_raised()`'s staging is `mktemp -d "${ROOT}/.escalation-context-tmp.XXXXXX"` under `ROOT` (the main checkout), with the exact comment the design now cites ("concurrent or successive escalations on the same ticket never collide or overwrite each other's persisted context"). Nothing in that path is async. The round-2 misstatement is fully corrected; design.md line 30 now describes the real behavior and correctly explains why the mitigation is not transferable here.
- Single-shell-invocation framing is coherent and introduces no new problem: `persist-evidence.sh` accepts any path and resolves it via `cd`/`pwd`, so passing the main checkout's absolute repo-root path works identically to a relative one while removing the cwd-persistence assumption. `rm -f` after the persist is safe (the durable copy is already written; script FAILs before copying if the source is unreadable). `; rm -f` (not `&&`) correctly cleans up even on a persist failure. The residual same-instant race is stated honestly in Risks (design.md line 75) rather than asserted away — that is the correct disposition, not a defect.
- tasks.md 3.3 and `specs/premise-validation/spec.md` lines 21-37 both carry the absolute-path + single-invocation + "shrinks not eliminates" language. No artifact-to-artifact contradiction.

**Round-2's second note (degraded-context escalation) — verified.**
- `scripts/concertino/gather-escalation-context.sh` line 32: `VALID_KINDS="dependency api-change budget blocker contradiction ticket-ambiguity"` — six kinds, as Decision 4 states; `ticket-drift` is genuinely new.
- design.md line 32 + tasks.md 3.4 require the material-drift check to stay fail-closed when a degraded raise omits `context=`, and explicitly forbid loosening it to an existence-only test. Correct: `assert-phase.sh` cannot distinguish "no escalation" from "escalation without context", so fail-closed is the only sound choice.

**Round-1 findings re-spot-checked as still holding.**
- `kind=` is genuinely dropped by `emit-event.sh` (line 244, `t|kind) ;;` in the field filter) — Decision 3's "no `kind` field to check" is true, and the `TICKET-DRIFT-ESCALATION` prefix-marker workaround is the right discriminator.
- Truncation is prefix-preserving (lines 416-450: binary-searched byte *prefix* of `CONTEXT`, with marker and `context_ref` appended after), so a leading marker survives. `MAX_LINE=4000` (line 56). Decision 3's reasoning is accurate.
- `assert-phase.sh`: `setup)` at line 97, `delivery)` at 131 with `main_checkout()` defined at 147 *inside* the delivery branch — tasks.md 2.1's instruction to hoist it above the `case` rather than duplicate is correct against the real file. Placeholder set `["tbd","n/a","na","todo",""]` at line 197 matches tasks.md 2.3's claim verbatim.

**Product-owner constraints still hold.**
- *Mandatory prompt / judgment answer*: Decision 2 + tasks 2.2-2.4 enforce presence, shape, non-placeholder fields, and verdict enum; nothing scripts the semantic judgment. Decision 3 adds the one genuinely mechanical consequence (material-drift ⇒ a real escalation exists), closing the CON-30-shaped gap without faking a check that cannot exist.
- *Proportionate cost*: Decision 5 + tasks 3.5 fix the no-drift cost at one read pass plus one evidence write — no sub-agent, no loop, no extra gate.

**Acceptance criteria traced.** AC1→3.1/3.3; AC2→3.2 + artifact `Claims checked`; AC3→Decisions 3/4 + tasks 1.x/3.4 + spec minor-staleness requirement; AC4→2.2-2.6 (with the honestly-stated Decision 1 residual that the backstop fires at Setup step 4, after the worktree — accepted, and still far earlier than any of the six real incidents); AC5→Decision 7 + tasks 5.2/5.4 (runs the real procedure against verbatim original premises, not a pre-written conclusion); AC6→Decision 5.

No placeholders, no unresolved TBDs, no scope drift, no uncovered AC found in this round.

### Verdict: CONFIRM

### Non-blocking notes
- design.md line 30's inline example still shows `cat > premise-validation.md` (bare) even though the surrounding prose mandates the absolute path. The prose governs and tasks 3.3 is unambiguous, but the implementer may want to write the example with the absolute path so it is not copied verbatim.
- The staging file lands untracked at the main checkout's repo root for the duration of the invocation. Worth confirming during execution that nothing (a concurrent `git add -A` in another orchestrator's Setup) can pick it up; `.gitignore`-ing `premise-validation.md` at the root would be a cheap belt-and-braces addition.
