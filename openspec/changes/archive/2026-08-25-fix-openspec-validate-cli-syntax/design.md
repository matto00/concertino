## Context

Concertino's Planning phase ends with a validation gate. The command that gate runs has never been valid.

The installed CLI is `@fission-ai/openspec` **1.2.0** (`openspec --version` → `1.2.0`; binary at `/usr/bin/openspec` → `/usr/lib/node_modules/@fission-ai/openspec/bin/openspec.js`). There is no project-level pin: the `"openspec": "^0.0.0"` entry in `package.json` is an unrelated abandoned 2019 name-squat, not this CLI. npm `latest` is **1.10.0**, so the installed CLI is roughly six months stale relative to npm — but nothing in this repo asks for a particular version, so 1.2.0 is simply what agents encounter.

## Ground-truth CLI surface (v1.2.0, captured from `--help`)

`openspec validate --help`:

```
Usage: openspec validate [options] [item-name]
Options:
  --all              Validate all changes and specs
  --changes          Validate all changes
  --specs            Validate all specs
  --type <type>      Specify item type when ambiguous: change|spec
  --strict           Enable strict validation mode
  --json             Output validation results as JSON
  --concurrency <n>  Max concurrent validations
  --no-interactive   Disable interactive prompts
```

There is no `--change`. The change name is a **positional** `[item-name]`.

`openspec instructions --help` **does** list `--change <id>  Change name`. So `openspec instructions <artifact-id> --change "<CHANGE_NAME>"` is correct as written — CON-115's suspicion about it is a false lead, and it must not be "fixed".

`openspec archive --help` still accepts `-y/--yes`, `--skip-specs`, `--no-validate`. All existing archive invocations are correct as written.

## Decision 1 — replacement form: `openspec validate "<NAME>" --type change`

Both candidate replacements work today:

| Invocation | Result on installed 1.2.0 |
| --- | --- |
| `openspec validate <name>` (CON-115) | works |
| `openspec validate <name> --type change` (CON-130) | works |
| `openspec validate --change <name>` (current doc) | `error: unknown option '--change' (Did you mean --changes?)`, exit 1, validation never attempted |

We adopt the explicit `--type change` form. `--type` exists precisely to disambiguate when a change and a spec share a name — an entirely plausible collision in this repo, since change names are derived from ticket titles and capability spec names are derived from the same vocabulary. The bare positional would resolve ambiguously (or interactively) in that case; `--type change` cannot. The cost is one flag.

## Decision 2 — the "twelve-day CLI drift" reading in the ticket's addendum is **refuted**

The ticket asks whoever works it to say so with evidence if they conclude the drift reading is wrong. It is wrong.

Both CON-115's and CON-130's proposed replacements are **simultaneously valid on the same installed 1.2.0 binary, today**. If the CLI had changed between 2026-08-09 and 2026-08-21 such that the bare positional stopped working and `--type change` started working, exactly one of them would work now. Both do. Further, the installed CLI is 1.2.0 — it did not change at any point during the twelve-day window in question, because nothing upgraded it.

The likelier and better-supported story: each filer verified one working form and did not test the other. Neither filing is inaccurate; both are incomplete about the alternative. The disagreement is between two under-specified observations, not between two CLI versions.

This does **not** weaken the "pin or state the version" acceptance criterion — it just relocates its justification. The real hazard is not that these two tickets caught a live drift; it is that a doc hardcodes a command surface with nothing recording which surface it was written against, so the next genuine upgrade (1.2.0 → 1.10.0 is eight minor versions of unreviewed change) produces exactly this failure with no way to tell. Stating the version is the fix for that, and it remains load-bearing.

## Decision 3 — assert on exit code, not stdout

The ticket asks whether `validate` shares `archive`'s exit-0-on-abort defect. Measured directly against the installed CLI:

- malformed change → non-zero exit, errors on stdout
- well-formed change → exit 0, `Change '<name>' is valid`

`validate` reports failure honestly through its exit status. The role docs therefore do **not** need to switch to stdout-only assertion; the AC's conditional ("if `openspec validate` can fail while exiting 0") does not trigger. Execution must re-demonstrate this against a deliberately malformed change and capture the transcript as evidence — this is a first-class acceptance criterion, not assumed.

## Decision 4 — fix locus is six tracked source files, and the rendered outputs are NOT committable here

This is the finding that makes the change bigger than its title. The Planning-step validate block agents actually read is **not authored in `core/roles/orchestrator.md`**. `lib/cli/render.js` injects it at render time from `specProvider.validateCmd`:

```js
const validate = sp.validateCmd || 'openspec validate --change "<CHANGE_NAME>"';
```

Full enumeration of the broken string on base `fb914c4`, restricted to **tracked** files (excluding `node_modules`, `.concertino/worktrees`, and `openspec/changes/archive`, which is historical report text and must not be rewritten):

| Location | Nature |
| --- | --- |
| `lib/cli/render.js:75` (`specArtifacts` case) | hardcoded fallback — **this is what this repo actually renders from**, since no local config exists |
| `lib/cli/init.js:132` (`specProvider` scaffold) | written into every newly-initialised project |
| `config/examples/concertino.json:19` | shipped example config, copied by users authoring a config by hand |
| `config/examples/helio.json:11` | shipped example config; also the input to `npm run test:selftest` |
| `docs/config-reference.md:258` | documentation example shown to users authoring a config |
| `core/roles/orchestrator.md` ×2 (Design-ticket Planning step 4; the fold-in "Re-validate" step) | hand-written prose, genuinely in core |
| `openspec/specs/followup-triage/spec.md:101` | **canonical spec text** requiring the broken invocation be "re-run clean" |

`lib/cli/init.js` and the two `config/examples/*.json` are the highest-leverage of these — they are the paths by which the defect is re-seeded into consumer projects, whether the user scaffolds via `init` or copies an example by hand. They are in the same leverage class as each other.

`openspec/specs/followup-triage/spec.md:101` is included deliberately rather than deferred: leaving a canonical spec that *requires* the broken invocation would directly contradict this change's own new spec delta, which requires documented invocations to be valid. Correcting the command string inside that existing requirement is a text fix to an already-canonical statement, not a new requirement, so it does not need its own spec delta.

**`concertino.config.json` is explicitly NOT in this list.** It is gitignored (`.gitignore:5`) and does not exist in this repo. An earlier draft of this design listed it as "this repo's own config — feeds every render here"; that was wrong in both halves. With no local config present, `lib/cli/render.js:75`'s fallback is what renders here, which is already the first row above.

**Rendered outputs cannot be committed alongside in this repo.** `.gitignore` excludes `/.claude/agents/concertino-*.md`, `/.codex/roles/concertino-*.md`, `/.opencode/agents/concertino-*.md`, `/AGENTS.md`, and `scripts/concertino/.concertino.env`; the first three directories do not exist on disk here at all. So "run `concertino sync` and commit the regenerated agents" — the natural instinct, and what an earlier draft of this plan said — is unexecutable. Instead, Execution verifies the *rendered* result without committing it, by rendering into a throwaway directory outside the checkout — exactly the pattern the repo's existing render tests already use (`test/scripts/auditor-render.test.sh`):

```
OUT="$(mktemp -d)"
node bin/concertino sync --out="$OUT" --config=config/examples/helio.json
grep -c 'validate --change' "$OUT/.claude/agents/concertino-orchestrator.md"
```

and asserts the rendered orchestrator carries `--type change` and contains **no** occurrence of `validate --change`. This is a stronger check than inspecting source strings, because it exercises the actual render path end to end.

**`--dry-run` must NOT be used for this.** `concertino sync --dry-run` prints filenames only and writes nothing (`lib/cli/sync.js`, `lib/cli/help.js`); a dry-run into a fresh `mktemp -d` leaves the directory empty, so every `grep` against it would pass vacuously — a green check proving nothing. Measured: dry-run → 0 files written; real sync → 47 files. The `--out=<throwaway>` form is safe for the same reason it is safe in the existing render tests: it never touches this checkout's own `.claude/`, `.codex/` or `scripts/concertino/`.

The rendered orchestrator contains the injected validate block **twice** plus two prose occurrences (4 total matches for `validate --change` on base). Assertions must therefore be on **total absence** across the whole file, not a single-site match, so a partial fix cannot pass.

## Decision 5 — stated version, not pinned or auto-detected

Options considered: (a) add `@fission-ai/openspec` as a real devDependency pinned to 1.2.0; (b) detect the version at runtime and branch; (c) state the targeted surface in the doc with a trust-`--help` escape hatch.

We take (c). (a) changes how every consumer installs their toolchain and would force an immediate 1.2.0→1.10.0 compatibility review that this ticket has no mandate for; it also cannot bind a globally-installed binary, which is what agents actually invoke. (b) is machinery the ticket explicitly does not ask for and adds a runtime failure mode to every Planning phase. (c) costs a short note, satisfies AC 4 as literally written ("pinned **or stated**"), and — critically — gives the agent an instruction for the disagreement case, which is the situation that actually caused this bug's twelve-month lifetime: an agent reading a doc that contradicts the tool and having no rule about which wins.

The note states: the targeted surface is v1.2.0; npm latest is 1.10.0; if `openspec <cmd> --help` disagrees with this doc, trust `--help`, do not guess, and file a follow-up ticket.

## Decision 6 — the fix needs a regression test, not just one-shot evidence

This exact defect was filed twice (CON-115 on 2026-08-09, CON-130 on 2026-08-21) and survived both. `npm test` currently asserts nothing about the validate command string, so nothing would catch it returning the moment someone edits `render.js` or an example config. Manual demonstration evidence (Decision 3, task 5) proves the fix works *today* and then decays.

We therefore add a shell test in the style the repo already uses for render assertions (`test/scripts/auditor-render.test.sh`, `opencode-render.test.sh`, `local-provider-render.test.sh`): render a **real** sync into a throwaway `--out="$(mktemp -d)"` (never `--dry-run`, per Decision 4, and never this checkout's own directories), assert the rendered orchestrator file **exists**, then assert it contains `--type change` and contains no `validate --change` anywhere — plus a direct assertion on `lib/cli/init.js`'s scaffolded value. Wired into the `npm test` chain in `package.json`.

The file-exists precondition is load-bearing: those tests' `hasnt` helper is `grep -qF ... 2>/dev/null` negated, which returns `ok` against a missing file. Without an exists-check, a test that renders nothing would report all-green.

## Decision 7 — the docs must name exit status as the success signal

The new spec delta requires the role documentation to assert on whichever signal the CLI reports failure through. Correcting the command string alone does not satisfy that: the surrounding wording is currently "Validate before handoff (fix any errors first)" (`lib/cli/render.js:81`) and "re-run ... clean" (`core/roles/orchestrator.md` ×2) — neither names exit status, so an agent has no stated criterion for what "clean" means and could plausibly eyeball stdout. Since Decision 3 establishes that `validate` reports failure honestly through exit status, all three sites are amended to say the command must exit zero. Without this, design and spec disagree.

## Risks / Trade-offs

- **Concurrent run collision.** CON-138 is live in this repo on `core/scripts/cleanup.sh`. This change touches none of `core/scripts/`. If any step turns out to require editing `cleanup.sh`, stop and escalate rather than editing.
- **CON-140 proximity.** CON-140 (base commit `fb914c4`) edited turn-discipline prose in `core/roles/orchestrator.md`. Our two prose edits are at the openspec-invocation lines, disjoint from CON-140's. Edit around them.
- **`concertino sync` provenance.** CON-128 records that a stale global `concertino` binary can silently regenerate rendered agents from stale core. Execution must run sync via this repo's own `node bin/concertino` entrypoint, never a globally-installed `concertino`, and record which binary ran.
- **Editing a canonical spec.** `openspec/specs/followup-triage/spec.md` is canonical, already-archived spec text. We amend the command string inside an existing requirement rather than adding or removing a requirement, so no spec delta is owed and `openspec validate --specs` must still pass afterwards.
- **Stating a version invites staleness of its own.** The note will itself be wrong after an upgrade. Mitigated by the trust-`--help` rule, which makes the doc self-correcting in the failure case rather than authoritative-and-wrong.

## Gate-Chain Implications Checklist

Not applicable — this change touches no `.husky/**` hook and no script a hook invokes. It modifies documentation, a JSON config, two `lib/cli/` modules, and regenerated agent/script outputs. `scripts/concertino/` regenerated output is invoked by agents, not by the commit gate chain.
