# CON-99: Runs may be getting marked delivered/done despite an unresolved fast-forward failure at Cleanup

## Description

Seen a few times tonight (2026-08-07/08) — runs reaching DONE that look like they shouldn't have, without having dug in yet. Investigating properly tomorrow; filing now so it isn't lost, and so the orchestrator can escalate for more context/scope rather than this being guessed at cold.

CON-90 through CON-94 are the clearest repeated pattern. Each of their `events.jsonl` tails looks the same:

```
phase.enter    Cleanup
escalation.raised   "can't fast-forward local main (main is checked out at /home/matt/Development/concertino with uncommitted changes)"   options=retry,skip
escalation.answered  answer=retry
run.end        status=delivered        <- ~1-1.2s after the answer
gate.result    phase:cleanup   pass
```

Five runs in a row hit the identical blocker, were answered `retry`, and ended `delivered` about a second later. CON-95 is a different shape but also suspicious — an `escalation.answer_discarded` immediately followed by a fresh `escalation.answered` (`standalone`) and then `run.end status=done`, all within ~30s.

## Possible mechanism (unconfirmed — needs real investigation)

`core/scripts/cleanup.sh:172-196` — when the fast-forward is `dirty`/`diverged`/`failed`, it raises the escalation above and blocks on `retry`/`skip`. On `retry` it calls `attempt_fast_forward` exactly once more (`:180`), but then:

* if the retry still isn't `updated`/`current`, the script only `echo`s a stderr note ("... resolve manually") — `:190-193`
* nothing re-raises, nothing marks the run failed, nothing blocks

Execution just falls through to the rest of Cleanup regardless of whether the retry actually succeeded. If that's what happened here, a `retry` that doesn't actually resolve the dirty/diverged local main would still let the run finish as delivered/done — silently, since the only trace is an `echo >&2` note that never reaches the dashboard. Worth confirming: was local `main` actually caught up after each of these five retries, or did the escalation answer just wave the run through?

## To investigate / escalate

* Confirm whether local `main` was genuinely fast-forwarded after each `retry` above (git reflog / the note text on stderr, if captured anywhere) — or whether these all fell into the silent-fallthrough path.
* If it's the fallthrough: decide whether `retry` failing a second time should re-raise, hard-fail the run, or something else — this is exactly the kind of call that should go back to me as an escalation rather than being assumed.
* Worth checking whether this generalizes beyond the fast-forward escalation — anywhere else in Cleanup/Delivery that answers a blocking escalation but doesn't actually gate the next step on the outcome.

## Acceptance criteria

* Root cause identified and written up (even if the fix lands in a follow-up ticket).
* A `retry` (or any escalation answer) that doesn't actually resolve the underlying blocker can no longer result in a run silently reaching delivered/done.
