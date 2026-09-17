## Context

See proposal.md — Why. Three facts about the current tree shape every decision
below, and all three were established by probe rather than assumption.

1. **The auditor runs in a worktree that has no configuration.** Verified on
   this run's own worktree: the 30 tracked `scripts/concertino/*.sh` are
   present, but `.concertino.env`, `speeds.json`, `concertino.config.json` and
   `AGENTS.md` are all absent (`.gitignore` lines 5, 10, 18; both
   `worktree.linkModules` and `worktree.envFiles` are `[]`). Every existing
   script that wants config does `[ -f "${SCRIPT_DIR}/.concertino.env" ] &&
   source ...` — a conditional whose false branch is silent, so in a worktree
   these all fall back to defaults without complaint.
2. **Main-checkout resolution is the established precedent for exactly this.**
   `check-merge-readiness.sh:208-222` already carries a `main_checkout()`
   helper (`git rev-parse --git-common-dir`, then `dirname`), copied rather
   than sourced, to read the run's event log for condition 3. The in-file
   comment states the convention explicitly: every procedure script in this
   suite stays standalone.
3. **`agentMerge`'s schema block is `additionalProperties: false`** with only
   `enabled` and `mergeMethod`, so `protectedPaths` is *rejected* today rather
   than ignored. The schema widening is load-bearing, not cosmetic.

## Goals / Non-Goals

**Goals:**

- One deterministic, script-level condition whose result the auditor cannot
  influence, added to the place the other pre-merge conditions already live.
- A byte-for-byte unchanged outcome for every project that does not set the
  field.
- A refusal that is mechanically distinguishable from the existing refusals, so
  the orchestrator/auditor can route it without parsing prose.

**Non-Goals:**

- Per-path *approval* (a human approving one protected path and not another).
  The outcome is binary: touched, or not.
- Any change to `check-pr-mergeable.sh`. CON-207 reports it returning `PASS` on
  an empty `statusCheckRollup`; this change must not build on that predicate,
  and equally must not quietly fix it.
- Retiring the consuming repo's local workaround (that repo is not in scope).
- Making `protectedPaths` meaningful outside agent-merge. A human merging by
  hand is exactly the intended escape hatch, not a loophole to close.

## Decisions

### Decision 1: Delegate glob matching to git's `:(glob)` pathspec, not a shell matcher

`check-gate-chain-change.sh` establishes the house style for "which changed
paths match a pattern": enumerate changed paths, `case`-match each, print one
tagged line per match, end with a terminal `GATECHAIN yes|no`. I will reuse its
*output* shape (Decision 4) but **not** its matcher.

Measured, on a throwaway repo:

| pattern | bash `case` | `git ... -- ':(glob)<pat>'` |
| --- | --- | --- |
| `record/**` vs `record/nested/deep/c.md` | matches — but only because `*` crosses `/` | matches, per-segment `**` |
| `scripts/check-*.sh` vs `scripts/nested/check-bar.sh` | matches (wrong — `*` crossed `/`) | does not match |
| `CHARTER.md` vs `docs/CHARTER.md` | `*CHARTER.md` over-matches | does not match; root-anchored |

In bash `case`, `*` spans `/`, so `record/**` and `record/*` collapse to nearly
the same pattern and `scripts/check-*.sh` silently over-matches into
subdirectories. Getting the ticket's own three example globs right with `case`
would mean hand-rolling segment-aware matching — new, untested, and exactly the
kind of bespoke predicate this project has been burned by. Git already
implements it.

**Honest note on the measurement:** my first probe of the `case` behavior
reported a *non-match* for `scripts/check-*.sh`, which was an artifact of my own
quoting (a quoted `case` pattern does not glob). A positive control with the
pattern unquoted matched correctly. The table above reflects the corrected
runs. This is recorded because a zero-hit probe that is really a quoting bug is
the precise failure this repo's own guidance warns about.

Alternatives considered: a Node one-liner using `minimatch` (adds a runtime
dependency to a shell script that deliberately has none, and
`check-gate-chain-change.sh`'s embedded `node -e` reads the husky hook rather
than matching globs); `find`-based matching (`find` here is `bfs`, not GNU
findutils — already a known trap in this environment).

### Decision 2: Read the glob list from the main checkout, and never accept it as an argument

Acceptance criterion 4 requires a check "the Auditor cannot satisfy by
assertion". That rules out the two mechanisms that look natural:

- **A `{{var:}}`-rendered script argument.** Role templates *are* substituted,
  and `getVar` would comma-join an array cleanly, so this would work
  mechanically. But a list the auditor passes is a list the auditor can pass
  empty. The prose would say "pass the configured globs"; a prose instruction
  is precisely the enforcement strength this ticket exists to escape.
- **A worktree-local `.concertino.env` variable.** Per Context fact 1, that
  file does not exist in a worktree. The guard would read an empty list and
  pass — failing open in the one place it must hold. It would also be
  invisible: the run would look green.

So the script resolves the main checkout itself (Context fact 2) and reads
`concertino.config.json` there. Parsing: `node -e` with `JSON.parse`, matching
`check-gate-chain-change.sh`'s existing precedent of embedding a small `node`
program inside a procedure script, rather than adding a `jq` dependency for
structured config reads.

The fourth positional argument stays `ARCHIVE_PREFIX`; no new argument is
added, which is itself part of the guarantee — there is no parameter to abuse.

**[Added at final gate round 4, self-caught by the executor before sending
to the skeptic — a regression in the round-3 fix, not a new skeptic
finding.]** Round 3 (Decision 3 below) made condition 4 resolve
`isPlainRelativeGlob` via `require(path.join(REPO_ROOT, "lib", "config.js"))`
— correct for concertino's own checkout, where `REPO_ROOT` (computed from
`SCRIPT_DIR`, two directories above either rendered script location) does
have a `lib/config.js`. But **a consuming repo never receives concertino's
own `lib/` at all** — `concertino sync` renders `scripts/concertino/*.sh`,
role/law templates, and `.claude/`/`.codex/`/`.opencode/` adapter files into
a consumer's tree; it does not (and architecturally cannot, without adding a
whole-module vendoring step this ticket never scoped) also copy `lib/`. The
round-3 fix's `require` ran **unconditionally**, before ever checking
whether `protectedPaths` was even non-empty — so in ANY consuming repo with
`agentMerge.enabled: true` and ANY `concertino.config.json` (the ordinary
case for every project using concertino), condition 4 threw
`Cannot find module '.../lib/config.js'`, was caught by the outer `try`,
and refused the ENTIRE merge with exit 1 — regardless of whether
`protectedPaths` was ever configured. This is a strictly bigger break than
the round-3 locale defect this predicate exists to close: it does not
merely fail to catch one glob shape, it makes agent-merge entirely
unusable for every consuming project. Measured directly: `require()` from
`/home/matt/Development/helio` (a real consuming checkout, no
`lib/config.js` anywhere in its tree) throws `Cannot find module
'/home/matt/Development/helio/lib/config.js'`; the identical call from
this worktree's own root resolves and returns a working
`isPlainRelativeGlob`.

**The fix, and why it does not reopen Decision 2's guarantee or Decision 4
(C4)'s one-predicate rule:** the `require` now happens ONLY when
`pp.length > 0` — i.e. only when there is actually something to validate.
An empty/absent `protectedPaths` short-circuits to `{ok:true,patterns:[]}`
immediately, the exact same no-op guarantee the missing-config-file branch
already gives one JSON key higher up, and never touches `lib/config.js` at
all — so a consuming repo with nothing configured behaves exactly as
before this whole capability existed, regardless of whether concertino's
`lib/` is reachable from its tree. A consuming repo that HAS configured a
non-empty `protectedPaths` still calls the one predicate, and if that
`require` fails there (the genuine "cannot validate a configured list"
case), the outer `catch` still refuses (exit 1) rather than silently
passing — fail-closed is preserved exactly where it matters, and Decision
4 (C4)'s "exactly one predicate, never two independent implementations"
still holds: this fix does not reintroduce a bash-side reimplementation:
it changes WHEN the one predicate is called, not how many predicates
exist.

**The coverage gap this exposed, reported plainly rather than glossed
over:** `test/scripts/check-merge-readiness.test.sh`'s 133 fixtures at the
time of round 3 (0980b03/10d7c28) all invoked `$SCRIPT` — the literal file
living inside this checkout — so `SCRIPT_DIR`/`REPO_ROOT` inside the script
always resolved to THIS checkout's own root, which does have
`lib/config.js`. No fixture ever exercised the shape a real consuming repo
is actually in (a byte-copied script with no `lib/` anywhere above it).
That gap is fixed going forward with `deployed_script_dir()` (a throwaway
directory containing only a copy of the script and its sourced
`lib/*.sh` dependencies, no top-level `lib/config.js`), which two new
fixtures (the no-op and fail-closed arms) now run against.

### Decision 3: Fail closed on every uncertainty

This is the decision that keeps the guard from becoming vacuous, and the probe
results below are why it is stated as its own decision rather than left
implicit.

Measured behavior of git pathspec on malformed input:

- `:(glob)record/[unclosed` — **exit 0, empty output.** A malformed glob
  silently matches nothing. A guard that treats "no matches" as "nothing
  protected" is therefore trivially defeated by a typo in the config.
- `:(nosuchmagic)...` — exit 128, loud. Only bad *magic* fails noisily.
- `:(glob)` with an empty pattern — matches **every** path in the tree.
- **[Added at final gate, CON-193 skeptic-final-1.md]** A configured entry
  using git's exclude/negation pathspec magic — e.g. `!record/**`, or
  explicit `:(exclude)record/**` — is a well-formed, non-empty string that
  passes config-time validation cleanly (it is neither non-array,
  non-string, nor empty), reaches
  `git diff --name-only <base> <head> -- ':(glob)!record/**'` unmodified,
  and **exits 0 with empty output even when the diff genuinely touches the
  path** — an exclude-only pathspec has no positive pathspec to pair with,
  so it matches nothing. Reproduced against the real script (not just raw
  git): a fixture with `record/foo.md` genuinely touched in the diff and
  `protectedPaths: ["!record/**"]` printed `PASS`/exited 0, with a positive
  control on the same fixture (`protectedPaths: ["record/**"]`, no `!`)
  correctly exiting 5 and naming the path. This is the identical failure
  shape as the unclosed-`[` case above (git accepts the syntax, silently
  matches nothing), just via a different git pathspec defect — the guard's
  malformed-pattern detection covered only the unclosed-`[` shape and did
  not generalize to pathspec *magic* at all, leaving this shape open.
- **[Added at final gate round 2, CON-193 skeptic-final-2.md — the fix
  above was itself a denylist, and a denylist is always one shape behind.]**
  The round-1 fix shipped `entry.startsWith('!') || entry.startsWith(':')`
  in both layers — a denylist of the ONE shape a review had demonstrated,
  despite its own comment claiming to be "ALLOWLIST-shaped." Round 2's
  skeptic found and reproduced a THIRD bypass in under 15 minutes of
  adversarial probing: a configured entry with a **leading space** —
  `" !record/**"` — satisfies neither `startsWith('!')` nor
  `startsWith(':')` (the string starts with a space), so it passed both
  layers unmodified, reached git as `:(glob) !record/**`, and **silently
  matched nothing even though the diff genuinely touched the path** —
  reproduced against the real script with a positive control on the
  identical fixture (plain `record/**`, no leading space, correctly exited
  5 and named the path). The skeptic's structural point, not just the
  instance: "a denylist must enumerate every evasion and it will always be
  one shape behind" — the fix needed to change SHAPE, not gain a third
  `startsWith` check.

  **Owner-approved remediation — a real positive allowlist, not a third
  prefix check:** `isPlainRelativeGlob` (`lib/config.js`) and its shell
  mirror in `check-merge-readiness.sh` now accept an entry ONLY if: it
  equals its own whitespace-trimmed form (rejected OUTRIGHT if not — never
  silently trimmed-and-accepted, since silent normalization in a safety
  guard hides operator error) and is non-empty after trimming; it does not
  contain `..` (path escape); it does not end with `/`; its first
  character is drawn from `[A-Za-z0-9._-]` (which, without the function
  needing to know `!`/`:`/space are individually "magic," already excludes
  all three, plus a leading `/`); and every remaining character is drawn
  from `[A-Za-z0-9._/*?[-]` (the exact punctuation a plain relative glob
  needs — no colon, no bang, no whitespace, at any position, not only
  leading). A future evasion shape can only slip through by matching this
  ACCEPT pattern, not by dodging a REJECT pattern that does not yet know
  about it — that is the actual, checkable difference between an allowlist
  and a denylist that claims to be one.

- **[Added at final gate round 3, CON-193 skeptic-final-3.md — the round-2
  fix was architecturally correct (a real positive allowlist) but shipped
  as TWO independent reimplementations of it, and the two disagreed.]**
  Round 2's allowlist accept pattern (`[A-Za-z0-9._-]` for the first
  character, `[A-Za-z0-9._/*?[-]` for the rest) was written once in JS
  (`lib/config.js`'s `isPlainRelativeGlob`) and re-derived a SECOND time
  in bash (`check-merge-readiness.sh`'s own `[[ "$pat" =~ ... ]]`) — the
  right rule, expressed twice, by two different regex engines. Round 3's
  skeptic found the two engines do not agree: bash's `[[ =~ ]]` is
  **locale-collation-aware**. Under the ambient `LANG=en_US.UTF-8` (this
  machine's actual default, confirmed via `locale`, never pinned by the
  script), a POSIX bracket-expression range like `[A-Za-z0-9._-]`
  collate-widens to accept accented Latin-1/Latin-Extended letters that
  sort adjacent to their base letter. Reproduced 3/3 runs: `"récord/**"`
  — **ACCEPTED** by the bash regex, **REJECTED** by the identical-in-
  intent JS regex (plain JS regexes are not locale-collation-aware).
  Cyrillic homoglyphs of "record" were correctly rejected by both layers
  — this is specifically Latin-range collation widening, not a general
  Unicode hole. An operator (or an adversarial diff) writing `"récord/**"`
  to protect the real ASCII `record/**` directory gets an entry the bash
  backstop accepts as well-formed, which then matches nothing under
  `git diff ... -- ':(glob)récord/**'` against the real ASCII tree — the
  identical failure shape as rounds 1 and 2, a third root cause producing
  the same "looks protective, protects nothing" outcome.

  **The owner's ruling, and why this is not a fourth patch:** two
  independent reimplementations of one predicate can always diverge, and
  patching the fourth disagreement leaves the fifth (the owner cited
  CON-219 — one figure restated in four places drifted and cost two review
  rounds — as the identical one-source-of-truth lesson in a different
  part of this codebase). The fix is therefore not a third bash-side
  accept pattern, nor an `LC_ALL=C` patch merely bolted onto the existing
  bash regex (which would still leave TWO implementations, now agreeing
  today but free to diverge again on the next thing neither author
  thought of): **the bash reimplementation is deleted outright.**
  Condition 4 already shells out to `node -e` to read
  `agentMerge.protectedPaths` from the main checkout's config (Decision
  2) — that SAME call now also requires `isPlainRelativeGlob` from THIS
  worktree's own `lib/config.js` (resolved via the script's own
  `SCRIPT_DIR`, two directories up from either rendered location) and
  validates every entry against it, returning an accept/reject verdict
  bash only CONSUMES. There is now exactly one place the "is this a plain
  glob" question is answered.

  **The one bash-side check that remains, and why it cannot be
  delegated:** detecting an unclosed `[` character class is not a "what
  characters make up a plain glob" question (the question rounds 1-3 kept
  answering differently) — it is "does GIT's OWN pathspec engine treat
  this string as matching nothing," a property of git's parser that
  `isPlainRelativeGlob` was never trying to model (it does not check
  bracket balance either). This one remaining `[[ =~ ]]` use is pinned to
  `LC_ALL=C` so it cannot repeat round 3's mistake, even though its own
  test (`[^]]*$`, a negated single-character class) is not a collating
  range and should not itself be locale-sensitive — the pin removes any
  doubt rather than relying on that reasoning holding indefinitely.

Consequences, layered so no single layer is the only defense:

1. **Config-time validation** rejects a non-string or empty-string entry,
   naming the index and value (spec requirement 1). The empty-string case is
   called out separately because of the match-everything result above.
   **[CON-193 skeptic-final-2.md]** It also rejects anything the positive
   `isPlainRelativeGlob` accept pattern does not recognize as a plain glob
   — a real ALLOWLIST (fixed accept pattern), not the round-1 denylist of
   `!`/`:` prefixes that round 2 defeated.
2. **Run-time fail-closed**: an unresolvable main checkout, an unreadable or
   unparseable config, or a pattern git reports as unusable all refuse rather
   than pass. **[CON-193 skeptic-final-3.md]** This layer calls the SAME
   `isPlainRelativeGlob` predicate — required directly from this worktree's
   own `lib/config.js` inside the same `node -e` call condition 4 already
   uses to read the config — rather than independently re-deriving an
   equivalent rule in shell (see the round-3 note above for why a second
   reimplementation, even a correct-looking one, is the actual defect
   class). Config validation alone still fails open for anyone who edits
   `concertino.config.json` without re-running `concertino validate`, which
   is exactly the scenario a hand-edited config in a delivery worktree's
   main checkout represents — this layer's independence is of WHEN it
   runs, not of WHAT rule it applies. Verified to hold with a config the JS
   validator's `collectConfigIssues` never saw at all (a shell fixture
   writing `concertino.config.json` directly to the fixture repo).
3. **A pattern that cannot match is distinguished from one that legitimately
   matches nothing**, so a typo surfaces instead of silently disarming. This
   now covers a syntactically malformed glob (unclosed `[`, the one
   remaining bash-side check, locale-pinned) and every shape the one
   `isPlainRelativeGlob` predicate does not recognize as a plain glob
   (pathspec magic in any position, whitespace anywhere, `..`, a trailing
   `/`, locale-widened accented letters) — the same "matched nothing"
   surface, several different root causes, one predicate, one refusal.

### Decision 4: A distinct exit code, and a `PROTECTED <path>` line per match

The script's exit codes are already a meaningful vocabulary: `0` pass, `1`
hard failure, `3` CI still pending (resumable), `4` stale reviewed SHA (do work
then retry). These map to genuinely different auditor verdicts, and the existing
precedence rule is that `1` dominates `4`.

A protected-path refusal is a *fifth* meaning: not a failure to fix, not a wait,
not a re-review — a permanent routing decision that this merge belongs to a
human. Overloading `1` would make it indistinguishable from a red CI check in
the auditor's own branch logic, which currently keys off exit code, not prose.
So: **exit 5**, with one `PROTECTED <path>` line per matched path on stderr,
mirroring `check-gate-chain-change.sh`'s tagged-line output and
`STALE <role> ...`'s one-line-per-instance shape.

Precedence: `1` dominates `5` dominates `4`. Rationale — a hard failure is still
the most urgent fact; but a protected-path match must not be masked by a stale
SHA, because re-reviewing would clear the `4` and then surface the `5` anyway,
wasting a full gate cycle to reach the same conclusion. Condition 4 is
evaluated only when `protectedPaths` is non-empty, so an unset field adds not
one git call.

### Decision 5: Which diff base

Condition 3 already resolves a base for its own comparison: `gh pr view` for
`baseRefName`, fall back to `${CONCERTINO_BASE_BRANCH:-main}`, then
`git fetch origin <base>` and `merge-base`. Note that in a worktree the
`.concertino.env` fallback is unavailable (Context fact 1), so that default
resolves to the literal `main` — correct for this repo, and the `gh pr view`
result is the primary path regardless.

Condition 4 reuses that same freshly-fetched base rather than resolving a second
one. Two bases in one script could disagree, and a stale base is the failure
direction that bites: it would re-admit paths the branch already merged in.
Concretely, the comparison is `merge-base(origin/<base>, HEAD)` to the verified
head — the branch's own contribution, not everything that has landed on the
base since.

## Risks / Trade-offs

- **[The whole path is unexercised in this repository.]** `agentMerge.enabled`
  is `true` in config, but the owner ruled `AGENT_MERGE=false` for this entire
  batch, so no auditor has ever run here and every merge has been manual. This
  change therefore ships with test and mutation evidence only — not field use.
  → Mitigation: say so plainly in `docs/config-reference.md` and in the
  delivery report; do not describe the feature as proven in practice. The shell
  tests stub `gh`, so they exercise the script's logic but not a real merge.
- **[Round 3's defect had a mitigating asymmetry, worth stating plainly rather
  than letting the REFUTE read as "the whole feature was broken."]** The JS
  layer (`lib/config.js`'s `isPlainRelativeGlob`, and `collectConfigIssues`
  that calls it) was correct throughout round 3 — it rejected every accented-
  Latin entry the skeptic tried, with no gap. The defect was confined to the
  now-deleted bash reimplementation: the script-level backstop that exists
  specifically for a hand-edited `concertino.config.json` that never went
  through `concertino validate`. **Any project that ran `concertino sync` /
  `concertino validate` / `concertino doctor` before this diff's merge
  attempt was already protected** — the exposure was narrowly the "someone
  edited the main checkout's config directly and skipped validation" path,
  not the ordinary one. → Mitigation: state this asymmetry plainly in
  `docs/config-reference.md` and here, rather than letting a reader infer
  the feature was unprotected end-to-end; also restate (this doesn't change
  between rounds) that agent-merge itself remains unexercised in this
  repository today — `AGENT_MERGE=false` for the whole batch, no auditor has
  ever actually run, and CON-207 means `check-pr-mergeable.sh` still passes
  on an empty `statusCheckRollup` — so none of this has field evidence behind
  it regardless of how solid the mutation-proof evidence looks.
- **[A guard that cannot fail is worse than no guard.]** This batch catalogued
  14 instances of verification machinery that reported success while measuring
  nothing. → Mitigation: every new arm must be mutation-proven — remove or
  invert the guard, observe red, restore, observe green — with the transcript
  recorded. Specifically including: the refusal itself, the distinct exit code,
  the empty-list no-op, and the malformed-pattern fail-closed.
- **[Exit code 5 could collide with a future meaning, or with a shell
  convention.]** → Mitigation: 5 is not a reserved shell status (126/127/128+n
  are); it is documented in the script header alongside 1/3/4 and in the
  auditor's exit-code prose, which is the single place that vocabulary lives.
- **[The rendered copy can drift.]** `scripts/concertino/**` is tracked and
  byte-compared against `core/scripts/**` by
  `test/scripts/rendered-scripts-drift.test.sh`. `concertino.config.json` is
  gitignored and absent from the worktree, so `concertino sync` cannot be run
  from inside it. → Mitigation: edit `core/scripts/check-merge-readiness.sh`
  and copy it to `scripts/concertino/check-merge-readiness.sh` in the same
  commit; the drift test is the backstop. Note
  `test/scripts/check-merge-readiness.test.sh` points `SCRIPT=` at
  `core/scripts/`, so mutating only the rendered copy yields a false green —
  mutation transcripts must target the core copy.
- **[Reading config with `node -e` inside a shell script.]** → Mitigation: it
  is an existing precedent in this very suite
  (`check-gate-chain-change.sh`), and node is already a hard prerequisite for
  concertino itself. A missing/failing node read falls into Decision 3's
  fail-closed branch.

### Decision 6: Delta file placement, and why two scenario headers are deliberately stale

Found by running `openspec archive` against a disposable copy, not by reading
docs — `openspec validate` exits zero on both defects below.

**Placement.** OpenSpec resolves which spec a delta's requirements target by
the delta *file's directory* under `specs/`, never by requirement content. So
the `RENAMED`/`MODIFIED` blocks targeting the existing `agent-merge` capability
must live at `specs/agent-merge/spec.md`, and only the new capability's
`Purpose`+`ADDED` may live at `specs/agent-merge-protected-paths/spec.md`. With
everything in one file under the new capability's directory, archive fails
hard: `archive_spec_update_failed: target spec does not exist; only ADDED
requirements are allowed for new specs`.

**Frozen scenario headers.** Archive reconciles a MODIFIED requirement's
scenarios by **title string**, not content, and refuses to drop a title the
current spec still has. So `#### Scenario: All three conditions pass` and
`#### Scenario: All four conditions hold` are retained **verbatim** even though
the conditions they describe are now four and five respectively. The corrected
counts live in each scenario's `WHEN` text instead.

This is deliberate, not an oversight: retitling those two headers is what round
2 of the design gate caught, and "fixing" the stale numeral in a header
re-breaks archive. Round 1's re-anchoring intent is satisfied by the two
`RENAMED` requirement titles, which archive *does* support renaming. A future
reader tempted to tidy the numerals should change the `WHEN` text, never the
header.

**Verification constraint this promoted (C1).** A spec-delta change is not
verified by `openspec validate` alone: run `openspec archive` against a
disposable copy before claiming the delta is sound — never against the live
worktree. Evidence for this change: archive exits 0 with `specsUpdated: true`,
`added: 5, modified: 2, renamed: 2`.

## Migration Plan

Additive and backward-compatible; no migration. A project observes no change
until it sets the field. Rollback is deleting the field, or reverting the
commit — nothing persists outside config and the scripts.

## Open Questions

None that would change the specs, the approach, or the task breakdown.
