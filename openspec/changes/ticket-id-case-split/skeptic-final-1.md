## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

- **Ground truth diff** — read `git diff main...HEAD` in full for the three
  changed scripts (`core/scripts/assert-phase.sh`, `start-servers.sh`,
  `emit-event.sh`) and the three role templates
  (`core/roles/{orchestrator,evaluator,skeptic}.md`). Confirmed with my own
  eyes, not the evaluator's narrative:
  - `assert-phase.sh`: every phase branch (`setup`/`servers`/`delivery`/
    `cleanup`) now reads `TICKET_ID` from its own next positional slot and
    computes `GATE_TICKET="${TICKET_ID:-${WORKTREE_PATH##*/}}"` — verified
    the argument indices line up correctly with each phase's own required
    args and the updated usage docstring (assert-phase.sh:12-20, 96-105,
    115-118, 130-132, 180-183).
  - `start-servers.sh`: `TICKET_ID="${4:-}"` at top-level, `local T="${TICKET_ID:-${WORKTREE_PATH##*/}}"`
    inside `start_one()`.
  - `emit-event.sh`: unconditional `tr '[:lower:]' '[:upper:]'` canonicalisation
    inserted strictly after the `looks_like_ticket` shape-check/early-exit,
    before `RUN_DIR` is computed (emit-event.sh:284-294).
  - `cleanup.sh` (CON-64's prior fix) uses the identical
    `TICKET_ID="${4:-}"` / `T="${TICKET_ID:-${WORKTREE_PATH##*/}}"` shape —
    confirmed this change is a faithful mirror, not a divergent new pattern.
  - All role-template call sites (`orchestrator.md` setup/delivery/cleanup
    gates, `evaluator.md`/`skeptic.md` servers gate) now pass `"$TICKET_ID"`
    as the trailing arg; `TICKET_ID` is established as an orchestrator
    variable from the top of the file, so it's in scope at every call site.
    Grepped `core/roles/` and `core/scripts/` for any other
    `assert-phase.sh`/`start-servers.sh` call site — found none missed
    (only descriptive comments in `architecture.md`, `persist-evidence.sh`,
    `check-merge-readiness.sh`, `triage-followup.sh`, none of them actual
    invocations).
  - `core/scripts/` vs `scripts/concertino/` rendered copies: `diff`'d all
    four touched files (`assert-phase.sh`, `start-servers.sh`,
    `emit-event.sh`, `README.md`) — byte-identical, confirming the cycle-2
    doc-sync fix actually landed and stuck.

- **Full test suite, run myself:** `npm test` → `# tests 1558 / # pass 1558 /
  # fail 0`, exit 0, no `not ok` lines — matches evaluation-2.md's claimed
  numbers exactly, re-run independently (not trusted from the report).

- **Live end-to-end reproduction of the exact bug scenario (AC1), not just
  reading the unit tests:**
  ```
  REPO=$(mktemp -d); git init; WT="$REPO/worktrees/con-99"; mkdir -p "$WT/.git"
  bash core/scripts/assert-phase.sh setup "$WT" CON-99
  ```
  Result: `.concertino/runs/CON-99/` created, **no** `.concertino/runs/con-99/`
  phantom directory — one run directory for a lowercase-suffix worktree path
  when the explicit ticket id is passed.

- **Live probe of the independent second line of defense (Decision 2):** ran
  the same lowercase-suffix worktree scenario with **no** explicit
  `TICKET_ID` argument (pure basename inference, `GATE_TICKET=con-100`) —
  the resulting run directory was still `.concertino/runs/CON-100/`
  (canonicalised by `emit-event.sh`), not `con-100/`. Confirms the
  defense-in-depth claim in design.md Decision 2 actually holds at runtime,
  not just in the unit tests.

- **Read the new/extended test files in full**
  (`test/scripts/assert-phase.test.sh`, `start-servers.test.sh`,
  `emit-event.test.sh`) — confirmed they reproduce the ticket's literal
  regression scenario (`worktrees/con-79`, ticket `CON-79`; lowercase,
  mixed-case, and converging-triple-invocation cases for `emit-event.sh`),
  assert "no phantom directory" as an explicit negative check, and retain
  coverage for the pre-existing basename-inference fallback and the
  malformed-ticket drop path (canonicalisation runs strictly after, never
  widening, the shape check).

- **Root cause / probe, per systematic-debugging.md** — `files-modified.md`
  records a probe-before-fix (`assert-phase.sh setup` on a lowercase
  worktree path, inspecting the resulting `.concertino/runs/con-79/`
  directory) and the regression tests are the ones that would have caught
  it (verified by construction: the lowercase-suffix test case literally IS
  the bug scenario, and I independently reproduced the same result live
  above).

- **AC-by-AC trace:**
  1. "One run directory, one fleet row for lowercase-suffix branch" —
     traced to `assert-phase.sh`'s `GATE_TICKET` resolution + `emit-event.sh`'s
     canonicalisation, live-reproduced above. Met.
  2. "`assert-phase.sh`/`start-servers.sh` take the ticket id explicitly;
     retained inference is documented" — traced to the trailing `[TICKET_ID]`
     argument in both scripts' usage docstrings and inline comments at each
     `GATE_TICKET`/`T` assignment. Met.
  3. "Test coverage mirroring CON-64's, lowercase-suffix regression case" —
     traced to the three extended test files, read in full above. Met.
  4. "Existing split directories merged or clearly ignorable — decide on
     migration" — traced to `design.md` Decision 3: explicit non-goal,
     reasoned (telemetry-only blast radius, existing reap policy, migration
     script risk/reward), not silence. Met.

- **No UI surface** — this is a shell-script/test/doc-only change; the
  design-standard / screenshot section of the final-gate procedure is
  correctly N/A, consistent with the task framing ("N/A — no UI configured
  for this project").

- **Scope check** — `git status --short` shows only bookkeeping files
  (`workflow-state.md`, `evaluation-2.md`) uncommitted, no stray pollution
  left from my own live probes (which all ran in `mktemp -d` throwaway
  repos, cleaned up after).

### Verdict: CONFIRM

The fix is a faithful, verified mirror of CON-64's `cleanup.sh` pattern,
extended to the two remaining scripts named in the ticket, plus an
independent second line of defense in `emit-event.sh` that I confirmed at
runtime closes the gap even for call sites that still only infer the ticket
id. All four acceptance criteria trace to real, exercised code. The cycle-1
doc-drift change request (rendered `scripts/concertino/README.md` out of
sync) is verifiably resolved — byte-identical to `core/scripts/README.md`.
Full test suite (1558/1558) passes on a fresh run. No scope creep, no
placeholders, no missed call sites.

### Non-blocking notes

- `core/scripts/README.md`'s `cleanup.sh` usage row still doesn't show
  `[TICKET_ID]` even though `cleanup.sh` has carried that argument since
  CON-64 (a pre-existing doc gap noted in skeptic-design-1.md, not
  introduced by this change, and out of this ticket's scope).
- Design.md Decision 3 (no migration of pre-existing split run directories)
  is a reasonable call given the telemetry-only blast radius and existing
  reap policy, but it does mean any already-split `CON-79`/`con-79`-style
  directory pairs from before this fix landed will linger until reaped
  rather than being actively cleaned up. Worth a one-line mention in the PR
  description so a human reviewer isn't surprised by lingering phantom rows
  from before this fix, but not a blocker.
