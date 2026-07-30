## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

Read fresh, in full, deriving nothing from round 1's narrative: `ticket.md`,
`proposal.md`, `design.md`, `tasks.md`, `specs/escalation-deadline-source/spec.md`,
`specs/escalation-trust-offramp/spec.md` (and `skeptic-design-1.md` as a *claim*).

- **Structural validity:** `openspec validate escalation-await-reliability-offramp --strict`
  → `Change 'escalation-await-reliability-offramp' is valid`. Every finding below is
  substantive, not structural. `specs/escalation-resume/` is indeed gone; the two
  capability dirs match `proposal.md`'s Capabilities list.

- **The revised root cause (Part 1, Decision 1) — verified true and the fix verified
  to work.**
  - `core/scripts/emit-event.sh` has no `.concertino.env` sourcing anywhere;
    `TIMEOUT_MIN="${CONCERTINO_ESCALATION_TIMEOUT_MIN:-60}"` at line 381 is the only
    read. Siblings do source it: `assert-phase.sh:26`, `start-servers.sh:35`,
    `cleanup.sh:47`, `setup-worktree.sh:70`, `resolve-speed.sh:77`.
  - `/home/matt/Development/concertino/scripts/concertino/.concertino.env` exists and
    sets `CONCERTINO_ESCALATION_TIMEOUT_MIN=8`; `concertino.config.json` has
    `"envFiles": []`; the worktree's own
    `CON-47/scripts/concertino/.concertino.env` genuinely **does not exist**
    (`ls` → No such file or directory). So the design's central correction —
    a `SCRIPT_DIR`-only fix would not have fixed the real case — is correct.
  - `ROOT="$(main_checkout)" || exit 0` is a single occurrence (line 142), and
    `main_checkout()` (lines 58–68) resolves via `git rev-parse --git-common-dir`,
    which works from a worktree. Anchor point is real and unambiguous.
  - **Probe A** (scratchpad temp repo + real worktree, current unpatched script,
    `.concertino.env` with `CONCERTINO_ESCALATION_TIMEOUT_MIN=0` only in the main
    checkout, invoked as `bash scripts/concertino/emit-event.sh escalation --await`
    from inside the worktree under `timeout 5`): `exit=124 elapsed=5s`, log =
    `escalation.raised`, `escalation.timeout`. Confirms the configured value is
    ignored today **and** that a SIGTERM kill leaves `escalation.timeout` as the
    ticket's most recent event.
  - **Probe B** (same setup, script patched with design.md Decision 1's exact
    two-branch snippet): `exit=1 elapsed=0s` — the main-checkout `.concertino.env`
    was sourced from inside the worktree and the deadline applied. **Decision 1 is
    implementable exactly as written and does what it claims.**
  - Existing suite safety verified: `test/scripts/emit-event.test.sh:21` resolves
    `$SCRIPT` to the real `core/scripts/emit-event.sh` (no `.concertino.env` in
    `core/scripts/`) with cwd a `mktemp -d` git repo (no `scripts/concertino/` at
    all), so neither branch fires — design.md:48's "zero behavior change for the
    entire existing suite" holds.

- **Real escalation traces re-measured myself** (node over
  `.concertino/runs/<T>/events.jsonl`): CON-30 `raised → timeout +599.9s`,
  `raised → timeout +599.8s`; CON-35 `raised → timeout +599.9s`; CON-22
  `raised → answered +3304.8s → timeout +3600.5s from raise`. Matches the revised
  premise in `proposal.md:5` / `design.md:3`.

- **Who writes what:** `lib/ui/store.js:211–227` (`writeAnswer`) writes **only**
  `answer.json`; its own comment at :203 states `--await` "is the reader; it records
  `escalation.answered` itself once it picks" it up. `emit-event.sh:386–402` is the
  sole `escalation.answered` writer besides the documented manual fallback
  (`core/roles/orchestrator.md:529–533`). `docs/dashboard.md:201` says the same.

- **Post-kill / post-timeout log state at Decision 2's call site:**
  `emit-event.sh:355–360` (`on_kill` → `write_line escalation.timeout`) and
  :408–415 (natural-deadline path → `write_line escalation.timeout`);
  `core/roles/orchestrator.md:522–524` states the invariant outright — *"Non-zero
  exit: it timed out, or the wait was killed. **Either way** `--await` has already
  recorded `escalation.timeout`"*; `docs/dashboard.md:206–209` repeats it.
  - **Probe C** (patched script, 60-min deadline, `answer.json` written ~0.4s before
    a `timeout -s TERM 6` kill — i.e. the exact "answer arrives in the gap" case
    Decision 2 exists for): `await exit=124`; log = `escalation.raised`,
    `escalation.timeout` (no `answer`); `answer.json` **still present** containing
    `{"answer":"approve"}`. The human's real answer survives in `answer.json`; the
    event log says only "timed out".

- **Reducer/UI (re-verified, not inherited):** `lib/ui/reducer.js:155–158` nulls
  `run.escalation` on both `escalation.answered` and `escalation.timeout`;
  `lib/ui/watch.js:473–477` walks the human back off the escalation screen. So after
  a recorded timeout the dashboard cannot solicit a new answer — consistent with
  design.md's Rejected-approach section.

- **Registration surfaces for new files:** `bin/concertino`'s `copyAssets()` uses
  `fs.readdirSync(path.join(core,'scripts'))` (line 664) — a new `core/scripts/*.sh`
  **is** picked up by `concertino sync` automatically, so tasks.md 6.1 is sound.
  But `package.json:23`'s `test` script **enumerates every shell test file
  explicitly** (including `check-merge-readiness.test.sh`), and nothing in tasks.md
  registers the new test there.

- **`check-merge-readiness.sh` precedent** (the pattern Decision 2 cites): confirmed
  it takes `<WORKTREE_PATH> …`, carries its own `main_checkout()`, prints
  `FAIL <reason>` to stderr, `set -uo pipefail`. The pattern claim is accurate.

- **Part 2 re-verified independently:** `specs/escalation-trust-offramp/spec.md`'s
  three requirements + five scenarios map 1:1 onto `ticket.md:31–34`'s four numbered
  points (corroborate-before-recording; recording is terminal; no reopening, naming
  the exact failure mode; unsolicited-claim carve-out). Placement (`design.md:70`,
  tasks 5.1–5.5) targets a real anchor — the Exit 0 / Non-zero bullets at
  `core/roles/orchestrator.md:519–533` — and the timeout-vs-answer tension flagged in
  round 1 is now explicitly resolved (design.md:72, task 5.5) against the existing
  "A timeout is never an approval" text at :525–526. **Part 2 is sound; I have no
  change requests against it.**

### Verdict: REFUTE

Decision 1 (the corrected root cause) is right and probe-verified. Part 2 is sound
and ready. The blocker is **Decision 2** — the replacement safety net. It reproduces
the same structural defect round 1 REFUTE'd in `--resume`: its success condition
cannot be true at the call site it is specified for. The design even restates the
governing fact (`on_kill` always records `escalation.timeout`) in its
Rejected-approach section without applying it to the mechanism that replaced it.

### Change Requests

1. **Decision 2's "found an answer" branch is unreachable at its specified call
   site — it can never fire.** `design.md:54–58` / `specs/escalation-deadline-source/spec.md:19`
   define success as *"the most recent event among `escalation.raised` /
   `escalation.answered` / `escalation.timeout`* is `escalation.answered`", and
   `tasks.md` 4.1 / spec.md:38 fix the call site at "on a non-zero `--await` exit,
   before falling back to chat". Enumerate the log tail at that instant:
   - natural deadline elapsed → `emit-event.sh:413–415` wrote `escalation.timeout` → spec's "timed-out" case → **nothing reported**;
   - `TERM`/`INT` kill → `emit-event.sh:355–360` wrote `escalation.timeout` → **nothing reported** (Probes A and C; CON-30 ×2 and CON-35 at 599.9s);
   - uncatchable kill / process vanishes → tail is `escalation.raised` → spec's "still-open" case → **nothing reported**;
   - the raise-write failed → `emit-event.sh:334–336` exits 1 with no escalation events → **nothing reported**.
   That is 100% of reachable states, and `core/roles/orchestrator.md:522–524` — the
   very bullet task 4.1 inserts *after* — already asserts the same invariant
   ("**Either way** `--await` has already recorded `escalation.timeout`"). So
   `spec.md:21–23` ("A recorded answer is reported" at the orchestrator call site),
   task 3.3's exit-0 branch and task 4.2's "if it reports an answer" branch are dead
   code, and `design.md:58`'s claim that this "directly closes the 'don't lose an
   answer that arrives in the gap between a kill and the fallback' goal" is false.
   Either resolve this (see CR2) or drop Decision 2 from the change.

2. **The answer that a kill actually loses lives in `answer.json`, which the check is
   specified to ignore.** `lib/ui/store.js:211–227` writes only `answer.json`;
   `emit-event.sh:386–402` is the only thing that ever turns it into an
   `escalation.answered` event — so by construction an answer lost to a kill is never
   in the event log. Probe C is the demonstration: `answer.json` holds
   `{"answer":"approve"}` while the log's most recent escalation event is
   `escalation.timeout`. If the goal in `design.md:13` is to be met, the check must
   read `answer.json` (read-only, no consumption), with an explicit staleness rule —
   e.g. accept it only if its mtime is after this escalation's `escalation.raised`
   `t`, since `emit-event.sh:367–379` already treats a pre-existing `answer.json` as
   possibly belonging to an earlier question and records `escalation.answer_discarded`
   rather than trusting it. Specify that rule and add a scenario for the stale case,
   or state explicitly (Non-Goals) that no recovery exists and delete the claim at
   `design.md:13`/`:58` and `proposal.md:12`.

3. **`proposal.md` and `design.md`/spec specify two different matching rules, and
   they diverge on a log shape this repo actually produced.** `proposal.md:12` says
   "an `escalation.answered` event recorded **after the original `escalation.raised`
   for this exact question**"; `design.md:54` and `spec.md:19` say "the **most
   recent** event among the three kinds". On CON-22's real tail
   (`raised → answered → timeout`, verified above) the proposal's rule reports the
   answer and the design's rule reports nothing. Pick one and make all three
   artifacts agree. If it is the ordering rule, state the assumption it rests on
   ("an `answered` newer than the newest `raised` necessarily answers the current
   question") — nothing in the spec matches on question text, so the "for this exact
   question" wording in `proposal.md` is not implemented by anything.

4. **The residual cases used to justify Decision 2 are not covered by the trigger
   Decision 2 specifies.** `design.md:13` and `proposal.md:12` justify the check with
   "a session restart, compaction, or a shorter per-call timeout on some other
   harness". In a restart or post-compaction resume there is no `--await` exit code
   to hook — the orchestrator is a fresh context — so the single trigger at
   `tasks.md` 4.1 / `spec.md:38` reaches none of them. Either add the recovery
   trigger those cases need (e.g. "when resuming a run whose log shows an escalation
   raised with no recorded resolution, check before re-raising" — note this is also
   the one place where an orphan poller's `escalation.answered` *could* be the tail,
   i.e. the only state in which CR1's success branch is satisfiable), or drop those
   cases from the justification.

5. **The new test file would never run.** `tasks.md` 3.4 adds
   `test/scripts/check-escalation-answer.test.sh`, but `package.json:23`'s `test`
   script lists every shell suite by name (`… && bash test/scripts/check-merge-readiness.test.sh`)
   and no task adds the new one. Add a task to register it in `package.json` (and
   check whether any CI workflow enumerates suites separately).

6. **`tasks.md` 2.1 as worded would write a `.concertino.env` into the live source
   tree and hang the existing suite.** `test/scripts/emit-event.test.sh:21` sets
   `$SCRIPT` to the repo's real `core/scripts/emit-event.sh`, so "a `.concertino.env`
   next to the script" literally means `core/scripts/.concertino.env` — a gitignored
   file dropped in the working tree that would then be sourced by *every* later case
   in the same suite, including lines 155 and 238 which pass
   `CONCERTINO_ESCALATION_TIMEOUT_MIN=0` as a process env var and would now be
   clobbered to the file's value (an 8-minute hang each). Restate the task to copy
   the script into the per-case temp repo for that scenario (and clean up), and while
   there make the precedence explicit in the design: the sourced file **overrides** an
   already-exported `CONCERTINO_ESCALATION_TIMEOUT_MIN` (that is what the sibling
   convention does — `assert-phase.sh:26` et al. — but the design never says so, and
   two of the existing tests depend on the opposite for their speed).

### Non-blocking notes

- Decision 1's snippet sits at line 142, i.e. *before* `ROLE="${CONCERTINO_ROLE:-script}"`
  and `PROJECT="${CONCERTINO_PROJECT:-$(basename "$ROOT")}"` (lines 144–146). Harmless
  today — the rendered `.concertino.env` carries neither key — but worth one clause in
  design.md noting that any future `.concertino.env` key colliding with a
  `CONCERTINO_*` var emit-event.sh reads would now win over the caller's environment.
- `docs/dashboard.md:206–213` describes the post-timeout flow as "the orchestrator
  falls back to presenting the `ESCALATION` block in chat exactly as it always did".
  If Decision 2 survives in any form, that paragraph needs the new step too — round
  1's CR7 flagged this file and tasks.md now covers only the script header and
  `core/scripts/README.md`.
- Design.md's Non-Goal on the sibling scripts' identical `SCRIPT_DIR`-only gap is the
  right call for this ticket, but note the gap is not purely latent: `resolve-speed.sh`
  falls back to `CONCERTINO_HARNESS` from `.concertino.env` and is invoked from
  worktree context too, so harness detection can silently degrade to "unknown" the
  same way. Worth naming that concretely in the follow-up ticket.
- If the fastest path to value is preferred: Decision 1 (probe-verified) plus Part 2
  (sound) are independently shippable with no reference to Decision 2 at all —
  `design.md:83`'s Migration Plan already treats the new script as free-standing.
  Dropping Decision 2 to a follow-up is a legitimate resolution to CR1–CR4.
