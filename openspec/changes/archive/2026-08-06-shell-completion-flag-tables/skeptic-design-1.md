## Skeptic Report — design gate (round 0, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/cli-shell-completions/spec.md`, `.openspec.yaml`,
  `workflow-state.md` in full.
- Read the actual file the change targets, `lib/cli/completion.js` (78
  lines, all three shell branches), plus `lib/cli/prune.js`, `eject.js`,
  `migrate.js`, `answer.js`, `watch.js` to independently confirm the flags
  each command actually accepts (no hidden flags the design missed:
  `eject` also takes `--core`, but that's an existing gap shared by
  `sync`/`diff`/`init` too and out of this ticket's scope — consistent,
  not a new omission).
- Confirmed the hard-coded role list decision
  (`orchestrator executor evaluator skeptic auditor`) matches
  `adapters/claude-code/agents.json`'s actual `roles` keys via a one-off
  `node -e` read.
- Confirmed the claimed existing conventions (`--harness`/`--example`
  hard-coded value lists in fish/zsh/bash; `gates --run`'s free-form
  no-value-list pattern) are real by reading `completion.js` directly —
  design.md's factual claims about the current file are accurate **except
  for one**, below.
- Ran `node bin/concertino completion zsh` directly to check the Non-Goal
  claim that `watch`'s `--config`/`--out` are "already completed globally
  in all three shells." Output:
  ```
  else case $words[2] in
    sync|update) _arguments ... ;;
    diff) _arguments ... ;;
    validate|doctor|upgrade) _arguments ... ;;
    init) _arguments ... ;;
    gates) _arguments ... ;;
    completion) _arguments ... ;;
  esac; fi
  ```
  There is no `*)` default branch and no `watch` entry. `_arguments` (the
  only place `--out=[...]:dir:_files` and `--config=[...]:file:_files` are
  registered) is never invoked when `$words[2]` is `watch` — zsh currently
  offers **zero** flag completion for `watch`, not even `--out`/`--config`.
  This is unlike fish, where the `--out`/`--config` `complete` lines carry
  no `-n` predicate and are genuinely global (confirmed by reading the fish
  branch), and unlike bash, where the flag-name `case "$prev"` switch is
  keyed only on the previous token, not the subcommand, so it's genuinely
  global there too. The claim is true for fish and bash but **false for
  zsh**, and I re-ran the command a second time to rule out a fluke — same
  output both times.
- Traced every AC in `ticket.md` against `tasks.md` and `spec.md`: fish
  (1.1–1.4), zsh (2.1–2.4), bash (3.1–3.3) each map to a task; the
  "existing commands unchanged" AC maps to `spec.md`'s third requirement.
  No placeholders/TBDs found anywhere in the planning set.
- Checked codebase convention for verification tasks by reading three
  prior archived changes' `tasks.md`
  (`2026-07-29-plumb-harness-through-sync`,
  `2026-08-01-fix-cleanup-sh-comment-drift`,
  `2026-07-29-stale-base-warning-delivery-gate`): every one of them that
  adds real conditional/behavioral logic (not a pure comment-text sync)
  includes a dedicated automated-test task, wired so `npm test` exercises
  it. `node --test` (the first clause of this repo's `test` script)
  auto-discovers any `test/*.test.js` file, so a new `test/completion.test.js`
  would need no separate wiring step — but no such task exists here.
  `tasks.md` §4 ("Verification") only has a one-time **manual** diff
  (4.1) and "run the suite" (4.2), which exercises the pre-existing suite,
  not anything asserting the new per-command flag entries or protecting
  the "existing behavior unchanged" spec requirement against regression.

### Verdict: REFUTE

### Change Requests

1. **`design.md`'s Non-Goals / `tasks.md` incorrectly skip a `watch` zsh
   entry.** `design.md`'s Non-Goals section states `watch`'s flags "are
   already completed globally in all three shells; adding a
   `watch`-scoped block would be a no-op." This is false for zsh — see
   evidence above; zsh's `args_map`/`case $words[2]` mechanism has no
   default branch, so `watch` currently gets no flag completion at all
   in zsh, unlike fish and bash where the global claim does hold. Add a
   `watch` entry to zsh's `args_map` (task 2.x) offering `--out`/`--config`
   only, mirroring the `validate|doctor|upgrade` pattern (`'"--out=[project
   root]:dir:_files -/" "--config=[config path]:file:_files"'`), and correct
   `design.md`'s Non-Goals bullet and `ticket.md`'s parenthetical
   ("already covered globally") to note this is shell-specific: true for
   fish/bash, false for zsh pre-change. Leaving this unfixed means the
   change ships an inconsistency it explicitly claims not to have — `watch`
   completes worse than `validate`/`doctor`/`upgrade` in zsh even after
   this ticket lands, with no task tracking it.

2. **`design.md`'s bash decision for `--sub`/`--total` isn't reflected in
   `tasks.md`.** `design.md`'s Decisions section states `answer`'s
   `--sub`/`--total` should be completed in bash via `COMPREPLY=()`
   "matching how `gates --run` ... is already completed" — i.e. an
   explicit `--sub|--total) COMPREPLY=() ;;` case in the `case "$prev"`
   switch, parallel to the existing `--run) COMPREPLY=() ;;` line. But
   `tasks.md` §3 (bash) only has 3.1 (add `--role`/`--sub`/`--total` to
   the flag-*name* catch-all) and 3.2 (`--role` value case) — no task adds
   a `--sub`/`--total` value-position case. Without it, typing
   `answer T V --sub <TAB>` falls through to the `*)` catch-all and
   suggests every flag name (`--out --config --dry-run --harness --run
   --yes --example --role --sub --total`) as a completion for the *value*
   of `--sub`, contradicting the free-form/no-suggestion behavior the
   design doc commits to and the `--run` precedent it cites. Add a task to
   §3 making this explicit (or drop the design decision if `COMPREPLY=()`
   for these two flags is not actually wanted — but as written, design and
   tasks disagree on bash's user-facing behavior for `--sub`/`--total`,
   and an implementer following only tasks.md will produce output that
   contradicts design.md).

3. **No automated regression coverage planned for the new behavior or for
   the "existing completion behavior unchanged" spec requirement.**
   `spec.md`'s "existing completion behavior unchanged" requirement (with
   its own scenario) currently has only a one-time manual diff (task 4.1)
   protecting it — there is no test that would catch a future regression
   (e.g. an unrelated edit to `completion.js` accidentally dropping the
   `sync|update` entry, or one of this ticket's own new entries silently
   breaking later). This is inconsistent with this repo's own convention:
   every archived change I sampled that adds real conditional logic (not
   a pure comment-text sync) added a dedicated automated test task (e.g.
   `2026-07-29-plumb-harness-through-sync` task 5.1,
   `2026-07-29-stale-base-warning-delivery-gate`'s entire §2). Add a task
   under `tasks.md` §4 to add `test/completion.test.js` (auto-discovered
   by `node --test`, no `package.json` wiring needed) asserting, for each
   shell, that the generated output (a) contains the new
   `prune`/`eject`/`migrate`/`answer` flag entries and the five exact role
   names, and (b) still contains the pre-existing
   `sync`/`diff`/`init`/`gates`/`completion` entries verbatim (or at least
   the specific substrings that matter), so `npm test` — not a one-time
   manual diff — is what protects the "unchanged" requirement going
   forward.

### Non-blocking notes

- `docs/cli-audit-2026-08.md` finding 5's recommendation text ("Ticket:
  CON-86") and finding 6's cross-reference are consistent with this
  change's scope; task 4.3's "if the doc tracks per-finding status" is
  correctly hedged — the doc is a static point-in-time audit report with
  no live status field, so no action is required there.
- The zsh `args_map`'s existing pattern groups related commands under one
  `pat) ...` key (e.g. `validate|doctor|upgrade`); tasks.md doesn't
  prescribe whether `prune`/`migrate` (both `--dry-run`-only) should share
  a key — this is a reasonable implementation-detail freedom, not a design
  gap.
