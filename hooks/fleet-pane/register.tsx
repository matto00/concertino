// hooks/fleet-pane/register.tsx
import { atom, read, update } from 'claude-code'
import type { AgentInfo, EngineInterface, Register, SessionMessage, UiOpenResult } from 'claude-code'
import type { FleetState, Lane } from '../../types'
import { renderPane } from './render'
import { runFleetSnapshot, POLL_MS, IDLE_POLL_MS } from './snapshot'
import { agentIdsByTicket, correlate, summarize, fingerprint, partition, detailTicket } from './lanes'

export const PANE = 'fleet'
const EMPTY: FleetState = { lanes: [], error: null, fingerprint: '', generatedAt: 0, root: '' }

export const fleet = atom({ plugin: 'concertino', key: 'fleet' } as const, EMPTY)
export const selected = atom({ plugin: 'concertino', key: 'selected' } as const, null as string | null)
export const paneOffered = atom({ plugin: 'concertino', key: 'paneOffered' } as const, false)
export const showAll = atom({ plugin: 'concertino', key: 'showAll' } as const, false)
export const seenEscalations = atom({ plugin: 'concertino', key: 'seenEscalations' } as const, [] as string[])

async function mainMessages($: EngineInterface): Promise<readonly SessionMessage[]> {
  try {
    const found = await $.session.messages()
    return Array.isArray(found) ? found : []
  } catch {
    return []
  }
}

async function listAgents($: EngineInterface): Promise<readonly AgentInfo[]> {
  try {
    const found = await $.agent.list()
    return Array.isArray(found) ? found : []
  } catch {
    return []
  }
}

// Polls are chained with `clock.after`, so they cannot overlap; the guard stays as a backstop.
let inFlight = false

/**
 * One poll. Never throws: a failure is recorded in state, the last lanes stay.
 * Resolves the delay before the next poll: POLL_MS while runs exist, IDLE_POLL_MS when idle or failing.
 */
export async function refresh($: EngineInterface): Promise<number> {
  const cwd = await $.session.root()
  const previous = await read($, fleet)
  const now = await $.clock.now()
  const all = await read($, showAll)
  const previousShown = partition(previous.lanes, now).shown.map(l => l.run.ticket)
  // A revealed (/fleet all) detail lane may be hidden from the list but still needs its detail.
  const revealed = all ? detailTicket(previous.lanes, await read($, selected), undefined, true, now) : null
  if (revealed && !previousShown.includes(revealed)) previousShown.push(revealed)
  // The engine follows `$` only into same-file functions, never across an import, so the snapshot
  // runner gets a narrow `process.run` shim whose `$` is spelled at the call site.
  const got = await runFleetSnapshot({ process: { run: (argv, init) => $.process.run(argv, init) } } as EngineInterface, cwd, previousShown)
  if (!got.ok) {
    await $.ui.status(undefined)
    if (previous.error !== got.error) await update($, fleet, f => ({ ...f, error: got.error }))
    return IDLE_POLL_MS
  }
  const [agents, messages] = await Promise.all([listAgents($), mainMessages($)])
  const lanes = correlate(got.snapshot.runs, agents, agentIdsByTicket(messages))
  const { shown, hidden } = partition(lanes, now)
  const next: FleetState = {
    lanes, error: null, fingerprint: fingerprint(lanes, null, hidden),
    generatedAt: got.snapshot.generatedAt, root: got.snapshot.root,
  }
  await $.ui.status(summarize(shown))
  if (next.fingerprint !== previous.fingerprint || previous.error) await update($, fleet, () => next)
  await toastNewEscalations($, shown)
  if (!shown.length) return IDLE_POLL_MS
  if (!(await read($, paneOffered))) {
    await update($, paneOffered, () => true)
    void openPane($).catch(() => undefined)
  }
  return POLL_MS
}

// Pre-CON-188 escalations carry no escalationId; ticket + raisedAt identifies them.
const escalationKey = (l: Lane): string | null => {
  const esc = l.run.escalation
  return esc ? (esc.escalationId ?? `${l.run.ticket}:${esc.raisedAt}`) : null
}

async function toastNewEscalations($: EngineInterface, lanes: Lane[]): Promise<void> {
  const seen = await read($, seenEscalations)
  const fresh = lanes.filter(l => {
    const key = escalationKey(l)
    return key && !seen.includes(key)
  })
  if (!fresh.length) return
  for (const lane of fresh) await $.ui.toast(`${lane.run.ticket} needs you: ${lane.run.escalation!.question.slice(0, 80)}`)
  await update($, seenEscalations, s => [...s, ...fresh.map(l => escalationKey(l)!)].slice(-200))
}

async function openPane($: EngineInterface, focus?: true): Promise<UiOpenResult> {
  const isUp = (await $.ui.panes()).some(p => p.id === PANE)
  if (isUp && !focus) return { isPlaced: true }
  return $.ui.open(focus ? { id: PANE, title: 'Fleet', focus } : { id: PANE, title: 'Fleet' })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'fleet', description: 'Show concertino lanes in a pane (`/fleet off` closes it, `/fleet all` toggles stale lanes)', argumentHint: '[off|all]', immediate: true })
    const tick = (): void => {
      if (inFlight) { $.clock.after(POLL_MS, tick); return }
      inFlight = true
      let delay = IDLE_POLL_MS
      void refresh($).then(d => { delay = d }, () => undefined).finally(() => {
        inFlight = false
        $.clock.after(delay, tick)
      })
    }
    $.clock.after(POLL_MS, tick)
    return next(e)
  })

  on('command.run', { command: 'fleet' }, async ($, e) => {
    if (e.args.trim() === 'off') {
      await $.ui.close({ id: PANE })
      return { text: 'Fleet pane closed.' }
    }
    if (e.args.trim() === 'all') {
      let nowAll = false
      await update($, showAll, current => (nowAll = !current))
      return { text: nowAll ? 'Fleet pane: showing all lanes.' : 'Fleet pane: showing live lanes only.' }
    }
    const placed = await openPane($, true)
    const surfaces = await $.session.surfaces().catch(() => [] as readonly string[])
    const attached = `surfaces: ${surfaces.length ? surfaces.join(', ') : 'none'}`
    return { text: `${placed.isPlaced ? 'Fleet pane opened' : `Fleet pane not shown: ${placed.reason}`} · ${attached}` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const model = {
      fleet: await read($, fleet),
      selected: await read($, selected),
      showAll: await read($, showAll),
      ...(e.props.view.agentId ? { viewAgentId: e.props.view.agentId } : {}),
      bodyColumns: e.props.bodyColumns,
      placement: e.props.placement,
      now: await $.clock.now(),
      onSelect: (ticket: string) => { void update($, selected, () => ticket) },
    }
    return renderPane(els, model)
  })
}
