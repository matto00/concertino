## Context

Concertino renders role-based agent definitions from `core/roles/*.md` +
`concertino.config.json` into each configured harness's native layout via two
existing emitters in `bin/concertino`: `emitClaude` (writes
`.claude/agents/concertino-*.md` + `.claude/commands/concertino-deliver.md`)
and `emitCodex` (writes `AGENTS.md` + `.codex/agents/concertino-*.toml` +
`.codex/prompts/concertino-deliver.md`). Model selection is resolved per
harness+role by `lib/config.js`'s `resolveModel(c, harness, role)`, which
today only knows about `claude-code` and `codex`, and only ever returns a
hosted-model id string (a Claude alias or an OpenAI-style Codex model id) —
there is no notion of *which provider* that id should be interpreted against.

There is no existing OpenCode adapter, template, or partial implementation
anywhere in this repo (confirmed by an exhaustive research pass: zero
references to `opencode`/`ollama`/`litellm` outside the ticket itself). The
`.opencode/`/`.cursor/` directories at the repo root are OpenSpec's own
multi-editor skill/command distribution for working on *this* repo's source —
unrelated to, and sharing no code with, `bin/concertino`'s render pipeline.
`CONTRIBUTING.md` currently overstates that `concertino sync` already renders
`.opencode/`/`.cursor/` mirrors; this is a pre-existing doc inaccuracy this
change makes true for the OpenCode half.

Every harness-aware call site in `bin/concertino` (harness picker, `cmdEject`,
`checkArtifacts`/`cmdDoctor`, `cmdDiff`, `cmdUpgrade`, `cmdCompletion`,
`cmdSync`) currently hardcodes exactly two harnesses, usually as a literal
two-element array or a binary ternary. `lib/config.js`'s `VALID_HARNESSES`,
`DEFAULT_MODEL_TIERS`, `withModelDefaults`'s harness loop, and
`resolveModel`'s final fallback (`harness === 'codex' ? ... : 'sonnet'`) are
the same shape. `config/concertino.schema.json` is `additionalProperties:
false` at the root and on `models`/`modelTiers`, so a third harness and a new
top-level `providers` block both need explicit schema entries or they're
rejected as unknown.

## Goals / Non-Goals

**Goals:**
- Add `opencode` as a fully-supported third harness, at parity with the
  existing two wherever that parity is meaningful (sync, validate, doctor,
  eject, diff, upgrade, completions).
- Add a `providers.ollama` config block that lets a project point any subset
  of its configured harnesses at a local Ollama instance, with per-role model
  selection, entirely through config — no hand-edited generated file.
- Give Codex and OpenCode native, correct provider wiring for Ollama's
  OpenAI-compatible API.
- Give Claude Code a documented, validated path to Ollama through an
  Anthropic-compatible gateway (e.g. LiteLLM), with a clear, actionable
  validation error when that path is requested but the gateway isn't
  configured.
- Preserve exact current behavior for every project that does not opt into
  `opencode` or `providers`.

**Non-Goals:**
- Do not implement or ship a gateway (LiteLLM or otherwise) — this change
  only renders the *configuration* pointing Claude Code at one the operator
  already runs.
- Do not attempt direct Ollama-to-Claude-Code compatibility — the ticket
  explicitly rules this out.
- Do not build a general multi-provider abstraction beyond Ollama (no
  Together/Groq/etc. providers) — `providers` is a real config block but this
  change populates exactly one named provider, `ollama`, matching the
  ticket's scope.
- Do not add a Cursor adapter (tracked separately in `ROADMAP.md`).
- Do not change `resolve-speed.sh`/`setup-worktree.sh`'s harness-precedence
  contract for the two existing signals (`CLAUDECODE`, `CODEX_SANDBOX*`) —
  the new OpenCode signal is additive and lower-precedence than both.

## Decisions

### Decision 1 — `providers.ollama` shape and the harness/provider boundary
`providers` is a new top-level, `additionalProperties: false` object with
exactly one currently-defined key, `ollama`:

```json
"providers": {
  "ollama": {
    "baseUrl": "http://localhost:11434",
    "apiKeyEnv": "OLLAMA_API_KEY",
    "harnesses": ["codex", "opencode"],
    "models": { "orchestrator": "...", "executor": "llama3.1:70b", "evaluator": "...", "skeptic": "...", "auditor": "..." },
    "gateway": { "baseUrl": "http://localhost:4000", "apiKeyEnv": "LITELLM_API_KEY" }
  }
}
```

`harnesses` is the load-bearing field: the subset of this project's
configured `harnesses` that should route through Ollama. It is deliberately
**not** inferred from the presence of an Ollama-looking model id string
anywhere in `models.<harness>.<role>` — the ticket is explicit that provider
and harness are independent dimensions, and inferring provider from a
freeform model-id string (e.g. guessing `"llama3.1:70b"` "looks like Ollama")
is exactly the kind of conflation it warns against. Declaring `harnesses`
explicitly also gives `concertino sync`/`doctor`/`validate` an unambiguous,
static answer to "does this project's Codex config need an Ollama provider
block" without parsing model strings.

`models.<harness>.<role>` remains the existing, unchanged per-role override
mechanism (already fully generic — no code change needed there). When a
harness is listed in `providers.ollama.harnesses` and a given role has no
explicit `models.<harness>.<role>` override, `resolveModel` falls back to
`providers.ollama.models.<role>` (new, third fallback tier) before the
existing tier/hardcoded fallback — this is what "a configured Ollama model
can be selected per role without editing generated files by hand" means
concretely: set `providers.ollama.models.executor`, or override per-harness
via the existing `models.codex.executor`, either way nothing renders by hand.

`claude-code` is a legal member of `providers.ollama.harnesses` (it is not
special-cased out of the array), but is validated (Decision 4) to require
`providers.ollama.gateway` to be present when it appears there — the array
membership is what expresses "this role's model should come from Ollama",
and `gateway` is what makes that reachable for Claude Code specifically.

**Alternatives considered:** (a) inferring provider from model-id string
shape — rejected, conflates provider and harness/model-id, exactly what the
ticket warns against, and is unreliable (Ollama model tags have no reserved
namespace). (b) A `providers` array supporting multiple named instances
(mirroring `speeds`'s `additionalProperties`-driven shape) — rejected as
over-general for this change's single-provider scope; `flattenSchema`'s
existing `speeds` special-case is precedent for extending to a map later if a
second provider is ever added, without disrupting this shape now.

### Decision 2 — `resolveModel` provider-fallback, not provider-return
`resolveModel(c, harness, role)` keeps its existing signature and continues
to return a plain model-id string — unchanged for every existing caller
(`.claude/agents/*.md`'s `model:` frontmatter, `.codex/agents/*.toml`'s
`model =`, and the new OpenCode render). The only change is a new fallback
tier inserted between the existing explicit-override check and the existing
tier/hardcoded-default check:

```js
function resolveModel(c, harness, role) {
  const explicit = c.models && c.models[harness] && c.models[harness][role];
  if (explicit) return explicit;
  const ollama = c.providers && c.providers.ollama;
  if (ollama && (ollama.harnesses || []).includes(harness) && ollama.models && ollama.models[role]) {
    return ollama.models[role];
  }
  // ...existing tier lookup, then existing hardcoded per-harness fallback
  // (restructured to a FALLBACK_MODEL[harness] map so a fourth harness
  // never silently returns 'sonnet')
}
```

Whether a harness is *routed through* Ollama (i.e. whether provider config
needs rendering at all) is a separate, harness-render-time decision made
directly from `providers.ollama.harnesses` — `resolveModel` only supplies the
model-id string; `emitCodex`/`emitOpencode`/`emitClaude` independently decide
whether to render provider wiring, keeping "which model" and "how is it
reached" cleanly separated.

That harness-level decision governs only whether the `[model_providers.ollama]`
block itself gets rendered at all (it is available for the harness to use).
Which *individual role* actually gets pointed at it (Decision 3's
`model_provider = "ollama"` line) is a distinct, precisely-defined
**role-level** condition, derivable at render time from data already present
— no new field is added to `resolveModel`'s return value:

> A role's model is **Ollama-routed** iff (1) its harness appears in
> `providers.ollama.harnesses`, **and** (2) no explicit
> `models.<harness>.<role>` override is set for that role. Condition (2) is
> exactly the same presence check `resolveModel`'s own first line already
> performs (`c.models && c.models[harness] && c.models[harness][role]`) — the
> render call site re-checks it directly rather than `resolveModel` reporting
> it back, since re-checking a plain presence test is simpler than plumbing a
> second return value through every caller that doesn't need it.

A role with an explicit `models.<harness>.<role>` override on an
otherwise-Ollama-routed harness is therefore **not** Ollama-routed: its
rendered per-role file gets no `model_provider = "ollama"` line (falls back
to that harness's default provider, exactly as today), and its model id is
whatever the override says — this is the deliberate, safe behavior for an
operator who wants every role on a harness routed through Ollama *except*
one they've explicitly pinned to a hosted model, and it requires no new
validation to prevent a broken render (a hosted model id is simply never
paired with `model_provider = "ollama"`).

**Alternative considered:** a new `resolveProvider(c, harness, role)` return
value describing full connection info per role — rejected as unnecessary
indirection; connection info (`baseUrl`/`apiKeyEnv`/`gateway`) is
harness-invariant per project (one Ollama instance), so reading
`c.providers.ollama` directly at each harness's render call site is simpler
than threading a resolved-per-role provider object through every model-id
call site that doesn't need it.

### Decision 3 — Codex Ollama wiring: a new rendered `.codex/config.toml` block
Codex's documented local-model support is a `[model_providers.<name>]` block
in Codex's own `config.toml`, referenced by a per-profile/agent
`model_provider = "<name>"` field — not a field addable to the individual
per-role `.codex/agents/*.toml` files' existing shape alone. `emitCodex`
gains:
- A `model_provider = "ollama"` line added to `adapters/codex/agent.toml.tmpl`
  (new `{{model_provider}}` placeholder), populated only for roles whose
  harness is Ollama-routed (else rendered empty/omitted, preserving today's
  file for every project that doesn't opt in).
- A new write, gated on `codex` appearing in `providers.ollama.harnesses`:
  a `[model_providers.ollama]` block (`name`, `base_url =
  providers.ollama.baseUrl`, `wire_api = "chat"`, `env_key =
  providers.ollama.apiKeyEnv` when set) appended into the project's rendered
  Codex config surface. Since `emitCodex` already merges content into
  `AGENTS.md` via `<!-- CONCERTINO:BEGIN/END -->` markers rather than
  managing a separate `config.toml` today, and Codex's own `config.toml` is
  typically a user/global file rather than something Concertino has
  previously rendered per-project, this change adds a new, narrowly-scoped
  `.codex/config.toml` write containing *only* the
  `[model_providers.ollama]` block, guarded by the same merge-marker pattern
  `AGENTS.md` uses, so a project with its own hand-edited `config.toml`
  content outside the markers is never clobbered.

### Decision 4 — Claude Code gateway validation
New check in `lib/config.js`'s `collectConfigIssues`, in a new `sec('Providers')`
section (following the existing `Budgets`/`Dashboard` precedent of new
sections added by prior tickets in this same function):

```js
if ((ollama.harnesses || []).includes('claude-code') && !ollama.gateway) {
  fail('providers.ollama.gateway',
    'providers.ollama.harnesses includes "claude-code" but no providers.ollama.gateway ' +
    'is configured — Claude Code cannot connect to Ollama directly; configure an ' +
    'Anthropic-compatible gateway (e.g. LiteLLM) via providers.ollama.gateway.baseUrl.');
}
```

When `gateway` *is* present and `claude-code` is Ollama-routed, `emitClaude`
renders the gateway's connection info into `.concertino.env`
(`renderEnv`) as documented environment variables (Claude Code's own
Anthropic-compatible client honors a base-URL/auth-token override for
enterprise/gateway setups) — `.claude/agents/*.md`'s `model:` frontmatter
field is left as an ordinary model alias/string exactly as today, since the
gateway is what remaps that id to the local Ollama model, not Concertino.
This keeps the claude-code render path's only real change scoped to
`.concertino.env` plus the validation rule above — no new per-agent-file
template surface.

### Decision 5 — OpenCode adapter shape
A new `adapters/opencode/` directory, parallel to `adapters/codex/`:
- `adapters/opencode/agent.tmpl` (or reusing `adapters/claude-code/agents.json`
  for shared per-role metadata — description/tools — the same way `emitCodex`
  already reuses that file rather than duplicating it) for per-role agent
  definitions.
- `adapters/opencode/header.md` / delivery-command template, parallel to
  `adapters/codex/header.md` + `prompt.md`.
- `emitOpencode(c, out, core, dry)` writes: OpenCode's native project config
  (an `opencode.json`/`opencode.jsonc`-equivalent, including a
  `provider.ollama` entry — OpenCode natively supports custom
  OpenAI-compatible providers — populated from `providers.ollama.baseUrl` /
  `apiKeyEnv` / explicit model ids, gated on `opencode` appearing in
  `providers.ollama.harnesses`, exactly mirroring Codex's gating), per-role
  agent files, and a delivery command/prompt file.
- `core/roles/orchestrator.md`'s `{{block:harnessResume}}` gains a third arm.
  Whether OpenCode gets Claude-Code-like full orchestration or Codex-like
  sequential-single-thread dispatch is an **open question** (Open Questions,
  below) pending a check of OpenCode's actual multi-agent capabilities — this
  change proceeds with the conservative assumption (Codex-like sequential,
  single-thread) unless research during implementation shows OpenCode
  supports genuine spawn/resume, since overstating a harness's capability is
  worse than understating it (a orchestrator that thinks it can suspend and
  resume when it can't is the CON-10 failure class this whole workflow's
  "never end your turn" guardrail exists to prevent).

### Decision 6 — OpenCode runtime-identity signal (harness-identity delta)
`setup-worktree.sh`/`resolve-speed.sh`'s `detect_harness()` gains a third,
lowest-precedence arm checking for an OpenCode-set process-env signal (best
guess: an `OPENCODE` or similar variable — to be confirmed against OpenCode's
actual runtime during implementation), inserted **after** the existing
`CLAUDECODE`/`CODEX_SANDBOX*` checks and **before** falling back to the
static `CONCERTINO_HARNESS` default — mirroring the existing two signals'
own documented caveat ("neither variable is a documented public contract, so
only presence is relied on"). If no such signal exists or the guessed
variable name is wrong, detection simply falls through to today's existing
fallback chain (static default, then `unknown`) — never a regression, just a
missed opportunity for one extra precision case. Both scripts get the
identical new arm, in lockstep, per their own existing "kept in sync
deliberately" comment.

### Decision 7 — Backward compatibility mechanics
- `harnesses` schema `enum` gains `"opencode"`; the schema/`withDefaults()`
  `default` stays `["claude-code", "codex"]` — unchanged.
- `VALID_HARNESSES` in `lib/config.js` gains `'opencode'`.
- `DEFAULT_MODEL_TIERS`/`withModelDefaults`'s harness loop/`models.<h>`
  initialization gain an `opencode` entry.
- `providers` defaults to `{}` in `withDefaults()` — a project with no
  `providers` key behaves identically to today; every new check in
  `collectConfigIssues`'s new Providers section is a no-op when
  `cfg.providers` is absent.
- `config/examples/generic.json` (the non-interactive `concertino init`
  default) is **not** changed to include `opencode` or `providers` — it stays
  the minimal claude-code-only baseline it is today.
- Every new schema/`bin/concertino` call site listed in the proposal is
  additive (a new `if (harnesses.includes('opencode'))` branch, a new array
  entry, a new object key) — none replace or restructure existing
  claude-code/codex logic.

## Risks / Trade-offs

- [Risk] The guessed OpenCode runtime env-var signal (Decision 6) turns out
  to be wrong or nonexistent → Mitigation: designed as strictly best-effort
  and additive; a wrong/missing signal degrades to the existing fallback
  chain, never breaks detection for the other two harnesses.
- [Risk] OpenCode's actual multi-agent/dispatch capabilities may not match
  either existing harness model cleanly (Decision 5) → Mitigation: default to
  the more conservative (sequential, Codex-like) description rather than
  overstating capability; revisit narrowly in a follow-up if OpenCode
  genuinely supports spawn/resume.
- [Risk] Codex's `config.toml` provider block (Decision 3) is a new
  Concertino-managed file class (previously Concertino never rendered
  anything into Codex's own `config.toml`) → Mitigation: scope the write to
  exactly the `[model_providers.ollama]` block behind the same
  `<!-- CONCERTINO:BEGIN/END -->` merge-marker convention `AGENTS.md` already
  uses, so any hand-authored `config.toml` content survives untouched.
- [Risk] `docs/config-reference.md` already has pre-existing gaps
  (`models`/`modelTiers`/`speeds`/`agentMerge`/`dashboard` are undocumented
  today, independent of this change) → Mitigation/scope: this change
  documents its own new `providers`/`opencode` surface fully; backfilling the
  unrelated pre-existing gaps is explicitly out of scope (tasks.md may note
  it as a follow-up, not required for this ticket's AC).
- [Trade-off] `providers` is scoped to exactly one named provider (`ollama`)
  rather than a general multi-provider map — accepted per Non-Goals; adding a
  second provider later would need Decision 1's array-vs-map question
  revisited, not a breaking change to `providers.ollama` itself.

## Migration Plan

No migration is required for existing projects — every change is additive
and opt-in (Decision 7). `concertino migrate` (which diffs `withDefaults(raw)`
against `raw` and writes additions) will pick up the new `providers: {}`
default automatically for any project that runs it, exactly like any other
prior additive default. No rollback beyond a normal revert is needed since no
existing rendered artifact or config shape changes for a project that doesn't
opt in.

## Open Questions

1. **OpenCode's actual agent-dispatch model** (Decision 5): full
   orchestration parity with Claude Code, Codex-like sequential-single-thread,
   or a third bespoke shape? Proceeding with the conservative
   sequential-single-thread assumption; revisit if implementation research
   into OpenCode's real capabilities shows otherwise.
2. **OpenCode's actual runtime-identity env signal** (Decision 6): exact
   variable name unconfirmed from within this repo. Best-effort, non-blocking
   per Decision 6's own mitigation.
3. **Exact OpenCode native config file name/shape** (`opencode.json` vs.
   `opencode.jsonc` vs. another documented format) — to be confirmed against
   OpenCode's own docs during implementation; `emitOpencode`'s output path is
   an implementation-time detail, not a decision that changes this design's
   shape.
