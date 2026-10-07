// hooks/fleet-pane/render.tsx
// Pure drawing: a PaneModel in, a tree out. `els` is `$.ui.resolve(e)`.
import type { Elements, RenderSurface, RenderElement } from 'claude-code'
import type { FleetState, Lane, TimelineEvent, TicketMeta, TicketComment } from '../../types'
import { summarize, displayStatus, partition, newestComments, pickDetailLane } from './lanes'

type PaneEls = Elements[RenderSurface]

export type PaneModel = {
  fleet: FleetState
  selected: string | null
  showAll: boolean
  viewAgentId?: string
  bodyColumns: number
  placement: 'dock' | 'inline'
  now: number
  onSelect: (ticket: string) => void
}

export const PHASE_ORDER = ['Setup', 'Planning', 'Execution', 'Evaluation', 'Delivery', 'Cleanup']

export function truncate(s: string, max: number): string {
  const n = Math.max(0, max)
  return s.length <= n ? s : n <= 1 ? s.slice(0, n) : s.slice(0, n - 1) + '…'
}

export function phaseBar(phase: string | null): string {
  const i = phase ? PHASE_ORDER.indexOf(phase) : -1
  return PHASE_ORDER.map((_, j) => (j <= i ? '■' : '□')).join('')
}

export function fmtElapsed(ms: number | null): string {
  if (ms == null) return '-'
  const m = Math.floor(ms / 60000)
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
}

export const fmtAgo = (ms: number) => fmtElapsed(Math.max(0, ms)) + ' ago'

// A needs-you row is already yellow and the orchestrator's pause is expected, so it is never "stalled".
function agentLabel(lane: Lane): string {
  if (lane.liveness === 'stalled' && lane.run.status !== 'needs-you') return `${lane.run.currentAgent ?? ''} stalled`.trim()
  if (lane.liveness === 'external') return 'external'
  return lane.run.currentAgent ?? ''
}

const dimmed = (lane: Lane) =>
  ((lane.liveness === 'external' || lane.liveness === 'stalled') && lane.run.status !== 'needs-you') || displayStatus(lane) === 'unknown'

export function laneRow(lane: Lane, now: number): string {
  const r = lane.run
  const elapsed = r.startedAt != null ? (r.endedAt ?? now) - r.startedAt : r.elapsedMs
  const passed = r.gates.filter(g => g.status === 'pass').length
  return [
    r.ticket.padEnd(9), displayStatus(lane).padEnd(10), (r.phase ?? '-').padEnd(10),
    `c${r.cycle ?? '-'}`.padEnd(3), `${phaseBar(r.phase)} ${passed}/${r.gates.length}`.padEnd(11),
    fmtElapsed(elapsed).padEnd(7), agentLabel(lane),
  ].join(' ').trimEnd()
}

function visibleLanes(model: PaneModel): { visible: Lane[]; hidden: number } {
  const { shown, hidden } = partition(model.fleet.lanes, model.now)
  return { visible: model.showAll ? model.fleet.lanes : shown, hidden }
}

export function pickDetail(model: PaneModel): Lane | undefined {
  return pickDetailLane(model.fleet.lanes, model.selected, model.viewAgentId, model.showAll, model.now)
}

export function renderPane(els: PaneEls, model: PaneModel): RenderElement {
  const { Box, Text, Button } = els
  const { fleet, bodyColumns: w } = model
  const { visible, hidden } = visibleLanes(model)
  const detail = pickDetail(model)
  const suffix = model.showAll ? ' · all' : hidden > 0 ? ` · ${hidden} hidden` : ''
  const rule = '─'.repeat(Math.max(1, w))
  return (
    <Box flexDirection="column">
      <Box key="header"><Text bold>{truncate(`Fleet · concertino  ${summarize(visible)?.replace(/^fleet: /, '') ?? ''}${suffix}`, w)}</Text></Box>
      <Text dimColor>{rule}</Text>
      {fleet.error && <Box key="error"><Text color="red">{truncate(fleet.error, w)}</Text></Box>}
      {fleet.lanes.length === 0 && !fleet.error && (
        <Box key="empty"><Text dimColor>{truncate(`No concertino runs under ${fleet.root}/.concertino/runs`, w)}</Text></Box>
      )}
      {fleet.lanes.length > 0 && visible.length === 0 && (
        <Box key="empty"><Text dimColor>{truncate(`No live lanes · ${hidden} hidden (/fleet all)`, w)}</Text></Box>
      )}
      {visible.map((lane, i) => {
        const colour = colourOf(lane)
        return (
          <Box key={`row:${lane.run.ticket}`} flexDirection="row">
            <Text {...(colour ? { color: colour } : {})}>{detail === lane ? '▶ ' : '● '}</Text>
            <Button
              key={`lane:${lane.run.ticket}`}
              plain
              {...(i < 9 ? { hotkey: String(i + 1) } : {})}
              dimColor={dimmed(lane)}
              label={truncate(laneRow(lane, model.now), w - 2)}
              onPress={() => model.onSelect(lane.run.ticket)}
            />
          </Box>
        )
      })}
      {model.placement === 'dock' && detail && <Text dimColor>{rule}</Text>}
      {model.placement === 'dock' && detail && renderDetail(els, model, detail)}
    </Box>
  )
}

const colourOf = (lane: Lane): 'yellow' | 'red' | undefined => {
  const s = displayStatus(lane)
  return s === 'needs-you' ? 'yellow' : s === 'failed' ? 'red' : undefined
}

const LETTERS = 'abcdefghijklmnopqrstuvwxyz'
const lettered = (options: string[]) => options.map((o, i) => `${LETTERS[i] ?? '?'}) ${o}`).join('   ')

function answeredLine(lane: Lane): string | null {
  const a = lane.run.pendingAnswer
  if (!a) return null
  if ('answer' in a) return `answered: ${a.answer}`
  return `answered: ${a.subAnswers.filter(x => x != null).length}/${a.total}${a.complete ? '' : ' (in progress)'}`
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

export function descriptionRows(meta: TicketMeta | null, excerpt: string | null, w: number): { title: 'DESCRIPTION' | 'TICKET'; rows: string[] } {
  if (meta) {
    const rows = wrapRows(meta.description, w).slice(0, 12)
    return { title: 'DESCRIPTION', rows: rows.length ? rows : ['(no description)'] }
  }
  return { title: 'TICKET', rows: wrapRows(excerpt ?? '', w).slice(0, 8) }
}

export const commentRows = (c: TicketComment, w: number): string[] => wrapRows(c.body, w).slice(0, 6)

function timelineLine(ev: TimelineEvent, w: number): string {
  const d = new Date(ev.t)
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const rest = [ev.kind, ev.agent, ev.role && ev.kind === 'verdict' ? ev.role : undefined, ev.verdict, ev.phase, ev.gate,
    ev.status, ev.cycle != null ? `c${ev.cycle}` : undefined, ev.label].filter(Boolean).join(' ')
  return truncate(`${hhmm} ${rest}`, w)
}

export function renderDetail(els: PaneEls, model: PaneModel, lane: Lane): RenderElement {
  const { Box, Text } = els
  const w = model.bodyColumns
  const r = lane.run
  const colour = colourOf(lane)
  const pr = r.timeline.filter(ev => ev.kind === 'pr' && ev.url).at(-1)
  const desc = descriptionRows(r.ticket_meta, r.ticket_doc.excerpt, w)
  const meta = r.ticket_meta
  const shown = meta ? newestComments(meta.comments, 5) : []
  const truncated = !!meta?.commentsTruncated
  const more = meta ? meta.comments.length - shown.length : 0
  const staleMs = meta ? model.now - meta.fetchedAt : 0
  const esc = r.escalation
  const answered = answeredLine(lane)
  return (
    <Box key="detail" flexDirection="column">
      <Text bold {...(colour ? { color: colour } : {})}>{truncate(`${r.ticket}  ${r.ticket_meta?.title || r.ticket_doc.title || r.changeName || ''}  ${r.branch ?? ''}`, w)}</Text>
      <Text>{truncate(`Phase ${r.phase ?? '-'} · cycle ${r.cycle ?? '-'} · agent ${lane.liveness} · worktree ${r.worktree ?? '-'}`, w)}</Text>
      {meta && (
        <Box key="meta">
          <Text wrap="wrap">{metaLine(meta) + (staleMs > 60_000 ? ` · fetched ${fmtAgo(staleMs)}` : '')}</Text>
        </Box>
      )}
      {r.ticket_meta_error && <Box key="meta-error"><Text dimColor>{truncate(r.ticket_meta_error, w)}</Text></Box>}
      {esc && (
        <Box key="escalation" flexDirection="column" marginTop={1}>
          <Text bold color="yellow">{truncate(`ESCALATION (${esc.role ?? 'unknown'}, ${fmtAgo(model.now - esc.raisedAt)})`, w)}</Text>
          <Text wrap="wrap">{esc.question}</Text>
          {esc.options.length > 0 && <Text wrap="wrap">{lettered(esc.options)}</Text>}
          {(esc.subQuestions ?? []).map((sq, i) => (
            <Box flexDirection="column" key={`sq:${i}`}>
              <Text wrap="wrap">{`${i + 1}. ${sq.question}`}</Text>
              <Text wrap="wrap">{'   ' + lettered(sq.options)}</Text>
            </Box>
          ))}
          {answered && <Text dimColor>{truncate(answered, w)}</Text>}
        </Box>
      )}
      {desc.rows.length > 0 && (
        <Box key="ticket" flexDirection="column" marginTop={1}>
          <Text bold>{desc.title}</Text>
          <Text>{desc.rows.join('\n')}</Text>
        </Box>
      )}
      {r.timeline.length > 0 && (
        <Box key="timeline" flexDirection="column" marginTop={1}>
          <Text bold>TIMELINE</Text>
          {r.timeline.slice(-8).map((ev, i) => <Text key={`tl:${i}`} dimColor>{timelineLine(ev, w)}</Text>)}
        </Box>
      )}
      {(pr || r.costUsd != null) && (
        <Box key="pr" marginTop={1}><Text>{truncate(`${pr ? `PR  ${pr.url}` : ''}${r.costUsd != null ? `   cost $${r.costUsd.toFixed(2)}` : ''}`.trim(), w)}</Text></Box>
      )}
      {meta && meta.comments.length > 0 && (
        <Box key="comments" flexDirection="column" marginTop={1}>
          <Text bold>{`COMMENTS (${meta.comments.length}${truncated ? '+' : ''})`}</Text>
          {shown.map((c, i) => (
            <Box key={`cm:${i}`} flexDirection="column">
              <Text dimColor>{truncate(`${c.author ?? 'someone'} · ${c.createdAt != null ? fmtAgo(model.now - c.createdAt) : ''}`.trim(), w)}</Text>
              <Text>{commentRows(c, w).join('\n')}</Text>
            </Box>
          ))}
          {(more > 0 || truncated) && <Text dimColor wrap="wrap">{`${more}${truncated ? '+' : ''} more — ${meta.url ?? ''}`.trim()}</Text>}
        </Box>
      )}
    </Box>
  )
}
