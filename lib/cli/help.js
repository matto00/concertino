'use strict';

const { cyan, dim, banner } = require('./shared');

function help() {
  console.log(banner());
  console.log(`render the agent orchestra from ${dim('core/')} + your project config.

  ${cyan('concertino init')} ${dim('[--out=DIR] [--core=PATH]')}
      Interactive setup (TUI): write concertino.config.json, copy scripts + laws,
      scaffold the spec provider, then auto-sync agent files.
      Flags:
        ${dim('--example=helio|generic|opencode-ollama')}   skip prompts; start from an example profile
        ${dim('--yes')}                     skip prompts; use generic defaults + gate detection
        ${dim('--openspec-init')}           force openspec install + init (non-interactive)
        ${dim('--no-spec-setup')}           don't touch the spec provider
        ${dim('--core=PATH')}               render from PATH instead of the auto-detected core

  ${cyan('concertino sync')} ${dim('[--config=PATH] [--out=DIR] [--harness=claude-code,codex,opencode] [--core=PATH] [--dry-run]')}
      Render the harness files (Claude agents/command, Codex AGENTS.md/.codex,
      OpenCode opencode.json/.opencode) and regenerate .concertino.env from the
      config. Re-run after every edit.
      By default renders from the target's own ${dim('core/')} when the target is a
      git worktree of the same repo the CLI's own code lives in (with a note
      if the two differ); ${dim('--core=PATH')} forces a specific core explicitly.

  ${cyan('concertino update')} ${dim('<key=value> [...] [--config=PATH] [--out=DIR] [--core=PATH] [--dry-run]')}
      Update one or more config fields using dot-notation, then re-sync.
      Examples:
        ${dim('concertino update models.claude-code.skeptic=opus models.claude-code.evaluator=haiku')}
        ${dim('concertino update models.codex.auditor=gpt-5.1-codex')}
        ${dim('concertino update project.name=myapp budgets.executionCycles=5')}
        ${dim('concertino update agentMerge.enabled=true agentMerge.mergeMethod=squash')}

  ${cyan('concertino validate')} ${dim('[--config=PATH] [--out=DIR] [--ticket=ID]')}
      Check concertino.config.json for errors and warnings before syncing.
      With --ticket=ID, also live-fetches that ticket (ticketProvider.kind
      "linear" only) and validates any harness:<value> override it declares.

  ${cyan('concertino diff')} ${dim('[--config=PATH] [--out=DIR] [--harness=...] [--core=PATH]')}
      Show a unified diff between what sync would write and what's on disk.
      Runs the full template render; nothing is written.

  ${cyan('concertino doctor')} ${dim('[--config=PATH] [--out=DIR] [--core=PATH]')}
      Check the environment: node, git, gh auth, claude CLI, Codex CLI (if
      harness includes codex), Linear MCP (if ticket provider is linear),
      Playwright (if ui.enabled). Also byte-compares the rendered artifacts
      against core and warns when they have drifted. Always reports which
      core path it compared against, and whether it was forced via --core.

  ${cyan('concertino watch')} ${dim('[--config=PATH] [--out=DIR]')}
      Live fleet dashboard: every active run, its phase, gates,
      and escalations. ↵ attaches, n starts a run, q quits. Needs tmux.
      Also prunes eligible run logs once, best-effort, at startup.

  ${cyan('concertino prune')} ${dim('[--dry-run] [--config=PATH] [--out=DIR]')}
      Remove event logs under .concertino/runs/ that are both terminal (a
      run.end event was logged) and older than dashboard.retentionDays
      (default 30). A run with no run.end event is never removed, regardless
      of age. ${dim('--dry-run')} reports what would be removed without
      touching disk.

  ${cyan('concertino upgrade')} ${dim('[--out=DIR]')}
      Scan generated files for stale concertino version markers and report
      which need a re-sync.

  ${cyan('concertino gates')} ${dim('[--run=NAME] [--config=PATH] [--out=DIR]')}
      Without --run: list all configured gates with their commands.
      With --run: execute that gate's command against the project root.

  ${cyan('concertino eject')} ${dim('--role=<orchestrator|executor|evaluator|skeptic|auditor> [--harness=claude-code|codex|opencode] [--config=PATH] [--out=DIR] [--core=PATH]')}
      Print the fully-rendered agent file for a role to stdout. Respects
      local template overrides in .concertino/roles/. Useful for debugging
      exactly what an agent is reading. The codex harness only supports
      executor, evaluator, and auditor (the optional worker-dispatch roles);
      claude-code and opencode support all five roles.
      Example: ${dim('concertino eject --role=executor | less')}

  ${cyan('concertino migrate')} ${dim('[--config=PATH] [--out=DIR] [--dry-run]')}
      Add any config fields that are missing (new defaults from a newer
      version of concertino). Never overwrites existing values.

  ${cyan('concertino completion')} ${dim('[fish|zsh|bash]')}
      Print a shell completion script. Defaults to fish.
      Usage: ${dim('concertino completion fish | source  # fish')}
             ${dim('source <(concertino completion bash)  # bash')}

  ${cyan('concertino --version')}

  ${cyan('concertino help')}

Docs: ${dim('docs/quickstart.md · docs/config-reference.md · docs/adapting-to-your-project.md')}`);
}

module.exports = { help };
