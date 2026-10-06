// hooks/fleet-pane/register.tsx
import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'
import type { FleetState } from '../../types'
import { renderPane } from './render'

export const PANE = 'fleet'
const EMPTY: FleetState = { lanes: [], error: null, fingerprint: '', generatedAt: 0, root: '' }

export const fleet = atom({ plugin: 'concertino', key: 'fleet' } as const, EMPTY)
export const selected = atom({ plugin: 'concertino', key: 'selected' } as const, null as string | null)
export const seenEscalations = atom({ plugin: 'concertino', key: 'seenEscalations' } as const, [] as string[])

export const register: Register = on => {
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const model = {
      fleet: await read($, fleet),
      selected: await read($, selected),
      ...(e.props.view.agentId ? { viewAgentId: e.props.view.agentId } : {}),
      bodyColumns: e.props.bodyColumns,
      placement: e.props.placement,
      now: await $.clock.now(),
      onSelect: (ticket: string) => { void update($, selected, () => ticket) },
    }
    return renderPane(els, model)
  })
}
