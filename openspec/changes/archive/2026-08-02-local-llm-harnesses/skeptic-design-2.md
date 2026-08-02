## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- **Round 1's specific fix, verified independently against current files (not
  the round-1 summary):**
  - `design.md` Decision 2 (lines 122-183) now states a precise, testable
    **role-level** definition: "A role's model is **Ollama-routed** iff (1)
    its harness appears in `providers.ollama.harnesses`, **and** (2) no
    explicit `models.<harness>.<role>` override is set for that role,"
    explicitly derivable from data `resolveModel`'s own first line already
    checks (`c.models && c.models[harness] && c.models[harness][role]`) — no
    undesigned plumbing required, closing the exact gap round 1 flagged.
    Decision 2 also now explicitly separates the two decisions that were
    previously conflated: whether the `[model_providers.ollama]` **block**
    renders at all is harness-level (`providers.ollama.harnesses` membership,
    governs `emitCodex`'s `.codex/config.toml` write); which **individual
    role** gets `model_provider = "ollama"` in its own per-role file is the
    role-level condition above.
  - `tasks.md` §3.1 now reads "rendered as `model_provider = "ollama"` only
    for a role that is **Ollama-routed** per design.md Decision 2/3's precise
    definition — `"codex"` is in `providers.ollama.harnesses` AND no explicit
    `models.codex.<role>` override is set for that role" — this now matches
    Decision 2 exactly (word for word on the two-condition test) instead of
    the previous undefined "whose model resolution is Ollama-routed."
    §3.2 explicitly states the `[model_providers.ollama]` block "renders once
    per project regardless of which individual roles end up Ollama-routed per
    3.1" — correctly harness-level, matching Decision 2's separation. §3.3
    mirrors the same precise two-condition per-role check into `cmdDiff`/
    `cmdEject`. No implementer reading tasks.md and design.md together can
    now derive two different renders for the same config.
  - The previously-undefined mixed-override edge case (a role with an
    explicit hosted-model override on an otherwise-Ollama-routed harness) is
    now explicitly resolved, in both places, the same way: Decision 2 states
    it plainly ("its rendered per-role file gets no `model_provider =
    "ollama"` line... its model id is whatever the override says... requires
    no new validation to prevent a broken render"), and
    `specs/model-providers/spec.md`'s "Codex renders Ollama provider
    configuration" requirement gained the exact scenario round 1 asked for:
    "a role with an explicit hosted-model override is not Ollama-routed"
    (lines 72-81), which spells out both halves — the block still renders
    project-wide, that one role's file has no `model_provider` line and keeps
    its hosted override model id.
  - Confirmed the fix is self-consistent, not just present: the resolution
    (b) round 1 offered was chosen (define the role-level condition
    precisely, in terms of data already available; specify the mixed-case
    behavior explicitly; keep it consistent across design.md, tasks.md, and a
    new spec scenario) — all three artifacts now agree.

- Read `ticket.md` (9 ACs) fresh and traced each independently against
  `proposal.md`, `design.md` Decisions 1-7, `tasks.md` §1-10, and the three
  spec deltas — all 9 trace to concrete design/task/spec evidence (harness
  enum+validate → §1.1/2.5, `opencode-harness` Req1; sync renders per harness
  → §4.1-4.14, `opencode-harness` Req2; per-role Ollama model selection →
  Decision 2 + §2.4, `model-providers` Req2; Codex↔Ollama → Decision 3 + §3,
  `model-providers` Req3; OpenCode↔Ollama → Decision 5 + §4.3, `model-
  providers` Req4; Claude Code gateway + validation error → Decision 4 +
  §2.7/§5, `model-providers` Req5; doctor CLI+prereq checks without leaking
  secrets → §4.9/§6, `model-providers` Req6, `opencode-harness` Req3; backward
  compatibility → Decision 7 + §10.1, "absent providers is a no-op" /
  "rendering unaffected when not opted in" scenarios; tests → §9).
- Checked for placeholders/hand-waving: `grep -n -iE
  "TODO|TBD|FIXME|XXX|placeholder|hand-wav"` across all planning artifacts
  returns only legitimate uses (the literal `{{model_provider}}` template
  placeholder, and this report's/round-1's own prose describing what it
  checked for) — no deferred decisions blocking implementation.
- Re-read current repo state to confirm design.md's factual claims about
  today's code still hold: `lib/config.js:91-99` `resolveModel` is still the
  plain two-branch function described (explicit override → tier lookup →
  `harness === 'codex' ? CODEX_MODEL_FALLBACK : 'sonnet'`), `VALID_HARNESSES`
  at line 204 is still `['claude-code', 'codex']`, and
  `config/concertino.schema.json` is still `additionalProperties: false` at
  root/`models`/`modelTiers` — the design's premises are accurate, nothing
  has silently drifted since round 1.
- Re-checked the three Open Questions (OpenCode dispatch model, runtime
  env-var signal, native config filename) against tasks.md §4.1 — each still
  has an explicit conservative fallback and a concrete research task; none
  block implementation from starting.
- Checked scope: every proposal bullet still traces to a ticket scope line or
  AC; no new scope crept in during the round-1 revision.

### Verdict: CONFIRM

### Non-blocking notes

- `design.md` Decision 3's own sentence ("populated only for roles whose
  **harness** is Ollama-routed") is still loosely worded in isolation — read
  alone it echoes the pre-fix harness-level phrasing round 1 flagged.
  Practically this is harmless: it sits immediately after Decision 2's
  precise role-level definition of the term, and `tasks.md` §3.1 explicitly
  cites "design.md Decision 2/3's precise definition" and restates the exact
  two-condition test, so no implementer following the tasks can mis-render.
  Tightening Decision 3's sentence to "populated only for a role that is
  Ollama-routed" (dropping "whose harness") would remove the residual
  cross-document wording mismatch entirely, but it is not blocking.
- (Carried from round 1, still true, still non-blocking.)
  `specs/harness-identity/spec.md`'s "`setup-worktree.sh` resolves the
  running harness at runtime" requirement and
  `specs/opencode-harness/spec.md`'s "OpenCode runtime-identity signal
  (best-effort)" requirement still describe the same underlying third
  detection arm with near-duplicate scenario text in two capability files —
  not contradictory, but two independently-owned copies risk drifting later.
- (Carried from round 1, still true, still non-blocking.)
  `specs/opencode-harness/spec.md`'s eject requirement still says eject
  prints the rendered agent "for a supported role" without naming the
  role set; `tasks.md` §4.7 still punts this to implementation. Naming the
  role set explicitly (e.g. "all `core/roles/*.md` roles, matching Codex/
  Claude Code parity") would remove the ambiguity outright, but this doesn't
  block implementation from starting.
