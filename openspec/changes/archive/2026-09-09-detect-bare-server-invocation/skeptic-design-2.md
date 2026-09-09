## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

Re-read `design.md`, `tasks.md`, `specs/dev-server-process-identity/spec.md` in full from the worktree, plus ground truth (`core/scripts/start-servers.sh`, `test/scripts/start-servers.test.sh`, `package.json`, `git ls-files .claude`). I did not rely on the orchestrator's summary.

Round-1 change requests, re-checked against file contents:

1. **CR1 (existing tests break, unstated) — addressed in form.** `design.md` now carries Decision 4 stating the reuse-branch coverage is affected, and `tasks.md` 1.3 is a real task to update it. But see the Change Request below: the *content* of both is factually wrong in two ways.
2. **CR2 (port derivation undefined) — FIXED.** Decision 1 now derives host+port from the resolved `$url` (line-80 `eval`), explicitly "never from `$DEV_PORT`/`$BACKEND_PORT`", and specifies the no-port / non-local-host skip. `tasks.md` 1.1 matches. Verified against `start_one()` (`core/scripts/start-servers.sh:71`, `:80`) — `url` is exactly the variable named, and `start_one()` still takes no port argument.
3. **CR3 (contradictory degrade rule) — FIXED.** Decision 2 states one rule (mismatch only when a pid is found AND `/proc/<pid>/cwd` is readable AND resolves outside `WORKTREE_PATH`; everything else degrades with a stderr note). `tasks.md` 1.1 now agrees, and the spec carries a third scenario, "Process identity cannot be determined", making the boundary contract rather than implementation detail. The old "no matching pid is still a mismatch" text is gone (grep-confirmed absent).
4. **CR4 (wrong test home / vague gate) — FIXED.** `tasks.md` 2.1 now names `test/scripts/start-servers.test.sh` and explicitly rejects the `scripts/concertino/`-style check; 4.1 names the literal `npm test`. Confirmed `package.json:23` runs `bash test/scripts/start-servers.test.sh`.
5. **CR5 (deferred sync question) — FIXED.** `tasks.md` 3.3 now states the settled fact with its evidence and "no action needed". Re-ran `git ls-files .claude` myself: commands/settings/skills only, no `.claude/agents/`. Correct.

Fresh ground-truth reading of `test/scripts/start-servers.test.sh` (the reason for the verdict below): one shared `node` listener is created **once** at lines 23-27, before any test repo exists, and is consumed by **five** reuse-branch blocks — lines 48 (`HEL-1`), 123 (`HEL-3` ms loop), 158 (`TICK-9`), 181 (no-explicit-id), 202 (`CON-79`). Each sets `CONCERTINO_BACKEND_HEALTH` to that live listener, so `curl -sf` succeeds and the reuse branch runs; each asserts `exit 0`. Each block's `$WT` lives in its own `mktemp` repo that is `rm -rf`'d at the end of the block.

### Verdict: REFUTE

Four of five round-1 items are cleanly fixed and the design is otherwise sound. The fifth is fixed in form but wrong in substance, in a way that guarantees the executor improvises mid-flight — the exact failure CR1 existed to prevent.

### Change Requests

1. **Decision 4 / task 1.3 undercount the affected blocks (two, actually five) and prescribe a remedy that is structurally impossible.**

   - *Undercount:* both name only the `HEL-1` block and the `HEL-3` ms-resolution loop. `test/scripts/start-servers.test.sh` drives the reuse branch from **five** places — lines ~48, ~123, ~158, ~181, ~202 — every one of them pointing `CONCERTINO_BACKEND_HEALTH` at the shared listener and asserting `exit 0`. The three CON-80 ticket-id blocks (`TICK-9`, the no-explicit-id block, `CON-79`) go red under the new rule for exactly the same reason as the first two. `npm test` would still be red after 1.3 is completed as written, and 4.1 would still be unsatisfiable.
   - *Impossible remedy:* both say to "start the stand-in listener from a cwd under `$WT`". There is exactly **one** listener process (lines 23-27), started before any repo exists and shared by all five blocks, whose `$WT`s are five different `mktemp` directories created and deleted after the shared listener is already running. No single process cwd can be under all five. Any correct fix must change the *structure*, not the cwd — e.g. give each reuse block its own listener started with `cd "$WT"` (and its own port), or have blocks that only assert telemetry/ticket-id behavior opt out of the identity check by construction.

   Restate Decision 4 and task 1.3 with the correct block list (all five, by line and by marker) and a remedy that is actually executable against the shared-listener structure. Also state which of the five are meant to keep exercising the reuse path versus which may legitimately be restructured — otherwise "make the tests green" is the only instruction the executor really has.

### Non-blocking notes
- Decision 2 says "a pid is found", while `tasks.md` 1.1 and the spec both say **exactly one** pid. The narrower reading is clearly intended; a one-word edit to Decision 2 removes the last ambiguity about the multi-pid case (which should degrade).
- `lsof` / `/proc/net/tcp` remains a genuinely new dependency for these scripts (still zero prior uses). The risk section acknowledges it; worth ensuring the fallback path is itself exercised, not merely written.
- Task 2.1's new test must not reuse the shared module-level listener — its whole point is a foreign-cwd process on the resolved port. Worth saying so explicitly given change request 1 will be restructuring listener ownership anyway.
