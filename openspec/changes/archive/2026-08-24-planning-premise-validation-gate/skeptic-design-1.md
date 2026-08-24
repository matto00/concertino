## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/premise-validation/spec.md`, `specs/escalation-context/spec.md`.
- **Cited-fact check of the design's own premises** (the same discipline this ticket adds):
  - `core/scripts/gather-escalation-context.sh:32` — `VALID_KINDS="dependency api-change
    budget blocker contradiction ticket-ambiguity"`. Six kinds, exactly as claimed. Adding a
    seventh is a real, small edit. CONFIRMED.
  - `core/scripts/assert-phase.sh:97-114` — a real `setup)` case exists; `:147` — a real
    `main_checkout()` helper exists inside the `delivery)` case, reusable/hoistable as task 2.1
    says; `:181+` — the Delivery gate's `node` heading-scan exists and is a fair template.
    CONFIRMED.
  - `core/roles/orchestrator.md:176-218` — Setup step 1 (fetch/labels) → step 2 (derive branch)
    → step 3 (`setup-worktree.sh`) → step 4 (`assert-phase.sh setup`). CONFIRMED, and this is
    the source of finding 2 below.
  - `core/scripts/persist-evidence.sh:20-25` header — destination preserves the source's path
    *relative to its git working-tree top-level*, not the basename. Source of finding 3.
  - `core/scripts/emit-event.sh:232-244` — `t|kind)  ;;` — caller-supplied `kind=` is
    **explicitly dropped**; `kind` is structural (always `escalation.raised`). Source of
    finding 1.
  - `core/scripts/emit-event.sh:347-395` — an oversized `context` on `escalation.raised` is
    truncated and offloaded via `persist-evidence.sh`. Reinforces finding 1.
- **Product-owner constraint 1 (mechanically mandatory prompt, no faked correctness check):**
  honored. design.md Non-Goals states plainly that the *judgment* is not mechanized and the
  script "never judges whether the content is correct". Decision 2 enforces only shape +
  non-placeholder + verdict enum; Decision 3 adds a genuinely mechanical, non-faked check
  (a recorded `material-drift` requires a real `escalation.raised`). No objection.
- **Product-owner constraint 2 (proportionate cost):** honored. Decision 5 states the no-drift
  cost concretely (no sub-agent, no new loop, one evidence write), Decision 6 explicitly bounds
  sibling-collision search to the ticket's own epic/parent + `git log --oneline -20`, and the
  Risks section accepts the resulting false-negative rather than expanding scope. No objection.
- **`ticket-drafting-escalation.md` not weakened:** tasks 3.7 keeps the cross-reference *outside*
  that law's own text. No objection.

### Verdict: REFUTE

The shape of the change is right and the two stated constraints are respected. Three findings
are implementation-blocking (an implementer would have to guess, and two of the guesses produce
a gate that silently doesn't work), plus one AC that the planned fixtures do not actually
satisfy.

### Change Requests

1. **The `material-drift` escalation check (Decision 3 / tasks 2.5 / spec "A material-drift
   verdict requires an actually-raised escalation") is specified against a field that cannot
   exist.** `core/scripts/emit-event.sh:243` drops any caller-supplied `kind=`
   (`t|kind)  ;;`) because `kind` is the structural event name — an `escalation.raised` event
   therefore has *no* `kind` field, so "an `escalation.raised` event ... carrying a
   `kind=ticket-drift`-kind context block" is not checkable as written. Decide and write down
   which of these the implementer must do, because they are materially different changes:
   (a) match a literal marker inside the event's `context` string (then require
   `gather-escalation-context.sh ticket-drift` to emit a fixed, greppable marker line, and
   name that exact marker in design.md); or (b) carry the discriminator in an allowed payload
   field. Do **not** "fix" this by making `emit-event.sh` accept `kind=` — that key is
   deliberately dropped and re-allowing it rewrites what an event means.
   Additionally: `emit-event.sh:347-395` truncates/offloads an oversized `context`, so a
   context-substring check can false-FAIL a legitimately-raised escalation. State how the
   chosen marker survives that truncation path (e.g. marker emitted first / in a field the
   truncation loop never touches).

2. **Decision 1's stated rationale contradicts where the enforcement actually lands.**
   Decision 1 argues the value is catching drift "before the worktree exists ... a `halt`-option
   escalation costs nothing to unwind", but the only mechanical enforcement is
   `assert-phase.sh setup`, which `core/roles/orchestrator.md:218` runs as **step 4 — after**
   branch derivation (step 2) and `setup-worktree.sh` (step 3), and which structurally *cannot*
   run earlier because its own `main_checkout()` resolves via `git rev-parse --git-common-dir`
   **on `$WORKTREE_PATH`** (`assert-phase.sh:147-156`) and its first assertion is
   `[ -d "$WORKTREE_PATH" ]`. So a run that skips the step is caught only once the worktree
   exists, and the "written before branch derivation" ordering is prose-only and
   retroactively satisfiable. Resolve explicitly in design.md: either (a) acknowledge this and
   state the accepted residual (prompt ordering is procedural; the mechanical backstop fires at
   the step-4 gate, and a failure there costs a worktree teardown, not zero), or (b) add a
   second, earlier enforcement point that does not depend on `$WORKTREE_PATH`. Do not leave
   Decision 1's "costs nothing to unwind" claim standing unqualified — it is not what the
   design delivers.

3. **Where the artifact's *source* file is written before any worktree exists is unspecified,
   and it determines whether the gate can find it.** Tasks 3.3 says "construct
   `premise-validation.md` ... then persist it via `persist-evidence.sh`", but
   `persist-evidence.sh` derives its destination from the source's path *relative to its git
   working-tree top-level* (`persist-evidence.sh:20-25`), while `assert-phase.sh` will look for
   exactly `.concertino/runs/<TICKET>/evidence/premise-validation.md` (tasks 2.2). A source
   written anywhere but the main checkout's top level lands at a different destination and the
   gate fails on a correctly-executed step. Specify the exact source path, and say what happens
   to that stray untracked file at the repo root afterwards (deleted? gitignored?). Also confirm
   `persist-evidence.sh` behaves sanely if the source is placed under the destination tree
   itself (source == dest).

4. **Acceptance criterion 5 ("demonstrated on a real stale ticket ... and shown to detect the
   drift") is not met by the planned fixtures.** Tasks 5.2/5.4 *hand-construct* a
   `premise-validation.md` that already records the drift and a `material-drift` verdict. That
   demonstrates the gate, not the detection — it assumes the answer the step is supposed to
   produce. Add a step that runs the actual check procedure (tasks 3.2) against CON-131's
   verbatim original text ("the helio repo root is a bare checkout") and/or CON-128's against
   the live tree, and records the *derived* finding plus the command that produced it. This is
   cheap (one or two `git`/file-existence commands) and is exactly what the AC asks for — it
   does not require mechanizing judgment.

### Non-blocking notes

- Tasks 1.3 says "check for an existing test harness first" — fine, but the design gives no
  signal whether one exists. Not blocking; the task is honest about the uncertainty.
- Decision 6's `git log --oneline -20 <base>` is a reasonable bounded heuristic, but 20 commits
  is stated without justification. Consider naming it a tunable default rather than a constant.
- The spec's no-drift scenario ("no specific facts cited" → brief `**Claims checked:**` note)
  sits close to the placeholder set the gate rejects (`n/a`, `na`). Ensure the sanctioned
  no-facts wording is not itself a rejected placeholder.
