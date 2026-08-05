## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Read `ticket.md`, the revised `proposal.md`, `design.md`, `tasks.md`, and
  `specs/cli-default-command/spec.md` in full (fresh read this round, not
  reused from round 1).
- Round 1 (`skeptic-design-1.md`) REFUTEd on a single gap: `README.md`'s
  `## CLI reference` section — a third, independent full subcommand listing —
  was out of scope despite being missing `answer`/`prune` and having no
  bare-invocation note. Confirmed this round that the gap is closed:
  - `proposal.md` "What Changes" now has an explicit audit-fix bullet for
    `README.md`'s `## CLI reference` (missing `prune`/`answer`, no
    bare-invocation mention), and the "Impact" section lists `README.md`
    alongside `bin/concertino`, `lib/cli/help.js`, `lib/cli/completion.js`.
  - `design.md` Decision 3 ("watch becomes primary form in documentation")
    now explicitly names `README.md`'s CLI reference alongside
    `lib/cli/help.js` and `docs/dashboard.md` as gaining the
    bare-form/alias note. Decision 4 ("audit fixes: fix mechanically-safe,
    ticket-named gaps inline") now explicitly lists `README.md`'s `##
    CLI reference` as the third of three tables/lists getting the same
    treatment as `completion.js` and `help.js`, with the same
    mechanical-verifiability rationale (compare against `bin/concertino`'s
    dispatch chain).
  - `tasks.md` section 2 gained task 2.4: update `README.md:82-134`'s CLI
    reference with a bare-`concertino` entry, `watch`'s alias note, and
    `prune`/`answer` entries — parallel in scope and specificity to 2.1
    (completion.js) and 2.2/2.3 (help.js).
  - `specs/cli-default-command/spec.md`'s "Every registered subcommand is
    discoverable" requirement now includes `README.md`'s `## CLI reference`
    in its requirement text, with a third scenario ("README's CLI reference
    covers every dispatched subcommand") mirroring the completion/help
    scenarios exactly.
- Re-verified against the actual current repo state (not just the plan's
  claims) to confirm the plan remains grounded:
  - `bin/concertino:44-63` — the dispatch `if/else` chain — confirmed
    `answer` (line 63) and `prune` (line 51) are real, currently-dispatched
    subcommands, matching every claim in proposal/design/tasks/spec about
    what's missing from README/completion/help.
  - `README.md:82-134` — read the full `## CLI reference` code block.
    Confirmed it still lacks `prune` and `answer` entries and still
    documents only `concertino watch` (line 111) for launching the
    dashboard, with no bare-invocation mention — i.e. the gap tasks.md 2.4
    targets is real and current, not already fixed or stale. (README.md
    itself is correctly untouched this round — only the planning docs were
    revised, as expected; the executor implements task 2.4 next cycle.)
  - `lib/cli/help.js` (95 lines) — re-read in full; confirms the existing
    `prune`/`watch`/etc. entries' format that tasks.md 2.4 asks README to
    match is a real, consistent template to follow.
- Checked for new problems introduced by the revision itself (not just
  whether the prior gap was patched): no new placeholders (`TODO`/`TBD`), no
  new internal contradictions between proposal/design/tasks/spec, and no
  scope creep — the addition is scoped exactly to README's `## CLI
  reference` section, the same bounded surface round 1 identified, nothing
  broader (e.g. no other README sections, no docs/ file beyond what was
  already planned, pulled in).
- Confirmed the round-1 report's non-blocking notes (tasks.md 3.1 /
  design.md Decision 3's `docs/dashboard.md` treatment) required no further
  changes and received none — consistent with round 1's assessment that
  those were already sound.

### Verdict: CONFIRM

### Non-blocking notes

- `tasks.md` 2.4's cited line range (`README.md:82-134`) is close but not
  exact against the current file (the code-fenced block itself runs
  84–134, heading at 82) — immaterial, since the executor will locate the
  section by content (the `## CLI reference` heading and command names) not
  by line number, and line numbers naturally drift as tasks 1.x/2.1–2.3 land
  first in the same execution cycle.
