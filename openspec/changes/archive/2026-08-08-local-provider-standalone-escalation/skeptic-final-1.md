## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

1. **Ground truth of the diff.** `git diff main...HEAD --stat` (commit `7a82559`) touches exactly:
   `core/roles/orchestrator.md`, `core/scripts/next-ticket-id.sh` (+ mirror
   `scripts/concertino/next-ticket-id.sh`), `lib/cli/render.js`, `package.json` (test-chain wiring),
   `test/scripts/local-provider-render.test.sh`, `test/scripts/next-ticket-id.test.sh`,
   `test/scripts/standalone-triage-render.test.sh`, and the change-dir planning artifacts. No files
   outside this set — matches `files-modified.md` and the evaluator's claim. No scope creep.

2. **AC1 — "Under `local`, the `standalone` triage branch names an action the agent can actually
   perform."** Read `lib/cli/render.js`'s new `case 'standaloneTicket'` (block switch): the `local`
   branch returns prose instructing the agent to derive `<prefix>` from `$TICKET_ID`, run
   `scripts/concertino/next-ticket-id.sh tickets/ "<prefix>"`, and on `READY` write the returned
   `path` with `title:`/`state: backlog` frontmatter. All of `Bash`/`Write` are already granted to
   the `local`-provider orchestrator (confirmed no MCP tool is named). I actually rendered a
   synthetic `local` fixture (`node bin/concertino sync` against a hand-built
   `ticketProvider.kind: "local"` config) and read the rendered `standalone` bullet directly — it
   names `next-ticket-id.sh`, `tickets/`, `state: backlog`, and never `mcp__linear__save_issue`.
   AC1 traced to real, executed evidence — met.

3. **AC2 — "`linear`/`github` rendered output is unchanged, or the change is deliberate and
   covered."** I did not just trust the test; I independently rendered `core/roles/orchestrator.md`
   from a clean `git worktree add --detach main` checkout against `config/examples/concertino.json`
   (linear) and diffed the resulting `.claude/agents/concertino-orchestrator.md` byte-for-byte
   against the same render from this branch's `HEAD`: `diff` produced no output — **byte-identical**.
   (Removed the scratch worktree after.) Combined with the in-repo
   `test/scripts/standalone-triage-render.test.sh` asserting the same for both `linear` and `github`
   fixtures — AC2 met, not merely claimed.

4. **Gates re-run fresh (not trusted from the evaluator's paste).**
   - `npm test` → exit 0, all suites green (grepped the full log for `FAIL`/`not ok` lines beyond
     test-name text containing "fail" — none). Includes the two new suites
     (`next-ticket-id.test.sh`: 36/36; `standalone-triage-render.test.sh`: 10/10) and the extended
     `local-provider-render.test.sh` (10/10).
   - `openspec validate local-provider-standalone-escalation --strict` → `Change ... is valid`.
   - `diff core/scripts/next-ticket-id.sh scripts/concertino/next-ticket-id.sh` → no output (no
     mirror drift), both `chmod +x` (`-rwxr-xr-x`, verified with `ls -la`).

5. **Design-gate follow-through.** `skeptic-design-1.md` (round 1, CONFIRM) left one non-blocking
   note: `design.md`'s Decision 2 falsely claimed the prefix regex "mirrors" `set-ticket-state.sh`
   and that a prefix "can never end in a digit." Read the committed `design.md` (Decision 2,
   lines 56-77): now correctly states the regex is new/narrower and does not repeat the false
   "can't end in a digit" claim. Cross-checked the `set-ticket-state.sh` regex quoted there
   (`^[A-Za-z#][A-Za-z0-9_-]*[0-9]$`) against the actual file (`scripts/concertino/set-ticket-state.sh:74`)
   — matches exactly. The note was genuinely addressed, not just asserted addressed.

6. **`next-ticket-id.sh` correctness spot-check.** Read the full script. Validates `<prefix>` against
   `^[A-Za-z][A-Za-z0-9]*$` before use in a glob/path (closes injection concerns); `mkdir -p`s a
   missing `tickets-dir` (matches `lib/ui/tickets/local.js`'s treatment of a missing dir as empty,
   not an error); strips leading zeros before numeric comparison (avoids bash's octal trap on e.g.
   `CON-01.md`); re-checks the computed target doesn't already exist before printing `READY`. Ran
   `test/scripts/next-ticket-id.test.sh` directly — 36/36 pass, covering exactly these edge cases
   (independent per-prefix numbering, missing-dir auto-create, invalid-prefix rejection, the
   stubbed-`basename` unexpected-target safety check).

7. **UI/design judgment (Section 4).** N/A — this change touches only a Markdown template, a
   render-time JS switch, and shell scripts/tests. No UI-affecting files, no dev server needed; the
   project has no UI review configured for this ticket's surface area either way.

8. **Debugging law N/A.** This is a template/script *addition*, not a bug fix to existing running
   code — CON-91 corrects unexecutable prose that was never reachable via any test before, so there
   is no "probe-confirmed root cause + regression test for a prior bug" requirement to check; the new
   tests are the first coverage of this path, which is the correct shape for new capability, not a
   regression test for an existing defect.

### Verdict: CONFIRM

Every acceptance criterion traces to code I read and evidence I reproduced myself (not the
evaluator's narrative): the `local` branch is executable with tools the agent actually has, the
`linear`/`github` branches are verified byte-identical via an independent from-`main` render (not
just the in-repo test), the id-allocator script is correct and tested, no drift between the
canonical and mirrored copies, `npm test` and `openspec validate --strict` both pass fresh, and the
one substantive note left open at the design gate was genuinely fixed in the committed `design.md`.
No scope creep beyond the ticket's stated boundary (CON-62's harness-override note and GitHub's own
wording were correctly left untouched).

### Non-blocking notes

- None beyond what the design-gate skeptic already raised and which was addressed (see #5 above).
