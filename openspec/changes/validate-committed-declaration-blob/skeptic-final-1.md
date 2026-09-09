## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Repo: concertino (self-hosting). Pure bash change; no UI surface, no dev servers started.
Ground truth: `git diff main..HEAD` at 97d9895 (16 files, +1711/-8).

### What I verified (with evidence)

**Gates.** `bash test/scripts/squash-branch.test.sh` → `39 passed, 0 failed`
(Scenario 6 = 14 new assertions). Full `npm test` runs the whole chain; no failures.

**1. Bypass construction (throwaway repos under `mktemp -d`, never this worktree or helio).**
Built a bare-remote + clone fixture and attacked the guard in 8 shapes. Every one
refused, exit non-zero, HEAD unmoved:

| # | Shape | Result |
|---|---|---|
| A | trailing-whitespace-only divergence | REFUSED (divergence) |
| B | on-disk declaration replaced by a symlink to an out-of-tree file declaring `sneaky.txt` | REFUSED (divergence) |
| C | declaration staged-deleted, richer copy left on disk | REFUSED (no staged blob) |
| D | change dir untracked entirely (`git rm -r --cached`) | REFUSED (no staged blob) |
| E | mode-bit-only divergence (`chmod +x`) | REFUSED (divergence) |
| F | CRLF-only divergence | REFUSED (divergence) |
| G | `git update-index --assume-unchanged` to blind the D7 detector, disk declares `sneaky.txt` | REFUSED — *by the blob parse* ("exceeds the run's declared touched-file set") |
| H | `--skip-worktree` variant of G | REFUSED — same, by the blob parse |

G and H are the load-bearing result: I deliberately disabled D2's `git diff --quiet`
detector, and D1's staged-blob read still caught the bypass. That is direct measured
evidence for design.md's "D1 and D2 are BOTH, not either/or" rationale — it is not
just prose.

**2. Exemption attacks.** Both exemptions, alone and combined:
- `--allow-empty-declaration` + divergence → still refuses (test 4.3; mutation M6 below).
- `--allow-empty-declaration` + declaration-not-in-index → still refuses (4.3b; M7).
- D4a (no worktree copy, staged blob present) + undeclared staged file, **with**
  `--allow-empty-declaration` → REFUSED ("exceeds the run's declared touched-file set").
  The flag does not widen D4a.
- D4a + a staged blob containing no parseable bullets, no flag → REFUSED.
- D4a + unparseable blob + `--allow-empty-declaration` → commits. This is the
  **pre-existing, explicitly opted-in** narrow exemption, and critically the guard
  validated *the blob it committed* (an empty declaration is genuinely what is
  committed). AC1 holds; this is not an amnesty reachable without the operator
  passing the flag.
- Forged index blob via `update-index --cacheinfo` (index declares more than disk) → REFUSED.
- D4a clean pass: confirmed `git show HEAD:<decl>` after the commit is byte-identical
  to the blob the guard parsed. **AC1's "same bytes" is directly measured, not inferred.**

I could not reach a commit through any exemption that the guard had not validated.

**3. AC4 mutation proof — re-run independently, not read.** Rebuilt an isolated
sandbox ROOT (`/tmp`, copied `core/scripts/{squash-branch.sh,lib/}` + the test file),
reproduced the 39/0 baseline there, then ran 8 mutations. Which new assertions go RED:

| Mutation | RED scenarios |
|---|---|
| M1 full revert to main's script | 4.1(x3), 4.2(x2), 4.3, 4.3b(x2), 4.4(x2), 4.4b, 4.4c |
| M2 delete only the D2 divergence block | 4.1(x3), 4.2, 4.3 |
| M3 delete only the D4 not-in-index block | 4.3b(x2), 4.4 remedy text |
| M4 **ungate the D7 detector** (drop `FILE_ON_DISK` from the divergence condition) | **4.4c**, 4.4b |
| M5 **D4a amnesty** (absent-on-disk ⇒ blob not parsed) | **4.4b**, 4.4c |
| M6 let `ALLOW_EMPTY` suppress divergence | **4.3** |
| M7 let `ALLOW_EMPTY` suppress D4 | **4.3b**(x2) |
| M8 wrong `git show` path spelling (worktree-absolute) | **4.5** + 19 others |

Every new scenario is failable by a mutation that corresponds to the defect it names:
4.3←M6, 4.3b←M7, 4.4b←M5, 4.4c←M4, 4.5←M8. No scenario passed both before and after
its own relevant mutation. In particular M5 independently reproduces the Cycle-3
addendum's Probe 4 — the transcript's corrected attribution is now accurate.

**4. Ordering (D2/D7).** `grep -n FILES_MODIFIED_PATH core/scripts/squash-branch.sh`
returns exactly one branch-routing `[ -f ... ]` test, at **line 140**; the divergence
detector is at **line 167** — after it, and gated on `FILE_ON_DISK -eq 1`. The other
two hits are the string assignment (130) and a diagnostic (155). M4 proves the gate
is load-bearing: ungating it flips 4.4c from commit to spurious refusal, i.e. exactly
the BLOCKER-escalated stop design.md predicts.

**5. Scope.** `grep -c 'dry.run\|DRY_RUN'` on the script → 0 (CON-164 untouched).
`git diff main..HEAD --name-only -- scripts/concertino/` → 0 files (render target
untouched; drift stays with CON-172). Only two non-change-dir files in the commit:
`core/scripts/squash-branch.sh`, `test/scripts/squash-branch.test.sh`. No unrelated
refactor — the diff is confined to the declaration-read block plus the three
diagnostics that name the source (D6).

**6. Acceptance criteria.**
- **AC1 MET** — parse reads `git show :<CHANGE_DIR>/files-modified.md` (script:146,196);
  committed blob verified byte-identical to the validated blob on the D4a pass.
- **AC2 MET** — divergence is a loud, unconditional refusal (script:167-172); probes A/E/F/X5/X6.
- **AC3 MET** — verified directly, including the case the AC names: a run with a
  *declared source path dirty and unstaged*, plus untracked scratch and an untracked
  `workflow-state.md`, still commits (rc=0, READY). Test 4.5 covers the plain case.
- **AC4 MET** — see the mutation table; reproduced independently in a fresh sandbox.
- **AC5 MET** — D4a carries its own structural check (4.4b, failable by M5), and D5's
  non-suppression is asserted for *both* halves (4.3←M6, 4.3b←M7), not just the divergence half.

**Delivery artifacts.** `files-modified.md` accurately and completely describes the
two source files actually in the commit (self-referentially, it is the declaration
this very guard validated). Spec delta states the index-read requirement.

### Verdict: CONFIRM

### Non-blocking notes
- tasks.md 6.1/6.2/6.3 are left `- [ ]`. They are scope-negative constraints ("do NOT
  do X") and I verified all three are honoured, so this is cosmetic — but an unchecked
  box in a completed change reads as unfinished work to a later run.
- 4.4b's exit-code half ("D4a still enforces the blob") stays green under M5, because
  M5 still exits non-zero via the generic branch; only its cause-anchored half
  discriminates. The scenario as a whole is correctly failable, so this is not a
  finding — but the exit-code assertion alone is not evidence, and a future edit that
  drops the cause-anchored assertion would silently hollow the scenario out.
- D4a + `--allow-empty-declaration` + an unparseable staged blob commits undeclared
  files. Correct per the flag's stated contract and the guard validates what it
  commits, so not a defect. Worth remembering as the one remaining operator-opt-in
  route past the declaration check if that flag is ever reconsidered.
