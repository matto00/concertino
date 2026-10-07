// hooks/fleet-pane/render.tsx
// Pure drawing: a PaneModel in, a tree out. `els` is `$.ui.resolve(e)`.
import type { Elements, RenderSurface, RenderElement } from 'claude-code'
import type { FleetState, Lane, TimelineEvent, TicketMeta, TicketComment } from '../../types'
import { summarize, displayStatus, partition } from './lanes'

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
  const { visible } = visibleLanes(model)
  if (model.viewAgentId) {
    const inView = visible.find(l => l.agentId === model.viewAgentId)
    if (inView) return inView
  }
  return visible.find(l => l.run.ticket === model.selected) ?? visible[0]
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

const nonEmpty = (s: string) => s.replace(/\r\n?/g, '\n').split('\n').filter(l => l.trim())

export function descriptionLines(meta: TicketMeta | null, excerpt: string | null): { title: 'DESCRIPTION' | 'TICKET'; lines: string[] } {
  if (meta) return { title: 'DESCRIPTION', lines: nonEmpty(meta.description).slice(0, 12) }
  return { title: 'TICKET', lines: nonEmpty(excerpt ?? '').slice(0, 8) }
}

export const commentLines = (c: TicketComment): string[] => nonEmpty(c.body).slice(0, 6)

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
  const desc = descriptionLines(r.ticket_meta, r.ticket_doc.excerpt)
  const meta = r.ticket_meta
  const shown = meta ? meta.comments.slice(-5) : []
  const more = meta ? meta.comments.length - shown.length + (meta.commentsTruncated ? 1 : 0) : 0
  const esc = r.escalation
  const answered = answeredLine(lane)
  return (
    <Box key="detail" flexDirection="column">
      <Text bold {...(colour ? { color: colour } : {})}>{truncate(`${r.ticket}  ${r.ticket_meta?.title || r.ticket_doc.title || r.changeName || ''}  ${r.branch ?? ''}`, w)}</Text>
      <Text>{truncate(`Phase ${r.phase ?? '-'} · cycle ${r.cycle ?? '-'} · agent ${lane.liveness} · worktree ${r.worktree ?? '-'}`, w)}</Text>
      {meta && <Box key="meta"><Text wrap="wrap">{metaLine(meta)}</Text></Box>}
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
      {desc.lines.length > 0 && (
        <Box key="ticket" flexDirection="column" marginTop={1}>
          <Text bold>{desc.title}</Text>
          <Text wrap="wrap">{desc.lines.join('\n')}</Text>
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
          <Text bold>{`COMMENTS (${meta.comments.length}${meta.commentsTruncated ? '+' : ''})`}</Text>
          {shown.map((c, i) => (
            <Box key={`cm:${i}`} flexDirection="column">
              <Text dimColor>{truncate(`${c.author ?? 'someone'} · ${c.createdAt != null ? fmtAgo(model.now - c.createdAt) : ''}`.trim(), w)}</Text>
              <Text wrap="wrap">{commentLines(c).join('\n')}</Text>
            </Box>
          ))}
          {more > 0 && <Text dimColor>{truncate(`${more} more — ${meta.url ?? ''}`.trim(), w)}</Text>}
        </Box>
      )}
    </Box>
  )
}
