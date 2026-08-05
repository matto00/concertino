## Skeptic Report — design gate (round 5, human-authorized cold pass on revised Decision 4a)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md` (full), `tasks.md` (full), and
  the current `specs/escalation-bubble-up/spec.md`, `specs/escalation-answer-cli/spec.md`,
  `specs/escalation-trust-offramp/spec.md`, `specs/inline-orchestrator-mode/spec.md`,
  `specs/orchestrator-turn-discipline/spec.md` fresh, cold — plus
  `skeptic-design-3.md` and `skeptic-design-4.md` (read as claims to verify,
  not facts), to understand exactly what the human-directed rethink is
  replacing.
- Re-read `lib/ui/store.js:199-296` (`writeAnswer`, `writeSubAnswer`) in full.
  Confirmed the exact comment design.md quotes (`store.js:199-206`) is
  byte-for-byte accurate, and confirmed `writeSubAnswer`'s `complete` flag
  (`subAnswers.length === total && subAnswers.every((a) => a != null)`,
  line 282) matches design's description exactly.
- Re-read `scripts/concertino/emit-event.sh` in full (575 lines, current
  pre-implementation state — confirmed via `git status`/`git diff main...HEAD`
  that no code has been touched yet, only the openspec change directory is
  untracked, so this is genuinely design-gate). Confirmed the generic
  non-`--await` write path Decision 4a relies on (`AWAIT=0` branch, lines
  292-295: `write_line "$KIND" || true; exit 0`) exists today, unmodified, and
  that the `*)` case in the k=v parsing loop (lines 235-237) would fold an
  `answer=`/`sub_answers=` argument through `json_value` exactly like any
  other field — matching what the confirming poll loop itself already
  produces for `sub_answers` (line 526) and `answer` (line 557).
- Re-read `lib/ui/reducer.js:151-193` — confirmed `escalation.answered` and
  `escalation.timeout` both null out `run.escalation` purely by event *kind*,
  with no dependency on which process wrote it, so a self-recorded event from
  `concertino answer` folds identically to one written by the poll loop.
- Cross-checked `core/roles/orchestrator.md`'s **existing, pre-ticket** manual
  chat-fallback text (lines 790-804): confirmed today's system already has a
  precedent for a non-poller writing `escalation.answered` directly via the
  same generic path — but only ever *after* `--await` has already exited
  non-zero (timed out/killed), never while a poll is active. This is the same
  "no concurrent observer" shape Decision 4a (revised) argues for the new
  chat-via-bubble path, just via a different trigger (timeout vs. chunked
  turn-ending). Useful corroboration, not itself part of this ticket.
- Ran `openspec validate dual-channel-escalation-delivery --strict` — passes
  clean (`Change 'dual-channel-escalation-delivery' is valid`).
- Grepped the whole change directory for `confirming`/`Decision 4b`/"one more
  ... wait-only" — the only remaining hits are inside Decision 4a's own
  historical narration of what it replaced (clearly marked "the original
  version... four skeptic rounds found...") and `tasks.md`/spec text
  explicitly stating the confirming call is gone. No stray contradictory
  leftovers from the pre-rethink shape.

### Verifying the rethink's own reasoning

**1. The quoted invariant is accurate and correctly scoped.** `store.js:199-206`'s
comment says `writeAnswer` doesn't emit `escalation.answered` because
`--await`'s poll loop, *already actively polling*, is the one that will pick
it up — doing both would double it. Design.md's reading of this ("this is
purely about avoiding a guaranteed double-write on today's one existing path,"
not an `answer.json`-atomicity constraint) is correct: `O_EXCL`/rename
guarantee only-one-answer-applies; the comment's own concern is
only-one-*log-entry*.

**2. The "no concurrent observer" argument holds, given the rest of this
design's own structure — not just asserted.** I traced it against Decision
3's chunked-polling and Decision 5's "no outstanding spawned child" bubble
mechanics specifically, per the ask:
- Decision 3 has the root polling in short (~25-30s) `--wait-only` calls,
  *ending its own turn between them specifically so a chat reply can be
  processed on an ordinary subsequent turn* (that is the entire stated reason
  for chunking rather than one long blocking call). A chat-given answer is
  necessarily processed on a turn where no `--wait-only` call from that same
  root is in flight — by the time the root reacts to a chat message and
  invokes `concertino answer`, the previous poll has already returned
  (exit 2) and no new one has started yet. The two states ("blocked inside a
  `--wait-only` Bash call" and "processing a chat reply") are structurally
  sequential in this design, never concurrent, which is exactly what Decision
  4a claims.
- Decision 6 restricts *who* ever calls `--wait-only`/`concertino answer` at
  all: only the actual root (no parent of its own), never an intermediate
  relay. So there is exactly one process in the whole topology that could
  ever be "the observer," and it is the same process invoking `concertino
  answer` — reinforcing, not weakening, the no-second-observer claim.
- I checked the one case this argument doesn't need to cover but that a
  careless read might conflate: `--inline` mode's own `--await` call (which
  *is* a long-lived, single active poller, unchanged by this ticket).
  Decision 7 / `inline-orchestrator-mode`'s spec correctly keep `--inline`
  entirely off the `concertino answer` path — it never raises via
  `--raise-only`, never bubbles, and its own procedure only ever calls
  `--await` directly. Nothing in this design routes a chat-given answer
  through `concertino answer` while an `--await`/`--wait-only` call for that
  *same* escalation could plausibly be concurrently active. This scoping is
  correct and the design does not overreach it.
- Minor, non-blocking observation: nothing explicitly forbids an implementer
  from batching a `--wait-only` retry and a `concertino answer` write into the
  same parallel tool-call turn (Claude Code supports parallel tool
  dispatch within one message) rather than the sequential branch-on-return
  the prose describes throughout (Decision 4a, `tasks.md` 4.3, and the spec's
  "The root presents immediately and resolves via both channels" requirement
  all describe an explicit sequential branch: refused → continue loop;
  resolved → resume; partial → continue loop — never "issue both at once").
  This isn't a design gap so much as an unstated-but-inferable constraint;
  worth a one-line explicit statement in the role prose during execution
  ("never issue `--wait-only` and `concertino answer` as parallel tool calls
  in the same turn") but not something that makes the design ambiguous or
  wrong as written.

**3. The refused-write case is not a silent gap.** On refusal, the root
doesn't just log a message and move on — `writeAnswer`'s refusal carries no
answer *value*, so the root structurally *needs* another `--wait-only` (or
equivalent read) to learn what the dashboard's answer actually was before it
can `SendMessage` the resolution (question/answer/channel/timestamp) per the
"root resumes the bubbled orchestrator" requirement. This makes "the root's
own already-running or next `--wait-only` call is what observes and logs
that competing answer" a forced consequence of the design, not an assumption
that could be skipped by an inattentive implementer — confirmed by `tasks.md`
4.3's explicit "refused → ... continue the normal `--wait-only` loop."

**4. CON-46 multi-part path is genuinely preserved, and the specific round-4
gap is closed.** The dashboard wizard path is untouched (still
`writeSubAnswer` → the unmodified poll-loop `complete`-flag branch,
`emit-event.sh:504-542`). For the new chat path: `escalation-answer-cli/spec.md`'s
"records `escalation.answered` when, and only when, its write resolves the
escalation" requirement and its four scenarios (resolving single-question,
completing multi-part, **partial multi-part records nothing**, refused
records nothing) directly match `writeSubAnswer`'s actual `complete`
semantics I verified in `store.js`. `specs/escalation-bubble-up/spec.md` adds
the matching "A partial multi-part chat sub-answer does not resolve the
wait" scenario (lines 97-100), explicitly stating the root does not resume
the orchestrator and continues normal polling — this is precisely the gap
round 4 found (an unconditional "resolves exit 0" claim that broke for a
non-final multi-part sub-answer) and it is now closed by removing the
confirming call's exit-code branching entirely rather than patching it a
third time. `tasks.md` 7.2 has a dedicated multi-part/partial regression
trace matching this.

### Anything else this fresh pass caught

- `proposal.md`'s "Single authoritative resolution across channels" bullet
  (line 11) is worded loosely enough to read as if *both* a dashboard answer
  and a chat answer "resolve through this same command" (`concertino
  answer`). That's imprecise — per design.md Decision 4 (unchanged) and
  Decision 4a (revised), a dashboard answer still goes through
  `lib/ui/controllers/escalation.js` → `writeAnswer` directly, never through
  the CLI; only a chat-given answer goes through `concertino answer`. The
  authoritative documents (`design.md`, both spec deltas, `tasks.md`) are all
  precise about this distinction — only this one summary sentence in
  `proposal.md` is loose. Non-blocking (proposal.md is a narrative summary,
  not what an implementer would build from), but worth a one-line tightening
  pass.
- No other regressions found in the rest of the artifact set on this pass —
  `escalation-trust-offramp`'s `SendMessage`-relay-is-terminal requirement,
  `orchestrator-turn-discipline`'s narrow carve-out, and the recursive-relay
  Decisions 5/6 remain internally consistent with the revised 4a and with
  each other.

### Verdict: CONFIRM

### Non-blocking notes

1. `proposal.md` line 11 loosely implies both channels resolve "through this
   same command" (`concertino answer`) — only the chat channel does; the
   dashboard channel is unchanged (`writeAnswer` via
   `lib/ui/controllers/escalation.js`). Worth a precision pass, not blocking.
2. Consider adding one explicit sentence to the root's procedure (design.md
   Decision 4a / `orchestrator.md`'s eventual prose) ruling out ever issuing
   a `--wait-only` retry and a `concertino answer` write as parallel tool
   calls within the same turn — the design's own prose already describes a
   strictly sequential branch-on-return everywhere, so this is a
   belt-and-suspenders clarification, not a fix for an actual ambiguity.
