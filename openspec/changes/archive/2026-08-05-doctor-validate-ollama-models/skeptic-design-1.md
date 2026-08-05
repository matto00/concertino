## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **Read all planning artifacts**: `ticket.md`, `proposal.md`, `design.md`,
  `tasks.md`, `specs/model-providers/spec.md` in full.
- **Acceptance-criteria trace** (ticket.md lines 40-43):
  1. "warns ... when a configured Ollama model lacks tools, or lacks thinking
     while codex is (or can be) Ollama-routed" → tasks.md 2.3/2.4, spec.md
     scenarios "doctor warns when a configured model lacks tools" and
     "...lacks thinking and codex is Ollama-routed". Covered.
  2. "warns when a configured model is not pulled locally" → tasks.md
     1.1/1.2, spec.md scenario "doctor warns when a configured model is not
     pulled". Covered.
  3. "Both are non-fatal, and skipped cleanly when the endpoint is
     unreachable" → design.md Decisions + Risks section, tasks.md 1.2/2.5,
     spec.md scenario "unreachable Ollama does not fail doctor". Covered.
  4. "A fully-capable configuration produces no new noise" → spec.md
     scenario "fully-capable configuration produces no new noise", tasks.md
     3.1. Covered.
  All four ACs trace to concrete tasks and spec scenarios — none left
  unaddressed, no scope drift beyond them (validate/settings-screen
  follow-ups are explicitly out-of-scope per the ticket's own "worth
  considering" hedge, correctly captured as Non-Goals in design.md).

- **Internal consistency**: Requirement name in the spec delta
  (`concertino doctor checks Ollama/gateway prerequisites without leaking
  secrets`) matches the existing requirement verbatim in
  `openspec/specs/model-providers/spec.md:137` (`grep -n "^### Requirement"`
  confirms this is the only requirement of that name) — this is genuinely a
  MODIFIED requirement, not an accidental new capability. Proposal, design,
  and tasks all agree on scope (extend `checkOllamaProvider`, no schema
  change, no new capability directory).

- **`openspec validate doctor-validate-ollama-models --strict` → "Change
  'doctor-validate-ollama-models' is valid"** (ran it myself from the
  worktree).

- **Grounded the technical claims against a real, running local Ollama**
  (`http://localhost:11434`, actually reachable on this machine):
  - `curl -X POST /api/show -d '{"model":"llama3.2:1b"}'` →
    `capabilities: ['completion', 'tools']` — confirms the ticket's own
    concrete failure case (`llama3.2:1b` lacks `thinking`) is real, not
    invented.
  - `curl -X POST /api/show -d '{"model":"gpt-oss:latest"}'` →
    `['completion', 'tools', 'thinking']` — confirms the design's
    assumption that `/api/show`'s `capabilities` array is the right signal
    and has the exact shape described.
  - `curl /api/tags` → `models[].name` includes exact `:tag` suffixes
    (`gpt-oss:latest`) — confirms design.md's rejection of `/v1/models` in
    favor of `/api/tags` for exact string matching against
    `providers.ollama.models` is technically sound, not hand-waved.

- **Checked the actual `checkOllamaProvider` code**
  (`lib/cli/doctor.js:128-155`) against the plan: confirmed it currently
  only does the base reachability + apiKeyEnv/gateway checks, called as
  `checkOllamaProvider(cfg, { ok, warn })` (no `fail`) — consistent with
  the plan's requirement that the new checks stay non-fatal (no path to
  `fail` exists in the signature the plan extends).

- **Checked `resolveModel`/`isOllamaRouted` in `lib/config.js:179-215`**:
  confirmed `providers.ollama.models[role]` is exactly the fallback-tier map
  the plan describes, and that the plan's Non-Goal (skip
  `models.<harness>.<role>` overrides) is real — those overrides bypass the
  provider-model map entirely per `resolveModel`'s first line, so scoping
  the check to `providers.ollama.models` is a legitimate, load-bearing
  scope boundary, not an oversight.

- **No placeholders/TODOs**: `grep -rniE "TODO|TBD|FIXME|figure out
  later"` across all five artifacts returned nothing.

- **No premature code changes**: `git status --short` in the worktree shows
  only the untracked `openspec/changes/doctor-validate-ollama-models/`
  directory — planning-only, as expected at this gate.

### Verdict: CONFIRM

### Non-blocking notes

1. `design.md`'s decision section says the new HTTP calls are "wrapped in
   the same try/catch-returns-null pattern doctor.js's `shell()` helper
   already uses" — but `shell()` is a closure local to `cmdDoctor`, not
   passed into `checkOllamaProvider(cfg, r)`. This reads as "reuse the same
   *coding pattern*" rather than "call the literal `shell()` function",
   which is what the existing `reachable()` function inside
   `checkOllamaProvider` already does (its own inline execSync/try-catch,
   not a call to `shell()`). Worth the executor double-checking this
   phrasing doesn't get misread as "thread `shell` through as a parameter."
2. `tasks.md` 3.1 doesn't specify how the new shell test will fake a local
   Ollama endpoint serving `/api/tags` and `/api/show` responses (there is
   no existing precedent test doing this — the pre-existing reachability
   check has no test coverage today). A real Ollama happens to be running
   on `localhost:11434` on this dev machine; the executor should make sure
   the new test spins up its own isolated fake server (e.g. a short Node
   `http` script) on a distinct port rather than depending on — or being
   confused by — a real local Ollama instance's actual model set.
