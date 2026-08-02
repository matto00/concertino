## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- **Ticket ACs enumerated** (`ticket.md`): (1) PR artifact added to evidence list
  once PR exists, likely a new `kind: 'pr'` event; (2) `evidenceItems()`/
  `evidenceLines()` recognize and render it distinctly; (3) Enter opens OS
  default browser instead of docview; (4) existing file-based Enter behavior
  unaffected; (5) failed browser-open fails gracefully, visibly, no crash.
  Traced each to a concrete task in `tasks.md` (§2 → AC1, §3 → AC2, §4/§5.2 →
  AC3, §4.1's "evidence item returns the existing action unchanged" → AC4,
  §5.2's `drillNotice` path → AC5). No AC is left uncovered.

- **`evidenceItems()`/`evidenceLines()` current shape** — read
  `lib/ui/screens/drilldown.js:236-292`. Confirmed: `evidenceItems(run)` today
  is `(run.events||[]).filter(ev => ev.kind === 'evidence')` (line 238);
  `evidenceLines()` builds `text = (isSelected ? '▸ ' : '  ') + (ev.label ||
  ev.ref || '(untitled)')` (line 288). The design's proposed filter (`kind ===
  'evidence' || kind === 'pr'`) and its stated "icon replaces the plain
  selection-marker prefix, file-entry rendering unchanged" claim are both
  accurate descriptions of what would need to change and are internally
  consistent — no contradiction with the actual code.

- **`describeEvent()` switch** — read `drilldown.js:86-117`: every existing
  event kind has its own `case`, with a safe `default` returning `{ label:
  ev.kind, detail: '' }`. Confirms design.md's claim that a `case 'pr':` is
  additive and that the fallback is safe if omitted — matches task 3.3.

- **`handleKey()`'s evidence branch** — read `drilldown.js:681-695`: on `\r`,
  today unconditionally returns `{ type: 'open-evidence-doc', ticket, ref:
  ev.ref, label: ev.label }`. Design's Decision 3 / task 4.1 (branch on
  `ev.kind`, `pr` → `open-external-url`, `evidence` → unchanged) is an accurate,
  minimal diff against this real code — confirms AC3/AC4 are both reachable
  without touching the other branch.

- **`watch.js`'s action-handling precedent** — read `lib/ui/watch.js:1904-1977`.
  Confirmed: `execFileSync` is already imported and used (line 11, line 133,
  line 2183); `open-evidence-doc`'s handler reads a file synchronously in a
  try/catch with a graceful "file not found" fallback (lines 1904-1926);
  `restart-confirmed`'s handler sets `drillNotice = result.error` on failure
  (line 1975), and `drilldown.js:734` renders `notice: state.drillNotice` in
  the drill-down screen. This is exactly the reuse path design.md Decision 4
  and tasks 5.1/5.2 describe — no invented mechanism, no new UI plumbing
  claimed that doesn't already exist.

- **`reducer.js` event ingestion** — read `lib/ui/reducer.js:68`:
  `run.events.push(ev)` unconditionally, no kind-based filtering anywhere in
  the file. Grepped the whole `lib/`/`core/`/`scripts/concertino/` tree for any
  allowlist of event kinds (`ALLOWED_KINDS`/`VALID_KINDS`/kind-gating) — none
  found. Confirms design's "no reducer change needed, purely additive" claim.

- **`emit-event.sh`'s generic k=v contract** — read
  `scripts/concertino/emit-event.sh:198-256`: any `k=v` pair not matching a
  handful of reserved keys (`ticket`, `role`, `project`, `t`, `kind`, `context`,
  `sub_questions`) is written through verbatim into the JSON line (the `*)`
  case, lines 235-237). Confirms `emit-event.sh pr ticket=... url=... label=...`
  needs no script change — matches task 2.2's claim (which correctly still
  calls for a manual verification step rather than asserting it).

- **Orchestrator Phase 3 Delivery, PR-creation step** — read
  `core/roles/orchestrator.md:525-573`: step 4 creates the PR (`gh pr create`),
  step 5 posts the link to the ticket, and `PR_URL` is later passed to the
  auditor verbatim in step 6. Confirms design.md's claim that step 4 is the one
  place `PR_URL` is known and durable, and that task 2.1's placement ("a step
  immediately after PR creation... before Post the PR link back to the
  ticket") lands exactly between steps 4 and 5 as described — no contradiction.

- **No code changed yet** — `git status --short` in the worktree shows only
  the untracked `openspec/changes/pr-artifact-evidence-link/` directory; `git
  diff --stat HEAD` is empty. Confirms this is genuinely pre-execution (design
  gate), consistent with the gate being invoked at the right point.

- **`openspec validate` syntax check** — ran
  `openspec validate pr-artifact-evidence-link --strict` fresh:
  ```
  Change 'pr-artifact-evidence-link' is valid
  ```
  The spec deltas (`evidence-reader`, `browser-link-open` [new capability],
  `evidence-telemetry`) parse and validate cleanly. Note: task 6.4 in
  `tasks.md` names the command as `openspec validate --change
  pr-artifact-evidence-link`, but the installed CLI's actual flag is
  `--changes` (plural, validates *all* changes) or a bare positional
  `<item-name>` — `--change` is not a recognized option
  (`error: unknown option '--change', did you mean --changes?`). This is a
  pre-existing project-wide convention, not unique to this plan — the same
  incorrect `--change <CHANGE_NAME>` invocation already appears in
  `core/roles/orchestrator.md:468`. Non-blocking here (trivial to correct at
  verification time, and not this change's own defect to fix), but flagged as
  a note since it directly contradicts the actual installed tool's help output.

### Internal-consistency / contradiction check

- proposal.md ↔ design.md ↔ tasks.md ↔ spec deltas: read all four together.
  Every decision made in design.md (new `pr` kind, not an `evidence` variant;
  merge-both-kinds filter; new `open-external-url` action; `watch.js`/
  `execFileSync`/`drillNotice` reuse; one new icon; Phase 3 step 4 emission
  point) is reflected identically in tasks.md's numbered steps and in the spec
  deltas' MODIFIED/ADDED requirements. No contradiction found between any pair
  of these documents.
- No placeholders, `TODO`/`TBD`, or deferred decisions found in any of the four
  artifacts. The one item left open in the ticket ("check whether other
  platforms need support") is explicitly resolved in design.md's Non-Goals
  ("Linux-only... a future platform is a follow-up") with a stated rationale
  (every other process-spawning call site in the repo already assumes
  Linux/POSIX) — this is a resolved decision, not hand-waving.
- Scope: no work beyond the ticket's five ACs is proposed (icons.js's one new
  glyph, the orchestrator's one new emit call, and the reducer's explicit
  no-op are all directly required by the ACs, not incidental scope creep).

### Verdict: CONFIRM

### Non-blocking notes
- Task 6.4's `openspec validate --change <name>` syntax does not match the
  installed CLI (`openspec validate --help` shows `--changes`/positional
  `<item-name>`, not `--change`); this is a pre-existing repo-wide convention
  (also present in `core/roles/orchestrator.md:468`), not something this
  change introduced, but the executor should use `openspec validate
  pr-artifact-evidence-link --strict` (verified working above) when performing
  task 6.4.
- Decision 5's icon choice (`icons.pr` vs `icons.link`, exact glyph) is left
  unspecified pending implementation — acceptable, since the constraint
  (restricted codepoint classes already documented in `icons.js`'s header) is
  precise enough that no two reasonable implementations would diverge in a way
  that matters to the ACs.
