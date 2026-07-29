## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

1. **Ticket ACs read directly.** `ticket.md` (4 AC bullets + the "may not be
   cleanly determinable" honesty warning). Confirmed via `mcp__linear__get_issue`
   description not needed — the worktree copy matches what the design responds to.

2. **Current bug state matches the described gap.**
   `core/scripts/setup-worktree.sh:169-175` emits
   `harness=${CONCERTINO_HARNESS:-unknown}` and nothing in `bin/concertino`
   currently writes `CONCERTINO_HARNESS` into `.concertino.env`
   (`renderEnv` at `bin/concertino:460-488` has no such line today) — the bug is real
   and the fix surface named in the design/tasks is exactly where the gap is.

3. **`renderEnv` / `.concertino.env` render site confirmed** at `bin/concertino:460`,
   called from `cmdSync` (`:1394`) and `cmdInit` (`:1485`) — a single render per sync,
   consistent with design.md's claim that `.concertino.env` is shared across all
   configured harnesses (multi-harness projects genuinely can't get a correct
   per-run static value).

4. **`setup-worktree.sh` is verified byte-identical** between `core/scripts/` and
   `scripts/concertino/` in this worktree (`diff` of the two files → empty), and
   `docs/harness-capabilities.md:63-69` ("Everything that stays identical") confirms
   it's the one script both harnesses invoke — matches the design's premise that a
   single shared script is the correct place for runtime detection.

5. **Independently reproduced the design's core factual claim** (this is the load-bearing
   fact the whole design rests on, and the ticket explicitly asks for it to be verified,
   not guessed):
   - `env | grep -i claude` in this live session → `CLAUDECODE=1` is in fact set.
   - `strings /usr/lib/node_modules/@openai/codex/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex | grep CODEX_SANDBOX` →
     both `CODEX_SANDBOX` and `CODEX_SANDBOX_NETWORK_DISABLED` are genuinely embedded
     in the installed Codex CLI binary at `/usr/bin/codex` (a symlink into that package).
   Both of design.md's "Verified directly in this environment" claims (lines 20-26)
   check out independently — this is not hand-waved.

6. **`cmdValidate`'s "Integrations" section exists exactly as described**
   (`bin/concertino:1248-1255`), currently validating `harnesses` with
   `ok()`/`fail()`. The design's plan to add one more informational `ok()` line there
   (never a `fail()`) is a natural, minimal extension of existing code, not invented
   structure.

7. **`docs/config-reference.md`'s `harnesses` top-level row** (`:21`) is the natural
   home tasks.md 3.1 targets — the page already documents `concertino.config.json`
   fields including `harnesses`, and currently has zero mentions of `.concertino.env`
   contents, so extending this row/adding a short paragraph is coherent with the
   page's existing scope.

8. **`core/scripts/README.md`'s `.concertino.env` key list** (`:63-76`) is a real,
   existing enumeration tasks.md 3.2 targets — confirmed the section exists and is
   the right shape to extend with one more line.

9. **Spec deltas are scenario-based and testable** — read
   `specs/harness-identity/spec.md` in full; each of the 3 requirements has
   Given/When/Then-shaped scenarios (single/multi harness at sync time; Claude/Codex/
   neither at runtime; static/runtime resolution reported by validate) that a shell
   test can mechanically assert against actual `.concertino.env` content, actual
   `run.start` event output, and actual `validate` stdout.

10. **Existing test convention confirms tasks.md 5.1/5.2/5.3 are actually feasible**,
    not aspirational. `test/scripts/sync-core-resolution.test.sh` is the established
    pattern for testing `bin/concertino sync`'s rendering behavior via real CLI
    invocations against throwaway configs/dirs — exactly the mechanism task 5.1(a)
    would use for the static-default scenarios, and the wiring point in
    `package.json`'s `test` script (task 5.2) is a real, editable list.

11. **`VALID_HARNESSES = ['claude-code', 'codex']`** (`bin/concertino:1250`) confirms
    the closed two-value enum the design's non-goals rely on.

### Judgment on the substantive design questions

**(a) Undocumented third-party env vars — reasonable trade-off here.** The design
does not treat `CLAUDECODE`/`CODEX_SANDBOX` as authoritative in isolation: it only
*narrows* a value that already has a safe, honest fallback (static default →
`unknown`), never gates a build/failure on them, and the design doc explicitly
records the verification method and a mitigation for the "these vars get renamed"
risk. Given the ticket's own framing (an unknown-but-honest field beats a
confidently-wrong one), betting on a live signal that degrades gracefully to the
existing safe default is a sound trade, not a fragile one.

**(b) Is there a materially better alternative the design missed?** I considered
and reject the two most obvious candidates myself: (1) a config field for a human to
set the "active harness" — this is strictly worse (goes stale exactly the way the
ticket's own note warns against), and the design already names and rejects it for
that reason (Decision 3); (2) each harness's entry point exporting
`CONCERTINO_HARNESS` before invoking the shared script — also considered and
rejected with a concrete reason (every current and future entry point would have to
remember to do it; env-var sniffing needs zero entry points to cooperate). I don't
have a better alternative to offer beyond what's already in the doc.

**(c) Spec deltas — testable and consistent with the design.** Yes; verified above.
One precision gap: the spec has no scenario for the (rare, but real — e.g. Codex
invoked as a sub-agent from within Claude Code) case where *both* `CLAUDECODE` and
`CODEX_SANDBOX`-family vars are set simultaneously. The design's code sketch
resolves this implicitly (checks `CLAUDECODE` first), but the spec is silent on
priority. Non-blocking — the resolution order in design.md Decision 2 is
unambiguous enough for an implementer to follow, and this is an edge case outside
either of the two documented invocation paths — but worth a one-line scenario
addition during implementation for completeness.

**(d) Tasks.md completeness.** Complete and correctly scoped: it covers
`renderEnv`, `cmdValidate`, the shared script, three docs (`config-reference.md`,
`core/scripts/README.md`, `concertino.schema.json`), and — critically, since this
repo dogfoods itself — an explicit section 4 to re-run `concertino sync` in this
very worktree and verify the regenerated `.concertino.env` before calling the change
done. Section 5's test plan matches an established, already-working test pattern
in this repo rather than inventing new test infrastructure.

### Minor observations (non-blocking)

- AC bullet 4 ("`bin/concertino validate` accepts the new key") is reinterpreted by
  the design as an informational resolution-report line rather than literal
  acceptance of a new key — reasonable, since `cmdValidate` never reads
  `.concertino.env` content at all today (confirmed: no `.concertino.env` reads
  anywhere in `cmdValidate`), so there is no literal "key" for it to accept beyond
  what Decision 3 already argues against adding. The design explains this choice
  directly rather than hand-waving past the AC wording.
- `core/scripts/README.md`'s existing `.concertino.env` key list is already missing
  `CONCERTINO_LINK_MODULES` and `CONCERTINO_ESCALATION_TIMEOUT_MIN` (pre-existing
  drift, unrelated to this ticket). Out of scope for tasks.md 3.2 and fine to leave
  alone.
- This worktree's own `scripts/concertino/.concertino.env` doesn't currently exist
  (it's gitignored and wasn't copied by worktree creation) — expected, and exactly
  what tasks.md 4.1's `concertino sync` run will produce.

### Verdict: CONFIRM

The design directly engages the ticket's explicit honesty warning rather than
skirting it, its load-bearing factual claims (`CLAUDECODE`, `CODEX_SANDBOX`
presence) are independently reproducible and I reproduced them myself, the
static-default + runtime-override + `unknown`-fallback chain is the correct shape
given `.concertino.env` is rendered once and shared across harnesses, the
alternatives it rejects are genuinely worse (not straw men), the spec deltas are
scenario-testable, and the tasks breakdown matches the real code structure
(`renderEnv`, the `Integrations` section, the README env-key list, and the existing
`sync`-testing convention) closely enough to implement correctly on the first pass.
