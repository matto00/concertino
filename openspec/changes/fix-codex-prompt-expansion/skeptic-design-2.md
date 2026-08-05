## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- Read round 1's report (`skeptic-design-1.md`) in full to establish the
  exact required revision: undefined behavior for a recognized-but-non-default
  codex `dashboard.launchCommand` operator override.
- Re-read `design.md`, `tasks.md`, and
  `specs/delivery-prompt-expansion/spec.md` fresh, in full.
- Confirmed the new **Decision 4a** in `design.md` (lines 168-197) explicitly
  adopts a no-op fallback: when the resolved-`codex` command's trailing
  quoted argument does not match the exact
  `"/concertino-deliver <request text>"` shape, the inlining step is a no-op
  and the command passes to `session.spawn()` byte-for-byte unchanged — this
  directly resolves round 1's Change Request 1 (which offered this as one of
  two acceptable options).
- Verified the claimed precedent is real: read
  `lib/ui/screens/launchplan.js:114-120` (`withSpeedFlag`) — it contains
  exactly `if (!m) return launchCommand; // no {{TICKET}} placeholder
  (custom override) — no-op`, matching Decision 4a's citation
  byte-for-byte in spirit and confirming the "mirrors an existing convention"
  claim is not fabricated.
- Confirmed `tasks.md` 2.5 now states the no-op requirement explicitly ("If
  the regex does not match ... the inlining step MUST be a no-op: return the
  command byte-for-byte unchanged ... Never let a non-match throw or corrupt
  the operator's custom command") and `tasks.md` 4.4 adds a dedicated
  regression test for exactly this case (`codex -c foo "some other prompt
  entirely"` passes through unchanged).
- Confirmed `specs/delivery-prompt-expansion/spec.md` gained a new
  requirement ("A recognized-but-non-default codex launch command is never
  rewritten") with a matching scenario ("Operator override is left
  untouched") — the spec now has explicit acceptance-level coverage for this
  case, not just an implementation note.
- Traced the mechanism end to end against real code to confirm Decision 4a
  is actually implementable as stated, not just plausible-sounding:
  - `lib/ui/harness.js`'s `harnessOfCommand()` (line 103) resolves harness
    from the first whitespace token only — confirmed it cannot and does not
    try to distinguish default-template from override, consistent with the
    design's own framing.
  - `lib/ui/harness.js`'s `launchSpecForTicket`/`launchSpecForChoices`
    (lines 233-262) insert provider flags (`--oss --local-provider ollama -m
    <model>`) via `cmd.replace(/^(\S+)\s/, '$1 ' + flags + ' ')` —
    immediately after the binary name, not at the string's end. This
    confirms the design's claim that a "final quoted segment" regex is
    unaffected by upstream provider-flag decoration: the trailing
    `"/concertino-deliver ..."` argument's position relative to the end of
    the string is unchanged regardless of what flags got inserted after the
    binary name.
  - `lib/ui/prompt.js`'s `submitTicket()` (lines 55-72) confirmed as the
    single choke point Decision 1 targets, with the existing
    `{{TICKET}}` substitution happening first, exactly as the design
    describes — the new inlining step's described insertion point (after
    substitution, before `session.spawn()`) is real and unoccupied by
    conflicting logic today.
- Independently re-measured `adapters/codex/prompt.md`'s actual content
  (`python3 -c "..."`): 88 backtick characters, 9 apostrophes, 0 `$`
  characters, 4196 bytes. `design.md` now states "88 backtick characters"
  (line 151) and "~4.1KB" (line 227) — both now match ground truth exactly,
  confirming round 1's two non-blocking factual corrections were applied
  correctly, not just claimed.
- Grepped `design.md`, `tasks.md`, and `spec.md` for `TODO|TBD|figure out
  later|to be determined` — none found; no new placeholders introduced by
  the round 1 → round 2 revision.
- Checked for new internal contradictions introduced by Decision 4a: cross-
  read Decision 1 (still describes the inlining step generically), Decision
  4 (flag/speed insertion point, unaffected), and the Risks section (now
  includes an explicit risk entry acknowledging the override-bypass
  trade-off as intentional, consistent with Decision 4a) — all consistent
  with each other and with the new spec requirement/scenario and task
  updates. No contradiction found.

### Verdict: CONFIRM

Round 1's required revision is now concretely, consistently, and
verifiably addressed across all three artifacts (design.md Decision 4a,
tasks.md 2.5/4.4, spec.md's new requirement + scenario), using a
precedented mechanism I confirmed is real in the codebase, not merely
asserted. Both non-blocking factual corrections (backtick count, file size)
were also applied and now match direct measurement. No new placeholders,
ambiguities, or contradictions were introduced by the revision.

### Non-blocking notes

- Neither `design.md` nor `tasks.md` states the literal regex pattern for
  extracting the trailing quoted segment (e.g. an exact `/"\/concertino-deliver
  ([^"]*)"$/`-shaped expression). This is a reasonable level of abstraction
  for a design doc — the shape ("final quoted segment," exact literal
  `/concertino-deliver` prefix) is unambiguous enough that two competent
  implementers would converge on equivalent regexes — but the executor
  should treat matching precision (anchoring at the true end of the command
  string, not just any occurrence) as load-bearing given Decision 4a's
  entire safety property depends on the regex reliably NOT matching
  non-default shapes.
