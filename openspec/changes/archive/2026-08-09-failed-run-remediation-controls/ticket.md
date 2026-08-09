# CON-98: Add failed-run remediation (a address / d done) and audit per-pane fleet controls

## Description

A FAILED run in the fleet dashboard gets exactly the same generic action set as every other row — `↵ attach`, `l details`, `t ticket`, `j/k move`, `1-9 jump` (`lib/ui/screens/fleet/keys.js`'s `handleKey`, `lib/ui/screens/fleet/sections.js`'s `buildHeadTail` footer hints). Nothing in that set engages with "this failed" specifically:

* There is no way to launch a remediation flow against a failed run from the dashboard.
* There is no way to tell concertino "I looked into this myself and it's actually fine" — a failed run just sits in FAILED (capped at `MAX_FINISHED`, `sections.js:26`) until it ages out, or the operator has to fix things by hand entirely outside the TUI.

## Proposed

1. `a` **(address)**, bound while focused on a FAILED row — starts a new session running a new `/concertino-address-failure` skill: audits the run's evidence/timeline/gates for what actually happened and attempts to correct and finish the run.
2. `d` **(done)**, bound on a FAILED row regardless of whether `a` was used — moves the run into the DONE section based on the operator's own investigation. This is a manual dashboard override, not a re-derivation of `reducer.js`'s `deriveStatus`: the underlying `run.end`/telemetry data still says failed; only the bucket (and possibly a local-provider ticket-status write-back — see CON-90) changes.

## Broader ask: audit the per-pane controls

Every section (NEEDS YOU, FAILED, RUNNING, QUICK START, QUEUED, DONE) shares one flat, generic key map today. Only QUEUED and QUICK START have ever gotten their own focus-scoped bindings (`focus === 'queue'` / `focus === 'quickstart'` in `keys.js`, with their own local `f`/`t`/`a`/`j`/`k`/Escape). FAILED, RUNNING, DONE and NEEDS YOU get nothing section-specific.

`keys.js`'s own running tally of claimed top-level letters (`a c d f h H j k l L m n N p P q r s S t y`) means `a`/`d` are almost certainly already spoken for at the top level — adding FAILED-only actions likely means giving FAILED a focus mode of its own (mirroring QUEUED/QUICK START), not just binding two more bare letters. While auditing, also check whether NEEDS YOU (already routes to the escalation screen on `↵`, may be fine as-is), RUNNING, and DONE (e.g. reopen/requeue?) are similarly under-served.

## Design decisions to escalate

This ticket is deliberately underspecified. It needs several judgment calls that should be escalated during planning/execution rather than decided silently:

1. Does `a`/`d` need a FAILED-local focus mode (like QUEUED/QUICK START) before either can bind at all, or is there room among the still-unclaimed top-level letters?
2. What does `/concertino-address-failure` actually do on invocation — read-only audit + report, or does it get write access to the worktree/branch to actually fix and re-deliver? Does it reuse the existing executor/evaluator loop, or is it a new, lighter-weight role?
3. Session mechanics for `a` — a new tmux window attached to the existing worktree, a fresh `Agent`/subagent spawn, or a brand-new concertino run keyed off the same ticket? How does its outcome get back onto the dashboard — a new row, or an update to the existing failed one?
4. Does `d` need a confirmation gate? Every other state-changing action in this codebase (force-start, clear-queue, kill, restart, quit-with-pending) is gated behind a `y` confirm; a bare `d` with no confirm would be the first exception.
5. Does `d` also drive a ticket-status write-back (CON-90's local-provider commit-and-push path), or is it dashboard-only bookkeeping?
6. Per-pane audit scope: which of NEEDS YOU / RUNNING / DONE actually need new or different actions, and what are they?
7. (Longer-horizon — flagged here rather than silently deferred) Should concertino formalize a "design" ticket type, where the acceptance criteria are explicitly "the right escalations got raised and answered" rather than "the described behavior got implemented" — so a ticket like this one, with multiple genuinely open questions and no single obviously-correct shape, can be filed honestly instead of dressed up as an ordinary feature ticket? Worth a decision here, or its own follow-up ticket — either way, don't let it silently block scoping this one.

## Acceptance criteria

* A FAILED run has at least one action beyond the generic set that meaningfully engages with "this failed" — the `a`/`d` pair, or whatever the escalated decisions above land on.
* The chosen mechanism is documented (`docs/dashboard.md` or wherever fleet key bindings live) and advertised in the footer hint, per `sections.js`'s existing "only advertise a key that currently does something" discipline.
* Every open decision above is either resolved (with the resolution recorded in the PR/ticket) or explicitly escalated and answered — never silently assumed.

## Related

* CON-90: local-provider status write-back dirties the main checkout, never commits and never pushes.
