// hooks/fleet-pane/register.tsx
import { atom, read, update } from 'claude-code'
import type { AgentInfo, EngineInterface, Register, SessionMessage, UiOpenResult } from 'claude-code'
import type { AccountUsage, AnswerDraft, DetailTab, FleetState, Lane, LaneUsage, UsageMeter } from '../../types'
import { recordTurn, ticketForAgent, tokensOf, weightOf } from './usage'
import { renderPane } from './render'
import { runFleetSnapshot, POLL_MS, IDLE_POLL_MS } from './snapshot'
import {
  agentIdsByTicket, correlate, detailTicket, draftFor, draftMessage, escalationKey, fingerprint, headline,
  laneState, partition, rememberAgents, summarize, type GroupKey,
} from './lanes'

export const PANE = 'fleet'
const EMPTY: FleetState = { lanes: [], error: null, fingerprint: '', generatedAt: 0, root: '', project: '' }

export const fleet = atom({ plugin: 'concertino', key: 'fleet' } as const, EMPTY)
export const selected = atom({ plugin: 'concertino', key: 'selected' } as const, null as string | null)
export const paneOffered = atom({ plugin: 'concertino', key: 'paneOffered' } as const, false)
export const showAll = atom({ plugin: 'concertino', key: 'showAll' } as const, false)
export const seenEscalations = atom({ plugin: 'concertino', key: 'seenEscalations' } as const, [] as string[])
export const knownAgents = atom({ plugin: 'concertino', key: 'knownAgents' } as const, {} as Record<string, string>)
export const drafts = atom({ plugin: 'concertino', key: 'drafts' } as const, {} as Record<string, AnswerDraft>)
export const openGroups = atom({ plugin: 'concertino', key: 'openGroups' } as const, [] as string[])
export const detailTab = atom({ plugin: 'concertino', key: 'detailTab' } as const, 'overview' as DetailTab)
export const laneUsage = atom({ plugin: 'concertino', key: 'laneUsage' } as const, {} as Record<string, LaneUsage>)
export const usageMeter = atom({ plugin: 'concertino', key: 'usageMeter' } as const, { weight: 0, usdAtStart: null } as UsageMeter)
export const account = atom({ plugin: 'concertino', key: 'account' } as const, null as AccountUsage | null)
export const seenComments = atom({ plugin: 'concertino', key: 'seenComments' } as const, {} as Record<string, number>)

/** Marks a lane's comments seen up to its newest one. */
async function markCommentsSeen($: EngineInterface, lane: Lane): Promise<void> {
  const newest = Math.max(-Infinity, ...(lane.run.ticket_meta?.comments ?? []).map(c => c.createdAt ?? -Infinity))
  if (!Number.isFinite(newest)) return
  const key = lane.run.ticket.toUpperCase()
  await update($, seenComments, seen => ((seen[key] ?? -Infinity) >= newest ? seen : { ...seen, [key]: newest }))
}

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

/**
 * The account's rate-limit windows and the session's API-equivalent cost. The meter's starting
 * cost is taken at the first reading, so lane shares divide only what accrued while metering.
 */
async function readAccount($: EngineInterface): Promise<void> {
  let usage
  try { usage = await $.session.usage() } catch { return }
  const next: AccountUsage = {
    rateLimits: usage.rateLimits.map(r => ({ kind: r.kind, percentUsed: r.percentUsed, ...(r.resetsAt ? { resetsAt: r.resetsAt } : {}) })),
    usd: usage.cost?.usd ?? null,
  }
  const was = await read($, account)
  if (JSON.stringify(was) !== JSON.stringify(next)) await update($, account, () => next)
  if (next.usd != null) await update($, usageMeter, m => (m.usdAtStart == null ? { ...m, usdAtStart: next.usd } : m))
}

async function sessionId($: EngineInterface): Promise<string | null> {
  try {
    return (await $.session.id()) || null
  } catch {
    return null
  }
}

const basename = (p: string) => p.replace(/\/+$/, '').split('/').at(-1) ?? p

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
  const groupsOpen = await read($, openGroups)
  const wanted = partition(previous.lanes, now, all, groupsOpen).shown.map(l => l.run.ticket)
  // The detail lane may sit in a collapsed group but still needs its ticket detail.
  const inDetail = detailTicket(previous.lanes, await read($, selected), undefined, all, now)
  if (inDetail && !wanted.includes(inDetail)) wanted.push(inDetail)
  // The engine follows `$` only into same-file functions, never across an import, so the snapshot
  // runner gets a narrow `process.run` shim whose `$` is spelled at the call site.
  const got = await runFleetSnapshot({ process: { run: (argv, init) => $.process.run(argv, init) } } as EngineInterface, cwd, wanted)
  if (!got.ok) {
    await $.ui.status(undefined)
    if (previous.error !== got.error) await update($, fleet, f => ({ ...f, error: got.error }))
    return IDLE_POLL_MS
  }
  const [agents, messages, me, known] = await Promise.all([listAgents($), mainMessages($), sessionId($), read($, knownAgents)])
  await readAccount($)
  const lanes = correlate(got.snapshot.runs, agents, me, agentIdsByTicket(messages), known)
  const remembered = rememberAgents(known, lanes)
  if (JSON.stringify(remembered) !== JSON.stringify(known)) await update($, knownAgents, () => remembered)
  const { shown, hidden } = partition(lanes, now, all, groupsOpen)
  const next: FleetState = {
    lanes, error: null, fingerprint: fingerprint(lanes, null, hidden),
    generatedAt: got.snapshot.generatedAt, root: got.snapshot.root,
    project: got.snapshot.project || basename(got.snapshot.root),
  }
  await $.ui.status(summarize(lanes, now))
  if (next.fingerprint !== previous.fingerprint || previous.error || previous.project !== next.project) await update($, fleet, () => next)
  await toastNewEscalations($, lanes)
  await baselineComments($, lanes)
  // Only drawn lanes keep the 2 s poll and open the pane: a quiet driverless run does neither.
  const live = shown.some(l => !['done', 'failed'].includes(laneState(l, now)))
  if (!live) return IDLE_POLL_MS
  if (!(await read($, paneOffered))) {
    await update($, paneOffered, () => true)
    void openPane($).catch(() => undefined)
  }
  return POLL_MS
}

/**
 * The first time a lane's comments arrive, they count as seen: "new" means new since this session
 * first saw the ticket, not every comment it ever had.
 */
async function baselineComments($: EngineInterface, lanes: Lane[]): Promise<void> {
  const seen = await read($, seenComments)
  const add: Record<string, number> = {}
  for (const l of lanes) {
    const key = l.run.ticket.toUpperCase()
    const comments = l.run.ticket_meta?.comments
    if (!comments || key in seen) continue
    const newest = Math.max(0, ...comments.map(c => c.createdAt ?? 0))
    add[key] = newest
  }
  // Bounded like seenEscalations: the newest 200 tickets' marks are kept.
  if (Object.keys(add).length) await update($, seenComments, s => Object.fromEntries(Object.entries({ ...add, ...s }).slice(-200)))
}

async function toastNewEscalations($: EngineInterface, lanes: Lane[]): Promise<void> {
  const seen = await read($, seenEscalations)
  const fresh = lanes.filter(l => l.run.escalation && !l.run.pendingAnswer && !seen.includes(escalationKey(l.run.ticket, l.run.escalation)))
  if (!fresh.length) return
  for (const lane of fresh) await $.ui.toast(`${lane.run.ticket} needs you: ${headline(lane.run.escalation!).slice(0, 80)}`)
  await update($, seenEscalations, s => [...s, ...fresh.map(l => escalationKey(l.run.ticket, l.run.escalation!))].slice(-200))
}

async function openPane($: EngineInterface, focus?: true): Promise<UiOpenResult> {
  const isUp = (await $.ui.panes()).some(p => p.id === PANE)
  if (isUp && !focus) return { isPlaced: true }
  return $.ui.open(focus ? { id: PANE, title: 'Fleet', focus } : { id: PANE, title: 'Fleet' })
}

/** Writes one draft, sized to its questions; drafts for escalations no lane carries any more are dropped. */
async function writeDraft($: EngineInterface, key: string, size: number, change: (d: AnswerDraft) => AnswerDraft): Promise<void> {
  const live = new Set((await read($, fleet)).lanes.flatMap(l => (l.run.escalation ? [escalationKey(l.run.ticket, l.run.escalation)] : [])))
  await update($, drafts, all => {
    const kept = Object.fromEntries(Object.entries(all).filter(([k]) => live.has(k) || k === key))
    return { ...kept, [key]: change(draftFor(all, key, size)) }
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'fleet', description: 'Show concertino lanes in a pane (`/fleet off` closes it, `/fleet all` shows every lane)', argumentHint: '[off|all]', immediate: true })
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

  /**
   * `/fleet`, `/fleet off`, `/fleet all`. Replies go through `$.ui.log` (drawn like a system
   * notice) and the hook returns `{}`: the pane is for the person, so its chatter must not
   * enter the model's context, which a returned `text` would.
   */
  /**
   * Meters every model turn: the main loop's count toward the session total only, a subagent's
   * also toward the lane whose orchestrator spawned it (directly or through its sub-agents).
   */
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const usage = result.usage ?? e.usage
    if (!usage) return result
    // Until the starting cost is known, a turn's cost lands inside it: metering the turn too would
    // charge a lane for cost the share never divides. Take the start now (this turn included) and
    // skip the turn. A host with no cost ledger never gets a start: meter its tokens regardless.
    if ((await read($, usageMeter)).usdAtStart == null) {
      await readAccount($)
      if ((await read($, usageMeter)).usdAtStart != null) return result
    }
    const weight = weightOf(usage, usage.model)
    let ticket: string | null = null
    if (e.agentId) {
      const [agents, known, state] = await Promise.all([listAgents($), read($, knownAgents), read($, fleet)])
      ticket = ticketForAgent(e.agentId, agents, known, state.lanes.map(l => l.run.ticket))
    }
    // Parallel lanes finish turns concurrently: each write applies its delta inside `update` so
    // none is lost to a read-then-write race.
    const tokens = tokensOf(usage)
    await update($, usageMeter, m => recordTurn(m, {}, null, tokens, weight).meter)
    if (ticket) await update($, laneUsage, lanes => recordTurn({ weight: 0, usdAtStart: null }, lanes, ticket, tokens, weight).lanes)
    return result
  })

  on('command.run', { command: 'fleet' }, async ($, e) => {
    if (e.args.trim() === 'off') {
      await $.ui.close({ id: PANE })
      $.ui.log('Fleet pane closed.')
      return {}
    }
    if (e.args.trim() === 'all') {
      let nowAll = false
      await update($, showAll, current => (nowAll = !current))
      $.ui.log(nowAll ? 'Fleet pane: showing every lane.' : 'Fleet pane: showing live and recent lanes.')
      return {}
    }
    const placed = await openPane($, true)
    const surfaces = await $.session.surfaces().catch(() => [] as readonly string[])
    const attached = `surfaces: ${surfaces.length ? surfaces.join(', ') : 'none'}`
    $.ui.log(`${placed.isPlaced ? 'Fleet pane opened' : `Fleet pane not shown: ${placed.reason}`} · ${attached}`)
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const model = {
      fleet: await read($, fleet),
      selected: await read($, selected),
      showAll: await read($, showAll),
      openGroups: await read($, openGroups),
      drafts: await read($, drafts),
      detailTab: await read($, detailTab),
      seenComments: await read($, seenComments),
      laneUsage: await read($, laneUsage),
      usageMeter: await read($, usageMeter),
      account: await read($, account),
      ...(e.props.view.agentId ? { viewAgentId: e.props.view.agentId } : {}),
      bodyColumns: e.props.bodyColumns,
      placement: e.props.placement,
      now: await $.clock.now(),
      onSelect: (ticket: string) => { void update($, selected, () => ticket) },
      onTab: (tab: DetailTab, lane?: Lane) => {
        void update($, detailTab, () => tab)
        if (tab === 'comments' && lane) void markCommentsSeen($, lane)
      },
      onToggleGroup: (key: GroupKey) => {
        void update($, openGroups, open => (open.includes(key) ? open.filter(k => k !== key) : [...open, key]))
      },
      onPick: (escKey: string, question: number, value: string | null, size: number) => {
        void writeDraft($, escKey, size, d => ({ ...d, picks: d.picks.map((p, i) => (i === question ? value : p)) }))
      },
      onNote: (escKey: string, note: string, size: number) => {
        void writeDraft($, escKey, size, d => ({ ...d, note }))
      },
      // The pane writes nothing: the answer goes into the person's prompt box as a draft for the
      // driver, who records it with `concertino answer` and resumes the orchestrator.
      onDraft: (lane: Lane) => {
        const esc = lane.run.escalation
        if (!esc) return
        void (async () => {
          const key = escalationKey(lane.run.ticket, esc)
          const draft = draftFor(await read($, drafts), key, (esc.subQuestions?.length || 1))
          const filled = await $.prompt.fill({ text: draftMessage(lane.run.ticket, esc, draft), mode: 'replace' })
          // The picks stay in the draft until the escalation is answered, so a cleared prompt box can be refilled.
          if (filled.isFilled) {
            await $.ui.toast(`Answer for ${lane.run.ticket} is in the prompt box. Review it and press Enter.`)
          } else {
            await $.ui.toast(`Couldn't fill the prompt box${filled.refusal ? ` (${filled.refusal})` : ''}. Close any open dialog and try again.`)
          }
        })()
      },
    }
    return renderPane(els, model)
  })
}
