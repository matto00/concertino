// Pure: snapshot runs + the session's agents + its transcript → ordered lanes.
// No `$`, no I/O, so `claude plugin test` can pin every branch.
import type { AgentInfo, SessionMessage } from 'claude-code'
import type { Lane, Liveness, Run, RunStatus, TicketComment } from '../../types'

export const ORDER: Record<RunStatus, number> = { 'needs-you': 0, running: 1, unknown: 1, failed: 2, done: 3 }

const TICKET_RE = /\bTICKET_ID\s*[=:]\s*`?([A-Za-z#][A-Za-z0-9_-]*[0-9])/  // mirrors lib/ui/ticket.js TICKET_RE body so GitHub-provider ids like #123 and ids with _ match, while still stopping before a trailing . or backtick
const ENDED: ReadonlySet<AgentInfo['status']> = new Set(['completed', 'failed', 'killed'])

/** Newest orchestrator `Agent` tool use per ticket (keys upper-cased), read off the main transcript. */
export function agentIdsByTicket(messages: readonly SessionMessage[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const message of messages) {
    for (const use of message.toolUses) {
      if (use.tool !== 'Agent' || !use.agentId || use.input.subagent_type !== 'concertino-orchestrator') continue
      const prompt = typeof use.input.prompt === 'string' ? use.input.prompt : ''
      const m = TICKET_RE.exec(prompt)
      if (m?.[1]) {
        const key = m[1].toUpperCase()
        out.delete(key)          // re-insert so the newest wins and iteration order follows it
        out.set(key, use.agentId)
      }
    }
  }
  return out
}

function livenessOf(run: Run, status: AgentInfo['status'] | undefined, matched: boolean): Liveness {
  if (run.endStatus) return 'ended'
  if (!matched || status === undefined) return 'external'
  if (ENDED.has(status)) return 'stalled'
  return 'running'
}

export function correlate(runs: Run[], agents: readonly AgentInfo[], byTicket: Map<string, string>): Lane[] {
  const statusById = new Map(agents.map(a => [a.id, a.status]))
  const lanes: Lane[] = runs.map(run => {
    const agentId = byTicket.get(run.ticket.toUpperCase())
    const agentStatus = agentId ? statusById.get(agentId) : undefined
    const lane: Lane = { run, liveness: livenessOf(run, agentStatus, agentId !== undefined) }
    if (agentId) lane.agentId = agentId
    if (agentStatus) lane.agentStatus = agentStatus
    return lane
  })
  return lanes
    .map((lane, i) => ({ lane, i }))
    .sort((a, b) => (ORDER[a.lane.run.status] - ORDER[b.lane.run.status]) || (a.i - b.i))
    .map(x => x.lane)
}

/** The status a row shows: a run the CLI cannot classify (`unknown`) with a live agent is `running`. */
export function displayStatus(lane: Lane): RunStatus {
  return lane.run.status === 'unknown' && lane.liveness === 'running' ? 'running' : lane.run.status
}

export function summarize(lanes: Lane[]): string | undefined {
  if (!lanes.length) return undefined
  const running = lanes.filter(l => l.liveness === 'running').length
  const needsYou = lanes.filter(l => l.run.status === 'needs-you').length
  const failed = lanes.filter(l => l.run.status === 'failed').length
  const idle = lanes.filter(l => l.liveness !== 'running' && l.run.status !== 'needs-you' && l.run.status !== 'failed').length
  const parts = [`${running} running`]
  if (idle) parts.push(`${idle} idle`)
  if (needsYou) parts.push(`${needsYou} needs you`)
  if (failed) parts.push(`${failed} failed`)
  return 'fleet: ' + parts.join(' · ')
}

export const RECENT_MS = 30 * 60_000

/** Shown by default: this session's lanes (liveness running|stalled) or any lane with an event in the last RECENT_MS. */
export function isShown(lane: Lane, now: number): boolean {
  if (lane.liveness === 'running' || lane.liveness === 'stalled') return true
  const t = lane.run.timeline.at(-1)?.t
  return t !== undefined && now - t < RECENT_MS
}

export function partition(lanes: Lane[], now: number): { shown: Lane[]; hidden: number } {
  const shown = lanes.filter(l => isShown(l, now))
  return { shown, hidden: lanes.length - shown.length }
}

/** The newest `n` comments, oldest first. Linear's order is not relied on: sorted by createdAt ascending, nulls last. */
export function newestComments(comments: readonly TicketComment[], n: number): TicketComment[] {
  const sorted = comments
    .map((c, i) => ({ c, i }))
    .sort((a, b) => {
      if (a.c.createdAt == null || b.c.createdAt == null) return a.c.createdAt == null && b.c.createdAt == null ? a.i - b.i : a.c.createdAt == null ? 1 : -1
      return (a.c.createdAt - b.c.createdAt) || (a.i - b.i)
    })
    .map(x => x.c)
  return n <= 0 ? [] : sorted.slice(-n)
}

/** Which lane the detail block shows: the viewed agent's, else the selected ticket's, else the first visible. */
export function pickDetailLane(lanes: Lane[], selected: string | null, viewAgentId: string | undefined, showAll: boolean, now: number): Lane | undefined {
  const visible = showAll ? lanes : partition(lanes, now).shown
  if (viewAgentId) {
    const inView = visible.find(l => l.agentId === viewAgentId)
    if (inView) return inView
  }
  return visible.find(l => l.run.ticket === selected) ?? visible[0]
}

export const detailTicket = (lanes: Lane[], selected: string | null, viewAgentId: string | undefined, showAll: boolean, now: number): string | null =>
  pickDetailLane(lanes, selected, viewAgentId, showAll, now)?.run.ticket ?? null

export function fingerprint(lanes: Lane[], error: string | null, hidden = 0): string {
  const rows = lanes.map(l => [
    l.run.ticket, l.run.status, l.run.phase, l.run.cycle, l.run.gates.length,
    l.liveness, l.run.escalation?.escalationId ?? l.run.escalation?.raisedAt ?? null,
    l.run.timeline.at(-1)?.t ?? null, l.run.pendingAnswer !== null, l.run.currentAgent,
    l.run.ticket_meta?.fetchedAt ?? null, newestComments(l.run.ticket_meta?.comments ?? [], 1)[0]?.id ?? null, l.run.ticket_meta_error,
  ])
  return JSON.stringify([error, hidden, rows])
}
