## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

1. **Ground truth re-established.** Read `ticket.md`, `proposal.md`,
   `design.md`, `tasks.md`, `specs/cli-harness-flag/spec.md` fresh (not from
   the evaluator's summary). Read the full diffs of `lib/cli/shared.js`,
   `lib/cli/sync.js`, `lib/cli/diff.js`, `lib/cli/eject.js`, `lib/cli/help.js`,
   `README.md` via `git diff main...HEAD -- <files>` and confirmed the actual
   scope via `git diff 7443937...HEAD --stat` (the merge-base found by
   `main...HEAD` was a stale local `main` ref pointing at CON-98, three
   commits behind CON-84's actual parent (CON-99, `7443937`, already an
   ancestor of `HEAD`); diffing against the real parent shows this commit
   touches only `README.md`, `lib/cli/{diff,eject,help,shared,sync}.js`,
   `test/cli-shared.test.js`, `test/eject.test.js`, and the change's own
   `openspec/` artifacts — no scope creep, consistent with what the
   evaluator's report independently noted).

2. **Acceptance criteria traced to code.** The ticket's ask (unify
   `--harness` semantics: comma-list everywhere, `eject` acts on the list)
   is satisfied:
   - `lib/cli/shared.js` adds `parseHarnessList(raw, fallback)` — splits on
     `,`, trims, drops empty entries, validates against
     `['claude-code','codex','opencode']`, returns `{harnesses, error}`,
     never calls `process.exit` (matches Decision 1).
   - `sync.js`/`diff.js` both now call `parseHarnessList(args.harness,
     c.harnesses)` and exit non-zero with a named-bad-value error on
     failure (matches tasks 2.1/2.2, spec's "shared parsing/validation"
     requirement).
   - `eject.js` was rewritten: `renderForHarness(harness, role, c, out,
     core, meta)` returns rendered content or `null` (+ stderr note) for
     codex's narrower role set; `cmdEject` validates `--role` globally once
     (Decision 5a) before looping the harness list, printing raw content
     for a single named harness (byte-identical to pre-change, verified
     below) and `# ---- harness: <name> ----\n`-headered sections for a
     list of >1; exits non-zero only if the results list is empty.

3. **Re-ran the gates myself, fresh.**
   - `npm test` (full suite, from a clean invocation, ~1739 `node --test`
     cases across all suites plus 29 bash gate scripts): **1739 pass, 0
     fail** (`# tests 1739 / # pass 1739 / # fail 0`).
   - `node --test test/eject.test.js test/cli-shared.test.js` in isolation:
     **17/17 and unit tests all pass**, including the 5.4a/5.4b
     single-vs-multi-harness "unknown role fires exactly once" pair, the
     codex-skip-but-continue case, and the `bogus`-harness rejection across
     all three commands.
   - `bash test/scripts/opencode-render.test.sh`: **25/25 pass**, including
     the pre-existing `eject --harness=opencode --role=$role` calls this
     change's design explicitly promised not to break (task 5.7) — confirmed
     unmodified and green.
   - Manual reproduction of task 6.2: ran
     `node bin/concertino eject --role=executor
     --harness=claude-code,codex,opencode --out=<tmp>` against
     `config/examples/generic.json`. Output has three sections, headers at
     the correct byte offsets (`# ---- harness: claude-code ----` at
     offset 0, then `codex`, then `opencode`, each containing
     harness-appropriate content — TOML for codex, `mode: subagent` for
     opencode, YAML frontmatter for claude-code). Matches Decision 4 and
     the spec's "eject renders multiple harnesses" scenario.
   - Independently verified byte-for-byte single-harness parity:
     `eject --role=executor` (bare) vs. `eject --role=executor
     --harness=claude-code` produce identical stdout with no header, per
     `test/eject.test.js`'s own assertion, which I ran myself rather than
     trusting the evaluator's claim.

4. **Docs updated as specified.** `lib/cli/help.js`'s `eject` usage line
   now reads `[--harness=claude-code[,codex,opencode]]` with a description
   of the header behavior (verified via `--help` output, not just the diff).
   `README.md`'s eject line uses `claude-code,codex,opencode` to match
   sync/diff's phrasing — the bracket-vs-comma divergence between the two
   docs is intentional and separately specified by tasks 4.1/4.2, not an
   inconsistency.

5. **Design-soundness history checked.** `skeptic-design-1.md` REFUTEd an
   earlier draft (the 5a/5b role-validation conflation); `skeptic-design-2.md`
   CONFIRMed the revision. The shipped code (`eject.js`'s `meta.roles[role]`
   global check happening once before the harness loop, separate from
   `renderForHarness`'s codex-only per-harness skip) matches the confirmed
   design, not the refuted draft.

6. **Independently found the same minor ordering note the evaluator
   flagged** (not trusting their narrative, but confirming it by reading the
   diff myself): `cmdEject` now validates `--harness` (via
   `parseHarnessList`) before the `!exists(cfgPath)` check, whereas
   previously an invalid-harness error could only surface after the
   config-exists check. Neither the ticket, design, nor spec.md specifies
   precedence between "no config" and "unknown harness" errors, and no test
   depends on the old ordering — genuinely non-blocking, not a regression
   against any stated requirement.

### No UI review applicable

This is a CLI-only change; no design standard is configured for this project
per the task instructions (N/A).

### Verdict: CONFIRM

The implementation satisfies the ticket's stated intent (unify `--harness`
parsing across `sync`/`diff`/`eject`, give `eject` real multi-harness
capability) and every requirement/scenario in
`specs/cli-harness-flag/spec.md`, traced to specific code and independently
re-verified by running the tests and the CLI myself rather than trusting the
evaluator's or executor's claims. No scope creep once the stale local `main`
ref artifact is accounted for. All gates re-run clean.

### Non-blocking notes

- Same ordering observation as evaluation-1.md: `--harness` validation in
  `cmdEject` now runs before the config-existence check. If that ordering is
  meant to be permanent, a one-line comment would keep a future refactor
  from silently reordering it back.
