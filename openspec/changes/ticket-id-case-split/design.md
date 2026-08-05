## Context

`assert-phase.sh` and `start-servers.sh` both compute the ticket id they tag their own telemetry
with by inferring it from the worktree path's basename (`${WORKTREE_PATH##*/}`), rather than being
told it. `cleanup.sh` had exactly the same defect until CON-64, which threaded `TICKET_ID` in as an
explicit trailing argument and kept the basename inference only as a fallback. This change applies
the identical fix to the two remaining scripts, and additionally hardens `emit-event.sh` itself so
a future case-only variance (from any source, not just these two scripts) can't reopen the same
failure mode.

## Goals / Non-Goals

**Goals:**
- `assert-phase.sh` and `start-servers.sh` tag every event they emit with the canonical ticket id
  when it is available, exactly matching `setup-worktree.sh`'s and `cleanup.sh`'s existing
  behavior.
- A lowercase (or otherwise differently-cased) ticket suffix in a branch/worktree name can never
  again fork one run's telemetry across two directories.
- The existing stdout/stderr/exit-code contracts of both scripts are preserved byte-for-byte —
  this is a telemetry-tagging fix, not a behavior change to what gates enforce.

**Non-Goals:**
- Migrating already-split run directories created before this fix ships (see proposal.md
  Impact). The defect is telemetry-only and self-resolves via the dashboard's existing
  retention/reap policy.
- Normalising branch-name construction itself (proposal's Fix item 3, "consider whether
  `setup-worktree.sh` should normalise the branch suffix it builds"). `setup-worktree.sh` never
  derives its ticket id from the branch or worktree path — it already receives `TICKET_ID`
  explicitly as its first argument and uses that, verbatim, for every event it emits. There is
  nothing case-dependent for it to normalise; the branch/worktree path's own case is cosmetic
  (a directory name) and was never the source of the drift. No change needed here.
- Rejecting a case-mismatched `ticket=` outright (vs. canonicalising it). See Decision 2.

## Decisions

### Decision 1: explicit trailing `[TICKET_ID]` argument, basename inference retained as fallback

Mirrors `cleanup.sh`'s CON-64 shape exactly, rather than inventing a new convention:

- `assert-phase.sh setup <WORKTREE_PATH> [TICKET_ID]`
- `assert-phase.sh servers <WORKTREE_PATH> <DEV_PORT> <BACKEND_PORT> [TICKET_ID]`
- `assert-phase.sh delivery <WORKTREE_PATH> <BRANCH> [TICKET_ID]`
- `assert-phase.sh cleanup <WORKTREE_PATH> <DEV_PORT> <BACKEND_PORT> [TICKET_ID]`
- `start-servers.sh <WORKTREE_PATH> <DEV_PORT> <BACKEND_PORT> [TICKET_ID]`

In every case the new argument is the *last* positional argument for that invocation shape,
appended after whatever that phase already required — identical in spirit to how `cleanup.sh`
appended `TICKET_ID` as its 4th argument after its existing 3. `GATE_TICKET`/`T` becomes
`"${TICKET_ID:-${WORKTREE_PATH##*/}}"` in each script, replacing the unconditional
`${WORKTREE_PATH##*/}` inference. Omitting the argument is fully backward compatible: every
existing call site (and any external tooling that already calls these scripts directly) keeps
working exactly as before, just without the new event-tagging fix, until it's updated to pass the
ticket id.

Alternative considered: an environment variable (`CONCERTINO_TICKET_ID`) instead of a positional
argument. Rejected — it would be a different convention from `cleanup.sh`'s already-established
positional-argument pattern for the exact same problem, forcing callers to remember two different
mechanisms for what is conceptually one fix applied to three scripts.

### Decision 2: `emit-event.sh` canonicalises ticket case unconditionally, not only on detected collision

Once a validated `ticket=` value passes the existing `looks_like_ticket` shape check,
`emit-event.sh` upper-cases it (`tr '[:lower:]' '[:upper:]'`) before it is used to build `RUN_DIR`
or written into the event's own `ticket` field. This runs on every call, not only when a
differently-cased run directory is already found to exist.

Alternative considered: scan `.concertino/runs/` for an existing directory matching the incoming
ticket case-insensitively, and only rewrite the value when a collision is actually found (closer
to the ticket's own "reject or canonicalise a `ticket=` that differs only in case from an
**existing** run directory" phrasing). Rejected: it adds a filesystem scan to every single event
write (this script is called many times per run), it still leaves a race between two processes
racing to create the first directory for a given ticket in different cases, and unconditional
canonicalisation is strictly safer — it also fixes the very first event of a run, before any
directory exists yet, which a collision-triggered rewrite cannot do. Ticket ids are conventionally
uppercase project-wide already (`lib/ui/linear.js` uppercases the team key the same way); this
makes that convention load-bearing instead of aspirational.

Uppercasing is applied only to the letters the shape regex already permits
(`[A-Za-z#][A-Za-z0-9_-]*[0-9]`) — `#`, digits, `_`, `-` are untouched by `tr`, so this changes
nothing about which values are accepted, only which exact bytes are used once a value is.

### Decision 3: no rename/merge of pre-existing split run directories

Left as a deliberate non-goal (see above) rather than a migration step. `.concertino/runs/` is
reap-managed already (`lib/ui/reap.js` / `event-log-retention`); a handful of already-cold,
telemetry-only phantom directories are not worth a one-off migration script's added surface and
risk (rewriting historical event logs) for a run whose actual delivery already completed one way
or the other.

## Risks / Trade-offs

- [Risk] A caller that still omits the new trailing argument gets no benefit from Decision 1, only
  from Decision 2. → Decision 2's unconditional canonicalisation is exactly the safety net for
  this: even an inferred, uncorrected ticket id lands in the correctly-cased directory as long as
  its *shape* differs from the canonical one only in case (which is the entire failure mode this
  ticket describes). A call site whose basename isn't even ticket-shaped (fails
  `looks_like_ticket` entirely) is unaffected by this change either way — that's the pre-existing,
  separately-tracked CON-63/CON-64 failure mode, not this one.
- [Risk] Renaming `GATE_TICKET`'s source of truth touches every emit call site inside
  `assert-phase.sh` (`gate.result`, `gate.warning`). → Mechanical, covered by the extended test
  suite; the variable's *name* is unchanged, only its assignment.

## Migration Plan

No data migration (see Decision 3). Deploy is: land the script changes, update the three role
templates' call sites, run `concertino sync` to re-render, ship. No rollback concerns beyond a
normal revert — the new argument is optional and additive on both scripts.
