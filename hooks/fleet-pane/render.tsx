// hooks/fleet-pane/render.tsx
// Pure drawing: a PaneModel in, a tree out. `els` is `$.ui.resolve(e)`.
// Layout: docs/superpowers/specs/2026-10-07-fleet-pane-v2-design.md §Layout. Width is handled by
// flex (titles shrink and truncate first) plus two breakpoints, never by padded fixed columns.
import type { Elements, RenderSurface, RenderElement, ThemeKey } from 'claude-code'
import type { AnswerDraft, DetailTab, FleetState, Lane, Run, TicketComment, TimelineEvent, TicketMeta } from '../../types'
import {
  answeredCount, draftFor, escalationKey, escalationTitle, groupLanes, laneState, newestComments,
  pickDetailLane, questionsOf, stateColour, summaryParts, type GroupKey, type LaneGroup, type LaneState,
} from './lanes'
import { phaseSpans, priorityName, splitTicketBody } from './ticket'

type PaneEls = Elements[RenderSurface]

export type PaneModel = {
  fleet: FleetState
  selected: string | null
  showAll: boolean
  openGroups: string[]
  drafts: Record<string, AnswerDraft>
  detailTab: DetailTab
  seenComments: Record<string, number>
  viewAgentId?: string
  bodyColumns: number
  placement: 'dock' | 'inline'
  now: number
  onSelect: (ticket: string) => void
  onToggleGroup: (key: GroupKey) => void
  onPick: (escKey: string, question: number, value: string | null, size: number) => void
  onNote: (escKey: string, note: string, size: number) => void
  onDraft: (lane: Lane) => void
  onTab: (tab: DetailTab, lane?: Lane) => void
}

export const PHASE_ORDER = ['Setup', 'Planning', 'Execution', 'Evaluation', 'Delivery', 'Cleanup']
const PHASE_SHORT = ['Setup', 'Plan', 'Execute', 'Evaluate', 'Deliver', 'Cleanup']

/** Below this the row drops the ticket title; below NARROW also the phase. */
export const WIDE = 48
export const NARROW = 32

export function truncate(s: string, max: number): string {
  const n = Math.max(0, max)
  return s.length <= n ? s : n <= 1 ? s.slice(0, n) : s.slice(0, n - 1) + '…'
}

export function fmtElapsed(ms: number | null): string {
  if (ms == null) return '-'
  const m = Math.floor(Math.max(0, ms) / 60000)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return h < 48 ? `${h}h${String(m % 60).padStart(2, '0')}` : `${Math.floor(h / 24)}d`
}

export const fmtAgo = (ms: number) => fmtElapsed(Math.max(0, ms)) + ' ago'

const titleOf = (r: Run) => r.ticket_meta?.title || r.ticket_doc.title || r.changeName || ''
const elapsedOf = (r: Run, now: number) => (r.startedAt != null ? (r.endedAt ?? now) - r.startedAt : r.elapsedMs)
const prUrlOf = (r: Run) => r.prUrl ?? r.timeline.filter(ev => ev.kind === 'pr' && ev.url).at(-1)?.url ?? null
const prLabel = (url: string) => { const m = /\/pull\/(\d+)/.exec(url); return m ? `PR #${m[1]}` : 'PR' }

const DOT: Record<LaneState, string> = {
  'needs-you': '●', failed: '✕', done: '✓', running: '●', active: '●', waiting: '◐', stalled: '●', idle: '○',
}

/** What a row says on its right: the wait for a needs-you lane, the finish for a done one, else phase and run time. */
export function rowTail(lane: Lane, now: number, w: number): string {
  const r = lane.run
  const s = laneState(lane, now)
  if (s === 'needs-you' && r.escalation) return `waiting ${fmtElapsed(now - r.escalation.raisedAt)}`
  if (s === 'done' || s === 'failed') return r.endedAt != null ? fmtAgo(now - r.endedAt) : s
  const time = fmtElapsed(elapsedOf(r, now))
  if (w < NARROW || !r.phase) return time
  return `${r.phase}${r.cycle ? ` c${r.cycle}` : ''} · ${time}`
}

function laneRow(els: PaneEls, model: PaneModel, lane: Lane, index: number, isDetail: boolean): RenderElement {
  const { Box, Text, Button } = els
  const w = model.bodyColumns
  const s = laneState(lane, model.now)
  const quiet = s === 'idle' || s === 'done'
  return (
    <Box key={`row:${lane.run.ticket}`} flexDirection="row" gap={1}>
      <Text color={stateColour(s)}>{isDetail ? '▸' : DOT[s]}</Text>
      <Button
        key={`lane:${lane.run.ticket}`}
        plain
        {...(index < 9 ? { hotkey: String(index + 1) } : {})}
        {...(quiet && !isDetail ? { dimColor: true } : {})}
        label={lane.run.ticket}
        onPress={() => model.onSelect(lane.run.ticket)}
      />
      {w >= WIDE
        ? <Box flexGrow={1} flexShrink={1} minWidth={0}><Text wrap="truncate-end" {...(quiet ? { dimColor: true } : {})}>{titleOf(lane.run)}</Text></Box>
        : <Box flexGrow={1} />}
      <Text color={s === 'needs-you' ? 'warning' : 'subtle'} wrap="truncate-end">{rowTail(lane, model.now, w)}</Text>
    </Box>
  )
}

function groupBlock(els: PaneEls, model: PaneModel, g: LaneGroup, startIndex: number, detail: Lane | undefined): RenderElement {
  const { Box, Text, Button } = els
  const quiet = g.hidden && !g.collapsible ? ` (+${g.hidden} quiet)` : ''
  const head = g.collapsible
    ? <Button key={`group:${g.key}`} plain dimColor label={`${g.collapsed ? '▸' : '▾'} ${g.label} · ${g.total}`} onPress={() => model.onToggleGroup(g.key)} />
    : <Text dimColor>{`${g.label}${g.total > 1 || quiet ? ` · ${g.total}` : ''}${quiet}`}</Text>
  return (
    <Box key={`g:${g.key}`} flexDirection="column" marginTop={1}>
      {head}
      {g.lanes.map((lane, i) => laneRow(els, model, lane, startIndex + i, lane === detail))}
    </Box>
  )
}

export function pickDetail(model: PaneModel): Lane | undefined {
  return pickDetailLane(model.fleet.lanes, model.selected, model.viewAgentId, model.showAll, model.now, model.openGroups)
}

export function renderPane(els: PaneEls, model: PaneModel): RenderElement {
  const { Box, Text } = els
  const { fleet } = model
  const groups = groupLanes(fleet.lanes, model.now, model.showAll, model.openGroups)
  const detail = pickDetail(model)
  const parts = summaryParts(fleet.lanes, model.now)
  let index = 0
  const starts = groups.map(g => { const at = index; index += g.lanes.length; return at })
  return (
    <Box flexDirection="column">
      <Box key="header" flexDirection="row" gap={1} flexWrap="wrap">
        <Text bold color="claude">{fleet.project || 'concertino'}</Text>
        <Text dimColor>{model.showAll ? 'fleet · all' : 'fleet'}</Text>
        <Box flexGrow={1} />
        {parts.map((p, i) => <Text key={`c:${i}`} color={p.color}>{p.label}</Text>)}
      </Box>
      {fleet.error && <Box key="error" marginTop={1}><Text color="error" wrap="wrap">{fleet.error}</Text></Box>}
      {fleet.lanes.length === 0 && !fleet.error && (
        <Box key="empty" marginTop={1}><Text dimColor wrap="wrap">{`No concertino runs under ${fleet.root}/.concertino/runs`}</Text></Box>
      )}
      {groups.map((g, i) => groupBlock(els, model, g, starts[i]!, detail))}
      {model.placement === 'dock' && detail && renderDetail(els, model, detail)}
    </Box>
  )
}

// ── Detail ─────────────────────────────────────────────────────────────────────────────────────

const AGENT_WORDS: Record<string, string> = {
  running: 'orchestrator running', waiting: 'orchestrator waiting', stalled: 'orchestrator stopped', unseen: 'no orchestrator found here',
}

/** Who drives the lane and how its orchestrator is doing, in words. */
export function driverWords(lane: Lane): string {
  if (lane.run.endStatus) return `finished · ${lane.run.endStatus}`
  if (lane.driver === 'here') return `driven here${lane.agent ? ` · ${AGENT_WORDS[lane.agent]}` : ''}`
  return lane.driver === 'other' ? 'driven by another session' : 'no driver session recorded'
}

export function metaParts(lane: Lane, now: number): string[] {
  const r = lane.run
  return [
    r.branch,
    driverWords(lane),
    r.costUsd != null ? `$${r.costUsd.toFixed(2)}` : null,
    fmtElapsed(elapsedOf(r, now)),
  ].filter((p): p is string => !!p && p !== '-')
}

function stepper(els: PaneEls, lane: Lane, w: number): RenderElement {
  const { Box, Text } = els
  const r = lane.run
  const over = !!r.endStatus || r.status === 'done'
  const at = r.phase ? PHASE_ORDER.indexOf(r.phase) : -1
  const names = w >= 60 ? PHASE_SHORT : PHASE_SHORT.map(n => n[0]!)
  const current: ThemeKey = r.status === 'needs-you' ? 'warning' : r.status === 'failed' ? 'error' : 'suggestion'
  return (
    <Box key="stepper" flexDirection="row" flexWrap="wrap" columnGap={2} marginTop={1}>
      {names.map((name, i) => {
        const done = over || i < at
        const now = !over && i === at
        return (
          <Text key={`ph:${i}`} {...(done ? { color: 'success' as ThemeKey } : now ? { color: current, bold: true } : { dimColor: true })}>
            {`${done ? '✓' : now ? '●' : '○'} ${name}`}
          </Text>
        )
      })}
    </Box>
  )
}

function escalationCard(els: PaneEls, model: PaneModel, lane: Lane): RenderElement | null {
  const { Box, Text, Button, Input } = els as PaneEls & { Input?: Elements['terminal']['Input'] }
  const r = lane.run
  const esc = r.escalation
  if (!esc) return null
  const key = escalationKey(r.ticket, esc)
  const qs = questionsOf(esc)
  const draft = draftFor(model.drafts, key, qs.length)
  const answered = answeredCount(draft)
  const complete = answered === qs.length
  return (
    <Box key="escalation" flexDirection="column" marginTop={1} borderStyle="round" borderColor="warning" paddingX={1}>
      <Box flexDirection="row" gap={1}>
        <Text bold color="warning">{escalationTitle(esc)}</Text>
        <Box flexGrow={1} />
        <Text dimColor>{fmtAgo(model.now - esc.raisedAt)}</Text>
      </Box>
      {esc.context?.trim() && <Text dimColor wrap="wrap">{truncate(esc.context.trim(), 600)}</Text>}
      {r.pendingAnswer
        ? <Text color="success" wrap="wrap">Answered. Waiting for the orchestrator to pick it up.</Text>
        : qs.map((q, i) => (
          <Box key={`q:${i}`} flexDirection="column" marginTop={1}>
            <Text wrap="wrap">{qs.length > 1 ? `${i + 1}. ${q.question}` : q.question}</Text>
            {q.options.length > 0
              ? (
                <Box flexDirection="row" flexWrap="wrap" columnGap={2} marginLeft={2}>
                  {q.options.map((o, j) => {
                    const chosen = draft.picks[i] === o
                    return (
                      <Button
                        key={`opt:${i}:${j}`}
                        plain
                        label={`${chosen ? '◉' : '○'} ${o}`}
                        {...(draft.picks[i] != null && !chosen ? { dimColor: true } : {})}
                        onPress={() => model.onPick(key, i, chosen ? null : o, qs.length)}
                      />
                    )
                  })}
                </Box>
              )
              : Input && (
                <Box marginLeft={2}>
                  <Input key={`free:${i}`} placeholder="Your answer" value={draft.picks[i] ?? ''} submitLabel="save"
                    onInput={v => model.onPick(key, i, v.trim() ? v : null, qs.length)}
                    onSubmit={v => model.onPick(key, i, v.trim() ? v : null, qs.length)} />
                </Box>
              )}
          </Box>
        ))}
      {!r.pendingAnswer && Input && (
        <Box key="note" marginTop={1}>
          <Input key="note" placeholder="Add a note for the driver (optional)" value={draft.note} submitLabel="save"
            onInput={v => model.onNote(key, v, qs.length)} onSubmit={v => model.onNote(key, v, qs.length)} />
        </Box>
      )}
      {!r.pendingAnswer && (
        <Box key="esc-actions" flexDirection="row" gap={1} marginTop={1}>
          <Text dimColor>{complete ? 'Ready. Draft it, then send from the prompt box.' : `${answered} of ${qs.length} answered`}</Text>
          <Box flexGrow={1} />
          {complete && <Button key="draft" variant="primary" hotkey="d" label="Draft answer" onPress={() => model.onDraft(lane)} />}
        </Box>
      )}
    </Box>
  )
}

function gatesBlock(els: PaneEls, lane: Lane): RenderElement | null {
  const { Box, Text } = els
  const gates = lane.run.gates
  if (!gates.length) return null
  const failing = gates.filter(g => g.status !== 'pass' && g.firstError).at(-1)
  return (
    <Box key="gates" flexDirection="column" marginTop={1}>
      <Text dimColor>Gates</Text>
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        {gates.map((g, i) => {
          const ok = g.status === 'pass'
          const bad = g.status === 'fail'
          return <Text key={`gate:${i}`} color={ok ? 'success' : bad ? 'error' : 'subtle'}>{`${ok ? '✓' : bad ? '✕' : '…'} ${g.name.replace(/^phase:/, '')}`}</Text>
        })}
      </Box>
      {failing && <Text color="error" wrap="wrap">{truncate(failing.firstError!, 300)}</Text>}
    </Box>
  )
}

/** One timeline event in words: `skeptic: ESCALATION (design)`, `Execution started`, `PR opened`. */
export function humanEvent(ev: TimelineEvent): string {
  switch (ev.kind) {
    case 'run.start': return 'run started'
    case 'phase.enter': return `${ev.phase ?? 'phase'} started${ev.cycle && ev.cycle > 1 ? ` (cycle ${ev.cycle})` : ''}`
    case 'agent.spawn': return `${ev.agent ?? ev.role ?? 'agent'} started`
    case 'verdict': return `${ev.role ?? 'verdict'}: ${ev.verdict ?? '?'}${ev.gate ? ` (${ev.gate})` : ''}`
    case 'gate.result': return `gate ${(ev.gate ?? '').replace(/^phase:/, '')} ${ev.status ?? ''}`.trim()
    case 'evidence': return `evidence: ${ev.label ?? ''}`.trim()
    case 'escalation.raised': return `escalation raised${ev.role ? ` by ${ev.role}` : ''}`
    case 'escalation.answered': return 'escalation answered'
    case 'escalation.timeout': return 'escalation timed out'
    case 'pr': return 'PR opened'
    case 'run.end': return `finished${ev.status ? ` (${ev.status})` : ''}`
    case 'run.cost': return 'cost recorded'
    default: return [ev.kind, ev.agent, ev.status, ev.label].filter(Boolean).join(' ')
  }
}

const hhmm = (t: number) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }

/** The newest `n` events as display lines, consecutive evidence writes folded into one. */
export function recentLines(timeline: readonly TimelineEvent[], n: number): { t: number; text: string; colour: ThemeKey }[] {
  const out: { t: number; text: string; colour: ThemeKey; evidence?: string[] }[] = []
  for (const ev of timeline) {
    const prev = out.at(-1)
    if (ev.kind === 'evidence' && prev?.evidence) {
      prev.evidence.push(ev.label ?? '')
      prev.text = `evidence: ${prev.evidence.filter(Boolean).join(', ')}`
      prev.t = ev.t
      continue
    }
    out.push({ t: ev.t, text: humanEvent(ev), colour: eventColour(ev), ...(ev.kind === 'evidence' ? { evidence: [ev.label ?? ''] } : {}) })
  }
  return out.slice(-n).map(({ t, text, colour }) => ({ t, text, colour }))
}

const VERDICT_OK = new Set(['PASS', 'MERGE', 'CONFIRM'])
const VERDICT_BAD = new Set(['FAIL', 'BLOCKER', 'REFUTE'])
function eventColour(ev: TimelineEvent): ThemeKey {
  if (ev.kind === 'verdict') {
    const v = (ev.verdict ?? '').toUpperCase()
    return VERDICT_OK.has(v) ? 'success' : VERDICT_BAD.has(v) ? 'error' : v === 'ESCALATION' ? 'warning' : 'subtle'
  }
  if (ev.kind === 'gate.result') return ev.status === 'fail' ? 'error' : 'subtle'
  return ev.kind === 'pr' ? 'merged' : ev.kind === 'escalation.raised' ? 'warning' : 'subtle'
}

export function metaLine(m: TicketMeta): string {
  const parts = [
    m.state.name,
    m.assignee,
    m.priority != null ? `P${m.priority}` : null,
    m.estimate != null ? `${m.estimate} pts` : null,
    m.labels.length ? `labels: ${m.labels.join(', ')}` : null,
    m.url,
  ].filter((p): p is string => !!p)
  return parts.join(' · ')
}

/** Plain-text rows for a pane `width`: CRLF normalised, empty lines dropped, markdown links and leading #'s stripped, words greedily wrapped (an over-long word is hard-split). */
export function wrapRows(text: string, width: number): string[] {
  const w = Math.max(1, Math.floor(width))
  const rows: string[] = []
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/^\s*#+\s*/, '').trim()
    if (!line) continue
    let cur = ''
    for (let word of line.split(/\s+/)) {
      while (word.length > w) {
        if (cur) { rows.push(cur); cur = '' }
        rows.push(word.slice(0, w))
        word = word.slice(w)
      }
      if (!word) continue
      if (!cur) cur = word
      else if (cur.length + 1 + word.length <= w) cur += ' ' + word
      else { rows.push(cur); cur = word }
    }
    if (cur) rows.push(cur)
  }
  return rows
}

export const NO_DESC = '(no description)'

export function descriptionRows(meta: TicketMeta | null, excerpt: string | null, w: number): { title: 'Description' | 'Ticket'; rows: string[] } {
  if (meta) {
    // The body goes to Markdown whole; `rows` only carries it (or the placeholder) to the caller.
    return { title: 'Description', rows: [meta.description.trim() ? meta.description : NO_DESC] }
  }
  return { title: 'Ticket', rows: wrapRows(excerpt ?? '', w).slice(0, 8) }
}

function stateColourOf(type: string | null): ThemeKey {
  switch (type) {
    case 'started': return 'success'
    case 'unstarted': case 'backlog': case 'triage': return 'subtle'
    case 'completed': return 'merged'
    case 'canceled': return 'error'
    default: return 'text'
  }
}
const priorityColour = (p: number): ThemeKey => (p <= 1 ? 'error' : p === 2 ? 'warning' : 'subtle')

const TABS: { key: DetailTab; label: string; hotkey: string }[] = [
  { key: 'overview', label: 'Overview', hotkey: 'o' },
  { key: 'ticket', label: 'Ticket', hotkey: 't' },
  { key: 'activity', label: 'Activity', hotkey: 'a' },
  { key: 'comments', label: 'Comments', hotkey: 'c' },
]

/** Comments newer than the last one seen (the poll baselines a ticket when its comments first arrive). */
export function unseenComments(meta: TicketMeta | null, seenAt: number | undefined): number {
  if (!meta || seenAt == null) return 0
  return meta.comments.filter(c => c.createdAt != null && c.createdAt > seenAt).length
}

/** The ticket as the detail shows it: Linear or local meta when fetched, else the evidence copy's excerpt. */
function ticketView(r: Run): { meta: TicketMeta | null; parts: ReturnType<typeof splitTicketBody> } {
  const meta = r.ticket_meta
  return { meta, parts: splitTicketBody(meta ? meta.description : (r.ticket_doc.excerpt ?? '')) }
}

type Chip = { text: string; color: ThemeKey; link?: string }

/** What a link to the ticket says: Linear's own name for a Linear ticket, else neutral. */
export const openLabel = (meta: TicketMeta) =>
  meta.source === 'linear' || /linear\.app/.test(meta.url ?? '') ? 'Open in Linear' : 'Open ticket'

/** Dated comments newest first, then undated ones in their given order (an undated comment is never "latest"). */
export function newestFirst(comments: readonly TicketComment[]): TicketComment[] {
  const dated = comments.filter(c => c.createdAt != null).sort((a, b) => b.createdAt! - a.createdAt!)
  return [...dated, ...comments.filter(c => c.createdAt == null)]
}

/** The ticket's facts as chips: state, priority, epic, labels, assignee, estimate, link, staleness. */
export function ticketChips(meta: TicketMeta, now: number): Chip[] {
  const out: Chip[] = []
  if (meta.state.name) out.push({ text: meta.state.name, color: stateColourOf(meta.state.type) })
  const p = priorityName(meta.priority)
  if (p) out.push({ text: p, color: priorityColour(meta.priority!) })
  if (meta.epic) out.push({ text: `epic ${meta.epic}`, color: 'permission' })
  for (const l of meta.labels) out.push({ text: `#${l}`, color: 'subtle' })
  if (meta.assignee) out.push({ text: `@${meta.assignee}`, color: 'suggestion' })
  if (meta.estimate != null) out.push({ text: `${meta.estimate} pts`, color: 'subtle' })
  if (meta.url) out.push({ text: openLabel(meta), color: 'text', link: meta.url })
  const staleMs = now - meta.fetchedAt
  if (meta.source !== 'local' && staleMs > 60_000) out.push({ text: `fetched ${fmtAgo(staleMs)}`, color: 'subtle' })
  return out
}

function chipRow(els: PaneEls, chips: Chip[], key: string): RenderElement | null {
  const { Box, Text, Link } = els
  if (!chips.length) return null
  return (
    <Box key={key} flexDirection="row" flexWrap="wrap" columnGap={2}>
      {chips.map((c, i) => (c.link
        ? <Link key={`chip:${i}`} href={c.link} label={c.text} />
        : <Text key={`chip:${i}`} color={c.color}>{c.text}</Text>))}
    </Box>
  )
}

function tabBar(els: PaneEls, model: PaneModel, lane: Lane): RenderElement {
  const { Box, Button } = els
  const meta = lane.run.ticket_meta
  const count = meta?.comments.length ?? 0
  const fresh = unseenComments(meta, model.seenComments[lane.run.ticket.toUpperCase()])
  const label = (t: (typeof TABS)[number]) => {
    if (t.key !== 'comments' || !count) return t.label
    return fresh && model.detailTab !== 'comments' ? `${t.label} · ${count} (${fresh} new)` : `${t.label} · ${count}${meta?.commentsTruncated ? '+' : ''}`
  }
  return (
    <Box key="tabs" flexDirection="row" flexWrap="wrap" columnGap={2} marginTop={1}>
      {TABS.map(t => (
        <Button key={`tab:${t.key}`} plain hotkey={t.hotkey} label={label(t)}
          {...(model.detailTab === t.key ? {} : { dimColor: true })}
          onPress={() => model.onTab(t.key, lane)} />
      ))}
    </Box>
  )
}

/** Overview's ticket block: chips, the first paragraph, and a pointer to the Ticket tab. */
function ticketSummary(els: PaneEls, model: PaneModel, lane: Lane): RenderElement | null {
  const { Box, Text, Button } = els
  const { meta, parts } = ticketView(lane.run)
  if (!meta && !parts.summary) return null
  const more = [
    parts.acceptance.length ? `${parts.acceptance.length} acceptance criteria` : null,
    meta?.comments.length ? `${meta.comments.length} comment${meta.comments.length === 1 ? '' : 's'}` : null,
  ].filter(Boolean).join(' · ')
  return (
    <Box key="ticket-summary" flexDirection="column" marginTop={1}>
      <Text dimColor>Ticket</Text>
      {meta && chipRow(els, ticketChips(meta, model.now), 'ticket-chips')}
      {parts.summary && <Text wrap="wrap">{truncate(parts.summary, 400)}</Text>}
      <Button key="to-ticket" plain dimColor label={more ? `${more} · full ticket` : 'Full ticket'} onPress={() => model.onTab('ticket')} />
      {meta && meta.comments.length > 0 && (() => {
        const latest = newestFirst(meta.comments)[0]!
        return (
          <Button key="to-comments" plain dimColor
            label={`Latest comment: ${latest.author ?? 'someone'}${latest.createdAt != null ? `, ${fmtAgo(model.now - latest.createdAt)}` : ''}`}
            onPress={() => model.onTab('comments', lane)} />
        )
      })()}
    </Box>
  )
}

function overviewTab(els: PaneEls, model: PaneModel, lane: Lane): RenderElement[] {
  const { Box, Text } = els
  const recent = recentLines(lane.run.timeline, 6)
  return [
    stepper(els, lane, model.bodyColumns),
    escalationCard(els, model, lane),
    gatesBlock(els, lane),
    ticketSummary(els, model, lane),
    recent.length > 0
      ? (
        <Box key="timeline" flexDirection="column" marginTop={1}>
          <Text dimColor>Recent</Text>
          {recent.map((ev, i) => (
            <Box key={`tl:${i}`} flexDirection="row" gap={1}>
              <Text dimColor>{hhmm(ev.t)}</Text>
              <Text color={ev.colour} wrap="truncate-end">{ev.text}</Text>
            </Box>
          ))}
        </Box>
      )
      : null,
  ].filter((x): x is RenderElement => x != null)
}

function ticketTab(els: PaneEls, model: PaneModel, lane: Lane): RenderElement[] {
  const { Box, Text, Button, Markdown } = els
  const r = lane.run
  const { meta, parts } = ticketView(r)
  const truncated = !!meta?.commentsTruncated
  const out: (RenderElement | null)[] = [
    meta ? <Box key="chips" marginTop={1}>{chipRow(els, ticketChips(meta, model.now), 'ticket-chips')}</Box> : null,
    r.ticket_meta_error ? <Box key="meta-error"><Text dimColor wrap="wrap">{r.ticket_meta_error}</Text></Box> : null,
    parts.body
      ? <Box key="ticket-body" flexDirection="column" marginTop={1}><Markdown text={parts.body} /></Box>
      : <Box key="ticket-body" marginTop={1}><Text dimColor>{NO_DESC}</Text></Box>,
    !meta && r.ticket_doc.excerpt
      ? <Text key="excerpt-note" dimColor>From the run's evidence copy; may be cut short.</Text>
      : null,
    parts.acceptance.length
      ? (
        <Box key="acceptance" flexDirection="column" marginTop={1}>
          <Text dimColor>{`Acceptance criteria · ${parts.acceptance.length}`}</Text>
          {parts.notes && <Text wrap="wrap">{parts.notes}</Text>}
          {parts.acceptance.map((c, i) => (
            <Box key={`ac:${i}`} flexDirection="row" gap={1}>
              <Text color={c.done ? 'success' : 'subtle'}>{c.done ? '☑' : '☐'}</Text>
              <Box flexShrink={1}><Markdown text={c.text} /></Box>
            </Box>
          ))}
        </Box>
      )
      : null,
    meta && meta.comments.length > 0
      ? <Button key="to-comments" plain dimColor label={`${meta.comments.length}${truncated ? '+' : ''} comment${meta.comments.length === 1 ? '' : 's'} · open Comments`} onPress={() => model.onTab('comments', lane)} />
      : null,
  ]
  return out.filter((x): x is RenderElement => x != null)
}

function activityTab(els: PaneEls, model: PaneModel, lane: Lane): RenderElement[] {
  const { Box, Text } = els
  const r = lane.run
  const spans = phaseSpans(r.timeline, r.endedAt)
  if (!spans.length) return [<Box key="activity-empty" marginTop={1}><Text dimColor>No events yet.</Text></Box>]
  const out: RenderElement[] = []
  if (r.timelineTruncated) out.push(<Box key="activity-cut" marginTop={1}><Text dimColor>Older events not shown.</Text></Box>)
  spans.forEach((sp, i) => {
    const took = sp.end != null ? fmtElapsed(sp.end - sp.start) : `${fmtElapsed(model.now - sp.start)} so far`
    out.push(
      <Box key={`span:${i}`} flexDirection="column" marginTop={1}>
        <Box flexDirection="row" gap={1}>
          <Text bold>{sp.phase}</Text>
          {sp.cycle ? <Text dimColor>{`cycle ${sp.cycle}`}</Text> : null}
          <Box flexGrow={1} />
          <Text dimColor>{`${hhmm(sp.start)} · ${took}`}</Text>
        </Box>
        {recentLines(sp.events, sp.events.length || 1).map((ev, j) => (
          <Box key={`ev:${j}`} flexDirection="row" gap={1} marginLeft={2}>
            <Text dimColor>{hhmm(ev.t)}</Text>
            <Text color={ev.colour} wrap="truncate-end">{ev.text}</Text>
          </Box>
        ))}
      </Box>,
    )
  })
  return out
}

function commentsTab(els: PaneEls, model: PaneModel, lane: Lane): RenderElement[] {
  const { Box, Text, Link, Markdown } = els
  const meta = lane.run.ticket_meta
  if (!meta) {
    const why = lane.run.ticket_meta_error ?? 'Comments appear once the ticket has been fetched.'
    return [<Box key="comments-empty" marginTop={1}><Text dimColor wrap="wrap">{why}</Text></Box>]
  }
  if (!meta.comments.length) {
    const why = meta.source === 'local' ? 'No comments. Local tickets don\'t store comments yet.' : 'No comments yet.'
    return [<Box key="comments-empty" marginTop={1}><Text dimColor>{why}</Text></Box>]
  }
  const seenAt = model.seenComments[lane.run.ticket.toUpperCase()]
  // Newest first: scope changes and closing notes are what the person comes here for.
  const list = newestFirst(meta.comments)
  return [
    ...list.map((c, i) => {
      const fresh = c.createdAt != null && seenAt != null && c.createdAt > seenAt
      return (
        <Box key={`cm:${i}`} flexDirection="column" marginTop={1}>
          <Box flexDirection="row" gap={1}>
            <Text color="suggestion" bold>{c.author ?? 'someone'}</Text>
            <Text dimColor>{c.createdAt != null ? `${fmtAgo(model.now - c.createdAt)} · ${hhmm(c.createdAt)}` : ''}</Text>
            {fresh && <Text color="warning">new</Text>}
          </Box>
          {c.body.trim() ? <Markdown text={c.body.replace(/\r\n?/g, '\n')} /> : <Text dimColor>(empty)</Text>}
        </Box>
      )
    }),
    ...(meta.commentsTruncated || meta.url
      ? [(
        <Box key="comments-more" flexDirection="row" flexWrap="wrap" marginTop={1}>
          {meta.commentsTruncated && <Text dimColor>{`Showing the newest ${meta.comments.length}${meta.url ? ' · ' : ''}`}</Text>}
          {meta.url && <Link href={meta.url} label={openLabel(meta)} />}
        </Box>
      )]
      : []),
  ]
}

export function renderDetail(els: PaneEls, model: PaneModel, lane: Lane): RenderElement {
  const { Box, Text, Link } = els
  const r = lane.run
  const pr = prUrlOf(r)
  const body = model.detailTab === 'ticket' ? ticketTab(els, model, lane)
    : model.detailTab === 'activity' ? activityTab(els, model, lane)
      : model.detailTab === 'comments' ? commentsTab(els, model, lane)
        : overviewTab(els, model, lane)
  return (
    <Box key="detail" flexDirection="column" marginTop={1} borderStyle="single" borderDimColor paddingX={1}>
      <Box key="detail-header" flexDirection="row" gap={1}>
        <Text bold color="claude">{r.ticket}</Text>
        <Box flexGrow={1} flexShrink={1} minWidth={0}><Text bold wrap="truncate-end">{titleOf(r)}</Text></Box>
        {pr && <Link href={pr} label={prLabel(pr)} />}
      </Box>
      <Text dimColor wrap="wrap">{metaParts(lane, model.now).join(' · ')}</Text>
      {tabBar(els, model, lane)}
      {body}
    </Box>
  )
}
