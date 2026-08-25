## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Base commit verified: `fb914c4` (CON-140). All findings derived from the worktree tree and
from the installed CLI directly, not from the plan's transcripts.

### What I verified (with evidence)

**Decision 2 — "twelve-day CLI drift is refuted": CONFIRMED, the refutation is correct.**
Installed CLI is `1.2.0` (`openspec --version`, binary `/usr/bin/openspec`). npm `latest`
is `1.10.0` (`npm view @fission-ai/openspec dist-tags` → `latest: '1.10.0'`). Against a
scratch openspec project I ran all three candidate forms on the *same* binary:

| Invocation | Result |
| --- | --- |
| `openspec validate goodchange` (CON-115 form) | valid, exit 0 |
| `openspec validate goodchange --type change` (CON-130 form) | `Change 'goodchange' is valid`, exit 0 |
| `openspec validate --change goodchange` (current doc) | `error: unknown option '--change' (Did you mean --changes?)`, exit 1 |

Both proposed replacements work simultaneously on one binary, so the disagreement cannot be
version drift. design.md's reasoning is sound and the conclusion stands.

**Decision 1 — `--type change` over the bare positional: CONFIRMED, and its rationale is
empirically true, not merely plausible.** I created a spec named `goodchange` alongside the
change `goodchange`:
- `openspec validate "goodchange"` → `Ambiguous item 'goodchange' matches both a change and a spec.` exit 1
- `openspec validate "goodchange" --type change` → `Change 'goodchange' is valid`, exit 0

The collision hazard design.md hypothesises is real and `--type change` is the correct pick.

**Decision 3 — `validate` exits non-zero on failure: CONFIRMED.**
- malformed delta (no `## ADDED Requirements` header) → 2 errors printed, `EXIT=1`
- requirement missing body text → 1 error printed, `EXIT=1`
- well-formed change → `Change 'goodchange' is valid`, `EXIT=0`

`validate` does not share `archive`'s exit-0-on-abort defect. AC 3's conditional does not trigger.

**`openspec instructions --change` is correct as written: CONFIRMED.** `openspec instructions
--help` lists `--change <id>`. design.md is right that CON-115's suspicion here is a false
lead and this must not be "fixed".

**Decision 4 — the five-file enumeration: REFUTED. It is wrong in both directions.**
`grep -rn "validate --change\|validateCmd"` over the tree (excluding `node_modules`,
`.concertino/worktrees`, `openspec/changes/archive`) returns:

```
docs/config-reference.md:258        (listed in design.md)
lib/cli/init.js:132                 (listed)
lib/cli/render.js:75                (listed)
core/roles/orchestrator.md:582,868  (listed)
config/examples/concertino.json:19  NOT LISTED
config/examples/helio.json:11       NOT LISTED
openspec/specs/followup-triage/spec.md:101  NOT LISTED
```

and `concertino.config.json` — design.md's row 1, described as "this repo's own config —
feeds every render here" — **does not exist in this repo and is gitignored** (`.gitignore`
line 5). So is every rendered-output path the plan says it will regenerate and commit:
`.gitignore` excludes `/.claude/agents/concertino-*.md`, `/.codex/roles/concertino-*.md`,
`/.opencode/agents/concertino-*.md`, `/AGENTS.md`, `scripts/concertino/.concertino.env`.
`find` confirms `.claude/agents`, `.opencode/agents` and `.codex/roles` do not exist here at all.

**Gate surface: CONFIRMED.** `npm test` is the gate (`package.json`); no test currently
asserts the `validateCmd` string, so no existing test breaks — and equally, nothing would
catch this regressing again. Note `npm run test:selftest` renders from
`config/examples/helio.json`, one of the files the plan omits.

**Scope constraint: CONFIRMED CLEAN.** No task touches `core/scripts/cleanup.sh`; the only
`openspec` hits under `core/scripts/` are path comments, not invocations.

### Verdict: REFUTE

Decisions 1, 2, 3 and 5 are sound and well-evidenced — I independently reproduced all of
them. Decision 4, the one that determines what actually gets fixed, is factually wrong, and
acceptance criterion 1 ("every `openspec` invocation ... matches the installed CLI's real
surface") cannot be met by executing tasks.md as written.

### Change Requests

1. **Remove `concertino.config.json` from Decision 4's table and delete task 3.1.** That file
   does not exist in this repo and is gitignored (`.gitignore:5`). An executor following task
   3.1 will either create a gitignored file that can never be committed, or waste a cycle
   discovering this. The "feeds every render here" justification is false — with no config
   present, `lib/cli/render.js:75`'s fallback is what this repo renders from, which is already
   task 3.2.

2. **Add the three real, tracked locations the enumeration missed, with tasks for each:**
   - `config/examples/concertino.json:19` and `config/examples/helio.json:11` — shipped example
     configs. These are the same class of defect as `lib/cli/init.js` (they seed the broken
     string into consumer projects), and `helio.json` is consumed by `npm run test:selftest`.
   - `openspec/specs/followup-triage/spec.md:101` — the canonical spec text asserts
     "`openspec validate --change <CHANGE_NAME>` is re-run clean" as a requirement. Leaving a
     canonical spec requiring the broken invocation contradicts this change's own new spec
     delta. If you judge editing a canonical spec out of scope, say so explicitly in design.md
     with a reason and file the follow-up — do not leave it silently unlisted.

3. **Fix the "regenerate rendered harness outputs ... and commit them alongside" plan**
   (proposal.md "What Changes" bullet 3; tasks 6.1–6.3). `.claude/agents/`, `.opencode/agents/`
   and `.codex/roles/` are gitignored in this repo and do not exist on disk; they cannot be
   committed alongside. Either (a) drop the commit-rendered-outputs claim and replace task 6
   with a `bin/concertino sync --out=<tmp> --dry-run` verification that the *rendered* output
   now carries the corrected string (which is a real, valuable check and uses the existing
   `test:selftest` mechanism), or (b) name the specific tracked files you believe sync
   rewrites. As written, task 6.2's "confirm the regenerated `.claude/agents/` ... no longer
   contain `validate --change`" is unexecutable.

4. **Add a regression guard to task 5 or 7.** This exact defect was filed twice (CON-115,
   CON-130) and survived; `npm test` has nothing that would catch it returning. The repo
   already has render-assertion tests (`test/scripts/auditor-render.test.sh`,
   `opencode-render.test.sh`, `local-provider-render.test.sh`) to model on. Add a task for a
   test asserting the `specArtifacts` render fallback and the `init.js` scaffold both emit
   `--type change` and never `validate --change`. Without it, tasks 5 and 7.1 are one-shot
   manual evidence that decays the moment someone edits `render.js`.

5. **Task 5.1's malformed-change recipe needs no change, but state the expected exit code.**
   I confirmed a spec delta missing its `## ADDED Requirements` header yields exit 1 with
   `No delta sections found` — the recipe works. Record the expected non-zero exit in the task
   so the executor cannot report "it went red" from stdout alone.

6. **No task delivers spec Requirement 2's documentation obligation.** The new spec delta says
   "the role documentation MUST assert on whichever signal the CLI reports failure through",
   but tasks 3.5 and 4.1 only change the command string and add the version note. The existing
   wording is "Validate before handoff (fix any errors first)" (`lib/cli/render.js:81`) and
   "re-run ... clean" (`core/roles/orchestrator.md:582,868`) — neither names exit status. Either
   add a task making the exit-0 requirement explicit at those three sites, or soften the spec
   requirement to match what you actually intend to ship. As it stands, design and spec disagree.

### Non-blocking notes

- design.md asserts openspec 1.2.0 was "published 2026-02-23". I could not confirm the date
  from `npm view`; it is not load-bearing for any decision, but drop it rather than state an
  unverified date in a doc whose whole point is not stating unverified things about the CLI.
- design.md's Decision 4 calls `lib/cli/init.js` "the highest-leverage of the five" — with
  `config/examples/*.json` added, those are in the same leverage class (copied by users
  authoring a config by hand rather than via `init`). Worth saying so.
