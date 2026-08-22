'use strict';

const { cyan, dim, banner } = require('./shared');

// Per-command usage text, extracted from what used to be a single monolithic
// template string in help() — now the one source of truth reused by both
// `concertino help` (the full listing, composed below in USAGE_ORDER) and
// each subcommand's own `--help`/`-h` check (printUsage(cmdName)). Keep
// each block's exact text/formatting in sync with what `concertino help`
// used to render verbatim for that command — see tasks.md 2.4 for the
// byte-for-byte parity check.
const USAGE = {
  init: `  ${cyan('concertino init')} ${dim('[--out=DIR] [--core=PATH]')}
      Interactive setup (TUI): write concertino.config.json, copy scripts + laws,
      scaffold the spec provider, then auto-sync agent files.
      Flags:
        ${dim('--example=helio|generic|opencode-ollama')}   skip prompts; start from an example profile
        ${dim('--yes')}                     skip prompts; use generic defaults + gate detection
        ${dim('--openspec-init')}           force openspec install + init (non-interactive)
        ${dim('--no-spec-setup')}           don't touch the spec provider
        ${dim('--core=PATH')}               render from PATH instead of the auto-detected core`,

  sync: `  ${cyan('concertino sync')} ${dim('[--config=PATH] [--out=DIR] [--harness=claude-code,codex,opencode] [--core=PATH] [--dry-run]')}
      Render the harness files (Claude agents/command, Codex AGENTS.md/.codex,
      OpenCode opencode.json/.opencode) and regenerate .concertino.env from the
      config. Re-run after every edit. Destructive: whole-file regeneration,
      no confirmation prompt — run ${cyan('concertino diff')} first to preview.
      Prints a provenance line before writing anything: the resolved binary
      path as invoked, whether it's a linked global (npm-linked to a dev
      checkout) vs. a plain install, and the resolved ${dim('core/')} root.
      By default renders from the target's own ${dim('core/')} when the target is a
      git worktree of the same repo the CLI's own code lives in (with a note
      if the two differ); ${dim('--core=PATH')} forces a specific core explicitly.
      ${dim('--dry-run')} prints filenames only (would write/would copy) — no
      diff content, no changed/unchanged distinction; use
      ${cyan('concertino diff')} for a content-level preview.`,

  update: `  ${cyan('concertino update')} ${dim('<key=value> [...] [--config=PATH] [--out=DIR] [--core=PATH] [--dry-run]')}
      Update one or more config fields using dot-notation, then re-sync.
      Examples:
        ${dim('concertino update models.claude-code.skeptic=opus models.claude-code.evaluator=haiku')}
        ${dim('concertino update models.codex.auditor=gpt-5.1-codex')}
        ${dim('concertino update project.name=myapp budgets.executionCycles=5')}
        ${dim('concertino update agentMerge.enabled=true agentMerge.mergeMethod=squash')}`,

  validate: `  ${cyan('concertino validate')} ${dim('[--config=PATH] [--out=DIR] [--ticket=ID]')}
      Check concertino.config.json for errors and warnings before syncing.
      With --ticket=ID, also live-fetches that ticket (ticketProvider.kind
      "linear" or "local"/"manual") and validates any harness:<value>
      override it declares.`,

  diff: `  ${cyan('concertino diff')} ${dim('[--config=PATH] [--out=DIR] [--harness=...] [--core=PATH]')}
      Show a unified diff between what sync would write and what's on disk —
      the content-level preview for a destructive ${cyan('concertino sync')}.
      Covers every file sync can write: rendered role/command files,
      ${dim('scripts/concertino/*')}, ${dim('.concertino/laws/*')},
      ${dim('.concertino/workflow-state.template.md')}, ${dim('.claude/settings.json')}
      (merged result), ${dim('AGENTS.md')} (merged region), and the codex
      role/prompt files — so a local edit anywhere sync touches shows up as
      a pending loss before it happens. Runs the full template render;
      nothing is written. Also prints the same provenance line ${cyan('sync')} does.`,

  doctor: `  ${cyan('concertino doctor')} ${dim('[--config=PATH] [--out=DIR] [--core=PATH]')}
      Check the environment: node, git, gh auth, claude CLI, Codex CLI (if
      harness includes codex), Linear MCP (if ticket provider is linear),
      Playwright (if ui.enabled). Also byte-compares the rendered artifacts
      against core and warns when they have drifted. Always reports which
      core path it compared against, and whether it was forced via --core.`,

  watch: `  ${cyan('concertino watch')} ${dim('[--config=PATH] [--out=DIR]')}
      Live fleet dashboard: every active run, its phase, gates,
      and escalations. ↵ attaches, n starts a run, q quits. Needs tmux.
      Also prunes eligible run logs once, best-effort, at startup.
      Explicit alias for bare ${cyan('concertino')} above — both launch the
      same dashboard.`,

  prune: `  ${cyan('concertino prune')} ${dim('[--dry-run] [--config=PATH] [--out=DIR]')}
      Remove event logs under .concertino/runs/ that are both terminal (a
      run.end event was logged) and older than dashboard.retentionDays
      (default 30). A run with no run.end event is never removed, regardless
      of age. ${dim('--dry-run')} reports what would be removed without
      touching disk.`,

  upgrade: `  ${cyan('concertino upgrade')} ${dim('[--out=DIR]')}
      Scan generated files for stale concertino version markers and report
      which need a re-sync.`,

  gates: `  ${cyan('concertino gates')} ${dim('[--run=NAME] [--config=PATH] [--out=DIR]')}
      Without --run: list all configured gates with their commands.
      With --run: execute that gate's command against the project root.`,

  eject: `  ${cyan('concertino eject')} ${dim('--role=<orchestrator|executor|evaluator|skeptic|auditor> [--harness=claude-code[,codex,opencode]] [--config=PATH] [--out=DIR] [--core=PATH]')}
      Print the fully-rendered agent file for a role to stdout. Respects
      local template overrides in .concertino/roles/. Useful for debugging
      exactly what an agent is reading. --harness accepts a comma-separated
      list, same as sync/diff; naming more than one prints each harness's
      section in turn, preceded by a "# ---- harness: <name> ----" header —
      the default single-harness case (claude-code, unchanged) prints the
      raw rendered file with no header. The codex harness only supports
      executor, evaluator, and auditor (the optional worker-dispatch roles);
      claude-code and opencode support all five roles.
      Example: ${dim('concertino eject --role=executor | less')}`,

  migrate: `  ${cyan('concertino migrate')} ${dim('[--config=PATH] [--out=DIR] [--dry-run]')}
      Add any config fields that are missing (new defaults from a newer
      version of concertino). Never overwrites existing values.`,

  answer: `  ${cyan('concertino answer')} ${dim('<ticket> <value> [--sub <index> --total <n>] [--out=DIR]')}
      Answer a pending escalation from outside the dashboard TUI (e.g. from a
      chat session) — the same authoritative write path the dashboard's own
      escalation screen uses.`,

  completion: `  ${cyan('concertino completion')} ${dim('[fish|zsh|bash]')}
      Print a shell completion script. Defaults to fish.
      Usage: ${dim('concertino completion fish | source  # fish')}
             ${dim('source <(concertino completion bash)  # bash')}`,
};

// Display order for the aggregate `concertino help` listing — preserved
// exactly as it was before the per-command extraction (tasks.md 2.3/2.4).
const USAGE_ORDER = [
  'init', 'sync', 'update', 'validate', 'diff', 'doctor', 'watch', 'prune',
  'upgrade', 'gates', 'eject', 'migrate', 'answer', 'completion',
];

// Prints banner() + one command's own usage block — used by every `cmd*`
// function's `--help`/`-h` check. Deliberately excludes the aggregate
// listing's trailing "Docs: ..." footer line: that line is a footer for the
// whole `concertino help` listing, not any single command (design.md
// Decision 3).
function printUsage(cmdName) {
  console.log(banner());
  console.log(USAGE[cmdName]);
}

function help() {
  console.log(banner());
  console.log(`render the agent orchestra from ${dim('core/')} + your project config.

  ${cyan('concertino')} ${dim('[--config=PATH] [--out=DIR]')}
      Launch the live fleet dashboard — same as ${cyan('concertino watch')} below.
      This is the default when no subcommand is given.

${USAGE_ORDER.map((name) => USAGE[name]).join('\n\n')}

  ${cyan('concertino --version')}

  ${cyan('concertino help')}

Docs: ${dim('docs/quickstart.md · docs/config-reference.md · docs/adapting-to-your-project.md')}`);
}

module.exports = { help, printUsage };
