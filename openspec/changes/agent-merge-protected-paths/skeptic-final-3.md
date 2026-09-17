## Skeptic Report — final gate (round 3, skeptic-final-3.md)

Judged commit: `0980b031b3e9a0a74ebc93368e54f0cd116ba9d4` (0980b03), base `8a96bd1`.

### What I verified (with evidence)

- **Spawn-cwd guard**: `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=feature/agent-merge-protected-paths/CON-193` — proceeded normally.
- **JS allowlist (`lib/config.js:521-536`)**: read `isPlainRelativeGlob` in full. Ran it directly via `node -e` against 18 cases including both prior disarm shapes (`"!record/**"`, `" !record/**"`), `..`, trailing `/`, leading `/`, embedded `:`, NBSP (leading/embedded/trailing), tab, newline, and a 100k-char glob. All behaved as claimed — round-1 and round-2 shapes both correctly rejected, and JS's ASCII-only regex correctly rejects every accented-Latin variant I tried (`é`, `ñ`, `À`, `Ā`).
- **Bash allowlist (`core/scripts/check-merge-readiness.sh:620-664`)**: extracted the exact condition-4 accept logic (trim-check → `..`/trailing-`/` case check → `[[ "$pat" =~ ^[A-Za-z0-9._-][]A-Za-z0-9._/*?[-]*$ ]]`) into a standalone harness and ran it against the same shapes. Both prior disarm shapes correctly rejected. NBSP correctly rejected (charclass catches it even though the `sed`-based trim doesn't, confirming the claimed "independent rejection" for that one byte).
- **Rendered-copy parity**: `cmp scripts/concertino/check-merge-readiness.sh core/scripts/check-merge-readiness.sh` — byte-identical.
- **Docs honesty**: `docs/config-reference.md:469` still states "This path is unexercised in this repository today." — present, unmodified.

### A fourth disarm shape exists — reproduced, stable, contradicts the executor's own adversarial-sweep claim

The executor's claim #5 states the adversarial sweep covered "non-ASCII/Unicode whitespace... NBSP — JS trims it, bash `[[:space:]]` does not, but the character-class regex rejects non-ASCII bytes independently" — asserting the bash character-class regex rejects non-ASCII bytes in general. **This is false**, and the false generalization is exactly where the gap is.

Bash's `[[ =~ ]]` is locale-aware. Under the ambient `LANG=en_US.UTF-8` — the actual default locale of this machine, unset/unpinned by the script itself (confirmed: no `LC_ALL`/`LANG` assignment anywhere in `check-merge-readiness.sh`) — POSIX bracket-expression ranges like `[A-Za-z0-9._-]` collate-widen to accept accented Latin-1/Latin-Extended letters that sort adjacent to their base letter. Reproduced 3/3 runs, standalone harness, byte-for-byte the script's own regex:

```
$ bash -c 'pat="récord/**"; [[ "$pat" =~ ^[A-Za-z0-9._-][]A-Za-z0-9._/*?[-]*$ ]] && echo ACCEPT || echo REJECT'
ACCEPT   (LANG=en_US.UTF-8, 3/3 runs)
```

Also confirmed ACCEPT for `é`, `ñ`, `À`, `Ā` embedded anywhere in the pattern (`record/éx`, `record/ñx`, etc. — 4/4 cases). Meanwhile `lib/config.js`'s `isPlainRelativeGlob` (not locale-dependent — plain JS regex) correctly **rejects every one of these same strings** (verified via `node -e`, all 4 cases `false`).

**Why this is the disarm class, not a cosmetic nit.** Condition 4's own inline comment (`core/scripts/check-merge-readiness.sh:621-635`) states its entire purpose is to be "a config-validation-only defense fails open for anyone who edits `concertino.config.json` without running `concertino validate`" — i.e. this bash layer is specifically the backstop for the case where the JS layer's rejection was never consulted. In exactly that threat model: an operator (or an adversarial diff) writes `"récord/**"` intending to protect the real `record/**` directory. A reviewer skimming the diff plausibly reads `récord` as `record` (the diacritic is easy to miss, exactly like the round-2 leading space was easy to miss). The bash backstop **accepts** this entry as a well-formed plain glob (my repro above) and proceeds to `git diff ... -- ":(glob)récord/**"`, which will **never match any real path** under the ASCII `record/` directory — so the guard runs, reports no match, and PASSES, while a genuine edit to `record/**` sails through unprotected. This is byte-for-byte the same failure shape as round 1 (`!record/**`) and round 2 (`" !record/**"`): an entry that looks protective and is accepted by validation, but silently protects nothing. Confirmed it is not a general homoglyph hole — Cyrillic homoglyphs of "record" (`е`/U+0435, `о`/U+043E in place of Latin e/o) are correctly rejected by both layers, so the gap is specifically the locale-collation range-widening for Latin-1/Latin-Extended accented letters, not arbitrary Unicode.

This is precisely a case where "JS and bash disagree" (the exact risk category I was directed to hunt), and it directly falsifies the executor's stated adversarial-sweep conclusion for this character class rather than merely being an untested edge.

### Verdict: REFUTE

### Change Requests

1. **Fix `core/scripts/check-merge-readiness.sh` condition 4's accept regex to be locale-independent.** Either pin `LC_ALL=C` (or `LC_COLLATE=C`) around the `[[ =~ ]]` check, or switch the accept test to an explicit byte-range check that cannot be widened by collation (e.g. `grep -P` with `\A[A-Za-z0-9._-][A-Za-z0-9._/*?\[\]-]*\z` under `LC_ALL=C`, or a `case` glob using `[a-zA-Z0-9._-]` under `LC_ALL=C`, or an explicit per-byte loop). Verify the fix by re-running my repro (`pat="récord/**"` and the other 3 accented cases) and confirming REJECT, under both `LANG=en_US.UTF-8` and `LANG=C`.
2. **Add this shape as a fourth committed regression fixture** (a P17-equivalent), alongside the existing P14/P15/P16, that fails against the pre-this-fix condition-4 code and passes once (1) is fixed — matching this change's own established pattern of proving every prior disarm shape red-then-green.
3. **Re-run the three-mutation red/green demonstration** (Mutations A/B/C from this change's own methodology) against the new fixture to show it is a real catch, not a vacuous pass.
4. Once fixed, re-verify the JS/bash parity claim end-to-end: for every case in my repro set, `isPlainRelativeGlob` (JS) and the bash accept check must agree (both reject), not merely "reject the previously-known shapes."

### Non-blocking notes

- The rest of the round-2 remediation holds up well under adversarial testing: both prior disarm shapes are solidly closed, the two script copies are byte-identical, docs honesty is intact, and the JS-side allowlist itself shows no gap I could find. The single defect found is narrowly scoped to the bash layer's locale sensitivity — it does not implicate the JS validator or the overall allowlist design (owner's "positive allowlist fails closed by construction" ruling is architecturally sound; this is an implementation bug in one of the two independent reimplementations, not a flaw in the allowlist approach itself).
