## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- **Ticket ACs vs. artifacts.** Read `ticket.md` and the live Linear issue
  (`mcp__linear__get_issue CON-4`) side by side with `proposal.md`, `design.md`,
  `tasks.md`, `specs/event-log-retention/spec.md`. All four ACs trace to
  concrete tasks/spec requirements:
  - Configurable, documented retention bound → tasks 1.1/1.2, spec
    "Retention window is configurable with a documented default".
  - Prune that never removes an active run's log → tasks 3.x/4.x, spec
    "A run without a terminal event is never pruned" + "Pruning is exposed
    as an explicit command and a startup boundary".
  - `readAll` no longer re-parses unchanged logs → tasks 2.x, spec "The
    dashboard's read path scales with changed bytes, not total history".
  - Test covering an active run is never pruned → tasks 5.1/5.4.
  No AC is left uncovered; no task exceeds the ticket's scope.

- **Grounded the design's factual claims against the real codebase, not
  just the narrative:**
  - `lib/ui/store.js` (read in full): `readAll(root)` today is exactly the
    unconditional full-read-and-parse-every-poll function the ticket
    describes; `readEvents(root, ticket)` is the existing full-parse
    primitive the design says it will leave untouched — confirmed by
    reading the file, not assumed.
  - `lib/ui/watch.js:356`: `runs = reduce(store.readAll(root), ...)` — the
    single call site inside the poll loop the design targets. Confirmed via
    `grep -n "store.readAll" -r lib bin test` — it's the only call site in
    non-test code, so "watch.js holds one cache instance and passes it to
    every poll's `readAll` call" is a complete, not partial, fix.
  - `config/concertino.schema.json`'s `dashboard` block (read via
    `python3 -c 'json.load...'`): `maxConcurrent`/`escalationTimeoutMinutes`
    are `additionalProperties: false` siblings with exactly the
    type/minimum/description/default shape the design proposes for
    `retentionDays` — task 1.1's "following the existing style" claim
    checks out.
  - `docs/dashboard.md`: has an existing "Configuration" section (defaults
    table) and a "Where the data lives" section — the two places the design
    says it will add documentation both already exist with the described
    shape.
  - `bin/concertino`: `cmdWatch` loads config exactly as task 4.1 describes
    ("loads config the same way `cmdWatch` does"); the `--dry-run` flag
    already exists as an established convention on `sync`/`update`/`diff`
    (`grep -n "dry-run" bin/concertino`), so `concertino prune --dry-run`
    matches existing CLI conventions rather than inventing a new one.
  - `lib/ui/reducer.js`: `case 'run.end':` sets `run.endStatus`, and
    `cleanup.sh:55` is the actual (and, per
    `grep -rln "emit-event.sh" scripts/concertino/ | xargs grep -n "run\."`,
    the *only*) place in the codebase that emits a `run.end` event —
    confirms the design's "terminal ⇔ has a `run.end` event" signal is a
    real, well-defined predicate against the current system, not invented.
  - Ran `npx openspec validate event-log-retention-caching --strict` →
    "Change 'event-log-retention-caching' is valid". Ran baseline
    `npm test` → 35 + 14 passed, 0 failed (clean baseline before any
    execution, confirming the plan isn't papering over pre-existing
    breakage).
  - Checked for scope/spec collisions: `openspec/specs/*/spec.md` — only
    `phase-telemetry` mentions `store.js` at all, and only for an unrelated
    doc-comment requirement about the `malformed` counter, not `readAll`'s
    signature; `dashboard-render-loop` (the other spec touching
    `watch.js`'s poll loop) governs terminal-control escape sequences only.
    No existing spec's contract is silently broken by the proposed
    `readAll(root, cache)` signature change or the new best-effort prune
    call at `watch()` startup.

- **No placeholders/hand-waving found.** No `TODO`/`TBD` in any artifact;
  every decision in `design.md` states its alternative-considered and why
  it was rejected (Decisions 1–4), which is the opposite of deferred.

### Verdict: CONFIRM

### Non-blocking notes

1. **`tasks.md` 6.1's exact command is wrong for the installed CLI.**
   `npx openspec validate --help` shows `validate` takes a positional
   `[item-name]`, not a `--change` flag — I reproduced this:
   `npx openspec validate --change event-log-retention-caching --strict`
   → `error: unknown option '--change'`, while
   `npx openspec validate event-log-retention-caching --strict` (no flag,
   positional arg — what I actually used above) succeeds. Trivial to fix,
   won't block an executor for more than a moment, but worth correcting
   the task text so no one copy-pastes it verbatim.

2. **Decision 3's four-way branch in `design.md` (lines 82–95) has a small
   gap in its own stated exhaustiveness**: it covers (a) size+mtime
   unchanged, (b) size grew *and* mtime moved forward, (c) size shrank *or*
   mtime moved backward — but not "size grew while mtime stayed exactly
   equal" (possible on coarse-grained-mtime filesystems if two appends land
   in the same timestamp tick). On modern Linux/ext4 this is vanishingly
   rare given nanosecond mtime resolution, so it's not blocking, but the
   implementer should treat "size changed at all" (not "size changed *and*
   mtime moved forward") as sufficient to trigger a re-read, with mtime
   used only to detect backward-going truncation/rewrite — worth a one-line
   tightening during execution, not a re-plan.

3. **`design.md`'s Risk 1 (lines 120–128) undersells how common the
   "never-terminal" case is.** I confirmed via grep that `run.end` is
   *only* ever emitted by `cleanup.sh --phase4` on a successful, merged
   run — `lib/ui/control.js#killConfirmed` (the dashboard's own "kill a
   run" action) calls `session.kill(ticket)` directly with no
   `emit-event.sh run.end` call at all. So under this design, *every*
   run that is killed via the dashboard, abandoned, or otherwise never
   reaches a successful Phase-4 merge keeps its log forever — this is the
   default outcome for any unsuccessful run, not a rare "machine restarted
   mid-run" crash edge case as the prose implies. This doesn't block the
   design: it's a legitimate, disclosed trade-off consistent with the
   ticket's own explicit "must never remove a log for a run that is still
   active" constraint, and task 1.2 already requires stating the invariant
   plainly in the shipped `docs/dashboard.md` (which is the actual
   user-facing communication, and is accurate regardless of this framing
   nit). Purely a prose-accuracy suggestion for `design.md`'s own Risks
   section, not a required artifact change.
