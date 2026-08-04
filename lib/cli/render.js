'use strict';

// Template rendering + generated-file bodies (.concertino.env, speeds.json) —
// the pure config-to-text layer shared by sync, diff, and eject. Extracted
// from bin/concertino verbatim.

// Config-domain logic (defaults, validation, schema flattening) shared with
// the in-TUI settings screen (CON-57) — extracted into lib/config.js since
// bin/concertino runs its own CLI dispatch the instant it is loaded and so
// is never a safe `require()` target. The lib/cli/ command modules require
// it directly, each taking just the pieces it needs.
const { VALID_HARNESSES, ROLES, isOllamaRouted } = require('../config');
const { VERSION, DEFAULT_ESCALATION_TIMEOUT_MIN, bt } = require('./shared');

// ---------- template rendering -------------------------------------------
function getVar(c, key) {
  switch (key) {
    case '_ticketPrefixExample': return c.ticketProvider.idExample;
    case '_breakpointsNote':
      return (c.ui.breakpoints && c.ui.breakpoints.length)
        ? ' (resize to: ' + c.ui.breakpoints.join(' / ') + ')' : '';
    case '_skepticUiCondition':
      return c.ui.enabled ? '(skip if no UI changes)' : '(N/A — no UI configured for this project)';
    default: {
      let v = c;
      for (const part of key.split('.')) v = (v == null ? undefined : v[part]);
      return v == null ? '' : String(v);
    }
  }
}

function block(name, c, harness) {
  const sp = c.specProvider;
  const fence = (cmd) => '   ```bash\n   ' + cmd + '\n   ```';
  const docList = (role) => {
    const ds = c.canonicalDocs.filter((d) => d.bindTo.includes(role));
    if (!ds.length) return '   - (none configured)';
    return ds.map((d) => {
      const when = (d.when && d.when !== 'always')
        ? 'binding when changes match ' + bt(d.when) : 'binding always';
      return '   - ' + bt(d.path) + ' — ' + (d.summary || 'project standard') + ' (' + when + ').';
    }).join('\n');
  };
  switch (name) {
    case 'docsExecutor': return docList('executor');
    case 'docsEvaluator': return docList('evaluator');
    case 'docsSkeptic': return docList('skeptic');
    case 'gates': {
      const groups = [];
      for (const g of c.gates) {
        let grp = groups.find((x) => x.when === g.when);
        if (!grp) groups.push((grp = { when: g.when, items: [] }));
        grp.items.push(g);
      }
      return groups.map((grp) => {
        const head = grp.when === 'always'
          ? 'Always:' : 'When changed files match ' + bt(grp.when) + ':';
        return head + '\n' + grp.items.map((g) => '  - ' + bt(g.command)).join('\n');
      }).join('\n\n');
    }
    case 'specReadNote':
      return sp.kind === 'openspec'
        ? "Do **not** read the proposal/design/tasks here — step 3's apply instructions return them via `contextFiles`; reading them twice wastes tokens."
        : 'Then read the planning artifacts in the change dir (proposal, design, tasks) — written during planning.';
    case 'specApply':
      return sp.kind === 'openspec' && sp.applyCmd
        ? fence(sp.applyCmd) + '\n\n   Read every file listed in the returned `contextFiles` array.'
        : '   Read the planning artifacts in the change dir (proposal, design, tasks).';
    case 'specScaffold':
      return sp.kind === 'openspec' && sp.scaffoldCmd
        ? fence(sp.scaffoldCmd)
        : '   Create the change directory ' + bt(sp.changeDir) + '.';
    case 'specArtifacts': {
      if (sp.kind === 'openspec') {
        const validate = sp.validateCmd || 'openspec validate --change "<CHANGE_NAME>"';
        return [
          "   - Get the build order: `openspec status --change \"<CHANGE_NAME>\" --json | jq 'del(.context)'` — parse `applyRequires` and the `artifacts` list.",
          "   - For each artifact with status `ready`: `openspec instructions <artifact-id> --change \"<CHANGE_NAME>\" --json | jq 'del(.context)'`. Use the returned `rules`, `template`, `instruction`, `outputPath`, `dependencies` — read the dependency files, then write the artifact to `outputPath` following `template`.",
          '   - Re-run `openspec status` after each; stop when every `applyRequires` id has `status: "done"`.',
          "   - `jq 'del(.context)'` strips the static context block openspec repeats on every call (already in your system context and `openspec/config.yaml`) — keep it to save tokens.",
          '',
          '   Validate before handoff (fix any errors first):',
          '   ```bash',
          '   ' + validate,
          '   ```'
        ].join('\n');
      }
      return [
        '   - Write `proposal.md` (what & why), `design.md` (approach + key decisions), and',
        '     `tasks.md` (an ordered checklist) into the change dir.',
        '   - If the change alters an API/schema contract, capture the delta alongside them.',
        '   - Confirm the artifacts cover every acceptance criterion before handoff.'
      ].join('\n');
    }
    case 'specArchive':
      if (sp.kind === 'openspec' && sp.archiveCmd) {
        return [
          '   ```bash',
          '   rm -f ' + sp.changeDir + '/files-modified.md',
          '   ' + sp.archiveCmd,
          '   ```',
          '',
          "   (`rm` drops the executor's handoff file so it doesn't trip spec-hygiene checks;",
          '   add `--skip-specs` to the archive for infra/doc-only changes.)',
          '',
          '   **Fill synced spec Purposes.** `openspec archive` writes a placeholder',
          '   `## Purpose` (`TBD - created by archiving change <CHANGE_NAME>`) into every',
          '   capability spec it creates or updates. Before committing, find and fix them:',
          '   ```bash',
          '   grep -rl "TBD - created by archiving change <CHANGE_NAME>" openspec/specs/',
          '   ```',
          '   For each match, rewrite the `## Purpose` body to a one-line sentence drawn from',
          "   `proposal.md`. Leave other changes' specs untouched.",
          '',
          '   Commit the archive as a separate commit.'
        ].join('\n');
      }
      return '   Move the change directory into your archive location (e.g. `spec/archive/`) and commit it as a separate commit.';
    case 'hygiene': {
      const lines = [
        '   ```bash',
        '   git worktree list                            # any stragglers?',
        '   git status --short                           # stray changes to tracked files?',
        '   ls *.png 2>/dev/null || true                 # leftover UI-review screenshots?'
      ];
      if (sp.kind === 'openspec')
        lines.push('   ls openspec/changes/ 2>/dev/null | grep -v archive || true   # un-archived changes?');
      lines.push('   ```');
      lines.push('');
      lines.push('   Report anything unexpected as a "Hygiene note:" — do not fix automatically.');
      return lines.join('\n');
    }
    case 'uiReview':
      if (!c.ui.enabled)
        return 'This project has no UI review configured — mark Phase 3 **N/A** and skip the dev-server steps below.';
      return 'Run if any UI-affecting files changed (triggers: '
        + (c.ui.triggers || []).map(bt).join(', ')
        + '). Otherwise mark Phase 3 **N/A**.';
    case 'ticketProvider':
      return {
        linear: 'Use the Linear MCP: `mcp__linear__get_issue` to fetch, `mcp__linear__save_issue` to set status, `mcp__linear__save_comment` to comment.',
        github: 'Use the GitHub MCP: `mcp__github__get_issue` to fetch (number, title, body, labels); `mcp__github__create_issue_comment` to comment; `mcp__github__update_issue` to set labels (use a label like `in-progress` / `done` to track status). For PR creation use `gh pr create` via Bash as normal.',
        manual: 'No external ticket system — the ticket text is provided inline or in the change dir `ticket.md`; skip status updates.'
      }[c.ticketProvider.kind] || '';
    case 'harnessResume':
      if (harness === 'codex') {
        return "Codex has no programmatic multi-agent dispatch or warm-resume. Run the loop **sequentially in a single thread**: where this spec says \"spawn\" or \"resume\" an agent, instead **switch into that role**, perform its steps (reading its spec), and persist `workflow-state.md` between phases. Approximate the skeptic's cold property by re-reading ground truth from scratch (the diff, the files, the running app) and ignoring your own earlier narrative at each gate. Because everything runs sequentially in the one thread that is reading this, there is no spawn/suspend boundary here to end a turn across — the CON-10 never-end-your-turn failure cannot occur on this default path. The one place it still can is the *optional* worker-dispatch path (`.codex/agents/*.toml` + `spawn_agents_on_csv`): if you use it to dispatch a worker, you must still wait for it to call `report_agent_job_result` before your own turn ends, or the same orphaned-child failure applies. See `docs/harness-capabilities.md`.";
      }
      if (harness === 'opencode') {
        return "OpenCode has a Task-tool subagent mechanism, but no documented guarantee of Claude Code's warm-resume-across-turns semantics (`SendMessage` to a suspended agent) — see `docs/harness-capabilities.md`. Treat it like Codex: run the loop **sequentially in a single thread**. Where this spec says \"spawn\" or \"resume\" an agent, instead **switch into that role** (read `.opencode/agents/concertino-<role>.md` and its underlying role spec), perform its steps yourself, and persist `workflow-state.md` between phases. Approximate the skeptic's cold property by re-reading ground truth from scratch (the diff, the files, the running app) and ignoring your own earlier narrative at each gate. Because everything runs sequentially in the one thread that is reading this, there is no spawn/suspend boundary here to end a turn across — the CON-10 never-end-your-turn failure cannot occur on this default path. The one place it still can is the *optional* Task-tool dispatch path: if you use it to invoke a `concertino-<role>` subagent, you must still wait for its result before your own turn ends, or the same orphaned-child failure applies.";
      }
      return "You spawn sub-agents with the `Agent` tool and resume the executor + evaluator **warm** via `SendMessage` across cycles. The skeptic is **always a fresh `Agent` spawn** (cold). If `SendMessage` is unavailable, fall back to a fresh spawn whose prompt begins `RESUME — do not start over`, pointing the agent at `workflow-state.md` to recover — it resumes, never restarts.\n\n**Never end your turn while a spawned or resumed sub-agent is still outstanding.** As the top-level `/concertino-deliver` session, waiting is free — your session persists and receives the sub-agent's result whenever it arrives. But if you are yourself running as a sub-agent (a fleet driver, a queue runner, or another orchestrator dispatched you), returning control before that child reports back is fatal: a suspended sub-agent is not resumed by any external event, so you never see the result, and the child you spawned — now orphaned — does not survive your turn ending either. Drive every phase to completion within your own turn regardless of which context you're in. If the harness genuinely cannot wait inline, do not return control speculatively — poll for the artefact the sub-agent was told to produce (its report path, or a new commit on the branch), or escalate.";
    default: return '{{block:' + name + '}}';
  }
}

function renderBody(text, c, harness) {
  let out = text.split('<change-dir>').join(c.specProvider.changeDir);
  out = out.split('<base>').join(c.project.baseBranch || 'main');
  out = out.replace(/\{\{block:([a-zA-Z]+)\}\}/g, (_, n) => block(n, c, harness));
  out = out.replace(/\{\{var:([a-zA-Z0-9_.]+)\}\}/g, (_, k) => getVar(c, k));
  return out;
}

// ---------- .concertino.env ----------------------------------------------
function envValue(v) { return "'" + String(v).replace(/'/g, "'\\''") + "'"; }
function renderEnv(c) {
  const L = [];
  L.push('# concertino:sync v' + VERSION + ' — do not edit by hand.');
  L.push('CONCERTINO_BASE_BRANCH=' + envValue(c.project.baseBranch || 'main'));
  L.push('CONCERTINO_BASE_REMOTE=' + envValue(c.project.baseRemote || 'origin'));
  L.push('CONCERTINO_WORKTREE_BASE=' + envValue(c.worktree.base));
  L.push('CONCERTINO_FRONTEND_PORT_BASE=' + c.worktree.ports.frontendBase);
  L.push('CONCERTINO_BACKEND_PORT_BASE=' + c.worktree.ports.backendBase);
  L.push('CONCERTINO_ENV_FILES=' + envValue(c.worktree.envFiles.join(' ')));
  L.push('CONCERTINO_LINK_MODULES=' + envValue((c.worktree.linkModules || []).join(' ')));
  L.push('CONCERTINO_WORKTREE_HOOKS=' + envValue(c.worktree.hooks.join(';')));
  L.push('CONCERTINO_HARNESS=' + envValue(c.harnesses.length === 1 ? c.harnesses[0] : ''));
  // The set of harnesses with an implemented adapter (lib/config.js's
  // VALID_HARNESSES) — a sync-time snapshot bash scripts (setup-worktree.sh)
  // validate a per-ticket HARNESS_OVERRIDE against, so the "implemented
  // harnesses" list is never hand-duplicated in bash (CON-62 design.md
  // Decision 4).
  L.push('CONCERTINO_IMPLEMENTED_HARNESSES=' + envValue(VALID_HARNESSES.join(' ')));
  const dash = c.dashboard || {};
  const escalationTimeout = dash.escalationTimeoutMinutes != null
    ? dash.escalationTimeoutMinutes : DEFAULT_ESCALATION_TIMEOUT_MIN;
  L.push('CONCERTINO_ESCALATION_TIMEOUT_MIN=' + escalationTimeout);
  // Claude Code's Anthropic-compatible client honors ANTHROPIC_BASE_URL (the
  // gateway's endpoint) and ANTHROPIC_AUTH_TOKEN (the credential) as an
  // enterprise/gateway override — confirmed against LiteLLM's own "Configure
  // Claude Code" docs (tasks.md 5.2). Rendered only when claude-code is
  // Ollama-routed AND providers.ollama.gateway is configured (design.md
  // Decision 4) — never the credential VALUE, only the name of the env var
  // that should hold it (mirrors worktree.envFiles' path-not-secret
  // convention); the operator's own shell/secrets manager is responsible for
  // actually setting that named variable before launching Claude Code.
  const ollama = c.providers && c.providers.ollama;
  const claudeOllamaRouted = ollama && (ollama.harnesses || []).includes('claude-code') && ollama.gateway;
  if (claudeOllamaRouted) {
    L.push('ANTHROPIC_BASE_URL=' + envValue(ollama.gateway.baseUrl || ''));
    L.push('CONCERTINO_OLLAMA_GATEWAY_API_KEY_ENV=' + envValue(ollama.gateway.apiKeyEnv || ''));
  }
  const ds = c.devServers || {};
  for (const side of ['backend', 'frontend']) {
    const s = ds[side];
    const U = side.toUpperCase();
    if (s) {
      L.push('CONCERTINO_' + U + '_CWD=' + envValue(s.cwd || '.'));
      L.push('CONCERTINO_' + U + '_START=' + envValue(s.start));
      L.push('CONCERTINO_' + U + '_HEALTH=' + envValue(s.health));
      L.push('CONCERTINO_' + U + '_TIMEOUT=' + (s.timeoutSec || 120));
    } else {
      L.push('CONCERTINO_' + U + '_START=' + envValue(''));
    }
  }
  return L.join('\n') + '\n';
}

// ---------- speeds.json ----------------------------------------------------
// The sync-time-defaulted snapshot resolve-speed.sh reads at run time
// (design.md Decision 3) — exactly the config's `budgets`/`speeds`/
// `modelTiers`/`models` blocks, already merged with defaults by
// withDefaults(), not yet resolved to any one speed/harness. Harness-
// agnostic: one file serves every harness a project configures, the same
// way `speeds.<name>.roleTiers` and `modelTiers` themselves are.
function renderSpeedsJson(c) {
  // `models` is c.models PLUS the Ollama provider-model map, folded in for
  // every Ollama-routed (harness, role) pair. resolve-speed.sh's runtime
  // lookup is only `explicit // tier` — it has no third, provider tier of
  // its own (deliberately: it never re-implements Node-side resolution) —
  // so without this fold an Ollama-routed role's READY models= (and, through
  // it, workflow-state's MODELS and the orchestrator's call-time model
  // overrides) would report the HOSTED tier model while the rendered agent
  // files say the local one. isOllamaRouted() already requires the explicit
  // slot to be empty, so writing the provider model INTO that slot here is
  // exactly resolveModel()'s own precedence, snapshotted.
  const models = JSON.parse(JSON.stringify(c.models));
  for (const h of VALID_HARNESSES) {
    for (const role of ROLES) {
      if (isOllamaRouted(c, h, role)) {
        const m = c.providers.ollama.models && c.providers.ollama.models[role];
        if (m) {
          models[h] = models[h] || {};
          models[h][role] = m;
        }
      }
    }
  }
  return JSON.stringify({
    budgets: c.budgets,
    speeds: c.speeds,
    modelTiers: c.modelTiers,
    models,
  }, null, 2) + '\n';
}

module.exports = { renderBody, renderEnv, renderSpeedsJson };
