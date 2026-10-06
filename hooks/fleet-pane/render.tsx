// hooks/fleet-pane/render.tsx
// Pure drawing: a PaneModel in, a tree out. `els` is `$.ui.resolve(e)`.
import type { Elements, RenderSurface, RenderElement } from 'claude-code'
import type { FleetState, Lane } from '../../types'
import { summarize } from './lanes'

type PaneEls = Elements[RenderSurface]

export type PaneModel = {
  fleet: FleetState
  selected: string | null
  viewAgentId?: string
  bodyColumns: number
  placement: 'dock' | 'inline'
  now: number
  onSelect: (ticket: string) => void
}

export const PHASE_ORDER = ['Setup', 'Planning', 'Execution', 'Evaluation', 'Delivery', 'Cleanup']

export const truncate = (s: string, n: number) => (s.length <= n ? s : n <= 1 ? s.slice(0, n) : s.slice(0, n - 1) + '…')

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

function agentLabel(lane: Lane): string {
  if (lane.liveness === 'stalled') return `${lane.run.currentAgent ?? ''} stalled`.trim()
  if (lane.liveness === 'external') return 'external'
  return lane.run.currentAgent ?? ''
}

export function laneRow(lane: Lane): string {
  const r = lane.run
  const passed = r.gates.filter(g => g.status === 'pass').length
  return [
    r.ticket.padEnd(9), r.status.padEnd(10), (r.phase ?? '-').padEnd(10),
    `c${r.cycle ?? '-'}`.padEnd(3), `${phaseBar(r.phase)} ${passed}/${r.gates.length}`.padEnd(11),
    fmtElapsed(r.elapsedMs).padEnd(5), agentLabel(lane),
  ].join(' ').trimEnd()
}

export function pickDetail(model: PaneModel): Lane | undefined {
  const { lanes } = model.fleet
  if (model.viewAgentId) {
    const inView = lanes.find(l => l.agentId === model.viewAgentId)
    if (inView) return inView
  }
  return lanes.find(l => l.run.ticket === model.selected) ?? lanes[0]
}

export function renderPane(els: PaneEls, model: PaneModel): RenderElement {
  const { Box, Text, Button } = els
  const { fleet, bodyColumns: w } = model
  const detail = pickDetail(model)
  const rule = '─'.repeat(Math.max(1, w))
  return (
    <Box flexDirection="column">
      <Box key="header"><Text bold>{truncate(`Fleet · concertino  ${summarize(fleet.lanes)?.replace(/^fleet: /, '') ?? ''}`, w)}</Text></Box>
      <Text dimColor>{rule}</Text>
      {fleet.error && <Box key="error"><Text color="red">{truncate(fleet.error, w)}</Text></Box>}
      {fleet.lanes.length === 0 && !fleet.error && (
        <Box key="empty"><Text dimColor>{truncate(`No concertino runs under ${fleet.root}/.concertino/runs`, w)}</Text></Box>
      )}
      {fleet.lanes.map((lane, i) => (
        <Button
          key={`lane:${lane.run.ticket}`}
          plain
          {...(i < 9 ? { hotkey: String(i + 1) } : {})}
          dimColor={lane.liveness === 'external' || lane.liveness === 'stalled' || lane.run.status === 'unknown'}
          label={truncate(`${detail === lane ? '▶ ' : '  '}${laneRow(lane)}`, w)}
          onPress={() => model.onSelect(lane.run.ticket)}
        />
      ))}
      {model.placement === 'dock' && detail && <Text dimColor>{rule}</Text>}
      {model.placement === 'dock' && detail && renderDetail(els, model, detail)}
    </Box>
  )
}

// Stub until Task 7. The rule above it is drawn by renderPane.
export function renderDetail(els: PaneEls, _model: PaneModel, _lane: Lane): RenderElement {
  const { Box } = els
  return <Box key="detail" flexDirection="column" />
}
