## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md` (5 acceptance criteria) and confirmed each maps to a concrete
  task in `tasks.md` (1.1-1.6 assert-phase.sh, 2.1-2.3 start-servers.sh, 3.1-3.2
  sync, 4.1-4.4 tests, 5.1-5.3 manual verification).
- Read `proposal.md`, `design.md`, and `specs/gate-telemetry/spec.md` — no
  internal contradictions found; the spec's scenarios are a faithful restatement
  of the ticket ACs and the design's decisions.
- Read the actual current `core/scripts/assert-phase.sh` — confirmed the `case
  "$PHASE" in ... esac` block, the shared `fail()` helper (line 28), and the two
  existing `gate.result` emit call sites (lines 93-100, both already `|| true`)
  match exactly what the design describes and plans to modify.
- Read `core/scripts/start-servers.sh` — confirmed `start_one()` (line 49-67)
  is the single per-server call site with one existing `gate.result` emission
  (line 64) on the success path only, and no failure-path emission exists today
  (failure hits `exit 1` at line 60 with no telemetry call) — this grounds the
  proposal's Non-Goal (no new failure-path emission for start-servers.sh).
- Read `core/scripts/emit-event.sh` in full — confirmed `json_value`'s
  integer-auto-detection regex (`^-?(0|[1-9][0-9]*)$`) will correctly emit
  `duration_ms=0` unquoted, confirmed kv-splitting only breaks on the *first*
  `=` (so a `first_error` value containing `=` is safe), and confirmed the
  4000-byte `write_line` truncation is whole-line/all-or-nothing as the design
  claims — justifying the source-side 200-char trim decision.
- Read `lib/ui/reducer.js` — confirmed `ev.duration_ms` / `ev.first_error` are
  already read and default to `null` (lines 87-88), so no reducer/consumer
  change is in scope, as the proposal states.
- `diff core/scripts/{assert-phase,start-servers}.sh scripts/concertino/{...}`
  — both empty today, confirming the `concertino sync` re-render convention
  (task 3.1/3.2) is a real, currently-working mechanism, not aspirational.
- `grep` across `core/roles/*.md`, `docs/superpowers/plans/...` — an
  independent slice-2 planning doc already lists `gate.result` fields as
  `gate, status, duration_ms, first_error`, corroborating that these exact
  field names are the correct target, not an invention of this ticket's design.
- Confirmed `test/scripts/emit-event.test.sh` exists and is wired into
  `package.json`'s `test` script, validating the pattern tasks 4.1-4.3 propose
  to extend.

### Verdict: CONFIRM

### Non-blocking notes

- Second-resolution (`date +%s`) timing means `duration_ms` will only ever be a
  multiple of 1000 (e.g. always `0`, `1000`, `2000`, ...), which is coarser
  than the field name might imply to a future reader of the dashboard code.
  The design discloses and justifies this trade-off explicitly (Risks section)
  and it does not violate the letter of the AC (a non-negative integer), so
  this is not a blocker — just worth a one-line comment at the `date +%s`
  call site in the implementation so a future maintainer doesn't mistake it
  for millisecond-resolution timing.
- Task 5.3 ("confirm no other caller depends on the exact previous
  `gate.result` field set") is a good verification step to actually execute
  during the execution cycle, not just check off — the `grep` I ran above
  found no such dependency, but it's worth the implementer re-confirming with
  a fresh grep after the diff lands, in case sibling in-flight changes touch
  the same call sites.
