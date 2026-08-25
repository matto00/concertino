## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed commit `5465e0e` (single-commit diff `HEAD^..HEAD`; `HEAD^` is
`fb914c4` CON-140, which is not yet on `main` — so `git diff main...HEAD`
shows CON-140's files too. All findings below are scoped to `HEAD^..HEAD`).

### What I verified (with evidence)

**1. Ground-truth CLI surface (re-derived, not read from the audit)**
- `openspec --version` → `1.2.0`; `readlink -f $(which openspec)` →
  `/usr/lib/node_modules/@fission-ai/openspec/bin/openspec.js`.
- `openspec validate --help` → `Usage: openspec validate [options] [item-name]`,
  options `--all --changes --specs --type <type> --strict --json --concurrency
  --no-interactive`. **No `--change`.** The fix's form
  (`validate "<NAME>" --type change`) is exactly right.
- I also ran `--help` for `status`, `instructions`, `archive`, `new`, and the
  root command. `status --change <id>`, `instructions [artifact] --change <id>`,
  `archive [change-name] -y/--yes/--skip-specs` all exist. So `validate --change`
  was genuinely the only broken invocation — the audit's "correct-as-written"
  verdicts hold.
- `npm view @fission-ai/openspec dist-tags` → `latest: '1.10.0'`. The stated-version
  note's "npm latest has since moved to 1.10.0" is accurate as of today.

**2. AC1 — every `openspec` invocation matches the real surface, including the render path**
- `grep -rn 'openspec ' core/ adapters/ lib/`: post-fix, `core/roles/orchestrator.md`
  has only `openspec validate <CHANGE_NAME> --type change` (×2) and
  `openspec archive <CHANGE_NAME> --yes[ --skip-specs]` (×3), plus prose mentions.
- The Planning-step invocation is *not* authored in core — it is injected by
  `lib/cli/render.js:75` from `sp.validateCmd`. I checked all four sources of that
  value: `render.js`'s hardcoded fallback, `lib/cli/init.js:132` (scaffold),
  `config/examples/helio.json`, `config/examples/concertino.json`. All four fixed.
- I rendered a real sync and read the output: the Planning block emits
  `openspec validate "<CHANGE_NAME>" --type change`, and `grep -c 'validate --change'`
  on the rendered orchestrator is **0** (base had 4). **AC1 met.**

**3. AC2 — the gate demonstrably goes red. I re-derived it from scratch,
independently of `validate-gate-demonstration.md`.**
Built a throwaway `openspec init --tools none` project, hand-authored a
malformed change (spec with no `## ADDED Requirements` delta header) and a
well-formed one:
- `openspec validate "malformed-demo" --type change` → `Change 'malformed-demo'
  has issues` + two `[ERROR]` lines, **rc=1**.
- `openspec validate "wellformed-demo" --type change` → `is valid`, **rc=0**.
- `openspec validate --change wellformed-demo` → `error: unknown option '--change'
  (Did you mean --changes?)`, rc=1 — a *parse* error, identical regardless of
  change validity. That is the defect, confirmed.

My output matches `validate-gate-demonstration.md` §1–§3 **verbatim**, including
the full error text and the "Did you mean --changes?" hint. The doc is a real
transcript, not a reconstruction. **AC2 met.**

**4. AC3 — does not trigger, and the docs' change is the right one.**
`validate` reports failure honestly through exit status (rc=1 malformed / rc=0
well-formed, proven above). It does not share `archive`'s exit-0-on-abort defect,
so a stdout assertion is not required. The render text changed from the vague
"fix any errors first" to "**must exit zero before proceeding**", and both
core-authored call sites from "re-run ... clean" to "**until it exits zero**".
That is an exit-status assertion, which is the correct instrument here. **AC3
satisfied (vacuously, with the vacuity proven).**

**5. AC4 — the stated-version note is actionable, not decorative.**
`core/roles/orchestrator.md:471-476`, rendered at the head of Phase 1 step 3:
it names the target version, names npm `latest`, and gives a concrete decision
rule — "If `openspec <cmd> --help` ever disagrees with a command documented
here, trust `--help`, do not guess, and file a follow-up ticket rather than
improvising a flag." That is an executable instruction with a defined tiebreaker
and a defined non-improvisation escape hatch. **AC4 met.**

**6. The regression test is genuinely capable of failing — I mutation-proved
every assertion myself rather than trusting the recorded transcript.**
Working on a scratch copy of the worktree, `test/scripts/openspec-validate-cmd.test.sh`:

| Mutation | Result |
| --- | --- |
| Revert `config/examples/helio.json` `validateCmd` to `--change` | `a.3` FAIL, `a.4` FAIL, exit 1 |
| Revert **one** authored inline occurrence in `core/roles/orchestrator.md` (a location *not* fed by `validateCmd`) | `a.4` FAIL, exit 1 |
| Revert `lib/cli/init.js` | `b.1` FAIL, `b.2` FAIL, exit 1 |
| Stub `bin/concertino` to exit 0 writing nothing (silent no-op render) | `a.2` FAIL, `a.3` FAIL, exit 1 |
| Stub `bin/concertino` to exit 3 | `a.1` FAIL, `a.2` FAIL, `a.3` FAIL, exit 1 |

All 6 assertions have a demonstrated failing arm. Specifically on the concerns raised:
- It renders a **real** sync (`node bin/concertino sync --out=$OUT ...`, **no**
  `--dry-run`) into an `mktemp -d`, never this checkout.
- The exists-before-absence precondition (`a.2`) is **load-bearing and works**:
  in the no-op-render mutation, `a.4`/`b.*` still went green (negated `grep -qF`
  is vacuously "ok" against a missing file) and only `a.2`/`a.3` caught it. Without
  `a.2` that mutation would have reported 4-of-4 green. This is the exact
  evidence-shaped-non-evidence trap the ticket exists about, and the test closes it.
- `a.4`'s absence assertion is a whole-file `grep -qF "validate --change"` on the
  rendered orchestrator, so it covers all 4 base occurrences and any future one,
  from any source — core-authored or `validateCmd`-injected. Confirmed by the
  second mutation (a core-authored line, not the config line, tripped it).
- `a.4` does not false-positive on the legitimate `instructions apply --change`
  / `status --change` strings, because it matches the two-token `validate --change`.

**7. Gate re-run myself.** First `npm test` returned exit 144 with no captured
output; per re-run discipline I re-ran it to a file rather than concluding —
**RC=0**, full suite green, including the new
`openspec validate command surface (CON-130) — 6 passed, 0 failed`. The 144 was
`SIGPIPE` from my own `| tail`, i.e. measurement instability, not a failure.
Also `openspec validate "fix-openspec-validate-cli-syntax" --type change` → *is
valid*, rc=0 — this change's own artifacts pass the gate it fixes.

**8. Iron Laws.** Root cause is probe-confirmed (`--help` output, captured
verbatim in `openspec-cli-audit.md` and reproduced by me), not inferred. The
regression test exercises the fixed path and I proved it goes red. The audit's
help transcripts match my independent runs character-for-character.

**9. Scope discipline.**
- `git diff HEAD^..HEAD --name-only` outside the change dir is exactly 9 files:
  the 2 example configs, `core/roles/orchestrator.md`, `docs/config-reference.md`,
  `lib/cli/init.js`, `lib/cli/render.js`, `openspec/specs/followup-triage/spec.md`,
  `package.json`, and the new test. Nothing else.
- `core/scripts/cleanup.sh` — **untouched** (0 hits).
- `concertino.config.json` — absent and untracked; **not created**.
- `openspec/changes/archive/**` — **untouched** (0 hits).
- CON-140's turn-discipline content in `core/roles/orchestrator.md` — intact.
  `git diff fb914c4..HEAD -- core/roles/orchestrator.md` removes exactly 4 lines,
  all of them the two broken `validate --change` invocations and their trailing
  "clean," continuations. No CON-140 prose disturbed.
- Fix lands in source-of-truth files (`core/`, `lib/`, `config/examples/`), so it
  survives `concertino sync` — verified by rendering and reading the output.
- No UI, no servers, no Playwright (correctly — this repo has none).

### Verdict: CONFIRM

### Non-blocking notes

1. `core/roles/orchestrator.md:589` is 91 chars, against the file's consistent
   ~77-char wrap ("...`CONFIRM` (same procedure"). Cosmetic reflow.
2. `openspec-cli-audit.md` pastes verbatim `--help` for `validate`,
   `instructions`, and `archive`, but not for `status` — even though
   `lib/cli/render.js:77` injects `openspec status --change`. I verified it
   independently (`--change <id>` is real), so nothing is wrong; the audit is
   just one command short of exhaustive on the render-injected set.
3. **Downstream, out of this repo's scope:** helio's own
   `concertino.config.json:19` still holds `"openspec validate --change ..."`,
   and its already-rendered `.claude/agents/concertino-orchestrator.md` still
   carries 4 broken occurrences. This fix corrects the *examples* and the
   *scaffold*, which is the right boundary for the concertino repo — but every
   existing consumer needs a config edit + `concertino sync` before it actually
   benefits. Worth a follow-up ticket (or a `doctor` check that flags a
   `validateCmd` the installed CLI would reject).
4. Pre-existing (base, not introduced here): the `{{block:specArtifacts}}`
   substitution at the fold-in call site splices a fenced code block into the
   middle of a sentence, rendering as "```` ``` ```` — this design ticket never
   ran step 3 above". Reads awkwardly; unrelated to this fix.
