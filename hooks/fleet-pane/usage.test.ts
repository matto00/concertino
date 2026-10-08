import { test, expect } from 'claude-code/testing'
import type { AgentInfo } from 'claude-code'
import {
  fmtTokens, fmtUsd, laneShare, laneUsd, limitColour, priceOf, recordTurn, resetLabel, ticketForAgent, tokensOf, weightOf, windowLabel,
} from './usage'

const u = (input: number, output: number, cacheWrite = 0, cacheRead = 0) =>
  ({ input_tokens: input, output_tokens: output, cache_creation_input_tokens: cacheWrite, cache_read_input_tokens: cacheRead })

test('priceOf: the most specific model wins; case-insensitive; suffixes ignored', async () => {
  expect(priceOf('claude-fable-5-1')).toEqual({ input: 10, output: 50, cacheRead: 0.25 })
  expect(priceOf('claude-fable-5')).toEqual({ input: 10, output: 50, cacheRead: 1 })
  expect(priceOf('claude-opus-5-5[1m]')).toEqual({ input: 4, output: 20, cacheRead: 0.2 })
  expect(priceOf('claude-opus-4-8')).toEqual({ input: 5, output: 25, cacheRead: 0.5 })
  expect(priceOf('claude-sonnet-5-5')).toEqual({ input: 2, output: 10, cacheRead: 0.1 })
  expect(priceOf('claude-sonnet-5')).toEqual({ input: 2, output: 10, cacheRead: 0.2 })
  expect(priceOf('Claude-SONNET-4-6')).toEqual({ input: 3, output: 15, cacheRead: 0.3 })
  expect(priceOf('claude-haiku-5-5')).toEqual({ input: 0.1, output: 0.5, cacheRead: 0.01 })
  expect(priceOf('claude-haiku-4-5')).toEqual({ input: 1, output: 5, cacheRead: 0.1 })
})

test('priceOf: an unknown model prices as the current Sonnet', async () => {
  expect(priceOf('gpt-x')).toEqual(priceOf('claude-sonnet-5-5'))
  expect(priceOf('')).toEqual(priceOf('claude-sonnet-5-5'))
})

test('priceOf: Haiku 5.5 switches to long-context prices only above 100K prompt tokens', async () => {
  expect(priceOf('claude-haiku-5-5', 100_000).input).toBe(0.1)
  expect(priceOf('claude-haiku-5-5', 100_001)).toEqual({ input: 0.5, output: 2.5, cacheRead: 0.05 })
  expect(priceOf('claude-haiku-4-5', 500_000).input).toBe(1)
})

test('weightOf: list-price dollars, cache writes at the 1-hour 2x rate', async () => {
  // 1M of each kind on Sonnet 5.5: $2 input + $10 output + $4 write + $0.10 read.
  expect(Math.abs(weightOf(u(1e6, 1e6, 1e6, 1e6), 'claude-sonnet-5-5') - 16.1)).toBeLessThan(1e-9)
  // Fable 5.1's reads are a quarter of Fable 5's.
  expect(Math.abs(weightOf(u(0, 0, 0, 1e6), 'claude-fable-5-1') - 0.25)).toBeLessThan(1e-9)
  expect(Math.abs(weightOf(u(0, 0, 0, 1e6), 'claude-fable-5') - 1)).toBeLessThan(1e-9)
  // The prompt size that picks Haiku 5.5's tier counts cached tokens too.
  expect(Math.abs(weightOf(u(1000, 0, 0, 200_000), 'claude-haiku-5-5') - ((1000 * 0.5 + 200_000 * 0.05) / 1e6))).toBeLessThan(1e-12)
  expect(weightOf(u(0, 0), 'claude-sonnet-5-5')).toBe(0)
})

test('tokensOf: every kind of token, unweighted', async () => {
  expect(tokensOf(u(1, 2, 3, 4))).toBe(10)
})

const ag = (id: string, parentId?: string): AgentInfo =>
  ({ id, description: 'd', type: 'general', status: 'running', ...(parentId ? { parentId } : {}) }) as AgentInfo

test('ticketForAgent: the orchestrator itself, or any descendant up the parentId chain', async () => {
  const agents = [ag('orch'), ag('child', 'orch'), ag('grandchild', 'child'), ag('other')]
  const known = { 'SBX-1': 'orch', 'SBX-2': 'orch2' }
  expect(ticketForAgent('orch', agents, known)).toBe('SBX-1')
  expect(ticketForAgent('child', agents, known)).toBe('SBX-1')
  expect(ticketForAgent('grandchild', agents, known)).toBe('SBX-1')
  // An orchestrator that dropped out of the list still maps by its own id.
  expect(ticketForAgent('orch2', agents, known)).toBe('SBX-2')
})

test('ticketForAgent: null for an unrelated agent, an unknown id, or a broken chain', async () => {
  const agents = [ag('orch'), ag('lost', 'gone'), ag('other')]
  const known = { 'SBX-1': 'orch' }
  expect(ticketForAgent('other', agents, known)).toBeNull()
  expect(ticketForAgent('nobody', agents, known)).toBeNull()
  expect(ticketForAgent('lost', agents, known)).toBeNull()
  expect(ticketForAgent('orch', agents, {})).toBeNull()
})

test('ticketForAgent: gives up after 16 hops and on a parent cycle', async () => {
  const chain = Array.from({ length: 20 }, (_, i) => ag(`a${i}`, i ? `a${i - 1}` : undefined))
  const known = { 'SBX-1': 'a0' }
  expect(ticketForAgent('a15', chain, known)).toBe('SBX-1')        // 15 hops up, checked on the 16th visit
  expect(ticketForAgent('a16', chain, known)).toBeNull()           // a0 is 16 hops away
  expect(ticketForAgent('x', [ag('x', 'y'), ag('y', 'x')], known)).toBeNull()
})

test('recordTurn: the meter always grows; a lane only when the turn has a ticket', async () => {
  const meter = { weight: 10, usdAtStart: 1 }
  const main = recordTurn(meter, { A: { tokens: 1, weight: 1, turns: 1 } }, null, 50, 5)
  expect(main).toEqual({ meter: { weight: 15, usdAtStart: 1 }, lanes: { A: { tokens: 1, weight: 1, turns: 1 } } })
  const lane = recordTurn(meter, { A: { tokens: 1, weight: 1, turns: 1 } }, 'A', 50, 5)
  expect(lane.lanes).toEqual({ A: { tokens: 51, weight: 6, turns: 2 } })
  expect(recordTurn(meter, {}, 'B', 7, 3).lanes).toEqual({ B: { tokens: 7, weight: 3, turns: 1 } })
  expect(meter).toEqual({ weight: 10, usdAtStart: 1 })              // inputs untouched
})

test('laneUsd: the cost since the meter started, times the lane\'s share of the weight', async () => {
  const lane = { tokens: 100, weight: 25, turns: 2 }
  const meter = { weight: 100, usdAtStart: 2 }
  expect(laneUsd(lane, meter, { rateLimits: [], usd: 6 })).toBe(1)
  expect(laneUsd(lane, meter, { rateLimits: [], usd: 1 })).toBe(0)  // never negative
})

test('laneUsd: null when the lane, the weight, the account, its usd or the start is missing', async () => {
  const lane = { tokens: 100, weight: 25, turns: 2 }
  const acct = { rateLimits: [], usd: 6 }
  expect(laneUsd(undefined, { weight: 100, usdAtStart: 2 }, acct)).toBeNull()
  expect(laneUsd(lane, { weight: 0, usdAtStart: 2 }, acct)).toBeNull()
  expect(laneUsd(lane, { weight: 100, usdAtStart: 2 }, null)).toBeNull()
  expect(laneUsd(lane, { weight: 100, usdAtStart: 2 }, { rateLimits: [], usd: null })).toBeNull()
  expect(laneUsd(lane, { weight: 100, usdAtStart: null }, acct)).toBeNull()
})

test('laneShare: weight over the meter; null without a lane or weight', async () => {
  expect(laneShare({ tokens: 1, weight: 30, turns: 1 }, { weight: 120, usdAtStart: null })).toBe(0.25)
  expect(laneShare(undefined, { weight: 120, usdAtStart: null })).toBeNull()
  expect(laneShare({ tokens: 1, weight: 30, turns: 1 }, { weight: 0, usdAtStart: null })).toBeNull()
})

test('fmtTokens: plain under 1k, one decimal under 10k, whole k under 1M, then M', async () => {
  expect(fmtTokens(0)).toBe('0')
  expect(fmtTokens(999)).toBe('999')
  expect(fmtTokens(1000)).toBe('1.0k')
  expect(fmtTokens(1500)).toBe('1.5k')
  expect(fmtTokens(15000)).toBe('15k')
  expect(fmtTokens(250_400)).toBe('250k')
  expect(fmtTokens(1_200_000)).toBe('1.2M')
})

test('fmtUsd: cents under $10, whole dollars from $10', async () => {
  expect(fmtUsd(0)).toBe('$0.00')
  expect(fmtUsd(1.844)).toBe('$1.84')
  expect(fmtUsd(9.5)).toBe('$9.50')
  expect(fmtUsd(10)).toBe('$10')
  expect(fmtUsd(123.6)).toBe('$124')
})

test('windowLabel and limitColour', async () => {
  expect(windowLabel('five_hour')).toBe('5h')
  expect(windowLabel('seven_day')).toBe('7d')
  expect(windowLabel('spend_limit')).toBe('spend')
  expect(windowLabel('seven_day_opus')).toBe('seven day opus')
  expect(limitColour(95)).toBe('error')
  expect(limitColour(90)).toBe('error')
  expect(limitColour(89.9)).toBe('warning')
  expect(limitColour(70)).toBe('warning')
  expect(limitColour(69)).toBe('subtle')
})

test('resetLabel: "resets HH:MM" the same day, with the weekday otherwise, empty when missing or invalid', async () => {
  // Built from local dates so the test holds in any timezone. 7 October 2026 is a Wednesday.
  const now = new Date(2026, 9, 7, 10, 0).getTime()
  expect(resetLabel(new Date(2026, 9, 7, 22, 5).toISOString(), now)).toBe('resets 22:05')
  expect(resetLabel(new Date(2026, 9, 9, 9, 0).toISOString(), now)).toBe('resets Fri 09:00')
  expect(resetLabel(undefined, now)).toBe('')
  expect(resetLabel('', now)).toBe('')
  expect(resetLabel('not a date', now)).toBe('')
})

// Regressions.
test('fmtTokens: the unit is picked after rounding', () => {
  expect(fmtTokens(9_999)).toBe('10k')
  expect(fmtTokens(9_940)).toBe('9.9k')
  expect(fmtTokens(999_999)).toBe('1.0M')
  expect(fmtTokens(999.6)).toBe('1.0k')
})

test('ticketForAgent: an orchestrator not yet in the map is named from its own name or description', () => {
  const agents = [
    { id: 'o9', type: 'concertino:concertino-orchestrator', description: 'SBX-3 orchestrator', status: 'running' },
    { id: 'x1', type: 'concertino-executor', description: 'executor', status: 'running', parentId: 'o9' },
  ] as never
  expect(ticketForAgent('x1', agents, {}, ['SBX-3', 'SBX-30'])).toBe('SBX-3')
  expect(ticketForAgent('x1', agents, {}, ['SBX-30'])).toBeNull()
})
