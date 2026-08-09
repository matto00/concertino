# Roadmap

Planned improvements to Concertino. Not commitments — a living list.

## Near-term

- **Ticket-creation command.** Extract a provider-aware `concertino-create-ticket`
  (create one or more well-scoped tickets from a free-form description) so it
  isn't left behind in adopting repos. Origin: Helio's `/linear-create-ticket`,
  which the Helio adoption keeps in-repo for now because Concertino doesn't render
  an equivalent yet. Should support `ticketProvider.kind` = linear/github/local.

- **Cursor adapter.** Render the orchestra into Cursor's native layout
  (`.cursor/rules/*.mdc`, `.cursor/skills/*`) the way the claude-code, codex,
  and (CON-63, landed) opencode adapters do, so a fourth harness is
  first-class instead of a hand-maintained mirror. Origin: Helio carries a
  bespoke `.cursor/` mirror of the delivery workflow that the adoption left
  untouched. OpenCode landed ahead of this item (CON-63): a third harness,
  plus provider-aware model configuration (`providers.ollama`) letting any
  role on any harness route through a locally-hosted Ollama model.

- ~~**Codex model id.** `adapters/codex/agent.toml.tmpl` renders a placeholder
  model (`gpt-5.1-codex`, via `CODEX_MODEL` in `bin/concertino`). Make it
  config-driven (e.g. `harness.codex.model`) instead of a hardcoded
  constant.~~ Done (CON-22's `models.codex.<role>` / `modelTiers.codex`, and
  now CON-63's `providers.ollama.models` provider fallback) — model id is
  fully config-driven for every harness.

- **Worktree dependency install.** A fresh worktree isn't fully real until its
  deps exist: `CONCERTINO_WORKTREE_HOOKS` is the seam (e.g. `npm ci`), but
  nothing guides adopters toward it, so worktrees come up missing `node_modules`
  and fail at first run. Consider detecting the project type during `init` and
  proposing the install hook, the way gate auto-detection already does. Origin:
  fleet runs against Helio, whose hooks are `npx husky install` with no install
  step.

## Later

- **Real end-to-end run on Codex** to validate the sequential/degraded flow with
  actual worker spawning where available.
- **`concertino doctor`** — validate a project's config + rendered files against
  the schema and flag drift (rendered files older than the config).

## Dashboard / TUI

Ideas from a 2026-08-08 roadmap pass, tracked as Linear tickets under three
epics on the CON team — [TUI Observability](https://linear.app/helioapp/project/tui-observability-25790afc12d4),
[TUI Control & Navigation](https://linear.app/helioapp/project/tui-control-and-navigation-6b1b1558873a),
[TUI History & Analytics](https://linear.app/helioapp/project/tui-history-and-analytics-8ed0bedbe688).
Ranked roughly by leverage-to-cost given what the run/event model already
captures — see `docs/dashboard.md` for the dashboard as it exists today.

- **Live diff panel in the drill-down** (CON-104). A fifth drill-down panel
  (alongside TICKET/TIMELINE/GATES/EVIDENCE) showing `git diff --stat`
  against the run's worktree, expandable to a full unified diff. Today the
  only way to see what an agent has actually changed mid-run is `tmux
  attach` or waiting for the eventual PR. Builds on the existing EVIDENCE
  panel's rendering machinery.
- **METRICS cut by harness/model** (CON-105). `run.harness`/`run.model` are
  already captured per run (unlike `priority`, an explicit non-goal in the
  METRICS grid design for lack of data) — success rate and avg duration
  broken out by harness/model needs no new instrumentation, just a new
  METRICS row.
- **Taller (multi-row) METRICS charts** (CON-106). `format.js`'s
  `sparkline()` maps each data point to one of 8 block-character levels
  (`▁▂▃▄▅▆▇█`) but always renders exactly **one terminal row** — so the
  throughput chart's vertical resolution is capped at 8 levels regardless of
  how much vertical space the grid layout's right column actually has. Grid
  mode already computes a dynamic `columnAreaHeight` (see the
  fleet-metrics-grid design's "wider trend window" goal), so the room is
  there; `sparkline()` just doesn't use it. Needs a chart renderer that
  spans N rows — e.g. stacked block rows or a braille 2x4 sub-cell scheme
  for finer resolution — that `metricsColumnLines`' expanded tier can opt
  into when grid mode gives it the height.
- **Inspectable recent escalations** (CON-107). METRICS' "recent
  escalations" list (`metrics.js`) is already populated from
  `escalation.raised`/`.answered` events (question, options, who raised it,
  the eventual decision) but renders as flat, unselectable text — unlike
  EVIDENCE's rows, there's no way to open one and see the full
  question/answer. The data already exists in the event log; this is purely
  a missing selectable-list + detail-view affordance, reusing the existing
  (live) escalation screen in a read-only historical mode.
- **Searchable run archive** (CON-113). DONE only shows "most recent few + …
  N more" — no way to find a specific past run without grepping
  `.concertino/runs/*/events.jsonl` by hand. A `/` search (ticket id, title
  substring, harness, date range) over retained run directories.
- **Bulk row actions on the fleet** (CON-109). `space` to multi-select
  FAILED/QUEUED rows, then apply `a`/`d`/kill across the selection — today
  every FAILED action is one row at a time.
- **Fleet-wide search (`/`)** (CON-110). Jump to a ticket/run by typing part
  of its id or title, from the fleet view itself.
- **Launch presets** (CON-111). Save a harness/speed/provider/agent-merge
  combo from the launch plan as a named preset instead of re-cycling
  `H`/`S`/`P` per row every time.
- **Run comparison** (CON-114, depends on CON-113). Pick two DONE runs, see
  timelines/gate results/duration side by side — useful for "why did this
  one take 3x longer."
- **Cost/token spend tracking** (CON-108). No `cost_usd`/token field exists
  anywhere in the event schema today. Needs a new tier-2 event
  (harness-emitted, deterministic) plus a METRICS spend row. Bigger lift
  than the rest of this list — depends on what each harness actually
  exposes (Claude Code's `--output-format json` includes usage;
  Codex/OpenCode may not).
- **Mouse support — clickable panes and text-entry fields** (CON-112). No
  mouse handling exists anywhere today (`lib/ui/frame.js` is a raw ANSI
  diffing renderer with no retained layout tree to hit-test against, and
  there's no SGR mouse-mode input parsing on the stdin side). The biggest
  architectural lift on this list: needs mouse-reporting mode enabled
  (`\x1b[?1000h`/`\x1b[?1006h`), click-event parsing, *and* every screen's
  render pass to record each pane/row's on-screen bounding box so a click
  coordinate can be mapped back to "which row/field was that" — none of
  which the current draw path tracks. Worth prototyping on one screen (the
  fleet view's row list, or a single text-input prompt) before committing to
  it fleet-wide.
