## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

Every line citation in design.md was checked against the actual scripts, not trusted:

- `check-merge-readiness.sh:138` — `common="$(cd "$WORKTREE_PATH" ... git rev-parse --git-common-dir ...)"`. Exact.
- `emit-event.sh:96` — same `rev-parse --git-common-dir`. Exact.
- `cleanup.sh:129` — `REPO_ROOT="$(run_git ... rev-parse --show-toplevel)"`. Exact; the disagreement risk named in Decision 2 is real.
- `cleanup.sh:149` — `T="${TICKET_ID:-${WORKTREE_PATH##*/}}"`. Exact; basename inference confirmed.
- `cleanup.sh:40-48` — `--phase4`-first / `CONCERTINO_PHASE4=1` opt-in, `shift`, then `WORKTREE_PATH="${1:?...}"`. Decision 4's parsing spec is consistent with it.
- `emit-event.sh:52` — "ALWAYS exits 0 in normal mode, including on internal error". Exact. Early `exit 0` paths confirmed at `:75`, `:178`, `:284`, `:299`, `:340`.
- `auditor.md:54` (readiness invocation), `:80-85` (PENDING, re-invoke up to 3 times), `:204` (report written with the file-write tool), `:230` (persist-evidence), `:232-239` ("A verdict must always be emitted"). All exact; the 1–3 acquires / one release framing in CR3 is now accurate.

Round-2 CR closure:
- **CR1** — design.md Decision 2 ¶"Resolution of the lease root is the helper's job" + ¶"matched on the worktree path" + ¶"fails closed"; tasks 1.1/2.3/4.1a/4.1b; spec Requirement "The lease root is resolved by the shared helper, and an unresolvable root fails closed" with three scenarios (:45, :50, :55). Present and correct.
- **CR2** — Decision 4a with both constraints (release on recognition; never aborts); task 1.3 + new 1.3a; spec scenario "the lease is released even when the event write is skipped" (:21). Present and correct.
- **CR3** — wording now states 1–3 acquires, one release, grounded in `auditor.md:80-85`. Correct.
- Non-blocking notes adopted: pid recorded (Decision 2 ¶"records the acquiring pid", task 1.1); plain re-run as first recovery (Risks ¶1, task 3.3); fixture side effect (task 5.3).

The mechanism is not re-litigated; it holds. What I found is a new, concrete gap in the acquire/release **key**, which the round-2 work on the *root* did not cover.

### Verdict: REFUTE

### Change Requests

1. **The lease's ticket key can drift between acquire and release, stranding a run.** The lease path is `.concertino/runs/<TICKET_ID>/locks/auditor.lease` (design.md Decision 2, spec :9). `check-merge-readiness.sh` uses `TICKET_ID` **raw** — no case canonicalisation anywhere in the script (`:101`, and `:284` builds `runs/${TICKET_ID}/events.jsonl` from the raw value). `emit-event.sh` uppercases the ticket at `:292` (`tr '[:lower:]' '[:upper:]'`), and its own comment there records that lowercase-suffix branches passing non-canonical ids are a real, previously-observed occurrence (CON-80). A release keyed on the raw string (which is what task 1.3's "on recognition", i.e. before `:284`/`:292`, literally directs) can therefore look under a different directory than the acquire wrote to — and vice versa if release is placed after canonicalisation. The result is a permanently held lease and a strand clearable only by `--force-teardown` — exactly the outcome Decision 4a exists to prevent, reintroduced through the key instead of the root. Pin the normalisation in design.md Decision 2 as a helper responsibility (the helper canonicalises the ticket identically on acquire and release, or release locates the lease by scan rather than by ticket path), add it to task 1.1, and add a test to §4 that acquires with a lowercase ticket id and asserts the release still clears the lease.

2. **Task 1.2's "before any readiness check can fail or exit" would acquire an unreleasable lease on an invalid ticket id.** `check-merge-readiness.sh:122-123` rejects a malformed `TICKET_ID` (`looks_like_ticket`) and exits `FAIL`. `emit-event.sh:284` applies the same shape check and `exit 0`s on failure, so a lease acquired under a malformed id can never be released by the designed seam. Narrow task 1.2 (and Decision 2) to: acquire **after** argument and ticket-shape validation, but before any substantive readiness check — so a `FAIL` from a real check still leaves the lease held (the intended behaviour), while a lease is never created under a key the release path structurally cannot address.

### Non-blocking notes

- `emit-event.sh:178` (`ROOT="$(main_checkout)" || exit 0`) means a release invoked where the main checkout is unresolvable cannot run either; the helper resolving its own root does not change that. It degrades to the `--force-teardown` case rather than to a silent fail-open, so it is acceptable — but worth one sentence in Decision 4a so the implementer does not place the release downstream of `:178` and assume it always runs.
- Task 1.4's "confirm no other caller" should record the grep it ran, not just its conclusion; a zero-hit grep is only evidence if the pattern is shown.
