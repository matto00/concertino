## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **Read ground truth, not the design's claims about it.** `core/scripts/cleanup.sh:405-434`
  (`other_runs_live()` and its preceding comment block), `core/scripts/tui-attached.sh` (whole
  file), `core/scripts/emit-event.sh:307` (event line format), `lib/ui/retention.js`,
  `lib/cli/prune.js`, `lib/ui/watch.js:218`, `test/scripts/cleanup.test.sh:500-570`,
  `openspec/specs/cleanup-sync-guard/spec.md`, `openspec/specs/main-fast-forward/spec.md`.

- **Decision 2 (PID liveness rejected) — accurate.** `tui-attached.sh` does track exactly one
  singleton via one lockfile (`.concertino/cache/watch.lock`, `pid` field, `process.kill(pid,0)`
  reusing `lib/ui/watch-lock.js`'s semantics). It has no per-ticket-run analogue, and its own
  header already documents PID-recycling as an accepted residual risk. The rejection is
  well-reasoned and the characterisation of the file is faithful. CONFIRMED.

- **Decision 4 (`t` epoch-ms field) — accurate.** `emit-event.sh:307` emits `{"t":%s,...}` and a
  real log confirms it: `helio/.concertino/runs/HEL-560/events.jsonl` last line is
  `{"t":1786557443128,"kind":"gate.result",...}`. Last-line + extraction is viable with no new
  dependency. CONFIRMED (with a gap — CR2).

- **6-hour default — sane.** Exceeds every duration cited (CON-138 ~1h, HEL-651 multi-hour) by a
  wide margin while bounding the window to "same day" vs. the observed 13-day and 3-day
  false positives. Not an objection.

- **Capability home (`cleanup-sync-guard`) — acceptable.** `other_runs_live()`'s behaviour is
  currently specified nowhere (`grep "run.start"/"still live"` across `openspec/specs/*/spec.md`
  returns no match for it). `cleanup-sync-guard` governs "whether the automatic sync call fires",
  which is exactly what this guard decides, so it is the right home. Non-blocking note below on
  its Purpose line.

- **`core/` scoping — correct.** Proposal Impact and tasks 1.1/1.4 name `core/scripts/cleanup.sh`
  as the change site with `scripts/concertino/cleanup.sh` as a render artifact. Consistent with
  the CON-133/CON-140/CON-138 precedent. (One hazard in 1.4 — see CR3.)

- **Where the design contradicts ground truth: retention.** See CR1.
- **Where the plan would leave `npm test` red: the existing CON-66 fixture.** See CR3.

### Verdict: REFUTE

### Change Requests

1. **`design.md` "Context" states a fact that is false, about the very code being edited.**
   It asserts: *"There is no retention/pruning process for `.concertino/runs/*` in this repo today
   (confirmed absent — grep across `core/` and `scripts/` turns up no cron/prune script)"*.
   Ground truth: `lib/ui/retention.js` exists, is exposed as `concertino prune`
   (`lib/cli/prune.js`), is invoked automatically at dashboard startup
   (`lib/ui/watch.js:218 retention.prune(root, config)`), has its own capability spec
   (`openspec/specs/event-log-retention/`), and is documented in `lib/cli/help.js:79`. The grep
   was scoped to `core/` and `scripts/` only, where it was never going to be.

   The *conclusion* survives — but for a different reason that the design must state, because it
   is load-bearing for this fix: `retention.isEligible()` returns false unless `hasRunEnd()` is
   true (`lib/ui/retention.js`, "Absent run.end, this returns false regardless of how old the file
   is — the core safety property"). So retention deliberately never prunes exactly the stuck-marker
   case CON-121 is about. That is *why* nothing ages HEL-560 out — not because pruning doesn't exist.

   This also matters for the code: the comment block the executor will be editing
   (`core/scripts/cleanup.sh:413-420`) currently claims a stuck run "stays 'live' by this test
   until its run dir is pruned (`lib/ui/retention.js` prunes exactly those, by mtime)" — which is
   the exact inversion of what retention.js does. Fix the design's Context paragraph, and add a
   task to correct that inverted in-code comment while touching that block. Do not let the design's
   current wording propagate into a replacement comment.

2. **Undecided behaviour: unparsable / missing last-event timestamp.** Decision 4 and the spec
   both specify only the happy path ("its most recent logged event's `t` timestamp"). Neither says
   what `other_runs_live()` does when the last line has no extractable `t` — a torn final line from
   a concurrent append (the case most likely to occur under a *genuinely live* run, i.e. precisely
   the dangerous direction), a trailing blank line, or a hand-edited log. An implementer could
   reasonably read this either way, and the wrong reading turns a parse failure into "not live" →
   sync rewrites shared root artifacts under a live run, the exact failure CON-66 exists to prevent.
   Decide it explicitly (the safe direction is: unextractable timestamp ⇒ fall back to today's
   presence-based verdict, i.e. treat as LIVE), state it in `design.md`, and add a `#### Scenario:`
   for it in `specs/cleanup-sync-guard/spec.md` and a fixture task in `tasks.md`.
   Consider also specifying that extraction scans backwards to the last *parseable* line rather
   than trusting `tail -1` blindly.

3. **The verification plan misses the existing test suite, which this change will break.**
   `test/scripts/cleanup.test.sh` already has a dedicated CON-66 section (lines 500-570) covering
   exactly `other_runs_live()` end-to-end, and it is wired into `npm test` (`package.json:23`).
   Its `fake_event()` helper hardcodes the timestamp:
   ```
   printf '{"t":1,"kind":"%s",...}\n'
   ```
   `t=1` is 1970 — so the moment the staleness bound lands, the "another live run present: sync
   skipped" case (TICK-88, `run.start` only) becomes *stale*, sync fires, and three assertions plus
   the `hasnt`/`has` stderr checks flip. `tasks.md` never mentions this file; task 2.5 hedges
   ("Run existing test/gate scripts covering `cleanup.sh` **if any exist**"), which reads as though
   the plan was written without opening it.

   Revise the plan to: (a) parameterise `fake_event()`'s `t` (defaulting to *now*, so existing
   liveness cases keep passing intentionally rather than accidentally); (b) add **permanent**
   regression cases to `test/scripts/cleanup.test.sh` for the three spec scenarios plus CR2's —
   stale-no-run.end ⇒ sync proceeds, recent-no-run.end ⇒ sync skipped (the no-false-negative case),
   `run.end`-present ⇒ unchanged, `CONCERTINO_LIVE_RUN_STALE_HOURS` override honoured. Tasks 2.1-2.4's
   throwaway fixtures are fine as red/green *evidence* but must not be the whole regression story
   for a bug fix in this repo.

   Also fix task 1.4: it says re-render "in this repo's own main checkout". The executor must not
   mutate the main checkout mid-run. The rendered `scripts/concertino/cleanup.sh` **inside this
   worktree** is what `test/scripts/cleanup.test.sh` actually executes (`run_cleanup_fakebin` runs
   `bash scripts/concertino/cleanup.sh`), so the re-render must land in the worktree and be
   committed with the change; propagation to the main checkout happens through the normal merge +
   Phase-4 sync, not by hand.

### Non-blocking notes

- `openspec/specs/cleanup-sync-guard/spec.md`'s `## Purpose` line is currently scoped narrowly to
  the env-gated skip flag. Since this change adds a second, unrelated guard on the same decision,
  consider broadening the Purpose to "governs whether cleanup.sh's automatic `concertino sync`
  fires" so the capability's stated scope matches its contents.
- Decision 1's argument for a time bound over a new terminal-event kind is sound and I have no
  objection to it: it is the only option that retroactively unsticks HEL-560/HEL-395 and every
  already-stuck marker in every consuming project.
- The clock-skew risk note is honest and correctly judged negligible; no action.
