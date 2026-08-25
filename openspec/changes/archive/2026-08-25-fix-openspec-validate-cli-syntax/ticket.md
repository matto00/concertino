# CON-130: Orchestrator role doc instructs an openspec validate flag that does not exist

## Description

`core/roles/orchestrator.md`'s Phase 1 Planning step instructs `openspec validate --change "<CHANGE_NAME>"`. That flag does not exist in the installed openspec CLI (v1.2.0). Planning's validation step is the gate meant to catch malformed planning artifacts before Execution; a wrong invocation means that gate has been erroring out or silently doing nothing across every run using this doc.

Compounding this, `openspec archive` exits 0 even when it aborts, so the ecosystem around these commands already fails quietly. The concrete cost is visible in helio: 26 canonical spec files malformed badly enough to abort `openspec archive` mid-Phase-3, none found by a validation step.

CON-115 (2026-08-09) filed the same defect 12 days earlier and proposed a *different* replacement (bare positional `openspec validate "<NAME>"`) than this ticket (`openspec validate <name> --type change`). The ticket's addendum reads that disagreement as evidence the CLI surface changed within twelve days, and asks that if the reader concludes otherwise they say so with evidence.

CON-115 also flags `openspec instructions ... --change` as a second possibly-stale invocation, to be included in the audit.

## Acceptance criteria

- [ ] Every `openspec` invocation in `core/roles/*.md` matches the installed CLI's real surface.
- [ ] The Planning validation step demonstrably goes red against a deliberately malformed change — proven, not assumed.
- [ ] If `openspec validate` can fail while exiting 0, the role docs assert on stdout.
- [ ] The openspec version the docs target is pinned or stated.

## Scope constraints (from the delivery request)

- Fix must land in source-of-truth files so it survives `concertino sync`; regenerated harness outputs committed alongside.
- Do NOT touch `core/scripts/cleanup.sh` — CON-138 is live concurrently on that file. Escalate rather than edit it.
- Do not upgrade the installed CLI or add version auto-detection machinery; a stated/pinned note is what the AC asks for.
- Leave untracked non-ours files alone: `.claude/skills/concertino-fleet-driver/`, `scripts/concertino/pricing-table.json`, `scripts/concertino/report-cost.sh`, and the stray `CON-87` worktree.
