## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

1. **AC-to-task-to-file mapping is complete.** Read `ticket.md` (8 ACs),
   `proposal.md`, `design.md`, `tasks.md`. Each of the 6 fix items and the
   2 process ACs (AC7 "accepted as-is untouched", AC8 "suite passes") maps
   1:1 to a task in `tasks.md` (1.1↔AC1, 1.2↔AC2, 1.3↔AC3, 2.1↔AC4,
   2.2↔AC5, 2.3↔AC6, 3.1↔AC8, 3.2/3.3↔AC5/AC7). No AC left uncovered, no
   task added beyond the ticket's scope.

2. **Coverage gap #1 (untested `teamNotFoundMessage` guard) confirmed real.**
   Read `lib/ui/watch.js:288-303` — `ensureLaunchPad` has two separate
   try/catch blocks: one around `linear.launchPadStatus` (well tested), one
   around `linear.teamNotFoundMessage` for `initialCache.teamFound === false`
   (the guard in question). `linear` here is `require('./ticket-provider')`
   (`watch.js:44`), and `ticket-provider.js`'s `teamNotFoundMessage` calls
   `moduleFor(config)` (`lib/ui/ticket-provider.js:129-133`), which throws for
   an unresolvable kind — so the guard is real, not speculative. Grepped
   `test/watch.test.js` for `teamFound` (lines 3081-3199): the only
   `teamFound: false` seed test (`'a stale team-not-found cache renders the
   error...'`, line 3160) uses `LAUNCHPAD_CONFIG_BAD_TEAM`, a resolvable
   `kind: 'linear'` — no test pairs `teamFound: false` with an unresolvable
   kind. Confirmed gap.

3. **Coverage gap #2 (duplicated test) confirmed real.** Read
   `test/launchpad.test.js:1110-1114` — calls `provider.launchPadStatus(cfg,
   {}).enabled` directly, exercising `lib/ui/ticket-provider.js`, not
   `lib/ui/screens/launchpad.js` (the file `launchpad.test.js` is nominally
   about). `test/ticket-provider.test.js:19-20` asserts the byte-identical
   thing (`'launchPadStatus dispatches to local, which needs no api key'`).
   Confirmed genuine duplicate in the wrong file.

4. **Coverage gap #3 (magic `74`) confirmed real, and the derivation checks
   out precisely.** Found the test at `test/ticket-provider.test.js:71-82`
   (`'the gate message still fits an 80-column terminal, kind and all'`,
   asserting `e.message.length <= 74`) and the misleading comment at
   `lib/ui/ticket-provider.js:73-76` ("Kept under 74 characters — the length
   of the message this replaced"). Computed independently: base message
   (`'launch pad needs ticketProvider.kind "linear" or "local" — not ""'`)
   is 65 chars; real budget is `cols - 4` = 76 at the default `cols = 80`
   (`lib/ui/screens/launchpad.js:257,280`); headroom for the kind name is
   76 − 65 = **11 characters exactly**, matching the ticket's "~11
   characters" claim precisely. The test never references this real budget
   and only exercises short kinds (`github`, `jira`, `undefined`), so it
   would not catch truncation for any kind over 11 chars. Design's fix
   (reference `cols - 4` instead of hardcoded `74`, add a >11-char kind
   case) directly closes the gap it identifies.

5. **Hardening #1 (`parseTicket` outside try/catch) confirmed real.** Read
   `lib/ui/tickets/local.js:148-178` — the per-file `try { raw =
   readFileSync...; mtimeMs = statSync...} catch` block (165-171) closes
   before `parseTicket(...)` is called at line 172. Structural gap exists
   exactly as described; the fix (move the call inside the try) is the
   minimal, correct structural closure.

6. **Hardening #2 (dead exports) confirmed real.** `grep -rn
   "TICKETS_DIR|STATES|parseFrontmatter" lib/ test/ --include=*.js` outside
   `lib/ui/tickets/local.js` itself returned zero hits — `TICKETS_DIR`,
   `STATES`, and `parseFrontmatter` all have zero external references today.
   `STATES`/`TICKETS_DIR` are used internally in `local.js` (so removal is
   export-only, not usage removal) — consistent with the plan. Retaining
   `parseFrontmatter` as a "testing seam" is a defensible judgment call even
   though it's currently unused as one too; not a blocker.

7. **Hardening #3 (prototype-chain lookups) confirmed real, and the design's
   own risk-mitigation is verifiably safe.** `lib/ui/ticket-provider.js:26`
   (`MODULES = { linear, local }`) and `:38` (`ALIASES = { manual: 'local'
   }`) are plain-object literals; `:46` and `:62` index them with `[raw]` /
   `[kind]` — an unguarded prototype-chain hazard for hand-written kinds like
   `constructor`/`toString`/`hasOwnProperty`. `grep -n "ALIASES\|MODULES"
   lib/ui/*.js test/*.js` shows only the two lookup sites read these objects
   (plus comments) — no code anywhere relies on `Object.prototype` methods
   being callable *on* `ALIASES`/`MODULES`, so the design's own pre-flight
   risk check (either `Object.create(null)` or a `hasOwnProperty` guard is
   safe) is correct as written, not just asserted.

8. **openspec "no deltas" precedent verified, not just cited.** Ran
   `openspec validate local-provider-hardening --strict` myself: the only
   error is `"Change must have at least one delta. No deltas found."` —
   matches the ticket's claim exactly. Confirmed
   `openspec/changes/archive/2026-07-30-codex-worker-dispatch-caution` and
   `openspec/changes/archive/2026-08-01-fix-cleanup-sh-comment-drift` both
   exist as cited precedent for `--skip-specs` archival of no-user-facing-
   behavior changes.

9. **No placeholders, no internal contradictions.** No `TODO`/`TBD` in any
   of the four artifacts. `design.md`'s Decisions section doesn't contradict
   `proposal.md`'s "What Changes", and both agree with `tasks.md`. The five
   "Accepted as-is" ticket items are explicitly listed as non-goals in
   `design.md` and as a verification task (3.3) in `tasks.md` — no drift.

10. **Impact section is accurate and scoped.** Cross-checked against actual
    file contents: `lib/ui/watch.js` genuinely needs no code change for
    task 1.1 (only a new test); the four touched source files
    (`watch.js`, `tickets/local.js`, `ticket-provider.js`, and their test
    files) match the ticket's stated confinement — no scope drift into
    unrelated modules.

### Verdict: CONFIRM

The design is unusually well-grounded: every factual claim in the ticket
that I could independently check against the actual code (the untested
guard, the duplicate test, the magic-number derivation down to the exact
11-character headroom, the try/catch structural gap, the dead exports, the
prototype-chain hazard, and the openspec precedent) held up exactly as
stated. Tasks map 1:1 to acceptance criteria with no gaps or scope creep,
decisions are specific enough for an implementer to execute without
guessing, and the two identified risks in `design.md` are already verified
safe by a grep any implementer would also run.

### Non-blocking notes

- `design.md`'s "computed in the test rather than duplicated as a second
  magic number" for the `cols - 4` budget is slightly underspecified on
  *which* `cols` value the test should assume (the render pipeline's
  default is 80, per `lib/ui/screens/launchpad.js:257`) — but this is a
  normal, low-risk implementation detail for a test-only fix, not an
  ambiguity that blocks starting execution.
- The ticket's framing of "six tests" covering the sibling `launchPadStatus`
  guard undercounts slightly what I could directly attribute to the
  identical unresolvable-kind scenario in `test/watch.test.js` (I found 3
  tests matching that exact pattern there, with more related coverage
  spread across `test/ticket-provider.test.js`/`test/linear.test.js`) — the
  qualitative point (that guard is well covered, this one is not) is true
  regardless, so this doesn't affect soundness.
