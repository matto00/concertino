## Why

`openspec validate --change "<CHANGE_NAME>"` is not a valid invocation of the installed openspec CLI (v1.2.0). Every run of the Planning phase has therefore been executing a command that exits 1 with `error: unknown option '--change' (Did you mean --changes?)` without ever attempting validation — a gate that has never once run. Two separate tickets (CON-115, CON-130) independently reported it and neither fix ever landed.

Fixing the string alone is insufficient and would fail the ticket's first acceptance criterion: the Planning-step invocation that agents actually read is not authored in `core/roles/orchestrator.md` at all. It is injected at render time by `lib/cli/render.js` from `specProvider.validateCmd`. The broken string lives in seven tracked locations across six source files plus one canonical spec, including `lib/cli/init.js`, which scaffolds it into every newly-initialised project.

## What Changes

- Correct the invocation to `openspec validate "<CHANGE_NAME>" --type change` in all six tracked source locations: `lib/cli/render.js` (the hardcoded fallback this repo actually renders from), `lib/cli/init.js` (new-project scaffold), `config/examples/concertino.json`, `config/examples/helio.json`, `docs/config-reference.md`, and the two hand-written prose occurrences in `core/roles/orchestrator.md` — plus the canonical spec text at `openspec/specs/followup-triage/spec.md`, which currently requires the broken invocation be "re-run clean".
- Amend the wording at those documentation sites to name **exit zero** as the success criterion, not the undefined "clean" / "fix any errors first".
- Add a stated CLI-surface note to `core/roles/orchestrator.md` recording the targeted openspec version (1.2.0), that npm `latest` has since moved to 1.10.0, and a one-line rule: if `openspec <cmd> --help` disagrees with this doc, trust `--help` and file a follow-up rather than guessing.
- Add a regression test asserting the rendered orchestrator and the `init` scaffold both emit `--type change` and never `validate --change`, wired into `npm test`. This defect was filed twice and survived both times because nothing tested it.
- Verify the render path end to end by rendering a real sync into a throwaway `--out` directory (never `--dry-run`, which writes nothing). Rendered harness outputs are **gitignored in this repo** and are therefore verified, not committed.
- Capture executable evidence: the corrected invocation run against a deliberately malformed change (must go red, non-zero exit) and against a well-formed one (must go green, exit 0), proving `validate` does not share `archive`'s exit-0-on-abort defect.
- Record the audit of every `openspec` invocation reachable from `core/`, including the confirmed-correct ones left unchanged (`openspec instructions --change`, every `openspec archive` form).

## Capabilities

- `spec-provider-commands` — the openspec command surface Concertino's role docs and rendered agents instruct agents to run.

## Non-Goals

- Upgrading the installed openspec CLI, or pinning it as a dependency.
- Auto-detecting the CLI version at runtime, or generating the commands from `--help` output.
- Repairing helio's 26 malformed canonical specs (helio HEL-775 owns that).
- Any change to `core/scripts/cleanup.sh` (CON-138 is live on that file).
- Rewriting historical report text under `openspec/changes/archive/`, which records what past runs actually ran.
- Creating a local `concertino.config.json` (gitignored in this repo).
