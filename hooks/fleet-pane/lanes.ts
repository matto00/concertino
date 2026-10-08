// Pure: snapshot runs + this session's id, agents and transcript → lanes, groups, summaries and the
// escalation-answer helpers. No `$`, no I/O, so `claude plugin test` can pin every branch.
// v2 (docs/superpowers/specs/2026-10-07-fleet-pane-v2-design.md): who drives a run comes from the
// `session` every event carries; the Agent-call correlation only says how its orchestrator is doing.
import type { AgentInfo, SessionMessage, ThemeKey } from 'claude-code'
import type { AgentFact, AnswerDraft, Driver, Escalation, Lane, Run, RunStatus, TicketComment } from '../../types'

export const ORDER: Record<RunStatus, number> = { 'needs-you': 0, running: 1, unknown: 1, failed: 2, done: 3 }

const TICKET_RE = /\bTICKET_ID\s*[=:]\s*`?([A-Za-z#][A-Za-z0-9_-]*[0-9])/  // mirrors lib/ui/ticket.js TICKET_RE body so GitHub-provider ids like #123 and ids with _ match, while still stopping before a trailing . or backtick
const ENDED: ReadonlySet<AgentInfo['status']> = new Set(['completed', 'failed', 'killed'])
const ORCHESTRATOR = 'concertino-orchestrator'

/** The orchestrator agent type, bare or plugin-namespaced (`concertino:concertino-orchestrator`). */
export const isOrchestratorType = (t: unknown): boolean =>
  typeof t === 'string' && (t === ORCHESTRATOR || t.endsWith(':' + ORCHESTRATOR))

/** Newest orchestrator `Agent` tool use per ticket (keys upper-cased), read off the main transcript. */
export function agentIdsByTicket(messages: readonly SessionMessage[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const message of messages) {
    for (const use of message.toolUses) {
      if (use.tool !== 'Agent' || !use.agentId || !isOrchestratorType(use.input.subagent_type)) continue
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

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** The ticket as a whole word: `SBX-3` matches "SBX-3 orchestrator", never "SBX-30" or "SBX-3-2". */
const ticketWord = (ticket: string) => new RegExp(`(?:^|[^A-Za-z0-9_-])${escapeRe(ticket)}(?![A-Za-z0-9_]|-[A-Za-z0-9])`, 'i')

/**
 * Orchestrator agent id per ticket (keys upper-cased): first an orchestrator in the agent list whose
 * `name` or `description` names the ticket (a live one over an ended one), then the transcript's Agent
 * call, then the id remembered from an earlier poll.
 */
export function matchAgents(
  runs: readonly Run[], agents: readonly AgentInfo[], fromTranscript: Map<string, string>, known: Readonly<Record<string, string>>,
): Map<string, string> {
  const orchestrators = agents.filter(a => isOrchestratorType(a.type))
  const out = new Map<string, string>()
  for (const run of runs) {
    const key = run.ticket.toUpperCase()
    const re = ticketWord(run.ticket)
    const listed = orchestrators.filter(a => re.test(a.name ?? '') || re.test(a.description ?? ''))
    const id = (listed.filter(a => !ENDED.has(a.status)).at(-1) ?? listed.at(-1))?.id ?? fromTranscript.get(key) ?? known[key]
    if (id) out.set(key, id)
  }
  return out
}

const isOver = (run: Run) => !!run.endStatus || run.status === 'done'

export function driverOf(run: Run, sessionId: string | null, matched: boolean): Driver {
  // The newest event's session is authoritative: a run re-driven elsewhere changes owner. Only a log
  // without one (pre-v2, or a driver whose shell lacked the variable) falls back to the agent match,
  // which is this session's own agent list.
  if (run.driverSession) return sessionId && run.driverSession === sessionId ? 'here' : 'other'
  return matched ? 'here' : 'none'
}

export function agentFactOf(status: AgentInfo['status'] | undefined, matched: boolean): AgentFact {
  if (!matched) return 'unseen'
  if (status === undefined || ENDED.has(status)) return 'stalled'
  return status === 'waiting' || status === 'idle' ? 'waiting' : 'running'
}

export function correlate(
  runs: Run[], agents: readonly AgentInfo[], sessionId: string | null,
  fromTranscript: Map<string, string>, known: Readonly<Record<string, string>> = {},
): Lane[] {
  const statusById = new Map(agents.map(a => [a.id, a.status]))
  const matched = matchAgents(runs, agents, fromTranscript, known)
  const lanes: Lane[] = runs.map(run => {
    const agentId = matched.get(run.ticket.toUpperCase())
    const agentStatus = agentId ? statusById.get(agentId) : undefined
    const lane: Lane = { run, driver: driverOf(run, sessionId, agentId !== undefined) }
    if (lane.driver === 'here' && !isOver(run)) lane.agent = agentFactOf(agentStatus, agentId !== undefined)
    if (agentId) lane.agentId = agentId
    if (agentStatus) lane.agentStatus = agentStatus
    return lane
  })
  return lanes
    .map((lane, i) => ({ lane, i }))
    .sort((a, b) => (ORDER[a.lane.run.status] - ORDER[b.lane.run.status]) || (a.i - b.i))
    .map(x => x.lane)
}

/** Ticket → agent id for every lane that matched one, merged over what was known. */
export const rememberAgents = (known: Readonly<Record<string, string>>, lanes: readonly Lane[]): Record<string, string> => {
  const out = { ...known }
  for (const l of lanes) if (l.agentId) out[l.run.ticket.toUpperCase()] = l.agentId
  return out
}

/** How long a lane driven elsewhere still reads as active after its newest event. */
export const ACTIVE_MS = 5 * 60_000
export const RECENT_MS = 30 * 60_000

export type LaneState = 'needs-you' | 'failed' | 'done' | 'running' | 'waiting' | 'stalled' | 'active' | 'idle'

const lastEventAt = (run: Run): number | undefined => run.timeline.at(-1)?.t

/** One word per lane for its dot, chip and row: the run's own status first, then its driver's agent. */
export function laneState(lane: Lane, now: number): LaneState {
  const s = lane.run.status
  if (s === 'needs-you' || s === 'failed' || s === 'done') return s
  if (lane.run.endStatus) return 'done'
  if (lane.driver === 'here') return lane.agent === 'unseen' || !lane.agent ? 'idle' : lane.agent
  const t = lastEventAt(lane.run)
  return t !== undefined && now - t < ACTIVE_MS ? 'active' : 'idle'
}

export const stateColour = (s: LaneState): ThemeKey =>
  s === 'needs-you' ? 'warning' : s === 'failed' || s === 'stalled' ? 'error'
    : s === 'running' || s === 'active' ? 'success' : s === 'done' ? 'merged' : 'subtle'

export type GroupKey = 'needs' | 'here' | 'other' | 'none' | 'failed' | 'done'
/**
 * `lanes` are the rows drawn. `hidden` counts the group's lanes not drawn: quiet ones for other
 * sessions and no driver, older-than-RECENT_MS ones for a collapsed done/failed group.
 * `collapsible` is true when the group has older lanes to reveal.
 */
export type LaneGroup = { key: GroupKey; label: string; lanes: Lane[]; total: number; collapsed: boolean; collapsible: boolean; hidden: number }

const GROUP_LABEL: Record<GroupKey, string> = {
  needs: 'Needs you', here: 'Driven here', other: 'Other sessions', none: 'No driver session', failed: 'Failed', done: 'Done',
}
export const COLLAPSIBLE: ReadonlySet<GroupKey> = new Set(['failed', 'done'])

function groupOf(lane: Lane, now: number): GroupKey {
  const s = laneState(lane, now)
  if (s === 'needs-you') return 'needs'
  if (s === 'failed') return 'failed'
  if (s === 'done') return 'done'
  return lane.driver
}

/**
 * Lanes in display groups. Needs-you and driven-here lanes always show; other sessions' and
 * driverless lanes show while their newest event is under RECENT_MS old (the rest are counted as
 * `hidden`); done and failed groups are collapsed unless opened. `showAll` shows everything open.
 */
const isRecent = (lane: Lane, now: number) => {
  const t = lane.run.endedAt ?? lastEventAt(lane.run)
  return t !== undefined && now - t < RECENT_MS
}

/**
 * Lanes in display groups. Needs-you and driven-here lanes always show. Other sessions' and
 * driverless lanes show while their newest event is under RECENT_MS old. Done and failed lanes
 * show while they finished under RECENT_MS ago; older ones collapse behind the group's toggle
 * unless it is opened. `showAll` shows everything.
 */
export function groupLanes(lanes: readonly Lane[], now: number, showAll: boolean, openGroups: readonly string[] = []): LaneGroup[] {
  const byKey = new Map<GroupKey, Lane[]>()
  for (const lane of lanes) {
    const k = groupOf(lane, now)
    byKey.set(k, [...(byKey.get(k) ?? []), lane])
  }
  const out: LaneGroup[] = []
  for (const key of ['needs', 'here', 'other', 'none', 'failed', 'done'] as GroupKey[]) {
    const all = byKey.get(key)
    if (!all?.length) continue
    const label = GROUP_LABEL[key]
    if (key === 'needs' || key === 'here' || showAll) {
      out.push({ key, label, lanes: all, total: all.length, collapsed: false, collapsible: false, hidden: 0 })
      continue
    }
    const recent = all.filter(l => isRecent(l, now))
    if (COLLAPSIBLE.has(key)) {
      const older = all.length - recent.length
      const open = openGroups.includes(key)
      const rows = open ? all : recent
      out.push({ key, label, lanes: rows, total: all.length, collapsed: older > 0 && !open, collapsible: older > 0, hidden: all.length - rows.length })
      continue
    }
    out.push({ key, label, lanes: recent, total: all.length, collapsed: false, collapsible: false, hidden: all.length - recent.length })
  }
  return out
}

/** The lanes drawn as rows, in display order. */
export const visibleLanes = (groups: readonly LaneGroup[]): Lane[] => groups.flatMap(g => g.lanes)

export function partition(lanes: Lane[], now: number, showAll = false, openGroups: readonly string[] = []): { shown: Lane[]; hidden: number } {
  const groups = groupLanes(lanes, now, showAll, openGroups)
  const shown = visibleLanes(groups)
  return { shown, hidden: lanes.length - shown.length }
}

/** The summary counts, one per part, each with the theme colour the pane draws it in. Zero counts are left out. */
export function summaryParts(lanes: readonly Lane[], now: number): { label: string; color: ThemeKey }[] {
  const n = (pred: (s: LaneState) => boolean) => lanes.filter(l => pred(laneState(l, now))).length
  const parts: { label: string; color: ThemeKey }[] = []
  const push = (count: number, label: string, color: ThemeKey) => { if (count) parts.push({ label: `${count} ${label}`, color }) }
  push(n(s => s === 'needs-you'), 'needs you', 'warning')
  push(n(s => s === 'running' || s === 'active'), 'running', 'success')
  push(n(s => s === 'stalled'), 'stalled', 'error')
  push(n(s => s === 'waiting' || s === 'idle'), 'idle', 'subtle')
  push(n(s => s === 'failed'), 'failed', 'error')
  push(n(s => s === 'done'), 'done', 'subtle')
  return parts
}

/** The status line: live work only (done lanes are not news). */
export function summarize(lanes: readonly Lane[], now: number): string | undefined {
  const parts = summaryParts(lanes.filter(l => laneState(l, now) !== 'done'), now)
  return parts.length ? 'fleet: ' + parts.map(p => p.label).join(' · ') : undefined
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

/** Which lane the detail shows: the viewed agent's, else the selected ticket's (even in a collapsed group), else the first shown. */
export function pickDetailLane(lanes: Lane[], selected: string | null, viewAgentId: string | undefined, showAll: boolean, now: number, openGroups: readonly string[] = []): Lane | undefined {
  if (viewAgentId) {
    const inView = lanes.find(l => l.agentId === viewAgentId)
    if (inView) return inView
  }
  return lanes.find(l => l.run.ticket === selected) ?? partition(lanes, now, showAll, openGroups).shown[0]
}

export const detailTicket = (lanes: Lane[], selected: string | null, viewAgentId: string | undefined, showAll: boolean, now: number): string | null =>
  pickDetailLane(lanes, selected, viewAgentId, showAll, now)?.run.ticket ?? null

export function fingerprint(lanes: Lane[], error: string | null, hidden = 0): string {
  const rows = lanes.map(l => [
    l.run.ticket, l.run.status, l.run.phase, l.run.cycle, l.run.gates.map(g => g.status).join(''),
    l.driver, l.agent ?? null, l.run.escalation?.escalationId ?? l.run.escalation?.raisedAt ?? null,
    l.run.timeline.at(-1)?.t ?? null, l.run.pendingAnswer !== null, l.run.currentAgent, l.run.prUrl ?? null, l.run.costUsd,
    l.run.ticket_meta?.fetchedAt ?? null, newestComments(l.run.ticket_meta?.comments ?? [], 1)[0]?.id ?? null, l.run.ticket_meta_error,
  ])
  return JSON.stringify([error, hidden, rows])
}

// ── Escalations ────────────────────────────────────────────────────────────────────────────────

/** Pre-CON-188 escalations carry no escalationId; ticket + raisedAt identifies them. */
export const escalationKey = (ticket: string, esc: Escalation): string => esc.escalationId ?? `${ticket}:${esc.raisedAt}`

/** An option without the label its raiser numbered it with: `a) x`, `(b) x`, `C. x`, `2) x`, `- x` → `x`. */
export const stripOption = (o: string): string => o.replace(/^\s*(?:\(?[A-Za-z]\)|[A-Za-z][.:]|\(?\d{1,2}[.)]|[-*•])\s+/, '').trim() || o.trim()

export type Question = { question: string; options: string[] }

/** The questions to answer: the sub-questions when there are any, else the one question. */
export function questionsOf(esc: Escalation): Question[] {
  const subs = esc.subQuestions ?? []
  if (subs.length) return subs.map(q => ({ question: q.question.trim(), options: q.options.map(stripOption) }))
  return [{ question: esc.question.trim(), options: esc.options.map(stripOption) }]
}

/** The line a toast or a collapsed card shows: the question, else the first sub-question, never empty. */
export const headline = (esc: Escalation): string =>
  esc.question.trim() || esc.subQuestions?.find(q => q.question.trim())?.question.trim() || `${esc.role ?? 'an agent'} escalated`

const ROLE_WORD: Record<string, string> = { skeptic: 'Skeptic', evaluator: 'Evaluator', executor: 'Executor', orchestrator: 'Orchestrator', auditor: 'Auditor' }
export function escalationTitle(esc: Escalation): string {
  const who = esc.role ? (ROLE_WORD[esc.role] ?? esc.role) : 'An agent'
  return esc.gate ? `${who} needs a ${esc.gate} call` : `${who} needs you`
}

export const emptyDraft = (n: number): AnswerDraft => ({ picks: Array.from({ length: n }, () => null), note: '' })

/** The draft sized to the questions (a stored draft from an older shape is padded or cut). */
export function draftFor(drafts: Readonly<Record<string, AnswerDraft>>, key: string, n: number): AnswerDraft {
  const d = drafts[key]
  if (!d) return emptyDraft(n)
  return { picks: Array.from({ length: n }, (_, i) => d.picks[i] ?? null), note: d.note ?? '' }
}

export const answeredCount = (d: AnswerDraft) => d.picks.filter(p => p != null && p.trim() !== '').length

/** The message the person sends the driver: their picks, their note, and what the driver does with them. */
export function draftMessage(ticket: string, esc: Escalation, draft: AnswerDraft): string {
  const qs = questionsOf(esc)
  const id = esc.escalationId ? ` (${esc.escalationId})` : ''
  const lines = [`Answer ${ticket}'s ${esc.role ?? ''} escalation${id}:`.replace('  ', ' ')]
  qs.forEach((q, i) => {
    const pick = draft.picks[i]?.trim() || '(no answer)'
    lines.push(qs.length > 1 ? `${i + 1}. ${q.question} → ${pick}` : `${q.question} → ${pick}`)
  })
  if (draft.note.trim()) lines.push(`Note: ${draft.note.trim()}`)
  lines.push(`Record it with \`concertino answer\` and resume the ${ticket} orchestrator.`)
  return lines.join('\n')
}
