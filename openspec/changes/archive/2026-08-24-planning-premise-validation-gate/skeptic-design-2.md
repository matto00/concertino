## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

Re-derived each of round 1's four findings from the real scripts, not from the revised prose.

- **Revision 1 (marker instead of `kind=`) — HOLDS.** `core/scripts/emit-event.sh:244`
  (`t|kind)  ;;`) still drops caller `kind=`, so the discriminator genuinely cannot live
  there. The revised design's leading-marker prefix-match is checkable, and its
  truncation-survival argument is correct against the real code: `write_escalation_raised`'s
  binary search (`emit-event.sh:419-450`) builds `candidate="${prefix}${marker}"` from
  `utf8_safe_prefix "$mid"` — a **byte-prefix from the front**, with the truncation marker and
  `context_ref` appended after. A leading `TICKET-DRIFT-ESCALATION` line therefore survives any
  truncation that keeps a non-trivial prefix, exactly as Decision 3 claims. Spec + tasks 2.5
  state it as a prefix match, consistently.
- **Revision 2 (honest enforcement-point residual) — HOLDS.** `assert-phase.sh:109-111`: the
  `setup)` case's first assertions are `[ -d "$WORKTREE_PATH" ]` and the `.git` check, so it
  structurally cannot run before step 3; `core/roles/orchestrator.md:213` (step 4) confirms the
  ordering. Decision 1 and the Risks section now say this plainly and drop the "costs nothing
  to unwind" claim, substituting a claim I can check and that is true (all six cited incidents
  were caught well past Setup).
- **Revision 3 (source path) — HOLDS, and is the only path that works.**
  `persist-evidence.sh:109-125,134-135`: `SRC_REL` = source path relative to
  `git rev-parse --show-toplevel`, `DEST_PATH="${ROOT}/.concertino/runs/${TICKET_ID}/evidence/${SRC_REL}"`.
  A bare `premise-validation.md` at the main checkout's top level is therefore the unique source
  location that lands at the gate's expected destination. Decision 2 / tasks 3.3 / the spec all
  say so and all add the unconditional `rm -f`.
- **Revision 4 (fixtures demonstrate detection) — HOLDS.** Decision 7 + tasks 5.2/5.4 now run
  the procedure's real commands (`git config --get core.bare`, inode/`readlink` comparison)
  against CON-131's and CON-128's verbatim claims and record the *derived* finding. 5.5 keeps a
  separate mutation test for the gate itself, so gate-vs-detection are no longer conflated.
- **Corroborating facts re-checked:** `gather-escalation-context.sh:32` still lists exactly six
  kinds; `emit-event.sh:298-300` writes `<main checkout>/.concertino/runs/<TICKET>/events.jsonl`,
  which is the path tasks 2.5 / the spec name for the material-drift lookup; `assert-phase.sh:147`
  `main_checkout()` is still nested inside the `delivery)` case, as task 2.1's hoist assumes.
- **Product-owner constraint 1 (mandatory prompt, no faked mechanical answer):** still honored.
  The gate checks shape/placeholder/enum only; Non-Goals still states the judgment is not
  mechanized. The one genuinely mechanical addition (material-drift ⇒ a real `escalation.raised`)
  is now checkable against a field that actually exists.
- **Product-owner constraint 2 (proportionate cost):** still honored, and unchanged by the
  revisions — Decision 5's no-drift cost is one read pass + one `persist-evidence.sh` write; the
  revisions added one `rm -f` and re-scoped a fixture, neither of which touches per-ticket cost.

### Verdict: REFUTE

The four round-1 revisions are each correct against real script behavior — I could not refute
any of them. One new, specific defect was introduced *by* revision 3's chosen mechanism, and it
is cheap to close.

### Change Requests

1. **The fixed bare filename at the shared main-checkout root is a cross-run collision hazard,
   and Decision 2's stated reason for accepting it does not hold.** Decision 2 justifies using a
   fixed `<repo root>/premise-validation.md` rather than a per-run temp dir with: "this write is
   synchronous and immediately cleaned up within one orchestrator step, unlike `emit-event.sh`'s
   tmp dir which exists across an async binary-search loop." That distinction is wrong on both
   sides. `emit-event.sh:398-409` is *not* async — it is a straight-line `mktemp -d` →
   `printf > "$src"` → `persist-evidence.sh` → `rm -rf`, and it still uses a `mktemp -d`
   collision-safe dir, with the comment naming the exact reason ("concurrent or successive
   escalations on the same ticket never collide or overwrite each other's persisted context").
   Conversely, the orchestrator's version is the *less* atomic of the two: an orchestrator is a
   language model whose write, persist and `rm -f` are separate tool invocations with real
   latency between them. And this product is explicitly a fleet model — `README.md:31` ("safe to
   run a *fleet* of orchestrators unattended"), `README.md:167` ("worktree-per-ticket fleet
   model") — where every concurrent orchestrator shares **one** main checkout (all worktrees hang
   off it, and `persist-evidence.sh`'s `main_checkout()`/`ROOT` resolves to it for every run). So
   two orchestrators in Setup at overlapping times both write the same absolute path: B's content
   can be persisted under A's ticket, or A's `rm -f` can delete the file B is about to persist —
   producing either silently-wrong premise evidence attributed to the wrong ticket, or a spurious
   `FAIL` at a correctly-executed step. That is precisely the class of silent, plausible-looking
   wrongness this ticket exists to prevent.
   Fix (cheap, no redesign — the bare-root filename is forced by `persist-evidence.sh`'s
   `SRC_REL` semantics, so keep it): require in design.md Decision 2 and tasks 3.3 that the
   write, the `persist-evidence.sh` call and the `rm -f` be issued as a **single shell
   invocation** (one heredoc-write `&&` persist `;` `rm -f`), so the window is one process rather
   than several model turns, and state the remaining residual honestly (a still-nonzero race if
   two orchestrators enter that one command simultaneously) rather than asserting the race away.
   If you would rather eliminate the race than shrink it, say so explicitly and name the
   mechanism — but do not leave the current justification standing, because it misstates what
   `emit-event.sh` does and ignores the fleet topology the product advertises.

### Non-blocking notes

- Tasks 3.3's example invocation passes a relative `premise-validation.md`; `persist-evidence.sh`
  resolves it against the caller's CWD (`persist-evidence.sh:97`). Since the orchestrator's CWD
  is not guaranteed to persist between tool calls, prefer naming the absolute path in the
  rendered prose. (Folding this into change request 1's single-invocation form resolves it too.)
- `gather-escalation-context.sh`'s header explicitly documents "if this script fails, raise the
  escalation without `context=`". A `ticket-drift` escalation raised down that degraded path
  would carry no marker and would then fail the new material-drift gate despite a genuine
  escalation having been raised. Fail-closed is defensible here (it forces a well-formed
  re-raise), but it is worth one sentence in Decision 3 so an implementer does not "helpfully"
  loosen the check later.
- Round 1's note about the sanctioned no-facts wording ("no specific facts cited") sitting near
  the rejected placeholder set is now visible in the spec's last scenario; the placeholder set is
  exact-match (`tbd`/`n/a`/`na`/`todo`/empty), so that wording is safe. No action needed.
