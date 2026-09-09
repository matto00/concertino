## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Cold skeptic. Verified the two round-3 change requests against the actual
scripts, not against the design's description of them.

### What I verified (with evidence)

**CR1 — ticket-key canonicalisation. Real and correct.**
- The drift the design claims exists, does exist. `sed -n` on
  `core/scripts/check-merge-readiness.sh` shows `TICKET_ID="${3:?...}"` at `:101`
  used raw, and `:284` builds `${ROOT}/.concertino/runs/${TICKET_ID}/events.jsonl`
  from the raw value — no `tr` anywhere in that script.
  `core/scripts/emit-event.sh:296` does
  `TICKET="$(printf '%s' "$TICKET" | tr '[:lower:]' '[:upper:]')"`, with the
  CON-80 comment above it citing lowercase-suffix branches as a previously
  observed occurrence. So acquire-raw / release-uppercased would strand a
  lowercase-id run exactly as design.md Decision 2 states.
- The fix is placed correctly: canonicalisation is in the shared helper
  (tasks.md 1.1, "**The helper canonicalises the ticket id**"), not at either
  call site, so the two cannot drift apart again. Coverage exists: task 4.1c and
  `specs/phase4-teardown-safety/spec.md:16` ("a lowercase ticket id is released
  by the canonical release path").

**CR2 — unreleasable lease under a malformed ticket id. Real and correct.**
- `check-merge-readiness.sh:121-124` defines `looks_like_ticket()` and exits `1`
  with `FAIL invalid TICKET_ID` before any readiness work; `emit-event.sh:279`
  applies the identical predicate and `exit 0`s. So a lease taken before shape
  validation genuinely could never be released by the designed seam.
- design.md Decision 2's "Acquisition happens after ticket-shape validation, not
  before it" and tasks.md 1.2 place acquisition after validation and before any
  substantive check — which preserves the intended "a `FAIL` from a real
  readiness check still holds the lease" behaviour, since the shape check is at
  `:122` and the substantive checks begin well below `:280`. Spec scenario at
  `specs/phase4-teardown-safety/spec.md:21` asserts a malformed id creates no
  lease; task 4.1c asserts it too.

**Round-3 non-blocking notes, both adopted.** Decision 4a now carries the
`emit-event.sh:178` warning (verified: line 178 is exactly
`ROOT="$(main_checkout)" || exit 0`). Task 1.4 now requires recording the exact
grep patterns.

**Supporting citations spot-checked:** `cleanup.sh:129` is
`REPO_ROOT="$(run_git ... rev-parse --show-toplevel)"`; `cleanup.sh:149` is
`T="${TICKET_ID:-${WORKTREE_PATH##*/}}"`; `check-merge-readiness.sh:136-142` and
`emit-event.sh:93-100` both resolve via `--git-common-dir`. All as described.

**Convergence judgment.** Every fail-open and strand path I can construct is
closed: wrong root → helper resolves it itself and cleanup fails closed (1.1,
2.3, 4.1a); wrong key → helper canonicalises (1.1, 4.1c); wrong lookup key `T` →
matched on recorded worktree path (2.3, 4.1b); telemetry drop → release on
recognition (1.3); unkillable holder → `--force-teardown` (2.1, 2.7); guard rot →
mutation coverage (4.5). Task list covers every decision and the render/gate
constraint (5.1, 5.4) honours CON-173. This is implementable.

### Verdict: CONFIRM

### Non-blocking notes

1. **Decision 4a's "upstream of `:178`" bullet is not literally satisfiable, and
   the design already says so in its own second half.** `KIND` is taken at
   `emit-event.sh:74`, but `TICKET` and `ROLE` are only assigned in the argument
   loop at `:204-234` — i.e. *below* `:178`. A release that must know
   `role=auditor` therefore cannot sit upstream of the `|| exit 0`. The bullet's
   body concedes the downstream placement is "tolerable" (it degrades to
   `--force-teardown`, not a fail-open), so nothing is unsound — but the bolded
   sentence reads as a hard requirement an implementer will burn time trying to
   satisfy. Suggested resolution at execution time: place the release immediately
   after the argument loop and before the `:279` shape check, and reword the
   bullet from "must sit upstream of `:178`" to "note that `:178`'s early exit is
   upstream of where the release can be placed; the resulting skip degrades to
   `--force-teardown`, not to a fail-open."

2. **Two line citations have drifted by a few lines** and should not be trusted
   as exact by the implementer: `emit-event.sh:292` (design.md Decision 2,
   tasks.md 1.1) is actually `:296`; `emit-event.sh:284` (tasks.md 1.2) is
   actually `:279`. Both point at the right code, one screenful off.

3. `check-merge-readiness.sh` also exits `1` at `:131` when the worktree dir is
   missing. Acquisition should sit after that check too (it is trivially implied
   by "after argument validation", but the design only names `:122-123`).
