## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Fresh cold review. Fetched CON-190 and CON-191 directly from Linear (not from
orchestrator prose). Resolved the review base live via
`resolve-review-base.sh` (exit 0, printed `50947515fd55de30942e01c900d51696d91deaca`)
and diffed against HEAD (`15ca062a798909f17bfd7b3f2ea00329f136f339`, 33 files).

### What I verified myself (with evidence)

**Round 1's defect is actually fixed, not just re-worded.**
- Read `lib/cli/emit.js`'s `computeInstrumentationManifest()` and
  `core/scripts/setup-worktree.sh`'s `compute_instrumentation_manifest()`
  directly: both now call `listFilesRecursive()` / an equivalent recursive
  walk, filter to `.sh`, and key/sort on forward-slash-normalized relative
  paths (e.g. `lib/auditor-lease.sh`), never a bare basename.
- Ran the full `npm test` suite myself (`timeout: 600000`, exit code
  captured via a separate `echo $?`, never through a piped `tail`):
  `node --test` → `# tests 2322 / # pass 2322 / # fail 0`; every one of the
  49 shell suites reports `N passed, 0 failed`, including
  `instrumentation-digest.test.sh` 16/16 (new cases `2.2a`, `2.2b`, `4b.1`–
  `4b.3` all present and passing — `4b.1`/`4b.2` specifically patch a nested
  `lib/*.sh` fixture and assert `schema.change` names it by its nested
  relative path, `4b.3` asserts the untouched top-level file is NOT also
  named — the exact case round 1's REFUTE said was missing).
- Independently derived `basename(dirname(git rev-parse --git-common-dir))`
  from this actual worktree: correctly resolves to `concertino`, not
  `con-190` or any ticket-id-prefix-derived value — confirms `origin_repo`
  genuinely comes from the running repository, not the filed ticket's id
  (the exact conflation the ticket calls out as invalidating the original
  3.00x finding).

**CON-190's own half, given full scrutiny this round (round 1 focused on
CON-191's digest):**
- `emit-event.sh`'s new `if [ "$KIND" = "ticket.filed" ]` block (read
  directly, lines ~493–538) enforces all eight required fields
  (`ticket_id`, `origin_ticket`, `origin_repo`, `origin_role`,
  `origin_phase`, `origin_kind`, `suggested_by`, `triage`) and both enums
  (`origin_kind` ∈ followup/roadmap/escalation-split/human; `suggested_by`
  ∈ agent/human), placed after the CON-171 lease release per C3.
- Traced the orchestrator-prose emission site end to end by actually
  rendering it, for all three `ticketProvider` variants, in a scratch
  `concertino init` checkout (`github`, `local`, and — after correcting a
  config-schema mistake of my own, `kind` is `linear|github|local` not
  `tickets` — the file-based provider): all three render syntactically
  valid, executable bash containing the `ORIGIN_REPO=...` derivation and
  the full `emit-event.sh ticket.filed` call with every required field
  present as a literal or a documented placeholder
  (`<new ticket id>`/`<current phase>`/`<agent|human>`). This is genuinely
  executable as written, not merely prose that looks plausible.
- `triage-followup.sh`'s new `TRIAGE_JSON:`-prefixed machine-readable line
  is produced via `node -e` with `JSON.stringify`, so it correctly escapes
  arbitrary content and carries only the four triage fields (never the
  free-text `description`/`files`) — read directly, not merely as claimed.

**C3/C4 on the new code, re-derived:**
- `test/scripts/emit-event.test.sh` has an explicit red/green pair for the
  exact `orchestorator` typo the ticket's motivating corpus contains
  (`assert_red_role "role=orchestorator" orchestorator` at line 1211) and a
  separate assertion that a role-refused invocation still releases the
  auditor's teardown lease (line ~1256), proving refusal placement is below
  lease release for a real case, not merely asserted in prose.

**Decisions 2/7/8/9** — re-verified independently, agree with round 1's
judgment that both are reasonable engineering calls, not defects:
`schema.change`'s own `affected_kinds` omitting `schema.change` itself is a
real, minor completeness gap (also flagged by evaluation-1.md as a
non-blocking nit) but not shipping-blocking; `triage` as a JSON-encoded
string follows the existing `models=` precedent; `lib/ui/**` diff-count is
0; `read_raised_field()` correctly untouched since neither new event kind
overlaps its field set.

### Adversarial digging beyond round 1's scope (per this round's brief)

1. **Recursion fix side effects** — the digest now includes
   `lib/git-child-env.selftest.sh`. This is correct, not a defect: it is a
   real file under `scripts/concertino/`, actually loaded/executed as part
   of the rendered instrumentation surface, and hashing it is consistent
   with "every `.sh` file anywhere under `scriptsDir`" per the code comment
   — the same principle that fixed the round-1 gap. Digest reproducibility
   confirmed by test `2.2a` (two independent computations over an unchanged
   tree agree) and by my own path-normalization check above.

2. **`.instrumentation-manifest.json` as an untracked-by-default new render
   product — investigated concretely, found not to break anything, but
   under-documented.** I built a real scratch repo, ran `concertino init`,
   and confirmed: (a) the file IS written into the tracked
   `scripts/concertino/` directory; (b) `git status` reports it `??`
   (untracked) — there is no `.gitignore` entry for it, unlike
   `.concertino.env`/`speeds.json`; (c) `rendered-scripts-drift.test.sh`
   enumerates from `core/scripts/` only, so this file (no `core/`
   counterpart) is correctly out of scope for that gate "by construction" —
   confirmed by reading the test's own header comment; (d) a normal
   `git add scripts/` (the natural post-sync workflow, given
   `scripts/concertino/` is already tracked in this repo) picks the file up
   automatically since nothing ignores it, and I confirmed by a real
   `git worktree add` that a committed manifest DOES survive into a fresh
   worktree — the path this system's own per-ticket `setup-worktree.sh`
   actually uses. So the mechanism works in practice, but the drift-gate's
   own header comment (`rendered-scripts-drift.test.sh` lines 5–7) and
   `design.md`/`instrumentation-provenance/spec.md` name only
   `.concertino.env`/`speeds.json` as config-derived products "out of scope
   by construction," and never mention this third product at all — an
   omission, not a defect, since I could not find any path where it
   actually causes a false result.

3. **Baseline-survives-the-real-path — traced concretely, semantics
   confirmed correct.** Patch → sync order: `concertino sync` unconditionally
   overwrites the baseline with whatever is on disk at sync time, so a
   pre-existing local patch gets silently absorbed into the new baseline and
   will never retroactively trigger `schema.change`. This is inherent to any
   content-hash-diff-against-last-recorded-baseline design and matches the
   requirement's literal scope ("a local patch to a rendered script AFTER
   the last sync" — scenario in `instrumentation-provenance/spec.md`); it is
   not a gap introduced by this diff and not something the ticket asks this
   change to solve. Sync → patch order is exactly test cases 4.1/4.2/4b.1–3,
   confirmed passing.

4. **`report-cost.sh`'s role normalization** — read the diff: correctly maps
   any `agent_type` outside the closed `AGENT_ROLES` set (not just
   `concertino-*` agents — `SubagentStop` fires for every Task-tool
   subagent, including general-purpose ones) onto `role=script`, preserving
   the raw value in a separate `agent_type=` field so no information is
   lost and the emitted event still passes `emit-event.sh`'s new role
   validation rather than being silently dropped. Covered by
   `report-cost.test.sh`'s +31 lines, part of the green suite.

### Verdict: CONFIRM

Round 1's REFUTE identified a real, concrete defect (non-recursive digest
walk silently excluding `lib/auditor-lease.sh`, the exact file
`emit-event.sh` sources on every call). That defect is fixed, with a
genuine regression test (`4b.1`–`4b.3`) that specifically mutates a nested
fixture — not a re-worded green check. I found no new shipping-blocking
defect after independently re-deriving both tickets' acceptance criteria
against the code, reproducing the digest/role/ticket.filed mechanisms in
scratch environments, and re-running the full test suite myself (2322/2322
node tests, 49/49 shell suites, exit 0).

### Non-blocking notes

1. `rendered-scripts-drift.test.sh`'s header comment and
   `instrumentation-provenance/spec.md` should name
   `.instrumentation-manifest.json` explicitly as a third config-derived,
   no-`core/`-counterpart render product (alongside `.concertino.env`/
   `speeds.json`), rather than leaving it implicit. I verified this omission
   does not currently cause a false pass/fail anywhere, but it is exactly
   the kind of undocumented special case that costs a future reviewer real
   time re-deriving what I just spent time re-deriving.
2. `schema.change`'s own `affected_kinds` field for this delivery's event
   omits `schema.change` itself, even though this delivery introduces that
   kind (already flagged in evaluation-1.md as a non-blocking nit; I agree
   with that assessment and its reasoning for not re-emitting a corrected
   event).
3. The digest algorithm is duplicated (bash+inline-node in
   `setup-worktree.sh`, JS in `lib/cli/emit.js`) — deliberate per Decision 3
   and explicitly commented; a future ticket touching this area could
   collapse it into one shared helper.

### Gate defect check (per this round's instructions)

No report I drilled into this round rested a REFUTE or CONFIRM on
undisclosed mtime ordering or unsound evidence-directory timestamps that I
accepted at face value — every load-bearing claim above was either
independently reproduced (test run, scratch-repo render, path derivation)
or is a direct code/diff read. No gate defect to record.
