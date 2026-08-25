# CON-130: openspec CLI invocation audit

## CLI version / binary

```
$ openspec --version
1.2.0
$ which openspec
/usr/bin/openspec
$ readlink -f "$(which openspec)"
/usr/lib/node_modules/@fission-ai/openspec/bin/openspec.js
```

## Ground-truth `--help` output (verbatim)

```
$ openspec validate --help
Usage: openspec validate [options] [item-name]

Validate changes and specs

Options:
  --all              Validate all changes and specs
  --changes          Validate all changes
  --specs            Validate all specs
  --type <type>      Specify item type when ambiguous: change|spec
  --strict           Enable strict validation mode
  --json             Output validation results as JSON
  --concurrency <n>  Max concurrent validations (defaults to env
                     OPENSPEC_CONCURRENCY or 6)
  --no-interactive   Disable interactive prompts
  -h, --help         display help for command
```

```
$ openspec instructions --help
Usage: openspec instructions [options] [artifact]

Output enriched instructions for creating an artifact or applying tasks

Options:
  --change <id>    Change name
  --schema <name>  Schema override (auto-detected from config.yaml)
  --json           Output as JSON
  -h, --help       display help for command
```

```
$ openspec archive --help
Usage: openspec archive [options] [change-name]

Archive a completed change and update main specs

Options:
  -y, --yes      Skip confirmation prompts
  --skip-specs   Skip spec update operations (useful for infrastructure,
                 tooling, or doc-only changes)
  --no-validate  Skip validation (not recommended, requires confirmation)
  -h, --help     display help for command
```

Conclusions confirmed against installed 1.2.0:
- `validate` has **no** `--change` flag. The change/spec name is a positional
  `[item-name]`; `--type <type>` disambiguates change vs. spec.
- `instructions` **does** accept `--change <id>` — every existing
  `openspec instructions ... --change` invocation is correct as written.
- `archive` still accepts `-y/--yes`, `--skip-specs`, `--no-validate` — every
  existing `openspec archive` invocation is correct as written.

## Enumeration: every `openspec` invocation reachable from `core/`

`grep -rn 'openspec ' core/roles/`:

| Location | Invocation | Verdict |
| --- | --- | --- |
| `core/roles/orchestrator.md:582` (before fix) | `openspec validate --change <CHANGE_NAME>` | **BROKEN** — `--change` does not exist on `validate`. Fixed → `openspec validate <CHANGE_NAME> --type change`. |
| `core/roles/orchestrator.md:586` | prose reference to `openspec archive` behavior, no invocation | correct-as-written / non-invocation |
| `core/roles/orchestrator.md:850` | `openspec archive <CHANGE_NAME> --yes` | correct-as-written — `archive --help` lists `-y, --yes` |
| `core/roles/orchestrator.md:854` | prose: "`openspec validate` cannot operate on an archived change directory" — discusses `openspec validate` without invoking it | non-invocation prose mention, needs no change |
| `core/roles/orchestrator.md:868` (before fix) | `openspec validate --change <CHANGE_NAME>` | **BROKEN**, same defect as :582. Fixed → `openspec validate <CHANGE_NAME> --type change`. |
| `core/roles/orchestrator.md:899` | `openspec archive <CHANGE_NAME> --yes` | correct-as-written |
| `core/roles/orchestrator.md:908` | prose reference to `openspec archive`, no full invocation on this line | correct-as-written / non-invocation |
| `core/roles/orchestrator.md:913` | `openspec archive <CHANGE_NAME> --yes --skip-specs` | correct-as-written — `--skip-specs` is a real flag |

`grep -rn 'openspec' core/scripts/`: every hit (`persist-evidence.sh:108`,
`set-ticket-state.sh:149`, `squash-branch.sh:26`, `assert-phase.sh:283,287`)
is a path/comment reference to `openspec/changes/...` or `openspec/specs/...`,
never a CLI invocation. No changes needed.

## Tracked-file enumeration of the broken string (design.md Decision 4)

`grep -rln 'validate --change\|validateCmd'` (excluding `node_modules`,
`.concertino/worktrees`, `openspec/changes/archive`), cross-checked against
`git ls-files`:

| Location | Nature | Verdict |
| --- | --- | --- |
| `lib/cli/render.js:75` | hardcoded `validateCmd` fallback in `specArtifacts` — what this repo actually renders from | **FIXED** |
| `lib/cli/init.js:132` | scaffolded `specProvider.validateCmd` for new projects | **FIXED** |
| `config/examples/concertino.json:19` | shipped example config | **FIXED** |
| `config/examples/helio.json:11` | shipped example config; input to `npm run test:selftest` | **FIXED** |
| `docs/config-reference.md:258` | doc example JSON block | **FIXED** |
| `core/roles/orchestrator.md` ×2 (lines 582, 868 pre-fix) | hand-written Planning-phase prose | **FIXED** |
| `openspec/specs/followup-triage/spec.md:101` | canonical spec text requiring the broken invocation be "re-run clean" | **FIXED** (command string only; requirement text/structure untouched) |

`lib/config.js:531` and `config/concertino.schema.json:45` also matched the
`validateCmd` grep term, but only as the **field name** (`'validateCmd'` in a
key-copy loop / JSON-schema property key) — neither contains the broken
command string. **No edit needed.**

`concertino.config.json` is absent and gitignored in this repo (confirmed via
`git status` / `.gitignore:5`) — not edited or created, per scope constraint.

`openspec/changes/archive/**` and this change's own planning docs
(`ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
`skeptic-design-{1,2,3}.md`) still contain the broken string in prose
describing the historical bug — left untouched, as required; they are not
live invocations.

## Untouched files confirmed correct-as-written

- Every `openspec archive` invocation across `core/` and rendered output.
- Every `openspec instructions ... --change` invocation across `core/` and
  rendered output — `instructions --help` lists `--change <id>` explicitly.
- `core/scripts/cleanup.sh` — not touched (CON-138 concurrent); grep confirms
  it contains no `openspec` CLI invocation of any kind.
