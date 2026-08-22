## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read all five artifacts (`ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/git-child-env-hardening/spec.md`) in full.
- Read helio's shipped ground truth directly: `/home/matt/Development/helio/scripts/concertino/`
  `lib/git-child-env.sh`, `lib/git-child-env.selftest.sh`, `setup-worktree.sh`, `cleanup.sh`,
  `assert-phase.sh`, `start-servers.sh`.
- **Prefix strip (check 1): CONFIRMED sound.** Helio's helper is
  `git_child() ( unset -v $(compgen -v GIT_ 2>/dev/null) 2>/dev/null || true; exec git "$@" )`.
  The proposal ("via `compgen -v GIT_`, not an enumerated denylist"), design Decision 1, design
  Non-Goals ("No new denylist of GIT_* variable names anywhere"), tasks 1.1, and the spec's
  "A yet-unnamed GIT_* variable is still stripped" scenario all preserve prefix-strip. No
  denylist survives anywhere in the artifacts.
- **cd/eval precedence (check 2): CONFIRMED matches ground truth.** helio
  `setup-worktree.sh:357` is verbatim:
  `( cd "$WORKTREE_PATH" || exit 0; unset -v $(compgen -v GIT_ 2>/dev/null) 2>/dev/null; eval "$hook" >/dev/null 2>&1 ) || true`.
  design Decision 3, tasks 2.3 and the spec's "setup-worktree.sh hook-eval sequencing"
  requirement all specify exactly this form and explicitly reject
  `cd ... && unset ... || true; eval ...`.
- **Selftest asserts against the real file (check 3): CONFIRMED required.** Spec Requirement
  "Regression selftest asserts against the real shipped file" plus its "Selftest goes red when
  only the real file regresses" scenario, design Decision 4, and tasks 3.1 all require asserting
  against the real file, not an inline copy. Matches helio's selftest's final
  `SETUP_WORKTREE=...; HOOK_LINE="$(grep -F 'eval "$hook"' ...)"` block. (One ordering defect in
  how this is *sequenced* — see CR 2.)
- **Scope creep (check 4): CONFIRMED excluded.** CON-128/131/132 named in design Non-Goals,
  Decision 5, proposal, and tasks 6.2. (But the *rationale* for the cleanup guard is wrong — CR 3.)
- **AC traceability (check 5):** ACs 1, 3, 4, 5, 6 trace to spec requirements / tasks 4-6.
  **AC 2 ("a fresh render includes the `git-child-env.sh` helper and its selftest") does not
  trace to anything and cannot be met as designed** — see CR 1.
- Engine ground truth: `lib/cli/emit.js:426-430` renders scripts with a **flat, non-recursive**
  `fs.readdirSync(path.join(core,'scripts'))` + `fs.copyFileSync` (`lib/cli/shared.js:76`).
  `lib/cli/doctor.js:42-43` does the same with a read-based `compare`. Reproduced the consequence
  on this machine:
  `node -e fs.copyFileSync(<dir>,...)` → `EISDIR`; `fs.readFileSync(<dir>)` → `EISDIR`.
- Verified the ticket's start-servers claim: core `start-servers.sh:82` already has the fixed
  `nohup env $cmd` line (matches helio's line 84); core line 43 still has the bare
  `REPO_ROOT="$(git rev-parse --show-toplevel)"` that tasks 2.4 converts. Ticket claim holds.
- Verified helio's cleanup.sh guard is literally `if true; then echo "... DISABLED in this
  checkout (CON-128 ...)" >&2; elif other_runs_live; then ... else <sync> fi`, with a comment
  reading "Remove this guard (and this comment) once the binary resolution is fixed."

### Verdict: REFUTE

### Change Requests

1. **The design's central Non-Goal is false: this change CANNOT be content-only, and as
   specified `concertino sync` would crash.** `design.md` Non-Goals says "No change to the sync
   mechanism itself (`concertino sync`'s rendering engine) — this is a content-only change to
   what gets rendered." But the renderer enumerates `core/scripts/` flatly and copies each entry
   with `fs.copyFileSync` (`lib/cli/emit.js:426-429` → `lib/cli/shared.js:76`). Adding
   `core/scripts/lib/` makes `readdirSync` yield the string `lib`, and `copyFileSync` on a
   directory throws `EISDIR` (reproduced above) — so every `concertino sync` in every project
   would hard-fail, and ticket AC 2 ("a fresh render includes the helper and its selftest") is
   unachievable. `lib/cli/doctor.js:42-43` has the identical flat enumeration and its
   read-based `compare` would throw `EISDIR` too. Revise `proposal.md`/`design.md`/`tasks.md`/
   the spec to (a) delete or invert that Non-Goal, (b) add an explicit decision on how
   subdirectories under `core/scripts/` are rendered (recursive copy in `copyAssets` vs.
   flattening the helper to `core/scripts/git-child-env.sh` — note flattening would change the
   `source "${SCRIPT_DIR}/lib/git-child-env.sh"` line the selftest's static wiring check greps
   for, so the choice is load-bearing for task 3.1), (c) cover the `if (!dry && f.endsWith('.sh'))
   chmodSync 0o755` executable-bit path for files nested under `lib/`, (d) extend `doctor`'s
   drift check to whatever new layout is chosen, and (e) add a task + acceptance scenario that a
   real render actually produces `scripts/concertino/lib/git-child-env.sh` and
   `git-child-env.selftest.sh` (with the selftest executable). Without this, tasks 5.1's render
   step is the first thing that will fail in execution.

2. **`tasks.md` 4.1 inverts red-before-green into the exact vacuous form this ticket exists to
   prevent.** It reads "**Before implementing 3.1's real-file assertion**, ... demonstrate the
   selftest fails when the `cd`/`unset`/`eval` sequencing fix from 2.3 is reverted." Before that
   assertion exists, reverting only the real `setup-worktree.sh` line leaves the selftest at
   "ALL PASS" — that is precisely helio's documented `skeptic-final-2.md` failure mode. As
   written, task 4.1 either cannot go red or invites the implementer to declare a false red.
   Reorder: implement 3.1 including the real-file assertion first, **then** in the `mktemp -d`
   copy revert only the real `core/scripts/setup-worktree.sh` hook line (selftest untouched) and
   demonstrate a non-zero exit naming the sequencing regression, then restore and re-run green.
   This also aligns the task with ticket AC 5 and the spec's "Selftest goes red when only the
   real file regresses" scenario.

3. **The `cleanup.sh` sync guard is not actually decided, and the deferral rationale is a
   non-sequitur.** The ticket says "**Decide** and port the correct upstream form of the
   `cleanup.sh` automatic-sync guard." `design.md` Decision 5 instead defers with "CON-131
   already tracks the guard's separate, known defect (exits 0 on git-op failure)" — CON-131 is
   about cleanup.sh's exit code on git-op failure, which has nothing to do with whether the guard
   belongs in a template. The thing actually needing a decision is that helio's guard is a
   checkout-local, self-described temporary hack: `if true; then echo "... is DISABLED in this
   checkout (CON-128 ...)"`, with a dead `elif other_runs_live` branch and a comment saying
   "Remove this guard (and this comment) once the binary resolution is fixed." Porting it
   verbatim into `core/` would (a) permanently disable auto-sync for *every* consuming project,
   (b) ship an `if true;`/unreachable-`elif` dead branch to every project, and (c) hang that
   permanent behaviour on CON-128, which this same ticket records as **refuted** ("do not build
   version-stamping") — i.e. the stated unblock condition can never occur. Make and record an
   explicit decision (verbatim port / generalize behind a config or env flag defaulting to
   disabled / port with reworded non-helio-specific prose), and reword the spec's "cleanup.sh
   automatic-sync guard is preserved" requirement to match; as written it says only "matching
   helio's currently-shipped guard in behavior", which a competent implementer can read either
   way. Relatedly, `proposal.md` claims "Modified Capabilities: (none)" while the spec adds a
   cleanup.sh sync-guard requirement under the `git-child-env-hardening` capability — the sync
   guard is not git-child-env hardening; either scope it into its own capability or justify the
   grouping.

### Non-blocking notes

- `design.md` Decision 3's mechanism sentence ("`|| true` absorbs the `&&` chain's failure and
  the trailing `; eval ...` runs unconditionally regardless") states the consequence but omits
  the sharper half: on `cd` failure the `&&` also skips the **`unset`**, so `eval` runs both in
  the wrong cwd *and* with `GIT_*` still poisoned. The ticket text states this correctly; the
  design is a slightly weaker paraphrase.
- The spec's real-file requirement hardcodes the path `core/scripts/setup-worktree.sh`. helio's
  selftest resolves its target relatively (`CONCERTINO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"`),
  which is what makes it work both in-place in `core/` and post-render in
  `scripts/concertino/`. Consider phrasing the requirement as "the sibling `setup-worktree.sh`
  resolved relative to the selftest's own location" so the rendered copy is covered too.
- Ground-truth call-site counts for tasks 2.1-2.4, useful as an execution checklist: helio has
  `git_child` at assert-phase.sh x7, cleanup.sh x12, setup-worktree.sh x8, start-servers.sh x1.
