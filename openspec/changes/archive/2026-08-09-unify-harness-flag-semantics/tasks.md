## 1. Shared helper

- [x] 1.1 Add `parseHarnessList(raw, fallback)` to `lib/cli/shared.js`:
      splits `raw` on `,`, trims each entry, drops empty entries, validates
      against `['claude-code', 'codex', 'opencode']`, and returns
      `{ harnesses, error }` (never calls `process.exit` itself — see
      design.md Decision 1).

## 2. Wire `sync`/`diff` through the shared helper

- [x] 2.1 `lib/cli/sync.js`: replace `args.harness ? args.harness.split(',')
      : c.harnesses` with a `parseHarnessList(args.harness, c.harnesses)`
      call; on `error`, `console.error(red('error: ') + error)` and
      `process.exit(1)` before any output/side effect, matching `sync`'s
      existing error-handling convention.
- [x] 2.2 `lib/cli/diff.js`: same replacement, same error handling, using
      `c.harnesses` as the fallback.

## 3. Wire `eject` through the shared helper and add list support

- [x] 3.1 `lib/cli/eject.js`: replace `args.harness || 'claude-code'` with
      `parseHarnessList(args.harness, ['claude-code'])`; on `error`, same
      error-handling convention as sync/diff.
- [x] 3.2a Validate `--role` once, globally, upfront — before iterating the
      harness list at all — against the fixed 5-role set
      (`orchestrator`/`executor`/`evaluator`/`skeptic`/`auditor`, i.e.
      `meta.roles` from `adapters/claude-code/agents.json`). On an invalid
      role, print the existing "unknown role" error and `process.exit(1)`
      immediately, exactly once, regardless of how many harnesses were named
      (design.md Decision 5a — do NOT route this check through the
      per-harness skip-and-continue mechanism in 3.2b, which is reserved for
      codex's narrower, harness-specific role support).
- [x] 3.2b Refactor the existing single-harness if/else-if render logic (the
      `claude-code`/`codex`/`opencode` branches, now reached only with an
      already-globally-valid `--role` from 3.2a) into a per-harness render
      function returning the rendered string (or `null` + a stderr note
      strictly for codex's narrower role restriction — the existing "codex
      harness only has executor, evaluator, and auditor" check moves here
      unchanged; `claude-code`/`opencode` never return `null` here, since
      3.2a already ruled out an invalid role for them).
- [x] 3.3 Loop the parsed harness list through that per-harness render
      function, collecting each non-null result.
- [x] 3.4 When exactly one harness was named (explicit or defaulted) AND it
      produced output, print that output raw, with no header — must be
      byte-for-byte identical to today's output for every existing
      single-harness call (verified by task 5.2/5.3 below).
- [x] 3.5 When more than one harness was named, print each non-null result
      preceded by `# ---- harness: <name> ----\n`, in list order.
- [x] 3.6 If the collected results are empty (every harness in the list was
      unsupported for the requested role), print nothing to stdout and
      `process.exit(1)` — matching today's single-harness-unsupported-role
      behavior.

## 4. Docs

- [x] 4.1 `lib/cli/help.js`: update the `eject` usage line's
      `[--harness=claude-code|codex|opencode]` to
      `[--harness=claude-code[,codex,opencode]]`, and extend the description
      to mention that multiple harnesses print one section per harness with
      a `# ---- harness: <name> ----` header.
- [x] 4.2 `README.md`: update the `concertino eject` usage line the same
      way, matching `sync`/`diff`'s existing `--harness=claude-code,codex,
      opencode` phrasing style.

## 5. Tests

- [x] 5.1 Unit tests for `parseHarnessList` in `lib/cli/shared.js`: valid
      single value, valid comma list, list with whitespace around commas,
      trailing comma, one invalid entry, multiple invalid entries (all named
      in one error), empty `raw` falls back to the given fallback array.
- [x] 5.2 Subprocess test (pattern: `test/cli-help-flags.test.js`'s
      `execFileSync` against `bin/concertino`) — `eject --role=executor` (no
      `--harness`) and `eject --role=executor --harness=claude-code` both
      still produce identical stdout to a saved baseline (or to each other),
      confirming byte-for-byte no regression on the default/single-value
      path.
- [x] 5.3 Subprocess test — `eject --role=executor --harness=claude-code,
      opencode` produces two sections, each with its own `# ---- harness:
      ---- ` header, containing the expected per-harness content markers
      (e.g. `# concertino:sync` frontmatter for claude-code, opencode's own
      header shape).
- [x] 5.4 Subprocess test — `eject --role=skeptic --harness=codex,claude-code`
      prints the codex "only has executor, evaluator, and auditor" stderr
      note, prints only the claude-code section (with a header, since two
      harnesses were named) to stdout, and exits 0.
- [x] 5.4a Subprocess test — `eject --role=bogus --harness=claude-code,opencode`
      (a role invalid for every named harness, not a codex-specific
      restriction) prints exactly one "unknown role" error, no per-harness
      duplication, no stdout output, and exits non-zero — proving 3.2a's
      upfront check fires instead of 3.2b's per-harness skip path.
- [x] 5.4b Subprocess test — `eject --role=bogus --harness=codex` (single
      harness, globally-invalid role) also produces exactly one "unknown
      role" error, identical in shape to 5.4a's multi-harness case —
      confirming 3.2a's check is harness-count-independent.
- [x] 5.5 Subprocess test — `eject --role=skeptic --harness=codex` (single
      harness, codex-specific unsupported role) exits non-zero with no
      stdout output, printing the codex-specific stderr note — unchanged
      from today.
- [x] 5.6 Subprocess test — `eject --harness=bogus`, `sync --harness=bogus`,
      and `diff --harness=bogus` (project root fixture) each exit non-zero
      with an error naming `bogus` and the valid set, and (for sync/diff)
      write no files.
- [x] 5.7 Confirm `test/scripts/opencode-render.test.sh`'s existing `eject
      --harness=opencode --role=$role` invocation still passes unmodified
      (no test-script change needed if task 3.4 is correct).

## 6. Verification

- [x] 6.1 Run the full test suite (`npm test`) and confirm no regressions,
      in particular `test/completion.test.js` (completion.js is
      intentionally untouched — see design.md Decision 6) and
      `test/cli-help-flags.test.js`.
- [x] 6.2 Manually run `concertino eject --role=executor --harness=claude-code,codex,opencode`
      against a real example config (`config/examples/*.json`) and visually
      confirm all three sections render sensibly.
