## Context

`sync` and `diff` (`lib/cli/sync.js`, `lib/cli/diff.js`) both parse
`--harness` as `args.harness ? args.harness.split(',') : c.harnesses` and act
on every named harness that appears in the list, with no validation of
unrecognized names (an unrecognized name today simply matches none of the
three `if (harnesses.includes(...))` branches and silently produces no
output for it). `eject` (`lib/cli/eject.js`) instead reads
`args.harness || 'claude-code'` and compares it with strict equality against
each of the three literals in an if/else-if chain, falling through to an
explicit "unknown harness" error otherwise. `eject` renders exactly one
role's file for exactly one harness and writes it to stdout — this is its
whole reason for existing (`concertino eject --role=executor | less`,
`docs/cli-audit-2026-08.md`'s cited debugging use case).

CON-59's CLI audit (finding 3) named this divergence and explicitly ruled out
fixing it in place, filing this ticket instead because of its blast radius:
completion scripts, `help.js`/`README.md` docs, and any script already
invoking `eject --harness=<one value>` (confirmed via grep:
`test/scripts/opencode-render.test.sh` is the one such caller in this repo).

`eject`'s existing role handling is itself two different things bundled
under one check today: `claude-code` and `opencode` both validate `--role`
against the identical fixed 5-role set (`adapters/claude-code/agents.json`'s
`roles` keys, which is also `lib/cli/emit.js`'s `OPENCODE_ROLES`) — a role
outside that set is invalid *regardless* of which harness was named. `codex`
additionally restricts its own supported roles to a narrower subset
(`executor`/`evaluator`/`auditor`) — this second check is a genuine
per-harness capability difference, not a global validity check. This design
keeps those two cases distinct (Decision 5a vs. 5b below); conflating them
was an error caught at this change's own design-soundness gate (see
`skeptic-design-1.md`).

Separately: `--harness` passed with no `=value` (e.g. bare `--harness` as
the last token) sets `args.harness` to the boolean `true` today, and
`args.harness.split(',')` on a boolean throws a `TypeError` — this is a
pre-existing crash in `sync`/`diff` today, unrelated to and unchanged by
this design (`parseHarnessList`'s contract documents `raw` as "a string or
`undefined`", the same assumption `sync`/`diff` already make). Noted here so
a future reader doesn't mistake it for something this change was meant to
harden.

## Goals / Non-Goals

**Goals:**
- One shared parsing/validation code path for `--harness` used by all three
  of `sync`, `diff`, and `eject`, so the flag's *parsing* semantics
  (comma-separated list, validated against the three known harness ids) are
  identical everywhere it appears.
- `eject --harness` becomes capable of meaningfully acting on more than one
  harness, closing the actual gap named in the audit (rather than merely
  improving eject's error message for a list it still can't act on).
- Zero behavior change for every invocation that doesn't pass more than one
  harness to `eject` — the single-harness (including the default,
  harness-omitted) case must produce byte-for-byte identical stdout to
  today, so `test/scripts/opencode-render.test.sh`'s existing
  `eject --harness=opencode` call, and any other single-value caller,
  needs no change.

**Non-Goals:**
- Renaming either flag. The proposal's "What Changes" picks the
  accept-a-list option over the rename option: eject's blast radius from a
  rename (every doc, completion script, and caller that names `--harness`
  today) is strictly larger than from broadening what one already-existing
  flag accepts, and a rename buys no new capability on its own.
- Per-command `--harness` shell-completion changes (comma-list-aware value
  completion, e.g. offering a second token after a typed comma). Out of
  scope: the existing fish/zsh/bash completions for `eject --harness` already
  offer the three tokens as selectable/free-text values, identical in shape
  to `sync`/`diff`'s own `--harness` completion, which has never offered
  comma-aware completion either. Unifying eject's completion *entries* with
  sync/diff's (which this design already does not need to touch, since they
  already match in shape) is separate from teaching any of the three shells
  genuinely comma-aware completion, which no command has today.
- Adding `--harness` validation retroactively as a breaking change for
  existing automation: this design intentionally *adds* validation (see
  Decision 3) to `sync`/`diff`, which is a new hard-error where today there
  is silent no-op — flagged as a risk below, not swept under Non-Goals.
- Changing `sync`/`diff`'s own list-acting *behavior* (which harnesses run
  when) — only their parsing/validation code path moves to the shared
  helper; `harnesses.includes('claude-code')`-style dispatch in `sync.js`/
  `diff.js` is untouched.

## Decisions

### Decision 1: Extract one shared helper, `parseHarnessList`, into `lib/cli/shared.js`

Signature: `parseHarnessList(raw, fallback)` → `{ harnesses, error }`.
- `raw` is `args.harness` (a string or `undefined`).
- `fallback` is the array to use when `raw` is falsy — `c.harnesses` for
  `sync`/`diff` (project config's configured harness set), `['claude-code']`
  for `eject` (today's hardcoded single default, preserved exactly).
- Splits `raw` on `,`, trims each entry, drops empty entries (so a trailing
  comma or repeated commas don't produce a spurious `''` entry).
- Validates every entry against the fixed set `['claude-code', 'codex',
  'opencode']`. Any entry not in that set is collected; if any are invalid,
  returns `{ harnesses: null, error: 'unknown harness "<bad,list>" — valid:
  claude-code, codex, opencode' }` (all bad entries named together in one
  error, not one-error-per-entry) instead of the list.
- Each of the three call sites (`cmdSync`, `cmdDiff`, `cmdEject`) checks
  `error` immediately after calling it and does its own `console.error(red('error: ') + error); process.exit(1);` —
  matching each command's existing error-reporting convention (they already
  each do their own `red('error: ')`-prefixed `console.error` + `exit(1)`
  for other validation failures; the helper returns data, it doesn't call
  `process.exit` itself, so it stays trivially unit-testable in isolation
  without a subprocess).

Alternative considered: have the helper itself call `process.exit(1)` on
invalid input. Rejected — every existing `lib/cli/shared.js` helper is a
pure function; making this one exit directly would be the only side-effecting
helper in that file and would make it untestable without a subprocess (this
change's own test plan needs a direct unit test of the parsing/validation
logic, not just the subprocess-level integration tests `eject`/`sync`/`diff`
already lack today).

### Decision 2: `eject` keeps its own default (`claude-code` alone), not `sync`/`diff`'s (`c.harnesses`)

`eject`'s `fallback` argument to `parseHarnessList` stays `['claude-code']`,
not the project's configured `c.harnesses` list. Rationale: `eject`'s
single-file, stdout-piping use case (`concertino eject --role=executor |
less`) is the overwhelmingly common invocation and must keep behaving
exactly as it does today when `--harness` is omitted — switching the default
to "every configured harness" would silently change output for every
existing bare `eject --role=X` call the moment a project configures more
than one harness, which is exactly the kind of surprise this ticket exists
to remove, not introduce elsewhere.

### Decision 3: `sync`/`diff` gain harness-name validation as a side effect; `eject`'s error message becomes shared, not custom

Today `sync`/`diff` silently ignore an unrecognized `--harness` entry (no
error, no output for it, easy to mistake for "0 changed" success). Routing
them through `parseHarnessList` gives them the same explicit
"unknown harness" error `eject` already has, rather than deliberately
special-casing sync/diff to keep the old silent-ignore behavior. This is a
real, if narrow, behavior change for `sync`/`diff` — captured explicitly in
Risks below rather than treated as a Non-Goal, since silently doing nothing
for a typo'd harness name was never a documented or desirable behavior worth
preserving on its own.

### Decision 4: `eject`'s multi-harness output — sequential sections with a one-line header, never a single merged document

When `--harness` names more than one harness, `eject` renders each one in
turn (in the order given) and writes its output to stdout preceded by a
`# ---- harness: <name> ----\n` line; sections are not merged, reformatted,
or diffed against each other. Rationale: the three harnesses render into
three genuinely different file formats (Claude Code frontmatter+Markdown,
Codex TOML, OpenCode Markdown) with no shared schema to merge into — the
header's only job is to make a multi-harness stdout stream legible when
inspected or piped to `less`, the same way `diff`'s own multi-harness output
already separates sections by printing each destination file's path before
its diff. The single-harness case (still the default, and unaffected by this
decision) prints the raw rendered content with **no** header — this is what
keeps `concertino eject --role=executor | less` and
`test/scripts/opencode-render.test.sh`'s existing
`eject --harness=opencode --role=$role` call byte-for-byte unchanged.

Alternative considered: require `--role` support to be uniform across every
named harness (hard error if any harness in the list doesn't support the
role, e.g. `--role=skeptic --harness=claude-code,codex`). Rejected — codex's
narrower role support (`executor`/`evaluator`/`auditor` only) is a
pre-existing, harness-intrinsic fact orthogonal to this ticket's scope; hard
failing an otherwise-valid multi-harness eject just because codex doesn't
have a `skeptic` role would make the list feature far less useful for the
common "eject this role for every harness that supports it" case. See
Decision 5b.

### Decision 5a: `--role` is validated once, globally, upfront — before any per-harness work

`eject` validates `--role` against the fixed 5-role set
(`orchestrator`/`executor`/`evaluator`/`skeptic`/`auditor`) exactly once,
before iterating the harness list at all, exiting immediately with a single
"unknown role" error if it isn't one of the five — mirroring Decision 1's
treatment of `--harness` (one upfront check, one error, regardless of how
many harnesses were named). This is deliberately *not* folded into the
per-harness skip-and-continue mechanism (Decision 5b): a role outside the
5-role set is invalid independent of which harness is named, so checking it
per-harness would, for a multi-harness invocation, print the identical
"unknown role" note once per harness that happens to share the global
role-validity check (`claude-code` and `opencode` both do, since both
validate against the same `meta.roles`/`OPENCODE_ROLES` set) before falling
through to a generic "zero output" exit — confusing, duplicated output for
what is actually one input error. This gap (task 3.2 originally worded
broadly enough to route this case through Decision 5b's mechanism instead)
was the specific defect flagged at this change's own design-soundness gate;
see `skeptic-design-1.md`.

### Decision 5b: an unsupported role for one harness in a valid list is skipped with a stderr note, not a hard failure — unless it empties the whole list

Once Decision 5a's global role check has passed (so `--role` is confirmed to
be one of the five real roles), `eject` still has to handle `codex`'s
narrower, genuinely-harness-specific role support
(`executor`/`evaluator`/`auditor` only — `orchestrator`/`skeptic` are valid
roles that `codex` specifically doesn't implement). For each harness in the
list that doesn't support the (now-known-valid) requested role, `eject`
prints the same stderr note it already prints today for a single-harness
invocation of this shape ("codex harness only has executor, evaluator, and
auditor") and continues to the next harness in the list, omitting that
harness's section entirely rather than aborting the whole command. `eject`
exits non-zero only if, after processing the full list, zero harnesses
actually produced output (every entry in the list was `codex` and the role
isn't one of its three) — mirroring today's single-harness behavior, where
requesting an unsupported role from `codex` alone always means zero output
and a non-zero exit.

### Decision 6: `completion.js` is untouched

`eject --harness` completion in all three shells already offers the three
harness tokens as either free-text suggestions (fish's `-a`) or a value
enum (zsh's `:harness:(claude-code codex opencode)`) — identical in shape to
`sync`/`diff`'s own completion for the same flag, which has always accepted
a list without any comma-aware completion behavior. There is nothing
`eject`-specific left to fix here once its *parsing* matches sync/diff's;
touching `completion.js` would only be to introduce genuinely comma-aware
completion project-wide, which is explicitly out of scope (see Non-Goals)
and would put `test/completion.test.js`'s existing exact-string assertions
at risk for no behavior gain.

## Risks / Trade-offs

- [`sync`/`diff` gain a new hard error for an unrecognized `--harness` value
  that previously silently produced no output for that entry] → This is a
  deliberate, narrow behavior change (Decision 3), not an oversight: no
  existing test or script in this repo passes an intentionally-invalid
  `--harness` value to `sync`/`diff` (confirmed by grep across `test/` and
  `scripts/`), so nothing currently depends on the old silent-ignore
  behavior. The new error text is more actionable than the old silent
  no-op, which is a straightforward improvement even though it is
  technically a new failure mode for a previously-silent typo.
- [A future harness id is added to the adapter set but the shared helper's
  fixed three-entry allow-list isn't updated] → Same risk profile as today:
  `eject`'s existing `else` branch already hardcodes the same three-name
  list in its error message, so this isn't a new single point of failure,
  just a relocated one. Mitigated by both living in the same small,
  easy-to-grep helper function going forward instead of three separately
  hardcoded lists.
- [Multi-harness `eject` output is not designed to be piped straight to a
  single destination file the way single-harness output is] → Acceptable:
  multi-harness output was never possible before this change, so there is no
  existing single-file-redirect workflow to preserve for it; the header-per-
  section format is explicitly for interactive/inspection use (Decision 4),
  matching `diff`'s own multi-file precedent.
- [An implementer conflates the two different "invalid role" cases —
  globally-invalid-for-every-harness vs. codex-specific-unsupported — since
  both ultimately produce a `null`/no-output result from the per-harness
  render step] → Directly addressed by splitting Decision 5 into 5a (global,
  upfront, single-error check) and 5b (per-harness skip-and-continue,
  strictly for codex's narrower role set); tasks.md 3.2/3.2a and spec.md's
  "eject validates --role globally, once, before per-harness rendering"
  requirement make the two paths explicit and separately testable (tasks.md
  5.4a/5.4b), rather than leaving it to the literal wording of a single
  shared per-harness helper to get right by accident.

## Migration Plan

No data migration. This is a CLI-argument-parsing change with no persisted
state. Rollout is the normal `npm publish`/version-bump path already used
for this project; no flag/feature gate needed since the single-harness
behavior (the overwhelming majority of real invocations) is unchanged
byte-for-byte.

## Open Questions

None outstanding — the two options the proposal weighed (accept-a-list vs.
rename) are resolved by Decision 1 above (accept-a-list, on the grounds of
smaller blast radius and net-new capability).
