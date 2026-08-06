## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

1. **"Ten call sites" claim** — grepped `lib/cli/*.js` for the pattern
   `args.config ? path.resolve(args.config) : path.join(out, 'concertino.config.json')`
   and its `out` companion. Confirmed present, byte-identical (modulo local
   variable name), in exactly the ten files named: `sync.js`, `diff.js`,
   `eject.js`, `update.js`, `gates.js`, `doctor.js`, `watch.js`, `validate.js`,
   `prune.js`, `migrate.js`. No other `lib/cli/*.js` file (`completion.js`,
   `emit.js`, `help.js`, `render.js`, `resolve-core.js`, `shared.js`) contains
   the pattern.

2. **Scope boundaries (`init.js`/`upgrade.js`/`answer.js`)** — read each:
   - `init.js` line 288: `const cfgPath = path.join(out, 'concertino.config.json');`
     — unconditional, no `args.config` branch at all. Genuinely a different
     rule, correctly excluded.
   - `upgrade.js` line 9: only `const out = path.resolve(args.out || '.');`,
     no `cfgPath` line anywhere in the file. Correctly excluded.
   - `answer.js` line 65: `const root = path.resolve(flags.out || '.');` —
     uses a `flags` object (not `args`) and a `root` variable (not `out`), and
     has no `cfgPath` at all. Correctly excluded — matches design.md's "only
     out resolution, no cfgPath at all, or neither" framing, and the ticket's
     own "ten of thirteen" scoping (proposal.md line 47-48).
   These boundaries are justified by actual code differences, not asserted
   without checking.

3. **Helper design sensibility** — confirmed `lib/cli/shared.js` currently
   exports `REPO, ADAPTERS, DEFAULT_ESCALATION_TIMEOUT_MIN, VERSION, TTY,
   bold, dim, cyan, green, yellow, gray, blue, red, banner, section, read,
   exists, write, copy, bt, readRoleFile, findAdded, parseArgs` — no existing
   `resolveOut`/`resolveConfigPath` name collision (grepped repo-wide, zero
   hits outside the new design docs). All ten target files already
   `require('./shared')` with destructured named imports (verified each),
   so adding two more names to each destructuring list is the only wiring
   change needed — matches design.md Decision 2's claim exactly.

4. **`doctor.js`'s "out used later" caveat (tasks.md 2.6)** — grepped `out`
   usage in `doctor.js`: the local `out` from line 260 is read in at least
   nine downstream call sites (lines 317, 321, 339, 341, 342, and inside
   `checkArtifacts`/`checkBaseBranch`/`checkAgentMerge`). Assigning
   `resolveOut(args)`'s return value to the same local `out` name preserves
   all of these untouched — the caveat is real and the mitigation (keep the
   local variable, only replace the RHS) is correct and sufficient.

5. **Regression-check credibility (design.md Risk 2 / tasks.md 3.2)** —
   `test/validate.test.js` and `test/watch.test.js` invoke the actual CLI
   binary with both `--config=<path>` and `--out=<dir>` flags set to
   independent temp directories (e.g. `validate.test.js:42`,
   `watch.test.js:3581-3625`). These tests exercise the resolution logic
   through the real binary, not through a mock — "run the existing test
   suite" is a meaningful regression check for this refactor, not a rubber
   stamp.

6. **Ticket/proposal/design/spec consistency** — cross-read `ticket.md`,
   `proposal.md`, `design.md`, `tasks.md`, and
   `specs/cli-config-path-resolution/spec.md`. No contradictions: the two
   helper names, signatures, and precedence rule (`args.config` wins,
   else `<out>/concertino.config.json`) match across all five documents.
   `docs/cli-audit-2026-08.md` finding 7 (the ticket's cited source) also
   matches — same file list, same "verified byte-identical" claim, same
   ticket cross-reference (CON-87).

7. **No placeholders / deferred decisions** — `design.md` contains three
   explicit Decisions (helper count, location, signature) each with an
   alternative considered and a stated reason for rejection — no `TODO`/`TBD`
   found in any of the five artifact files.

8. **AC coverage** — all four `ticket.md` ACs map onto concrete tasks:
   helper extraction → tasks 1.1-1.3; all ten call sites switched → tasks
   2.1-2.10; behavior unchanged → task 3.3 (manual before/after check) plus
   the regression suite (task 3.2, item 5 above); no new dependencies → not
   contradicted anywhere (helpers are pure `path.resolve`/`path.join`
   wrappers around existing `fs`/`path` requires already present in
   `shared.js`).

### Verdict: CONFIRM

The plan is sound, complete, and traceable to ground truth. The "ten call
sites" claim, the `init.js`/`upgrade.js`/`answer.js` scope exclusions, and
the helper design (location, signature, two-helper split) all check out
against the actual repo files — no hand-waving, no contradiction between
proposal/design/tasks/spec, and every ticket AC has a corresponding task.

### Non-blocking notes

- `answer.js`'s `flags.out` line is textually similar to `resolveOut`'s
  target pattern (same `path.resolve(x.out || '.')` shape, different object
  name). Folding it in would be a natural follow-on but is correctly out of
  ticket scope here — flagging only so it isn't lost as a future finding, not
  as a requirement of this change.
