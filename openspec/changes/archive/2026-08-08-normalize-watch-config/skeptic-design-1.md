## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **Ticket ACs** (`ticket.md:22-25`):
  1. `watch()` receives a normalised config, or the reason it deliberately does
     not is documented at the call site.
  2. A missing/malformed config must not become fatal ("watch works without
     config" preserved).

- **Current buggy behavior confirmed in real code.** Read `lib/cli/watch.js`
  (worktree HEAD, no source changes yet — confirmed via `git status --short`
  showing only `openspec/changes/normalize-watch-config/` as untracked):
  ```js
  let config = {};
  if (exists(cfgPath)) {
    try { config = JSON.parse(read(cfgPath)); } catch (e) { /* watch works without config */ }
  }
  const { watch } = require('../ui/watch');
  return watch({ root: out, config });
  ```
  `withDefaults` is never called. `cmdWatch` is the sole production call site
  of `watch()` — confirmed via `grep -rn "watch({" lib/` (only hit outside
  tests) and `grep -rn "cmdWatch(" bin/ lib/` (only `bin/concertino:58`).

- **`withDefaults`'s throw-on-missing-shape claim verified.** Read
  `lib/config.js:147-184`. `c.harnesses = c.harnesses || [...]` runs first
  (mutates `c` even before the throw), then `c.project.baseBranch` and
  `c.ticketProvider.idExample` are accessed unconditionally — a config
  missing `project` or `ticketProvider` throws a `TypeError` there, exactly
  as design.md's Context section claims. This also validates the design's
  rationale for deep-cloning before calling `withDefaults` (it mutates `c` in
  place, partially, before it can throw), rather than pre-seeding empty
  objects (rejected alternative, correctly reasoned against as
  contract-duplication).

- **Downstream "stale comment" claims verified against real files**, all
  matching the design's quotes almost verbatim:
  - `lib/ui/watch.js:267-269` (`ensureLaunchPad`): "`config` here is whatever
    lib/cli/watch.js's cmdWatch parsed straight off disk — it never runs
    through lib/config.js's loadConfig/withDefaults..."
  - `lib/ui/watch.js:343-346` (`openLaunchPad`): "cmdWatch hands this config
    straight off disk, so a project still on the deprecated `manual` reaches
    here un-normalised..."
  - `lib/ui/ticket-provider.js:28-35` (`ALIASES` comment): "...lib/cli/watch.js's
    cmdWatch JSON.parses concertino.config.json straight off disk and hands
    the raw object to watch()..."
  - `test/watch.test.js:2902`, `test/ticket-provider.test.js:93`: same
    "cmdWatch never calls withDefaults" framing.
  Tasks 2.1–2.4 target exactly these locations. Non-goals correctly identify
  that the underlying defensive code (the try/catch in `ensureLaunchPad`, the
  `ALIASES` table) must NOT change, since `withDefaults` doesn't validate
  `kind` — confirmed: `withDefaults` only rewrites the one known `manual` →
  `local` alias (`lib/config.js:157`), doesn't touch other kind values, so an
  unresolvable `kind` (e.g. `"github"`) still reaches `watch()` post-fix
  exactly as the design claims.

- **Test-placement convention claim (task 3.1) checked.** `ls test/` shows
  `cli-help-flags.test.js` already exists alongside `watch.test.js` and
  `watch-lock.test.js` — supports the claimed precedent for a `cli-watch.test.js`-style
  file for `lib/cli/*` behavior, or folding into `watch.test.js`; task leaves
  either as acceptable, consistent with what's actually in the repo.

- **AC traceability**: AC1 is satisfied by task 1.2 (normalise-then-fallback
  logic) + task 1.3 (comment at the actual `cmdWatch` call site — the literal
  "call site" the AC refers to, not just the downstream consumer comments).
  AC2 is satisfied by task 1.2's three-way branch (no file / parse failure →
  `{}` unchanged; parse success + `withDefaults` failure → raw object) and
  spec.md's three scenarios under "A missing or malformed config does not
  prevent `concertino watch` from starting."

- **No scope drift**: `git status --short` / `git diff main...HEAD --stat`
  confirm no production files touched yet at this gate — only the
  `openspec/changes/normalize-watch-config/` doc tree is new, as expected
  before execution. Proposal's Impact section is narrow (one production file,
  two comment-only files, two test files) and matches the ticket's stated
  scope; no unrelated `withDefaults` call sites (`sync`/`diff`/`eject`/`migrate`)
  are touched, consistent with the stated Non-Goal.

- **No placeholders/TBDs/hand-waving found** in proposal.md, design.md,
  tasks.md, or spec.md. Every task references a specific file, and the two
  "alternatives considered" in design.md's Decision 1 are substantively
  reasoned, not perfunctory.

### Verdict: CONFIRM

The design is sound, internally consistent, and its factual claims about the
existing codebase (the bug's exact mechanism, `withDefaults`'s throw
behavior, the specific stale comments, the sole call site) all check out
against the real files. Tasks map cleanly to design decisions and to both
ACs; spec.md's scenarios are concrete and independently testable.

### Non-blocking notes

- Spec.md's "missing keys" scenario says config "omits `project` and/or
  `ticketProvider`" as one combined scenario; tasks.md 3.2 should ideally
  exercise both the project-missing and ticketProvider-missing sub-cases
  individually (not just one), since `withDefaults` accesses `c.project.*`
  before `c.ticketProvider.*` — a test that only omits `ticketProvider` while
  including `project` covers a different code path through the function than
  one that omits `project` entirely. This is a test-thoroughness point, not a
  design defect — leaving it to the executor/evaluator to catch during task 3.
