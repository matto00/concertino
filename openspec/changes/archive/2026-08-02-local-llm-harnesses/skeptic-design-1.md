## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md` (9 ACs) and traced each against `proposal.md` §Capabilities,
  `design.md` Decisions 1–7, and `tasks.md` §1–10. All 9 ACs have at least one
  concrete design decision + task + spec scenario backing them (harness
  enum/validate → §1.1/spec `opencode-harness` Req 1; sync renders per
  harness → §4.3/4.6/spec Req 2; per-role Ollama model selection → Decision 2
  + §2.4/spec `model-providers` Req 2; Codex Ollama connection → Decision 3 +
  §3/spec Req 3; OpenCode Ollama connection → Decision 5 + §4.3/spec Req 4;
  Claude Code gateway + validation error → Decision 4 + §5/§2.7/spec Req 5;
  doctor CLI+prereq checks without leaking secrets → §4.9/§6/spec Req 6+7;
  backward compatibility → Decision 7 + §10.1; tests → §9).
- Read all three spec deltas in full
  (`specs/harness-identity/spec.md`, `specs/model-providers/spec.md`,
  `specs/opencode-harness/spec.md`) — each `MODIFIED`/`ADDED` requirement has
  scenarios with concrete WHEN/THEN, no placeholder scenario text.
- Cross-checked design.md's three "Open Questions" (OpenCode dispatch model,
  OpenCode runtime-identity env var, OpenCode native config filename) against
  tasks.md — each has a task performing the actual research (4.1) with an
  explicit, documented conservative fallback if research is inconclusive, so
  none of them block implementation from starting; none read as a
  deferred/hand-waved decision.
- Read current `lib/config.js` (`resolveModel`, lines 91-99;
  `VALID_HARNESSES`, line 204) and `config/concertino.schema.json`
  (`models`/`modelTiers` `$ref`s, lines 148-163) to confirm the design's
  description of today's two-harness-hardcoded shape is accurate — it is.
- Read `adapters/codex/agent.toml.tmpl` — confirms today's per-role render is
  a flat `{{model}}` string substitution with no per-role routing/provider
  signal, which is directly relevant to Change Request 1 below.
- Checked for scope drift: every proposal bullet traces back to a ticket
  scope line or AC; the doctor Claude-Code-CLI unconditional-check fix
  (§4.9) is in scope because AC 7 ("doctor checks the *selected* harness
  CLIs") already requires it, not new scope.
- Checked contract/schema coverage: `providers` top-level block and
  `opencode` harness enum value both have explicit schema tasks (§1.1-1.3);
  `additionalProperties: false` root/`models`/`modelTiers` shape is
  correctly accounted for (design.md Context, confirmed against the live
  schema file).

### Verdict: REFUTE

### Change Requests

1. **Contradiction between design.md Decision 2/3 and tasks.md 3.1/3.3 on
   whether Ollama-provider rendering for Codex is harness-level or
   role-level, and no defined behavior for the resulting edge case.**
   Design.md Decision 2 states plainly: "Whether a harness is *routed
   through* Ollama... is a separate, harness-render-time decision made
   directly from `providers.ollama.harnesses`" — i.e. binary per harness,
   determined once, not per role. Decision 3 restates this as "populated
   only for roles whose **harness** is Ollama-routed." But `tasks.md` §3.1
   says: "rendered as `model_provider = "ollama"` only for roles **whose
   model resolution is Ollama-routed**" — a different, undefined,
   role-level condition (repeated again as the basis for §3.3's `cmdDiff`/
   `cmdEject` mirroring). `resolveModel` (design.md Decision 2's own code
   sketch, and the current implementation at `lib/config.js:91-99`) returns
   only a plain model-id string with no signal for *which* fallback tier
   produced it, so "whose model resolution is Ollama-routed" is not
   currently derivable from `resolveModel`'s return value without new,
   undesigned plumbing that Decision 2 explicitly declined to add
   ("`resolveModel` only supplies the model-id string"). This is not a
   cosmetic wording slip: it leaves genuinely undefined behavior for a
   config this design explicitly wants to support — a harness listed in
   `providers.ollama.harnesses` (e.g. `codex`) where one specific role has
   an explicit `models.codex.<role>` override to a *hosted*, non-Ollama
   model id (legal per Decision 1: "`models.<harness>.<role>` remains the
   existing, unchanged per-role override mechanism," unrestricted in
   shape). Depending on which reading an implementer follows: (a) harness-
   level (design.md) → that role's rendered `.codex/agents/<role>.toml` gets
   `model_provider = "ollama"` alongside a hosted model id Ollama doesn't
   serve, producing a broken Codex config for that role; (b) role-level
   (tasks.md) → requires inventing an undesigned signal, and the resulting
   behavior isn't specified anywhere (should it also skip the earlier
   `[model_providers.ollama]` block reference for that role's profile? emit
   a warning?). **Required revision:** pick one of (a) explicitly forbid/
   validate against a non-Ollama-looking override on an Ollama-routed
   harness's role (extend `collectConfigIssues`'s new Providers section,
   task 2.7), or (b) define precisely, in both design.md and tasks.md
   consistently, what "role's model resolution is Ollama-routed" means in
   terms of data actually available at render time (e.g. "true iff no
   explicit `models.<harness>.<role>` override is present" — which *is*
   derivable without new plumbing) and what happens to that specific role
   when it isn't. Update `tasks.md` §3.1/§3.3 to match whichever reading is
   chosen so a competent implementer cannot read them two ways, and add a
   spec scenario in `specs/model-providers/spec.md`'s "Codex renders Ollama
   provider configuration" requirement covering this mixed case.

### Non-blocking notes

- `specs/harness-identity/spec.md`'s modified "Requirement: `setup-worktree.sh`
  resolves the running harness at runtime" and
  `specs/opencode-harness/spec.md`'s added "Requirement: OpenCode
  runtime-identity signal (best-effort)" describe the same underlying
  behavior (the third, lowest-precedence OpenCode env-signal check in
  `setup-worktree.sh`/`resolve-speed.sh`) with near-duplicate scenario text
  in two separate capability spec files. Not contradictory today, but two
  independently-owned copies of the same requirement risk drifting out of
  sync on a future edit. Consider having `opencode-harness/spec.md`
  reference the `harness-identity` capability's requirement rather than
  restating its scenarios verbatim.
- `specs/opencode-harness/spec.md`'s "eject/diff/upgrade/completions support
  opencode" requirement says eject prints the rendered agent "for a
  supported role" without defining which roles are supported/unsupported;
  `tasks.md` §4.7 punts this to implementation ("decide and implement which
  roles OpenCode eject supports"). Design.md Decision 5 implies parity with
  the other two harnesses across all 5 standard roles, so this likely
  resolves itself, but tightening the spec wording to name the role set (or
  explicitly say "all `core/roles/*.md` roles, matching Codex/Claude Code
  parity") would remove the ambiguity outright.
