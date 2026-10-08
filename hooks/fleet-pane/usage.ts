// Pure: what the fleet costs on a subscription. The session's own figures ($.session.usage():
// rate-limit windows and the API-equivalent cost /cost totals) plus each lane's share, from the
// token usage every subagent turn reports, attributed up the parentId chain to its orchestrator.
import type { AgentInfo, ThemeKey } from 'claude-code'
import type { AccountUsage, LaneUsage, UsageMeter } from '../../types'
import { isOrchestratorType, ticketWord } from './lanes'

type Tokens = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }

/** List prices in dollars per million tokens: input, output, and cache read. */
export type Price = { input: number; output: number; cacheRead: number }

/**
 * Per-model list prices (platform.claude.com/docs/en/about-claude/pricing, read 2026-10-08), most
 * specific pattern first. Cache reads are not one multiplier: 0.025x on Fable 5.1, 0.05x on Opus 5.5
 * and Sonnet 5.5, 0.1x elsewhere. Only ratios matter, since a lane's dollars are its weighted share
 * of the session's own cost, but those ratios moved enough between models to need a table.
 */
const PRICES: [RegExp, Price][] = [
  [/(fable|mythos)-5-1/i, { input: 10, output: 50, cacheRead: 0.25 }],
  [/fable|mythos/i, { input: 10, output: 50, cacheRead: 1 }],
  [/opus-5-5/i, { input: 4, output: 20, cacheRead: 0.2 }],
  [/opus/i, { input: 5, output: 25, cacheRead: 0.5 }],
  [/sonnet-5-5/i, { input: 2, output: 10, cacheRead: 0.1 }],
  [/sonnet-5/i, { input: 2, output: 10, cacheRead: 0.2 }],
  [/sonnet/i, { input: 3, output: 15, cacheRead: 0.3 }],
  [/haiku-5-5/i, { input: 0.1, output: 0.5, cacheRead: 0.01 }],
  [/haiku/i, { input: 1, output: 5, cacheRead: 0.1 }],
]
const FALLBACK: Price = { input: 2, output: 10, cacheRead: 0.1 }

/** Haiku 5.5 bills a prompt over this many tokens at its long-context prices. */
const HAIKU_LONG_PROMPT = 100_000
const HAIKU_LONG: Price = { input: 0.5, output: 2.5, cacheRead: 0.05 }

/** A model's prices for a prompt of `promptTokens`; an unknown model prices as the current Sonnet. */
export function priceOf(model: string, promptTokens = 0): Price {
  const price = PRICES.find(([re]) => re.test(model))?.[1] ?? FALLBACK
  return /haiku-5-5/i.test(model) && promptTokens > HAIKU_LONG_PROMPT ? HAIKU_LONG : price
}

/**
 * Cache writes at the 1-hour rate, 2x input: the TTL Claude Code requests. A turn's usage does
 * not split writes by TTL, so a 5-minute write (1.25x) is over-weighted rather than guessed at.
 */
const CACHE_WRITE = 2

/** A turn's list-price dollars. Fast mode's premium is not visible in a turn's usage, so it is not priced. */
export function weightOf(u: Tokens, model: string): number {
  const p = priceOf(model, u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens)
  const dollars = u.input_tokens * p.input + u.output_tokens * p.output
    + u.cache_creation_input_tokens * p.input * CACHE_WRITE + u.cache_read_input_tokens * p.cacheRead
  return dollars / 1_000_000
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
