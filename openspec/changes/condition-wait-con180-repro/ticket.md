# CON-200: escalation-loop.test.sh's CON-180 repro assertion is timing-fragile under CPU contention

## Description

`test/scripts/escalation-loop.test.sh`'s CON-180 reproduction block (roughly lines 190-331)
fails intermittently on a loaded machine, producing a spurious red CI run on changes that have
nothing to do with it. The assertion that fails is:

```
CON-180 repro: its reason describes the STALE content (A, missing subAnswers)
  expected [true] got [false]
```

The block generates a pre-CON-180-fix mutant with an injected 2s race window
(`CON180_RACE_WINDOW_SEC=2`), writes `MALFORMED_A`, waits a fixed wall-clock `sleep 1`
(line 278), then writes `MALFORMED_B`. On a slow or contended runner the mutant does not reach
its first poll read of `answer.json` within that 1s, so B wins the first read. The reported
`reason` then describes B — which has `subAnswers` — instead of stale A, so the
`/missing or not an array/` check returns false. The sibling `content_hash` assertion still
passes either way, which is the tell-tale signature.

Observed in the wild on PR #141 (CON-188), run 35140557990: the `test (22)` leg hit this and
failed, which cancelled the `test (16)` leg via matrix fail-fast — `test (16)` had already
reported `escalation-loop.test.sh` passing. A fully green change presented as a two-leg CI
failure. CON-188 is blocked on this fix.

## Root cause (probe-confirmed in this run, refining the ticket)

An instrumented probe (a marker the mutant writes immediately after its first read) measured the
true margin `t_firstread - t_Awrite` against the 1.000s budget:

- UNLOADED: 0.943 / 0.945 / 0.946 / 0.947 / 0.947 s — only ~55ms of headroom.
- LOADED (36 spin loops on 12 cores): bimodal — 0.106 / 0.162 / 0.179 s, or
  1.048 / 1.050 s. The exceedances are the failure.

The mechanism is phase alignment against `emit-event.sh`'s own 1s poll interval, not merely
"slow setup": the fixed wait is the same length as the poll period it races, so if the A-write
slips past a poll tick the next read is a full interval later and always exceeds 1s. The
constant is marginal even on an idle machine.

## Acceptance criteria

- The CON-180 repro block no longer depends on a fixed wall-clock margin to win its race.
  It waits on positive evidence that the mutant has actually performed its first read of
  `answer.json` before writing B.
- The wait is bounded, and on timeout the test FAILS LOUDLY through the suite's own `check()`
  rather than silently proceeding to assert against a wrong interleaving.
- The `CON-180 repro: its reason describes the STALE content` assertion remains failable: when
  the guarded interleaving is not achieved (B wins the first read), the assertion still goes red.
  A wait fix that makes the assertion unfailable is worse than the flake.
- The assertion holds across repeated contended trials, not one clean run.
- Sibling fixed waits in the same file are assessed; only those fragile for this same reason are
  changed, and the assessment is stated.
