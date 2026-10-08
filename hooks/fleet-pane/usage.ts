// Pure: what the fleet costs on a subscription. The session's own figures ($.session.usage():
// rate-limit windows and the API-equivalent cost /cost totals) plus each lane's share, from the
// token usage every subagent turn reports, attributed up the parentId chain to its orchestrator.
import type { AgentInfo, ThemeKey } from 'claude-code'
import type { AccountUsage, LaneUsage, UsageMeter } from '../../types'
import { isOrchestratorType, ticketWord } from './lanes'

type Tokens = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }

/**
 * Relative input price by model family. Only ratios matter: a lane's dollars are its weighted
 * share of the session's own cost, so no absolute price table can go stale.
 */
const FAMILY: [RegExp, number][] = [[/opus/i, 5], [/sonnet/i, 3], [/haiku/i, 1]]
export const familyRate = (model: string) => FAMILY.find(([re]) => re.test(model))?.[1] ?? 3

/** A turn's weight in input-token units at its model's rate: output 5x, cache writes 1.25x, cache reads 0.1x. */
export function weightOf(u: Tokens, model: string): number {
  const units = u.input_tokens + 5 * u.output_tokens + 1.25 * u.cache_creation_input_tokens + 0.1 * u.cache_read_input_tokens
  return units * familyRate(model)
}

export const tokensOf = (u: Tokens) => u.input_tokens + u.output_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens

/**
 * The ticket an agent's turn counts toward: walk `parentId` up from the agent until an
 * orchestrator this pane matched to a ticket, or one whose name names a known ticket. Null for
 * the main loop or an unrelated agent.
 */
export function ticketForAgent(
  agentId: string, agents: readonly AgentInfo[], orchestrators: Readonly<Record<string, string>>, tickets: readonly string[] = [],
): string | null {
  const byId = new Map(agents.map(a => [a.id, a]))
  const ticketById = new Map(Object.entries(orchestrators).map(([ticket, id]) => [id, ticket]))
  let id: string | undefined = agentId
  for (let hops = 0; id && hops < 16; hops++) {
    const known = ticketById.get(id)
    if (known) return known
    // An orchestrator the poll has not matched yet (dispatched seconds ago): name it from its own
    // name or description, the same whole-word rule the poll uses.
    const agent = byId.get(id)
    if (agent && isOrchestratorType(agent.type)) {
      const hit = tickets.find(t => ticketWord(t).test(agent.name ?? '') || ticketWord(t).test(agent.description ?? ''))
      if (hit) return hit.toUpperCase()
    }
    id = agent?.parentId
  }
  return null
}

/** Adds one turn to the meter and, when it belongs to a lane, to that lane. */
export function recordTurn(meter: UsageMeter, lanes: Readonly<Record<string, LaneUsage>>, ticket: string | null, tokens: number, weight: number):
  { meter: UsageMeter; lanes: Record<string, LaneUsage> } {
  const next = { ...meter, weight: meter.weight + weight }
  if (!ticket) return { meter: next, lanes: { ...lanes } }
  const was = lanes[ticket] ?? { tokens: 0, weight: 0, turns: 0 }
  return { meter: next, lanes: { ...lanes, [ticket]: { tokens: was.tokens + tokens, weight: was.weight + weight, turns: was.turns + 1 } } }
}

/**
 * A lane's API-equivalent dollars: its weight's share of everything metered, times the cost
 * the session accrued since the meter started. Null until both are known.
 */
export function laneUsd(lane: LaneUsage | undefined, meter: UsageMeter, account: AccountUsage | null): number | null {
  if (!lane || meter.weight <= 0 || !account || account.usd == null || meter.usdAtStart == null) return null
  return Math.max(0, account.usd - meter.usdAtStart) * (lane.weight / meter.weight)
}

export const laneShare = (lane: LaneUsage | undefined, meter: UsageMeter) =>
  lane && meter.weight > 0 ? lane.weight / meter.weight : null

export function fmtTokens(n: number): string {
  // Pick the unit after rounding, so 9,999 reads "10k" and 999,999 reads "1.0M".
  const k = n / 1000
  if (Math.round(n) < 1000) return String(Math.round(n))
  if (Number(k.toFixed(k < 9.95 ? 1 : 0)) < 1000) return `${k.toFixed(k < 9.95 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

export const fmtUsd = (n: number) => (n < 10 ? `$${n.toFixed(2)}` : `$${Math.round(n)}`)

const WINDOW: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: 'spend' }
export const windowLabel = (kind: string) => WINDOW[kind] ?? kind.replace(/_/g, ' ')

export const limitColour = (pct: number): ThemeKey => (pct >= 90 ? 'error' : pct >= 70 ? 'warning' : 'subtle')

/** "resets 22:00" today, "resets Thu 09:00" later; empty when unknown. */
export function resetLabel(iso: string | undefined, now: number): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const d = new Date(t)
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const sameDay = new Date(now).toDateString() === d.toDateString()
  return `resets ${sameDay ? '' : `${d.toLocaleDateString('en-US', { weekday: 'short' })} `}${hm}`
}
