## Context

`core/scripts/cleanup.sh`'s `attempt_fast_forward` sets `FF_STATUS` to one of
`fetch-failed`, `no-local-base`, `current`, `updated`, `dirty`, `diverged`, or
`failed`, plus `FF_REASON` when relevant. The retry-exhaustion block (after a
human answers `retry` to the fast-forward escalation) currently treats every
non-`updated`/non-`current` outcome identically: it prints "note: local
<base> remains behind <remote>/<base> after retry" and appends `FF_REASON` in
parentheses when set.

That phrasing was written with the escalation's own trigger set in mind
(`dirty`, `diverged`, `failed`) — all three are outcomes where the script
completed its remote-vs-local comparison and knows local is behind. But the
retry can independently land on `fetch-failed` or `no-local-base`: cases
where `attempt_fast_forward` returned early because it couldn't even
establish the remote tip, so it has no basis for asserting "behind" at all.

## Goals / Non-Goals

**Goals:**
- Retry-exhaustion wording accurately reflects what the script actually
  knows: a confirmed-behind state vs. an inconclusive one.
- No change to `FF_STATUS`'s value set, to when the escalation is raised, or
  to exit/skip/continuation behavior.

**Non-Goals:**
- Not reworking the escalation's trigger conditions (only `dirty`,
  `diverged`, `failed` raise it today — `fetch-failed`/`no-local-base` on the
  *first* attempt already skip silently, per the existing `main-fast-forward`
  spec, and that is unchanged). This change only affects the message chosen
  *after a retry* that itself lands on `fetch-failed`/`no-local-base`.
- Not adding a third escalation or retry attempt.

## Decisions

**Decision: branch the retry-exhaustion message on `FF_STATUS`, not on a new
flag.** `attempt_fast_forward` already leaves `FF_STATUS` (and `FF_REASON`)
set after the retry call. The retry-exhaustion block can check
`FF_STATUS` directly:
- `fetch-failed` or `no-local-base` → "note: could not determine whether
  local <base> is behind <remote>/<base> after retry — <reason>" (reason:
  "fetch failed" for `fetch-failed`, "no local <base> branch" for
  `no-local-base`, falling back to any `FF_REASON` if the retry path ever
  sets one for these statuses).
- `dirty`, `diverged`, `failed` (or anything else reaching this branch) →
  keep today's "note: local <base> remains behind <remote>/<base> after
  retry" wording, with `FF_REASON` appended exactly as today.

Considered a boolean "did the fetch succeed" flag threaded out of
`attempt_fast_forward` instead — rejected as redundant: `FF_STATUS` already
encodes this distinction (`fetch-failed`/`no-local-base` are the only two
statuses reached without a successful remote-tip comparison), so branching
on it directly avoids adding new plumbing for information the function
already exposes.

## Risks / Trade-offs

[Risk: a future new `FF_STATUS` value silently falls into the wrong wording
branch] → Mitigation: the "confirmed behind" branch is written as the
default/fallback (matching today's behavior for any status this change
doesn't explicitly special-case), so a new status degrades to today's
wording rather than to a fabricated "could not determine" — the safer
direction if the mapping is ever incomplete, since it never asserts less
than what's known.

## Migration Plan

None — stderr wording change only, deployed via the normal
`core/scripts/cleanup.sh` → `concertino sync` → `scripts/concertino/cleanup.sh`
path already used for every other change to this script.
