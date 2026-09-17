# Files modified — CON-190 / CON-191

## Cycle 2 (final-gate skeptic REFUTE, skeptic-final-1.md, new constraint C5)

The final-gate skeptic found that both `computeInstrumentationManifest()`
implementations (`lib/cli/emit.js` and `core/scripts/setup-worktree.sh`)
walked `scripts/concertino/` **non-recursively** — top-level `*.sh` only —
silently excluding `scripts/concertino/lib/**`, even though `emit-event.sh`
itself `source`s `lib/auditor-lease.sh` on every invocation. A patch to a
nested `lib/*.sh` file moved the digest not at all: the exact CON-128
failure shape this capability exists to catch, so CON-191 AC1 was not
actually satisfied. Fixed by walking recursively (mirroring
`listFilesRecursive()`'s forward-slash-normalized relative-path convention)
in both implementations, keeping them in lockstep. See the new mutation
transcript below and the updated `test/scripts/instrumentation-digest.test.sh`
(cases 2.2a/2.2b, 4b.1–4b.3).

- `lib/cli/emit.js` — `computeInstrumentationManifest()` now uses
  `listFilesRecursive()` (already imported/used by `copyAssets()`) instead of
  a top-level `fs.readdirSync()`, so every `*.sh` file anywhere under the
  rendered `scripts/concertino/` tree — including `lib/**` — is hashed and
  keyed by its full relative path.
- `core/scripts/setup-worktree.sh` — `compute_instrumentation_manifest()`'s
  inline node script gains a `listShFilesRecursive()` helper mirroring the
  same algorithm, so the live digest setup-worktree.sh records on `run.start`
  is computed the same way as the render-time baseline `concertino sync`
  writes.
- `scripts/concertino/setup-worktree.sh` — byte-identical mirror of the
  above (constraint C2).
- `test/emit.test.js` — the `.instrumentation-manifest.json` test now counts
  rendered `.sh` files recursively (including `lib/**`) instead of only at
  the top level, with an explicit sanity assertion that at least one counted
  file is nested under `lib/` — the original top-level-only version of this
  test would have stayed green even with the regression the skeptic found.
- `test/scripts/instrumentation-digest.test.sh` — `write_manifest_from_dir()`
  (the test's own baseline-writer) is now recursive too, matching production;
  added case 2.2a/2.2b (digest reproducibility + relative-path-keyed
  manifest, change request 3) and case 4b.1–4b.3 (a NESTED `lib/*.sh` patch
  emits `schema.change` naming it by relative path, and does NOT also name
  the untouched top-level script — change request 2, the actual mutation
  proof for the reported gap).

### Mutation transcript for the C5 fix (change request 2)

RED (pre-fix, non-recursive algorithm — reproduced standalone, matching the
skeptic's own probe):

```
RED PROBE (pre-fix, non-recursive algorithm):
  before.digest = 7dab91ac04bd099a5df8db1c82506d92bfc81ef81700597e42ce673a68ef51a0
  after.digest  = 7dab91ac04bd099a5df8db1c82506d92bfc81ef81700597e42ce673a68ef51a0
  digest changed after patching lib/auditor-lease.sh: false
  files map keys: [ 'emit-event.sh' ]
```

GREEN (fixed, recursive algorithm, same fixture, same patch):

```
GREEN PROBE (fixed, recursive algorithm):
  before.digest = 16bee0394a0f81d3f67feaaaeea278643916c2aa9f81e8f8d47ee807443c7ba7
  after.digest  = 2e95ca61a61a30696960910f546ea4ceddf5abcc76c4aa8c678cb1c7c6c933e5
  digest changed after patching lib/auditor-lease.sh: true
  files map keys: [ 'emit-event.sh', 'lib/auditor-lease.sh', 'lib/git-child-env.sh' ]
```

The same RED/GREEN pair is additionally captured as a persistent, re-runnable
assertion in `test/scripts/instrumentation-digest.test.sh` (case 4b: patches
`lib/auditor-lease.sh` after the baseline is written and asserts
`schema.change` fires naming it) — confirmed to fail against the pre-fix
`setup-worktree.sh` (case 3.1 goes red under a mixed old-bash/new-baseline
state, and the standalone probe above isolates the exact non-recursive
defect) and pass against the fixed tree (16/16 in that file).

### Change request 3 — digest stability / sort key

Confirmed via `test/scripts/instrumentation-digest.test.sh` case 2.2a (two
independent `run.start` digests over an unchanged tree agree) and 2.2b (the
manifest's keys are full, forward-slash-normalized RELATIVE paths, e.g.
`lib/auditor-lease.sh` — never a bare basename). The sort key used in both
`lib/cli/emit.js` and `core/scripts/setup-worktree.sh` is the same relative
path used as the object key and the aggregation string (`f + ":" + h`), so
there is no separate, potentially-divergent sort key to drift from the keys
themselves.

## Cycle 1

- `core/scripts/emit-event.sh` — adds `ticket.filed` required-field + enum
  (`origin_kind`, `suggested_by`) validation, and closed `role` validation
  (7-value set: orchestrator/executor/evaluator/skeptic/auditor/script/
  dashboard). Both refusal blocks sit below the CON-171 auditor-lease
  release (constraint C3), never in the k=v argument loop.
- `scripts/concertino/emit-event.sh` — byte-identical mirror of the above
  (constraint C2); no `concertino sync` was run.
- `core/scripts/setup-worktree.sh` — computes a content digest, RECURSIVELY
  (see Cycle 2 above), over the rendered `scripts/concertino/**/*.sh` files,
  records it on `run.start` (`instrumentation_digest=`, non-fatal on
  failure), and compares it against a render-time baseline
  (`.instrumentation-manifest.json`, when present) to emit `schema.change`
  naming affected scripts on drift. No baseline is treated as no drift.
- `core/scripts/triage-followup.sh` — adds one machine-readable
  `TRIAGE_JSON:`-prefixed line carrying `ac_relevant`/`effort`/computed
  `overlap`/`recommendation`. The human-readable block and decision table are
  unchanged.
- `scripts/concertino/triage-followup.sh` — byte-identical mirror
  (constraint C2).
- `core/scripts/report-cost.sh` — normalises an unrecognised stripped
  `agent_type` (a non-Concertino `SubagentStop` subagent) onto `role=script`
  (the closed set's own inert default) and preserves the raw value in a
  separate `agent_type` field, so `emit-role-validation` never refuses and
  silently loses that cost event.
- `scripts/concertino/report-cost.sh` — byte-identical mirror (constraint
  C2).
- `lib/cli/emit.js` — `copyAssets()` now writes
  `scripts/concertino/.instrumentation-manifest.json` (render-time digest
  baseline, per-file sha256 + aggregate) alongside the rendered scripts, on a
  real (non-dry) sync with `withScripts=true`.
- `lib/cli/render.js` — the `standaloneTicket` block (linear/github/local
  variants) now also writes `origin_kind: followup` / `origin_ticket:
  $TICKET_ID` onto the filed ticket and emits `ticket.filed` recording full
  provenance, with `origin_repo` derived from the repository the orchestrator
  is running in (never the filed ticket's own id prefix).
- `core/roles/orchestrator.md` — "Triaging a suggested follow-up" step 3 now
  also captures the `TRIAGE_JSON:` line into `$TRIAGE_JSON` for later
  `ticket.filed` emission; the `standalone` verdict wiring is rendered via
  `standaloneTicket` above.
- `package.json` — registers `test/scripts/instrumentation-digest.test.sh`
  in the `test` script's `&&` chain.
- `test/scripts/emit-event.test.sh` — new coverage for `ticket.filed`
  required-field/enum validation and closed `role` validation, each with a
  RED-baseline (pre-change) probe proving the check is new, and lease-release
  regression coverage for the new role-validation placement. Also fixes a
  pre-existing `role=7` numeric-passthrough probe (now illegal under the
  closed role set) to use `project=7` instead.
- `test/scripts/instrumentation-digest.test.sh` — new file: covers
  `run.start`'s instrumentation digest, agreement across unchanged-instrument
  runs, baseline match/no-drift, baseline mismatch → `schema.change` naming
  the affected script, and non-fatal degradation when the digest cannot be
  computed.
- `test/scripts/triage-followup.test.sh` — new assertions for the
  `TRIAGE_JSON:` line; every pre-existing assertion is unchanged.
- `test/scripts/report-cost.test.sh` — new assertions for a non-Concertino
  `agent_type` normalising onto `role=script` with the raw value preserved,
  and confirms a recognised `concertino-<role>` agent_type still carries no
  redundant `agent_type` field.
- `test/scripts/standalone-triage-render.test.sh` — updated to assert the
  new `ticket.filed`/`origin_kind`/`origin_repo` content for all three
  provider variants (previously asserted byte-identical pre-change wording,
  which this change deliberately supersedes).
- `test/emit.test.js` — new unit tests for `copyAssets()` writing
  `.instrumentation-manifest.json` (and not writing it on a dry run).

## Mutation transcripts (constraint C4)

Every transcript below runs against a throwaway scratch git repo (never this
checkout's own `.concertino/`), using the pre-change `emit-event.sh` resolved
via `git show origin/main:core/scripts/emit-event.sh` for the RED baseline.

### 1. `role=orchestorator` (typo)

```
$ CONCERTINO_ROLE=orchestorator emit-event.sh(pre-change) phase.enter ticket=CON-1
rc=0
{"t":...,"kind":"phase.enter","project":"repo","ticket":"CON-1","role":"orchestorator"}

$ CONCERTINO_ROLE=orchestorator emit-event.sh(post-change) phase.enter ticket=CON-1
emit-event.sh: invalid role 'orchestorator' (must be one of: orchestrator, executor, evaluator, skeptic, auditor, script, dashboard)
rc=1
(no event appended)
```

Also verified: every one of the 7 legal roles (orchestrator, executor,
evaluator, skeptic, auditor, script, dashboard) is accepted with rc=0 and
recorded verbatim; the emitter's own default (no `CONCERTINO_ROLE` set)
still resolves to `role=script`; a `script`-role `run.end` (cleanup.sh's
actual invocation shape) is never refused; a role-refused invocation (driven
via an illegal `category` on a `role=auditor` verdict, since `auditor` is
itself always legal) still releases the CON-171 auditor teardown lease — see
`test/scripts/emit-event.test.sh`'s `assert_refused_auditor_verdict_releases_lease
"refused on illegal category (post role-validation insertion)"`.

### 2. `schema.change` as an arbitrary kind (pre-change had no field
   validation for it at all — now gated by the same closed-role check plus,
   separately, `ticket.filed`'s own required-field set)

```
$ CONCERTINO_ROLE=script emit-event.sh(pre-change) schema.change ticket=CON-1 foo=bar
rc=0
{"t":...,"kind":"schema.change","project":"repo","ticket":"CON-1","role":"script","foo":"bar"}
```

(No new validation is scoped to `schema.change`'s own fields in this change
— it inherits only the closed-role check, which `role=script` already
satisfies. This RED/GREEN pair is recorded per Setup's premise-validation
evidence; `schema.change`'s own field shape was left free-form by design,
matching `run.start`'s existing precedent for structured-but-unvalidated
event bodies.)

### 3. `ticket.filed` missing each required field (8 fields; one shown, the
   remaining 7 follow the identical pattern — all exercised in
   `test/scripts/emit-event.test.sh`)

```
$ emit-event.sh(pre-change) ticket.filed ticket=HEL-194 role=orchestrator
rc=0
{"t":...,"kind":"ticket.filed","project":"...","ticket":"HEL-194","role":"orchestrator"}

$ emit-event.sh(post-change) ticket.filed ticket=HEL-194 role=orchestrator <full args minus ticket_id>
emit-event.sh: missing required field 'ticket_id' for ticket.filed
rc=1
(no event appended)
```

Confirmed for all 8: `ticket_id`, `origin_ticket`, `origin_repo`,
`origin_role`, `origin_phase`, `origin_kind`, `suggested_by`, `triage`.

### 4. `ticket.filed` illegal `origin_kind` / `suggested_by`

```
$ emit-event.sh(pre-change) ticket.filed ... origin_kind=bogus
rc=0 (accepted silently)

$ emit-event.sh(post-change) ticket.filed ... origin_kind=bogus
emit-event.sh: invalid origin_kind 'bogus' (must be one of: followup, roadmap, escalation-split, human)
rc=1 (no event appended)
```

Same RED/GREEN pair confirmed for `suggested_by=nobody` (legal set:
`agent`, `human`). All four legal `origin_kind` values and both legal
`suggested_by` values accepted and recorded verbatim.

### 5. Other event kinds unaffected

```
$ emit-event.sh(post-change) phase.enter ticket=HEL-200 role=orchestrator phase=Setup
rc=0, appended — no ticket.filed field ever required off ticket.filed.

$ emit-event.sh(post-change) gate.result ticket=HEL-201 role=orchestrator
rc=0, appended.
```

### 6. `report-cost.sh` — role normalisation prevents a real, demonstrated
   telemetry loss

```
$ CONCERTINO_TICKET=CON-9 report-cost.sh(pre-change fix, POST-change
  role-validating emit-event.sh) < SubagentStop payload with
  agent_type="general-purpose"
rc=0
(.concertino/runs/CON-9/events.jsonl: EMPTY — the run.cost event was
 silently refused by emit-role-validation, since the raw agent_type
 "general-purpose" is not in the closed role set)

$ CONCERTINO_TICKET=CON-7 report-cost.sh(post-fix) < same payload shape
rc=0
{"...","kind":"run.cost","role":"script","agent_type":"general-purpose", ...}
(event appended, role normalised into the closed set, raw value preserved)
```

This demonstrates the fix is load-bearing, not defensive: without it, the
new role validation from this same change silently drops cost telemetry for
every non-Concertino subagent.

### 7. Instrumentation digest / schema.change drift

See `test/scripts/instrumentation-digest.test.sh` (11 assertions): two runs
with unchanged rendered scripts agree on `instrumentation_digest`; no
baseline present records the digest but emits no `schema.change`; a matching
baseline emits nothing; a rendered script locally patched after the baseline
was recorded emits `schema.change` naming that script; a digest that cannot
be computed (an unreadable `.sh` fixture) degrades `run.start` to omitting
the field, without failing setup.

## Verification

- `openspec validate ticket-filed-and-schema-change-events --type change` —
  exit 0 ("Change 'ticket-filed-and-schema-change-events' is valid").
- `npm test` (full suite, `node --test` + 49 shell suites including the two
  new ones) — exit 0, no `FAIL`/`not ok` lines. Historical-corpus fold
  assertions (constraint C1) are part of the pre-existing `emit-event.test.sh`
  suite and pass unmodified.
- This delivery's own `schema.change` event (Decision 2 / task 8.1) is
  recorded in `.concertino/runs/CON-190/events.jsonl` in the main checkout,
  naming both ticket ids (`CON-190,CON-191`) and the affected kinds
  (`ticket.filed,verdict,run.start`).

## Review artifacts (both cycles, per the CON-189 precedent of committing
## these in the change dir)

- `openspec/changes/ticket-filed-and-schema-change-events/evaluation-1.md`
  — the evaluator's cycle-1 report (untracked until this commit).
- `openspec/changes/ticket-filed-and-schema-change-events/skeptic-final-1.md`
  — the final-gate skeptic's round-1 REFUTE report (untracked until this
  commit); this is the report cycle 2 above addresses.
- `openspec/changes/ticket-filed-and-schema-change-events/skeptic-final-2.md` —
  final-gate skeptic round 2's report (CONFIRM), committed in the change dir
  per the CON-189 precedent.
- `openspec/changes/ticket-filed-and-schema-change-events/workflow-state.md`
  — promotes constraint `C5` (recursive enumeration/hashing + nested-fixture
  drift tests) at the `final` gate, round 1, per the skeptic's REFUTE.
- `openspec/changes/ticket-filed-and-schema-change-events/tasks.md` —
  mirrors the same `C5` addition into the Standing Constraints block; all 27
  tasks remain marked complete from cycle 1.
