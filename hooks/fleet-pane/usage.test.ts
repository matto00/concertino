import { test, expect } from 'claude-code/testing'
import type { AgentInfo } from 'claude-code'
import {
  familyRate, fmtTokens, fmtUsd, laneShare, laneUsd, limitColour, recordTurn, resetLabel, ticketForAgent, tokensOf, weightOf, windowLabel,
} from './usage'

const u = (input: number, output: number, cacheWrite = 0, cacheRead = 0) =>
  ({ input_tokens: input, output_tokens: output, cache_creation_input_tokens: cacheWrite, cache_read_input_tokens: cacheRead })

test('familyRate: opus 5, sonnet 3, haiku 1, anything else 3; case-insensitive', async () => {
  expect(familyRate('claude-opus-5-5')).toBe(5)
  expect(familyRate('claude-sonnet-4-5')).toBe(3)
  expect(familyRate('Claude-HAIKU-4')).toBe(1)
  expect(familyRate('gpt-x')).toBe(3)
  expect(familyRate('')).toBe(3)
})

test('weightOf: input + 5x output + 1.25x cache writes + 0.1x cache reads, times the family rate', async () => {
  expect(weightOf(u(100, 10, 40, 1000), 'claude-haiku')).toBe(100 + 50 + 50 + 100)
  expect(weightOf(u(100, 10, 40, 1000), 'claude-opus')).toBe(5 * 300)
  expect(weightOf(u(0, 0), 'claude-sonnet')).toBe(0)
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
