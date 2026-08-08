'use strict';

// Template rendering + generated-file bodies (.concertino.env, speeds.json) —
// the pure config-to-text layer shared by sync, diff, and eject. Extracted
// from bin/concertino verbatim.

// Config-domain logic (defaults, validation, schema flattening) shared with
// the in-TUI settings screen (CON-57) — extracted into lib/config.js since
// bin/concertino runs its own CLI dispatch the instant it is loaded and so
// is never a safe `require()` target. The lib/cli/ command modules require
// it directly, each taking just the pieces it needs.
const { VALID_HARNESSES } = require('../config');
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
        local: 'No external ticket system. The ticket lives at `tickets/$TICKET_ID.md` — read it for title, description and acceptance criteria, and read its frontmatter `labels` for the `harness:` override check below. Set status with `scripts/concertino/set-ticket-state.sh tickets "$TICKET_ID" <backlog|unstarted|started|completed|canceled>` — `started` here in Setup, `completed` at cleanup. There is no comment thread, so skip the "post a closing comment" and "post the PR link back to the ticket" steps entirely; the PR URL is already recorded by the `emit-event.sh ... url=` call you make anyway. **If `tickets/$TICKET_ID.md` does not exist**, the ticket text is provided inline or in the change dir `ticket.md` and you skip status updates entirely.'
      }[c.ticketProvider.kind] || '';
    // CON-91: the `standalone` triage verdict (see the "Triaging a suggested
    // follow-up" sub-procedure) needs an action the rendered agent can
    // actually perform. Under `local`, no Linear/GitHub MCP tools are granted
    // (see the `ticketProvider` case above), so the pre-existing unconditional
    // "file a new Linear ticket" wording was unexecutable there. `linear` and
    // `github` keep today's exact wording byte-for-byte, including its
    // original line-wrapping/indentation (5-space continuation matching the
    // `- **\`standalone\`** — ` bullet marker at the call site), so this is a
    // pure addition, not a rewording, for those two providers.
    case 'standaloneTicket': {
      const linearGithubWording =
        'file a new Linear ticket (`mcp__linear__save_issue`,\n' +
        '     no `id`) summarizing `description` and linking back to the current\n' +
        '     ticket (`$TICKET_ID`); note the new ticket\'s identifier in your summary\n' +
        '     to the human. No re-planning, no scope change to the current run.';
      return {
        linear: linearGithubWording,
        github: linearGithubWording,
        local: 'derive `<prefix>` from `$TICKET_ID` by stripping its trailing `-<digits>`\n' +
          '     (e.g. `CON-91` → `CON`), then run\n' +
          '     `scripts/concertino/next-ticket-id.sh tickets/ "<prefix>"` to allocate the\n' +
          '     next free id under `tickets/`. On `READY`, write the returned `path` with\n' +
          '     frontmatter `title:` (a short title drawn from `description`) and\n' +
          '     `state: backlog`, and a body summarizing `description` plus a line linking\n' +
          '     back to the current ticket (`$TICKET_ID`); note the new ticket\'s identifier\n' +
          '     in your summary to the human. No re-planning, no scope change to the\n' +
          '     current run.'
      }[c.ticketProvider.kind] || '';
    }
    case 'agentMergePermissionCheck':
      // CON-88: gated by the sync-time harness this rendered copy of
      // orchestrator.md was generated for — not a runtime workflow-state.md
      // lookup (no such field exists there; see design.md Decision 3 of the
      // agent-merge-permission-preflight change). Only claude-code has an
      // auto-mode permission classifier of the kind that denies the auditor
      // spawn today; codex/opencode fall through unconditionally, exactly as
      // before this change.
      if (harness === 'codex' || harness === 'opencode')
        return '**N/A on this harness** — no auto-mode permission classifier of this kind exists here today; proceed to spawn the auditor unconditionally, exactly as before this change.';
      return "Run `scripts/concertino/check-agent-merge-permission.sh \"$WORKTREE_PATH\"` before spawning the auditor:\n" +
        "     - **`PASS`** → proceed to spawn the auditor exactly as below. No added cost on the already-working path.\n" +
        "     - **`FAIL`** → do **not** attempt the spawn. Raise one escalation (per \"How to raise one\", `kind=blocker`) naming the missing rule(s) verbatim from the script's stderr, `options=retry,fallback`:\n" +
        "       - **`retry`** — the human ran `concertino sync` (or edited `.claude/settings.json` by hand) — re-run the check; on `PASS`, proceed to spawn the auditor; on `FAIL` again, re-raise (this does not count against, or interact with, any existing budget — a one-off permission-state check, not a REFUTE/FAIL loop).\n" +
        "       - **`fallback`** — proceed exactly as the existing `AGENT_MERGE = false` path: present the PR, wait for a human \"merged\" confirmation, no auditor spawn this run.";
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
  // endpoint) and ANTHROPIC_AUTH_TOKEN (the credential). Two routes
  // (CON-75 design.md Decision 1): **gateway** — claude-code Ollama-routed
  // AND providers.ollama.gateway configured (unchanged behavior, confirmed
  // against LiteLLM's own "Configure Claude Code" docs, tasks.md 5.2) — or
  // **direct** — claude-code Ollama-routed with NO gateway configured,
  // pointing straight at providers.ollama.baseUrl (Ollama's own native
  // Anthropic-compatible endpoint). Never the credential VALUE, only the
  // name of the env var that should hold it (mirrors worktree.envFiles'
  // path-not-secret convention) when an operator names a real one via
  // apiKeyEnv; the operator's own shell/secrets manager is responsible for
  // actually setting that named variable (and ANTHROPIC_AUTH_TOKEN itself)
  // before launching Claude Code in that case.
  const ollama = c.providers && c.providers.ollama;
  const claudeOllamaHarness = ollama && (ollama.harnesses || []).includes('claude-code');
  if (claudeOllamaHarness && ollama.gateway) {
    L.push('ANTHROPIC_BASE_URL=' + envValue(ollama.gateway.baseUrl || ''));
    L.push('CONCERTINO_OLLAMA_GATEWAY_API_KEY_ENV=' + envValue(ollama.gateway.apiKeyEnv || ''));
  } else if (claudeOllamaHarness && ollama.baseUrl) {
    // Direct route (CON-75). Verified (design.md Decision 4): Claude Code's
    // own CLI requires a non-empty ANTHROPIC_AUTH_TOKEN/ANTHROPIC_API_KEY to
    // skip its interactive OAuth login, even though Ollama's endpoint itself
    // needs no credential — 'ollama-local' is an inert placeholder (not a
    // secret) that satisfies the CLI's own check. A project fronting its own
    // local Ollama with a REAL credential names the env var holding it via
    // providers.ollama.apiKeyEnv instead — name only, never the placeholder,
    // never the value itself.
    L.push('ANTHROPIC_BASE_URL=' + envValue(ollama.baseUrl));
    if (ollama.apiKeyEnv) {
      L.push('CONCERTINO_OLLAMA_API_KEY_ENV=' + envValue(ollama.apiKeyEnv));
    } else {
      L.push('ANTHROPIC_AUTH_TOKEN=' + envValue('ollama-local'));
    }
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
  // CON-65: `models` is c.models verbatim, and the Ollama provider map rides
  // along as its own `providers.ollama` block instead of being folded into
  // the explicit-model slots at render time (the pre-CON-65 approach). The
  // fold baked the PROJECT-level routing decision into the file, which made
  // a per-run flip impossible: once the local model occupied the explicit
  // slot, no runtime input could recover the subscription one. With both
  // kept separate, resolve-speed.sh applies resolveModel()'s exact
  // precedence itself at lookup time — explicit > provider map > tier, with
  // claude-code excluded from provider-model substitution only on the
  // **gateway** route (the gateway remaps hosted aliases; see
  // isOllamaRouted's comment in lib/config.js — CON-75 made this
  // route-conditional, not unconditional) — honoring CONCERTINO_PROVIDER as
  // the per-run override and `providers.ollama.harnesses` as the project
  // default. Same output as the fold for every pre-existing call path;
  // newly flippable per window.
  const speeds = {
    budgets: c.budgets,
    speeds: c.speeds,
    modelTiers: c.modelTiers,
    models: c.models,
  };
  if (c.providers && c.providers.ollama) {
    speeds.providers = {
      ollama: {
        harnesses: c.providers.ollama.harnesses || [],
        models: c.providers.ollama.models || {},
        // CON-75 design.md Decision 5: resolve-speed.sh (bash, no access to
        // raw config — only ever reads this already-defaulted snapshot) needs
        // the same "is claude-code on the gateway route" signal
        // lib/config.js's isOllamaRouted computes in JS, so it is rendered
        // here rather than re-derived from data the script does not have.
        gatewayConfigured: !!(c.providers.ollama.gateway),
      },
    };
  }
  return JSON.stringify(speeds, null, 2) + '\n';
}

module.exports = { renderBody, renderEnv, renderSpeedsJson };
