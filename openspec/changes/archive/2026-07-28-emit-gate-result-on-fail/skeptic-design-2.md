## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- Read `proposal.md`, `design.md`, `tasks.md`, `specs/gate-telemetry/spec.md`
  (the delta), and `ticket.md` fresh (cold start, no reliance on round-1 report
  narrative beyond using it as a checklist of claims to re-verify).
- Read ground truth: `core/scripts/start-servers.sh` (75 lines, full file),
  `core/scripts/assert-phase.sh` (full file), `openspec/specs/gate-telemetry/spec.md`
  (current base spec, pre-change), `test/scripts/start-servers.test.sh` (full file).
- Fetched `CON-8` via `mcp__linear__get_issue` and re-traced all six ACs against
  the revised design/tasks.

**Re-verified each of round 1's four change requests against current file contents (not the orchestrator's narrative):**

1. **`looks_like_ticket` grounding — FIXED.** `grep -n "looks_like_ticket"
   core/scripts/*.sh` confirms the function exists only in `assert-phase.sh`
   (lines 109/114/119) — still absent from `start-servers.sh`. `design.md`
   lines 18-23 now explicitly says "`start-servers.sh` has no
   `looks_like_ticket` function today... the guard reuses the exact inline
   regex the pass-path emission already uses at line 66... No new helper is
   introduced." `tasks.md` task 1.2 mirrors this: "gate it with the same
   inline regex... do NOT call `looks_like_ticket`; that function exists only
   in `assert-phase.sh`, not in `start-servers.sh`." Both texts now match the
   actual pass-path pattern at `start-servers.sh:66-67` verbatim
   (`[[ "$T" =~ ^[A-Za-z#][A-Za-z0-9._-]*[0-9]$ ]] && ...`). Resolved.

2. **`local T=...` scoping gap — FIXED.** `design.md` Goals (lines 24-28)
   explicitly states the `local T="${WORKTREE_PATH##*/}"` assignment
   (currently `start-servers.sh:65`, after the `if/else` block) "must move to
   the top of `start_one()`... so `$T` is in scope for the new failure-path
   emission, which sits *inside* that `if` block." `tasks.md` task 1.1
   restates this as an explicit numbered step, with the correct branch
   reference ("before the `if curl -sf "$url" ...` branch," matching the
   actual code at line 54, no `!`). The "Decisions" section of `design.md`
   (lines 70-73) also cross-references it. Resolved as an explicit,
   actionable instruction rather than an implicit gap. (Note: `design.md`
   line 26 itself has a typo — "before the `if ! curl -sf ...` branch" — the
   real condition at line 54 has no `!`. Cosmetic only: `tasks.md`, the
   operative checklist, has it right, and the placement intent — top of
   function, before the reuse-check `if` — is unambiguous either way.)

3. **`tasks.md` 5.1 broken CLI invocation — FIXED.** `tasks.md:45` now reads
   `openspec validate emit-gate-result-on-fail --strict`. I ran it myself:
   `npx openspec validate emit-gate-result-on-fail --strict` →
   `Change 'emit-gate-result-on-fail' is valid`, exit 0. Resolved and
   independently reproduced (not taken on the orchestrator's word).

4. **`proposal.md` undercounting modified requirements — FIXED.**
   `proposal.md` lines 39-48 ("Modified Capabilities") now names all three:
   "gate.result events carry a duration," "Failing gate.result events carry
   the first error line," and "Existing stdout and telemetry-safety
   contracts are preserved." This matches the actual delta file
   `openspec/changes/emit-gate-result-on-fail/specs/gate-telemetry/spec.md`,
   which contains exactly these three `### Requirement:` headers, each with a
   new fail-path scenario appended (verified by reading the full delta file).
   Resolved.

**Fresh checks beyond the round-1 list:**

- Traced all 6 ACs in `ticket.md` to concrete tasks/decisions: (a)
  `gate=server:<label>`, `status=fail`, `duration_ms`, `first_error` on the
  failure path → `tasks.md` 1.2 + `design.md` Decisions; (b) stdout/stderr/
  `exit 1` unchanged → `tasks.md` 1.3 + spec delta's new "start-servers.sh
  failure output unchanged" scenario; (c) `|| true` guard → `tasks.md` 1.2;
  (d) `scripts/concertino/start-servers.sh` re-rendered via sync →
  `tasks.md` 2.1; (e) `gate-telemetry` spec updated → delta file present,
  broadens `first_error` scope beyond "`assert-phase.sh` only"; (f)
  `test/scripts/start-servers.test.sh` covers the new emission → `tasks.md`
  4.1/4.2. All six covered.
- Confirmed `scripts/concertino/start-servers.sh` is still byte-identical to
  `core/scripts/start-servers.sh` today (`diff` → no output), so the sync
  task starts from a clean, verifiable baseline.
- Spot-checked the spec delta's structure against OpenSpec's MODIFIED
  convention (full requirement text + all scenarios, not a diff fragment) —
  `openspec validate --strict` passing (above) is authoritative evidence this
  is structurally correct.
- No new placeholders, `TODO`/`TBD`, or scope drift found in the revised
  `design.md`/`tasks.md`/`proposal.md`. The two Non-Goals in `design.md`
  (not touching `assert-phase.sh`/`emit-event.sh`/reducer; not changing
  BLOCKER semantics) remain internally consistent with the rest of the
  design and with the ticket's own scoping.

### Verdict: CONFIRM

All four round-1 change requests are grounded-fixed against the actual
current file contents (verified independently, not from the orchestrator's
claims). No new blocking issues found on a fresh full re-read.

### Non-blocking notes

- `design.md:26` says "before the `if ! curl -sf ...` branch" — the actual
  condition at `start-servers.sh:54` is `if curl -sf "$url" ...` (no `!`).
  `tasks.md:5` has the correct wording. Worth a one-word fix in `design.md`
  for internal consistency, but not implementation-blocking since `tasks.md`
  is the operative checklist and is correct.
