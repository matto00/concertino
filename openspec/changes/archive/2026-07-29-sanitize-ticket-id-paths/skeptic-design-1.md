## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- **Ticket ACs traced to plan.** Read `ticket.md` (4 ACs) and cross-checked each
  against `proposal.md`/`design.md`/`tasks.md`:
  - AC1 (reuse `looks_like_ticket` pattern in both scripts) → tasks 1.1/2.1.
  - AC2 (emit-event.sh degrades silently, tier-2 style) → design Decision 2,
    task 2.2, `specs/ticket-id-path-safety/spec.md` scenarios.
  - AC3 (persist-evidence.sh stays `FAIL`/non-zero, callers already `|| true`) →
    design Decision 2, verified against real call sites (see below).
  - AC4 (traversal test coverage, nothing written outside runs dir) → tasks
    4.1–4.3, `specs/ticket-id-path-safety/spec.md` scenarios.
  All four ACs have a concrete task and spec scenario; none are hand-waved.

- **Current unsanitized state confirmed.** Read
  `core/scripts/emit-event.sh` (full) and `core/scripts/persist-evidence.sh`
  (full): both interpolate `TICKET`/`TICKET_ID` directly into `RUN_DIR`/
  `DEST_DIR` with no shape check today — the vulnerability is real, not
  imagined.

- **Existing pattern precedent confirmed, with one imprecision found.**
  `core/scripts/assert-phase.sh:122` does define
  `looks_like_ticket() { [[ "$1" =~ ^[A-Za-z#][A-Za-z0-9_-]*[0-9]$ ]]; }` as a
  named function. `core/scripts/start-servers.sh:76,83` and
  `core/scripts/cleanup.sh:55` do **not** — they inline the same bracket
  expression directly in `[[ ... ]]` tests without a function wrapper.
  `design.md`'s Context section claims "Three sibling scripts... already carry
  an identical inline guard — `looks_like_ticket() { ... }`" which overstates
  this (only one of the three actually names the function). This does not
  affect the plan's correctness: `test/scripts/ticket-pattern.test.sh`'s
  `extract()` greps for the literal bracket-expression text, not a function
  signature, so it will match the new copies in `emit-event.sh`/
  `persist-evidence.sh` regardless of whether they're wrapped in a function —
  confirmed by reading `extract()`'s implementation. Non-blocking; noted as a
  documentation nit.

- **Pattern is structurally sound against traversal.** The regex
  `^[A-Za-z#][A-Za-z0-9_-]*[0-9]$` admits no `.` and no `/` anywhere in the
  string, so no value matching it can produce `..` traversal or an absolute
  path. `../escape` and `../../../../escape` both fail the pattern (leading
  `.` is not in `[A-Za-z#]`). Verified by re-reading the bracket expression,
  not just trusting the proposal's assertion.

- **Placement logic re-derived from the real scripts, not just asserted.** In
  `emit-event.sh`, `ROOT="$(main_checkout)"` (read-only) runs before `TICKET`
  is parsed; `[ -z "$TICKET" ] && exit 0` runs before `RUN_DIR=...`/`mkdir -p`.
  Inserting the shape check at that same point (design Decision 1, task 2.2)
  means no filesystem side effect occurs before validation, and the `--await`
  path is reached only downstream of that point, so it inherits the guard for
  free exactly as claimed — confirmed by reading the full control flow
  including `write_escalation_raised()`'s internal call to
  `persist-evidence.sh "$TICKET" "$src"`, which only runs after `$TICKET` is
  already validated.
  In `persist-evidence.sh`, current order is: parse args → check
  `SOURCE_PATH` readable → `main_checkout` → build `DEST_DIR` → `mkdir -p`.
  `design.md` Decision 1 specifies the new check goes "immediately after
  argument parsing... before `main_checkout` is even called" — i.e. before
  even the source-readability check. `tasks.md` 1.1/1.2 is looser ("before
  `main_checkout` is called or any directory is created") and doesn't pin the
  ordering relative to the source check. This is a minor spec/task looseness,
  but no acceptance criterion or spec scenario depends on that ordering (the
  spec.md scenario tests only "even with a valid, readable SOURCE_PATH"), so
  it will not produce a wrong or ambiguous implementation either way.
  Non-blocking.

- **"No caller changes needed" claim verified against real callers.**
  Grepped `core/roles/{orchestrator,evaluator,skeptic}.md` for
  `persist-evidence.sh` call sites: `evaluator.md:159-165` and
  `skeptic.md:145-151` already say "If `persist-evidence.sh` prints `FAIL`,
  emit `verdict` with no `ref` field"; `orchestrator.md:150` documents the
  same FAIL-omits-ref contract. All three already treat any non-zero exit
  (regardless of cause) as "omit ref," so a new failure cause (invalid
  `TICKET_ID`) requires no prose change, confirming the proposal's Impact
  section.

- **Sweep claim verified against ground truth, not taken on faith.** Read
  `core/scripts/gather-escalation-context.sh` in full: it never touches
  `TICKET`/filesystem paths at all (pure text formatter). Read
  `core/scripts/setup-worktree.sh`: `TICKET_ID` is used only to derive
  `TICKET_NUM` (numeric port offset, line 54) and to tag an `emit-event.sh
  run.start` call (line 170) — `WORKTREE_PATH` is built from `BRANCH`, not
  `TICKET_ID`. Read `start-servers.sh`/`cleanup.sh`: their own `T` (derived
  from `WORKTREE_PATH` basename, not the raw ticket id) is already validated
  inline before any `emit-event.sh` call. The proposal's "swept, none found"
  claim holds up.

- **Rendered-copy / test-wiring claims verified.** `diff core/scripts/{emit-event,persist-evidence}.sh scripts/concertino/{...}` shows the
  rendered copies are currently byte-identical to the `core/scripts/` sources
  (confirms task 5.1's premise). `package.json`'s `test` script already
  chains `emit-event.test.sh`, `persist-evidence.test.sh`, and
  `ticket-pattern.test.sh` (confirms task 5.2's premise).

- **No placeholders/TBDs.** `grep -rniE "TODO|TBD|placeholder|figure out
  later|to be determined"` across the change dir returned nothing.
  `openspec validate sanitize-ticket-id-paths --strict` reports "Change
  'sanitize-ticket-id-paths' is valid".

### Verdict: CONFIRM

The design is sound: both call sites, both failure contracts, the shared
regex, the traversal-test plan, and the "no caller changes" claim all trace
correctly to real code and real acceptance criteria. No contradictions,
no scope drift beyond the sweep the ticket itself asked for, no ambiguity
that would let a competent implementer produce a wrong result.

### Non-blocking notes

1. `design.md`'s Context section overstates precedent: only
   `assert-phase.sh` names a `looks_like_ticket()` function;
   `start-servers.sh`/`cleanup.sh` inline the bracket expression without a
   wrapper. Doesn't change the plan or break `ticket-pattern.test.sh`'s
   text-based extraction, but worth a one-line correction if the design doc
   is revisited.
2. `tasks.md` 1.1/1.2 doesn't pin whether the new `persist-evidence.sh`
   shape check runs before or after the existing `SOURCE_PATH`
   readability check, whereas `design.md` Decision 1 is explicit ("before
   `main_checkout` is even called," i.e. before that check too). No spec
   scenario depends on the ordering, so either placement is acceptable —
   but the executor should follow `design.md`'s more specific ordering for
   consistency with the stated rationale (no filesystem side effect at all
   on a rejected id, and a slightly cleaner "which failure fires first"
   story when both `TICKET_ID` and `SOURCE_PATH` are bad).
