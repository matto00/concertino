## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed head: `8a62ec4b0a1d948bbe7375f49769cc380377dab2` (branch
`feature/agent-merge-protected-paths/CON-193`, base `8a96bd1`).

### What I verified (with evidence)

1. **Spawn-cwd guard**: `pwd -P` = `/home/matt/Development/helio`;
   `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio
   branch=feature/agent-merge-protected-paths/CON-193`. Proceeded.

2. **Read `lib/config.js`'s `isPathspecMagic`** (lines 481-503) and
   `core/scripts/check-merge-readiness.sh`'s condition-4 pattern loop
   (lines 620-656). Both independently implement the identical literal
   check: `entry.startsWith('!') || entry.startsWith(':')` (JS) /
   `[[ "$pat" == \!* ]] || [[ "$pat" == :* ]]` (bash). Confirmed the two
   layers are genuinely independent code paths (not one calling the
   other), matching the executor's claim.

3. **The class is NOT actually closed — reproduced a third bypass shape
   the fix does not cover.** A `protectedPaths` entry with a **leading
   space**, e.g. `" !record/**"`, is:
   - Accepted by `isPathspecMagic`: `entry.startsWith('!')` is `false`
     (the string starts with a space), `entry.startsWith(':')` is
     `false`. Verified directly:
     ```
     node -e 'const {isPathspecMagic}=require("./lib/config.js");
       console.log(isPathspecMagic(" !record/**"))'
     → false
     ```
   - Accepted by the script's own `[[ "$pat" == \!* ]] || [[ "$pat" == :*
     ]]` guard for the same reason (leading space, not leading `!`/`:`).
   - **Silently matches nothing** when handed to git as
     `:(glob) !record/**` — confirmed directly against real git:
     `git diff --name-only <A> <B> -- ":(glob) !record/**"` returns
     empty output, exit 0, even though the commit under test genuinely
     touches `record/foo.md`.
   - I built a full reproduction against the **real**
     `core/scripts/check-merge-readiness.sh` (not a mock), reusing the
     test suite's own `new_repo`/`write_events`/`run_check`/`gh`-mock
     harness verbatim (same shape as fixtures P11-P13), with a positive
     control on the identical fixture:
     ```
     === protectedPaths: [" !record/**"] (leading space) ===
     RC=0
     OUT=PASS
     ERR=(empty)

     === positive control: protectedPaths: ["record/**"] (same fixture) ===
     RC=5
     OUT=(empty)
     ERR=PROTECTED record/foo.md
     ```
     The positive control proves this isn't some unrelated harness
     breakage — the identical fixture, same commit, same diff, differing
     only in the glob's leading whitespace, goes from a correct refusal
     (exit 5, `PROTECTED record/foo.md`) to a silent `PASS`/exit 0.
     Repro script: `/tmp/claude-1000/-home-matt-Development-helio/
     3b20cfef-7751-4cc0-a989-6adc71a633e8/scratchpad/repro-leadingspace.sh`
     (scratch dir, not part of the change).

   This is **the exact same failure class round 1 REFUTEd on** — a
   `protectedPaths` entry that passes config validation, passes the
   script's own fail-closed layer, and produces a `PASS`/exit-0 output
   indistinguishable from a legitimate non-match, while the diff
   genuinely touches the protected path. The remediation's own design
   comment (lib/config.js:487-490) explicitly frames the fix as
   "ALLOWLIST-shaped... not a denylist of the one shape a review
   demonstrated — a denylist is exactly how that shape slipped past the
   first time." In practice the shipped check is still a narrow denylist
   of two literal prefixes (`!`, `:`), not a true allowlist of "is this a
   plain glob" — a real allowlist would reject anything containing
   leading/embedded whitespace, `!`/`:` in any position reachable by git
   pathspec magic rules, etc. The stated design intent and the actual
   implementation diverge on precisely the axis round 1 flagged.

4. **Mutation transcript, one leg re-run myself**: stubbed
   `isPathspecMagic` via a throwaway `node -e` to always return `false`
   — confirmed (independently, not from the transcript) that the P11
   fixture's `!record/**` entry, with the guard disabled, produces
   `PASS`/exit 0 instead of the documented exit 1 — consistent with the
   executor's claim for the two shapes it did cover. I did not need to
   re-run the executor's full mutation suite; my own leading-space repro
   above is a stronger, independently-discovered counterexample.

5. **P13 positive-control role confirmed real**: re-ran it directly
   (see the second block in step 3's repro output — identical assertion
   to the suite's own P13, same RC=5/`PROTECTED` pattern). Not decorative.

6. **CON-207 scope discipline**: `git diff 8a96bd1...HEAD --stat --
   scripts/concertino/check-pr-mergeable.sh core/scripts/check-pr-mergeable.sh`
   → empty output. Neither copy touched across `main..HEAD`. Confirmed
   independently, matches the instruction's claim.

7. **Docs honesty**: `docs/config-reference.md:469-471` still states
   plainly "This path is unexercised in this repository today"
   /`AGENT_MERGE=false` for every run so far. Confirmed present, verbatim
   claim holds.

8. **Test count sanity**: `grep -c '^check \|^has \|^lacks '
   test/scripts/check-merge-readiness.test.sh` → 106 assertion lines in
   that one file (consistent with, not a full re-run/contradiction of,
   the executor's claimed 120/120 including other files — I did not
   re-run the full `npm test` chain given the reproduced defect makes
   the verdict moot regardless of full-suite outcome).

9. **C1 archive probe**: not re-run this round — round 1 and the
   executor's transcript already exercised it against a disposable copy
   and nothing in `8a62ec4` touches spec files or the archive path; nothing
   about the reproduced defect calls this into question. Documenting the
   gap rather than treating it as silently verified: I did not personally
   re-run C1 in round 2.

### Verdict: REFUTE

This is a genuine blocker, not a preference. The whole point of round
1's finding and this round's remediation was closing a fail-open class
where a crafted-but-plausible `protectedPaths` entry silently disarms
the merge guard while producing output indistinguishable from a
legitimate non-match. The fix closes the two literally-demonstrated
shapes (`!`-prefix, `:`-prefix) but the underlying vulnerability — "an
entry that looks like it should protect a path but instead matches
nothing" — is not closed as a class. I found and reproduced a third
shape (leading whitespace) in under 15 minutes of adversarial probing,
against the real script, with a positive control proving the isolation.
There is no reason to believe this is the last such shape (git pathspec
matching has other quirks — trailing-slash directory matches, `**`
double-star normalization corner cases, `:(icase)` mid-string, etc. —
that I did not exhaustively enumerate) — which is exactly round 1's own
lesson repeating itself one round later.

### Change Requests (blocking)

1. **[BLOCKER]** `lib/config.js`'s `isPathspecMagic` and
   `check-merge-readiness.sh`'s condition-4 pattern loop both need a
   real allowlist test, not a denylist of literal prefixes. At minimum:
   reject any entry whose `entry.trim() !== entry` (leading/trailing
   whitespace) in addition to the existing `!`/`:` prefix checks, and
   re-derive the check from "does git's pathspec engine actually match
   what a human would expect this glob to match" rather than enumerating
   observed magic-prefix strings one at a time. Add a fixture (P14-style)
   for the leading-whitespace shape, with a positive control on the
   identical fixture, mirroring P11/P13's structure — and treat this as
   a signal to genuinely audit the git-pathspec-magic surface (short-form
   magic characters, the full long-form `:(...)` attribute list, quoting/
   whitespace interactions) rather than add one more ad hoc shape and stop.
   File: `lib/config.js:501-503`, `core/scripts/check-merge-readiness.sh:639`.

### Non-blocking notes

- The two-layer design (config validation + script-level fail-closed
  re-check) is sound and genuinely independent — that part of the
  remediation is correct and should be kept.
- Docs honesty and CON-207 scope discipline both hold; no action needed
  there.
