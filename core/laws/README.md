# Iron Laws

Canonical, dependency-free "law" documents that the Concertino agents are
**bound to read at the point of use**. Each law is a hard, evidence-gated
behavioral rule phrased as a refusal — the mechanism that keeps the autonomous
loop diligent and self-correcting when the human is out of the loop.

The design rationale and full topology live in
[`../design/architecture.md`](../design/architecture.md).

## The laws

| File                                | Iron Law                                    | Bound to                     |
| ----------------------------------- | ------------------------------------------- | ---------------------------- |
| `systematic-debugging.md`           | No fix without a probe-confirmed root cause | executor                     |
| `verification-before-completion.md` | No completion claim without fresh evidence  | executor, evaluator, skeptic |

Two further canonical standards are **project-specific** (so they live in your
repo, not here) and are bound the same way via `concertino.config.json →
canonicalDocs`:

- a **code-quality** standard (e.g. `CONTRIBUTING.md`),
- a **design-language** standard (e.g. `DESIGN.md`), the UI counterpart.

These are the proven lever: binding agents to read an explicit external standard
*at the moment they need it* empirically lifts quality far more than asking a
model to infer the standard. Concertino generalizes that pattern — you supply the
docs, the config binds them to the right agents at the right phase.

## How the mechanism works

1. **Canonical, re-read just-in-time.** Agents read the relevant law _at the
   moment they need it_, not from drifting/compacted memory.
2. **Evidence-gated transitions.** A claim ("tests pass", "root cause found",
   "ready to ship") requires a fresh, reproduced artifact — so a wrong step fails
   loudly instead of propagating silently.
3. **Cold, adversarial verification.** The skeptic is spawned fresh at the gates
   and derives its verdict from ground truth, never from another agent's
   narrative — so it can't inherit the loop's blind spots.

## Acknowledgements

These laws are **inspired by [obra/superpowers](https://github.com/obra/superpowers)**.
Each law's frontmatter carries an `inspired_by` pointer. They were rewritten from
scratch — there is **no runtime dependency** on superpowers. See the repo root
[`README.md`](../../README.md) for the full attribution and the inspired-by /
original boundary.
