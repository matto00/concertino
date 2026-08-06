## Context

Ten `lib/cli/cmd*` modules each hand-write the identical two-line
`out`/`--config` resolution described in `proposal.md`. `lib/cli/shared.js`
already exists as the home for this kind of cross-command plumbing
(`parseArgs`, `exists`, `read`, `write`, etc.), so the natural extraction
point is two new exports there rather than a new module.

## Goals / Non-Goals

**Goals:**
- Remove the ten duplicated copies of the `out`/`--config` resolution logic.
- Preserve behavior exactly — same resolution rule, same precedence
  (`args.config` wins when present, else `<out>/concertino.config.json`).
- Keep the change mechanical and easy to review: no unrelated refactoring of
  the ten touched files beyond the resolution lines themselves.

**Non-Goals:**
- Changing the resolution rule itself (e.g. adding an env-var fallback) — a
  separate, follow-on concern the ticket explicitly calls out as motivation,
  not scope.
- Touching `init.js` (unconditional `cfgPath`, no `args.config` override —
  a different rule, not the duplicated pattern) or `upgrade.js`/`answer.js`
  (only `out` resolution, no `cfgPath` at all, or neither) — out of scope per
  the ticket's own "ten of thirteen" framing.

## Decisions

**Decision 1: Two helpers, not one.** `resolveOut(args)` and
`resolveConfigPath(args, out)` are separate functions rather than a single
`resolveOutAndConfig(args)` returning both, because a few call sites need
`out` independently of `cfgPath` (e.g. `doctor.js` uses `out` in several
unrelated checks before/after the `cfgPath` line) and keeping them separate
lets each call site opt into only what it needs, matching today's
call-by-call shape.

Alternative considered: a single combined helper returning `{ out, cfgPath }`.
Rejected — it would force every call site to destructure even when only one
value is needed, and doesn't match the existing style of small, single-purpose
helpers in `shared.js`.

**Decision 2: Location — `lib/cli/shared.js`, not a new module.**
`shared.js` is already the designated home for cross-command CLI plumbing and
is already imported by all ten target files (directly or transitively via
`parseArgs`/`exists`/etc.), so adding two more exports there requires no new
`require` wiring beyond what's already present, and matches the file's
existing stated purpose ("Shared plumbing for the CLI command modules").

Alternative considered: a new `lib/cli/paths.js`. Rejected — unnecessary
indirection for two small functions with no other cohesive grouping of their
own.

**Decision 3: Signature — `resolveConfigPath(args, out)` takes `out` as a
parameter rather than recomputing it internally.** Every existing call site
already computes `out` on the line immediately before `cfgPath` and needs
`out` again later in the function body (e.g. for `watch({ root: out, ... })`),
so recomputing `out` inside `resolveConfigPath` would either duplicate the
resolution a second time or force callers to discard their own `out` in favor
of a second call — passing `out` in keeps one resolution per call site
exactly as today.

## Risks / Trade-offs

- [Risk: a call site's local variable name for `cfgPath` or `out` differs
  slightly (already-observed spread: `out`, `cfgPath` are consistent across
  all ten, so this is low)] → Mitigation: grep-verified before editing; the
  refactor only replaces the two resolution lines, not any downstream usage,
  so a renamed local doesn't need touching elsewhere in the same function.
- [Risk: byte-for-byte behavior drift introduced during extraction] →
  Mitigation: helper bodies are copy-pasted verbatim from the existing
  duplicated lines, not rewritten from a description; existing test suite
  (unit tests over `lib/cli/*`, if present) re-run after the change as a
  regression check.

## Migration Plan

Single-commit refactor: add the two helpers to `shared.js`, then switch all
ten call sites in the same change. No phased rollout, no data migration, no
user-facing behavior change to communicate. Rollback is a plain revert if
needed — no persisted state depends on the new helpers existing.
