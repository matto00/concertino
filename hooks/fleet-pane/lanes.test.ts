import { test, expect } from 'claude-code/testing'
import type { AgentInfo, SessionMessage } from 'claude-code'
import type { Escalation, Lane, Run } from '../../types'
import {
  ACTIVE_MS, RECENT_MS, agentFactOf, agentIdsByTicket, answeredCount, correlate, detailTicket, draftFor, draftMessage,
  driverOf, emptyDraft, escalationKey, escalationTitle, fingerprint, groupLanes, headline, isOrchestratorType, laneState,
  matchAgents, newestComments, partition, pickDetailLane, questionsOf, rememberAgents, stateColour, stripOption,
  summarize, summaryParts, visibleLanes,
} from './lanes'

const NOW = 10 * 3_600_000
const MIN = 60_000

const run = (over: Partial<Run>): Run => ({
  ticket: 'CON-1', changeName: null, branch: null, worktree: null, phase: null, cycle: null, gates: [],
  lastVerdict: null, escalation: null, costUsd: null, startedAt: null, endedAt: null, endStatus: null,
  elapsedMs: null, status: 'unknown', malformed: 0, ticket_doc: { title: null, excerpt: null },
  pendingAnswer: null, timeline: [], currentAgent: null, ticket_meta: null, ticket_meta_error: null, ...over,
})

/** A run whose newest event is `min` minutes before NOW. */
const at = (min: number, over: Partial<Run> = {}): Run => run({ timeline: [{ t: NOW - min * MIN, kind: 'phase.enter' }], ...over })

const lane = (r: Run, driver: Lane['driver'], agent?: Lane['agent']): Lane => ({ run: r, driver, ...(agent ? { agent } : {}) })

const orch = (id: string, status: AgentInfo['status'], name?: string, description = 'd', type = 'concertino-orchestrator'): AgentInfo =>
  ({ id, description, type, status, ...(name !== undefined ? { name } : {}) }) as AgentInfo

const promptCall = (id: string, prompt: string, subagent_type = 'concertino-orchestrator'): SessionMessage => ({
  role: 'assistant', text: '',
  toolUses: [{ tool_use_id: 'tu-' + id, tool: 'Agent', agentId: id, input: { subagent_type, prompt } }],
}) as unknown as SessionMessage

const esc = (over: Partial<Escalation> = {}): Escalation =>
  ({ question: 'Which cache?', options: ['a) Map-based LRU', 'b) lru-cache package'], raisedAt: NOW - 5 * MIN, escalationId: 'e1', role: 'skeptic', ...over })

// ── agent type and the transcript fallback ────────────────────────────────────────────────────

test('isOrchestratorType: bare and plugin-namespaced types match; others and non-strings do not', async () => {
  expect(isOrchestratorType('concertino-orchestrator')).toBe(true)
  expect(isOrchestratorType('concertino:concertino-orchestrator')).toBe(true)
  expect(isOrchestratorType('some-plugin:concertino-orchestrator')).toBe(true)
  expect(isOrchestratorType('concertino-orchestrator-v2')).toBe(false)
  expect(isOrchestratorType('xconcertino-orchestrator')).toBe(false)
  expect(isOrchestratorType('Explore')).toBe(false)
  expect(isOrchestratorType(undefined)).toBe(false)
  expect(isOrchestratorType(42)).toBe(false)
})

test('agentIdsByTicket: the real orchestrator prompt shapes all map; newest call wins', async () => {
  const map = agentIdsByTicket([
    promptCall('old', 'TICKET_ID=HEL-1027.'),
    promptCall('a', 'TICKET_ID=HEL-1027. AGENT_MERGE_OVERRIDE=1'),
    promptCall('b', 'TICKET_ID=`HEL-1028`. SPEED=fast'),
    promptCall('c', 'TICKET_ID: HEL-1029 go'),
    promptCall('d', 'TICKET_ID=#123. AGENT_MERGE_OVERRIDE='),
    promptCall('e', 'TICKET_ID=`a_b_c-9`.'),
    promptCall('f', 'TICKET_ID=PROJ-SUB-12 RESUME', 'concertino:concertino-orchestrator'),
  ])
  expect([...map.entries()]).toEqual([['HEL-1027', 'a'], ['HEL-1028', 'b'], ['HEL-1029', 'c'], ['#123', 'd'], ['A_B_C-9', 'e'], ['PROJ-SUB-12', 'f']])
})

test('agentIdsByTicket: ignores Agent calls that are not the orchestrator and non-Agent tools', async () => {
  const bash = { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'x', tool: 'Bash', input: { command: 'echo TICKET_ID=CON-9' } }] } as unknown as SessionMessage
  expect([...agentIdsByTicket([promptCall('x', 'TICKET_ID=CON-1', 'Explore'), bash]).keys()]).toEqual([])
})

// ── matchAgents ────────────────────────────────────────────────────────────────────────────────

test('matchAgents: an orchestrator in the agent list is matched by its name or description, case-insensitively', async () => {
  const runs = [run({ ticket: 'SBX-1' }), run({ ticket: 'SBX-2' })]
  const got = matchAgents(runs, [orch('n', 'running', 'sbx-1'), orch('d', 'running', undefined, 'SBX-2 orchestrator')], new Map(), {})
  expect([...got.entries()]).toEqual([['SBX-1', 'n'], ['SBX-2', 'd']])
})

test('matchAgents: a namespaced orchestrator type matches; a non-orchestrator agent naming the ticket does not', async () => {
  const runs = [run({ ticket: 'SBX-1' })]
  expect(matchAgents(runs, [orch('ns', 'running', 'SBX-1', 'd', 'concertino:concertino-orchestrator')], new Map(), {}).get('SBX-1')).toBe('ns')
  expect(matchAgents(runs, [orch('ex', 'running', 'SBX-1', 'SBX-1 explore', 'Explore')], new Map(), {}).size).toBe(0)
})

test('matchAgents: SBX-3 does not match an agent named for SBX-30, nor a ticket with a prefix', async () => {
  const runs = [run({ ticket: 'SBX-3' })]
  expect(matchAgents(runs, [orch('x', 'running', 'SBX-30', 'SBX-30 orchestrator')], new Map(), {}).size).toBe(0)
  expect(matchAgents(runs, [orch('y', 'running', 'XSBX-3')], new Map(), {}).size).toBe(0)
  // Regression: nor a longer id that continues with a dash.
  expect(matchAgents(runs, [orch('w', 'running', 'SBX-3-2', 'SBX-3-2 orchestrator')], new Map(), {}).size).toBe(0)
  expect(matchAgents([run({ ticket: 'PROJ-SUB-1' })], [orch('p', 'running', 'PROJ-SUB-12')], new Map(), {}).size).toBe(0)
  expect(matchAgents(runs, [orch('v', 'running', undefined, 'SBX-3 - deliver')], new Map(), {}).get('SBX-3')).toBe('v')
  expect(matchAgents(runs, [orch('z', 'running', undefined, 'deliver SBX-3.')], new Map(), {}).get('SBX-3')).toBe('z')
  // With both listed, the one naming SBX-3 itself wins.
  expect(matchAgents(runs, [orch('x', 'running', 'SBX-30'), orch('z', 'running', 'SBX-3')], new Map(), {}).get('SBX-3')).toBe('z')
})

test('matchAgents: a live orchestrator is preferred over an ended one, whatever the order', async () => {
  const runs = [run({ ticket: 'SBX-1' })]
  expect(matchAgents(runs, [orch('live', 'running', 'SBX-1'), orch('dead', 'completed', 'SBX-1')], new Map(), {}).get('SBX-1')).toBe('live')
  expect(matchAgents(runs, [orch('dead', 'killed', 'SBX-1'), orch('live', 'waiting', 'SBX-1')], new Map(), {}).get('SBX-1')).toBe('live')
  // Only ended ones: the newest (last) listed.
  expect(matchAgents(runs, [orch('d1', 'failed', 'SBX-1'), orch('d2', 'completed', 'SBX-1')], new Map(), {}).get('SBX-1')).toBe('d2')
})

test('matchAgents: the list wins over the transcript, the transcript over the remembered id', async () => {
  const runs = [run({ ticket: 'sbx-1' })]
  const transcript = new Map([['SBX-1', 'from-transcript']])
  const known = { 'SBX-1': 'remembered' }
  expect(matchAgents(runs, [orch('listed', 'running', 'SBX-1')], transcript, known).get('SBX-1')).toBe('listed')
  expect(matchAgents(runs, [], transcript, known).get('SBX-1')).toBe('from-transcript')
  expect(matchAgents(runs, [], new Map(), known).get('SBX-1')).toBe('remembered')
  expect(matchAgents(runs, [], new Map(), {}).size).toBe(0)
})

// ── driver and agent facts ─────────────────────────────────────────────────────────────────────

test('driverOf: driverSession is authoritative; only without one does an agent match imply here', async () => {
  expect(driverOf(run({ driverSession: 'me' }), 'me', false)).toBe('here')
  expect(driverOf(run({ driverSession: 'me' }), 'me', true)).toBe('here')
  // Regression: a match (e.g. a remembered id) no longer makes another session's run "here".
  expect(driverOf(run({ driverSession: 'them' }), 'me', true)).toBe('other')
  expect(driverOf(run({ driverSession: 'me' }), null, true)).toBe('other')
  expect(driverOf(run({ driverSession: null }), 'me', true)).toBe('here')
  expect(driverOf(run({}), null, true)).toBe('here')
  expect(driverOf(run({ driverSession: 'them' }), 'me', false)).toBe('other')
  expect(driverOf(run({ driverSession: 'them' }), null, false)).toBe('other')
  expect(driverOf(run({ driverSession: null }), 'me', false)).toBe('none')
  expect(driverOf(run({}), 'me', false)).toBe('none')
})

test('agentFactOf: unseen without a match; stalled when ended or dropped; waiting for waiting/idle; else running', async () => {
  expect(agentFactOf('running', false)).toBe('unseen')
  expect(agentFactOf(undefined, true)).toBe('stalled')
  for (const s of ['completed', 'failed', 'killed'] as const) expect(agentFactOf(s, true)).toBe('stalled')
  expect(agentFactOf('waiting', true)).toBe('waiting')
  expect(agentFactOf('idle', true)).toBe('waiting')
  expect(agentFactOf('running', true)).toBe('running')
  expect(agentFactOf('pending', true)).toBe('running')
})

test('correlate: driver from the session id, agent fact only for live lanes driven here', async () => {
  const lanes = correlate([
    run({ ticket: 'HERE', driverSession: 'me' }),
    run({ ticket: 'MATCHED' }),
    run({ ticket: 'OTHER', driverSession: 'them' }),
    run({ ticket: 'NONE' }),
    run({ ticket: 'ENDED', driverSession: 'me', endStatus: 'done', status: 'done' }),
  ], [orch('m', 'waiting', 'MATCHED')], 'me', new Map())
  const by = Object.fromEntries(lanes.map(l => [l.run.ticket, l]))
  expect(by['HERE']).toMatchObject({ driver: 'here', agent: 'unseen' })
  expect(by['HERE']!.agentId).toBeUndefined()
  expect(by['MATCHED']).toMatchObject({ driver: 'here', agent: 'waiting', agentId: 'm', agentStatus: 'waiting' })
  expect(by['OTHER']).toEqual({ run: by['OTHER']!.run, driver: 'other' })
  expect(by['NONE']).toEqual({ run: by['NONE']!.run, driver: 'none' })
  expect(by['ENDED']).toMatchObject({ driver: 'here' })
  expect(by['ENDED']!.agent).toBeUndefined()
})

test('correlate: a remembered agent that dropped out of the list reads stalled, not unseen', async () => {
  const [lane] = correlate([run({ ticket: 'SBX-1', driverSession: 'me' })], [], 'me', new Map(), { 'SBX-1': 'gone' })
  expect(lane).toMatchObject({ driver: 'here', agent: 'stalled', agentId: 'gone' })
  expect(lane!.agentStatus).toBeUndefined()
})

test('correlate: regression: a remembered agent does not claim a run another session now drives', async () => {
  const [lane] = correlate([run({ ticket: 'SBX-1', driverSession: 'them' })], [], 'me', new Map(), { 'SBX-1': 'old' })
  expect(lane!.driver).toBe('other')
  expect(lane!.agent).toBeUndefined()
})

test('correlate: a matched orchestrator that completed while the run has no run.end is stalled', async () => {
  const [lane] = correlate([run({ ticket: 'SBX-1', status: 'running' })], [orch('a', 'completed', 'SBX-1')], 'me', new Map())
  expect(lane).toMatchObject({ driver: 'here', agent: 'stalled', agentStatus: 'completed' })
})

test('correlate: orders needs-you, then running/unknown, then failed, then done; ties keep input order', async () => {
  const lanes = correlate([
    run({ ticket: 'D', status: 'done' }), run({ ticket: 'F', status: 'failed' }), run({ ticket: 'U1', status: 'unknown' }),
    run({ ticket: 'N', status: 'needs-you' }), run({ ticket: 'R', status: 'running' }), run({ ticket: 'U2', status: 'unknown' }),
  ], [], null, new Map())
  expect(lanes.map(l => l.run.ticket)).toEqual(['N', 'U1', 'R', 'U2', 'F', 'D'])
})

test('rememberAgents: merges matched ids over what was known, keyed upper-case', async () => {
  const lanes: Lane[] = [{ run: run({ ticket: 'sbx-1' }), driver: 'here', agentId: 'a' }, { run: run({ ticket: 'SBX-2' }), driver: 'none' }]
  expect(rememberAgents({ 'SBX-9': 'z' }, lanes)).toEqual({ 'SBX-9': 'z', 'SBX-1': 'a' })
})

// ── laneState ──────────────────────────────────────────────────────────────────────────────────

test('laneState: the run status wins for needs-you, failed and done; run.end reads done', async () => {
  expect(laneState(lane(run({ status: 'needs-you' }), 'here', 'stalled'), NOW)).toBe('needs-you')
  expect(laneState(lane(run({ status: 'failed' }), 'here', 'running'), NOW)).toBe('failed')
  expect(laneState(lane(run({ status: 'done' }), 'other'), NOW)).toBe('done')
  expect(laneState(lane(run({ status: 'unknown', endStatus: 'merged' }), 'none'), NOW)).toBe('done')
})

test('laneState: driven here follows the agent fact; unseen and missing read idle', async () => {
  expect(laneState(lane(run({ status: 'running' }), 'here', 'running'), NOW)).toBe('running')
  expect(laneState(lane(run({ status: 'running' }), 'here', 'waiting'), NOW)).toBe('waiting')
  expect(laneState(lane(run({ status: 'running' }), 'here', 'stalled'), NOW)).toBe('stalled')
  expect(laneState(lane(run({ status: 'running' }), 'here', 'unseen'), NOW)).toBe('idle')
  expect(laneState(lane(run({ status: 'running' }), 'here'), NOW)).toBe('idle')
})

test('laneState: other and none are active while the newest event is under ACTIVE_MS old, else idle', async () => {
  expect(ACTIVE_MS).toBe(5 * MIN)
  for (const d of ['other', 'none'] as const) {
    expect(laneState(lane(at(4), d), NOW)).toBe('active')
    expect(laneState(lane(at(6), d), NOW)).toBe('idle')
    expect(laneState(lane(run({}), d), NOW)).toBe('idle')
  }
  // The newest event is the last one in the timeline.
  const r = run({ timeline: [{ t: NOW - 60 * MIN, kind: 'run.start' }, { t: NOW - MIN, kind: 'phase.enter' }] })
  expect(laneState(lane(r, 'other'), NOW)).toBe('active')
})

test('stateColour: a theme key per state', async () => {
  expect(stateColour('needs-you')).toBe('warning')
  expect(stateColour('failed')).toBe('error')
  expect(stateColour('stalled')).toBe('error')
  expect(stateColour('running')).toBe('success')
  expect(stateColour('active')).toBe('success')
  expect(stateColour('done')).toBe('merged')
  expect(stateColour('idle')).toBe('subtle')
  expect(stateColour('waiting')).toBe('subtle')
})

// ── groups and visibility ──────────────────────────────────────────────────────────────────────

test('groupLanes: groups in order Needs you, Driven here, Other sessions, No driver session, Failed, Done', async () => {
  const lanes = [
    lane(at(1, { ticket: 'D', status: 'done' }), 'here'),
    lane(at(1, { ticket: 'F', status: 'failed' }), 'other'),
    lane(at(1, { ticket: 'NONE' }), 'none'),
    lane(at(1, { ticket: 'O' }), 'other'),
    lane(at(1, { ticket: 'H' }), 'here', 'running'),
    lane(at(1, { ticket: 'N', status: 'needs-you' }), 'other'),
  ]
  const groups = groupLanes(lanes, NOW, false)
  expect(groups.map(g => [g.key, g.label])).toEqual([
    ['needs', 'Needs you'], ['here', 'Driven here'], ['other', 'Other sessions'], ['none', 'No driver session'], ['failed', 'Failed'], ['done', 'Done'],
  ])
  expect(groups.map(g => g.lanes.map(l => l.run.ticket))).toEqual([['N'], ['H'], ['O'], ['NONE'], ['F'], ['D']])
})

test('groupLanes: needs-you and driven-here lanes show however old; other and none hide after RECENT_MS, counted', async () => {
  expect(RECENT_MS).toBe(30 * MIN)
  const lanes = [
    lane(at(600, { ticket: 'N', status: 'needs-you' }), 'none'),
    lane(at(600, { ticket: 'H' }), 'here', 'stalled'),
    lane(at(29, { ticket: 'O-NEW' }), 'other'),
    lane(at(31, { ticket: 'O-OLD' }), 'other'),
    lane(run({ ticket: 'O-NOEV' }), 'other'),
    lane(at(31, { ticket: 'X-OLD' }), 'none'),
  ]
  const groups = groupLanes(lanes, NOW, false)
  const g = Object.fromEntries(groups.map(x => [x.key, x]))
  expect(g['needs']!.lanes.map(l => l.run.ticket)).toEqual(['N'])
  expect(g['here']!.lanes.map(l => l.run.ticket)).toEqual(['H'])
  expect(g['other']).toMatchObject({ hidden: 2, total: 3, collapsed: false, collapsible: false })
  expect(g['other']!.lanes.map(l => l.run.ticket)).toEqual(['O-NEW'])
  // A group whose every lane is hidden still stands, to carry the count.
  expect(g['none']).toMatchObject({ hidden: 1, lanes: [] })
  // showAll shows them all, nothing hidden.
  const all = Object.fromEntries(groupLanes(lanes, NOW, true).map(x => [x.key, x]))
  expect(all['other']).toMatchObject({ hidden: 0 })
  expect(all['other']!.lanes).toHaveLength(3)
  expect(all['none']!.lanes).toHaveLength(1)
})

test('groupLanes: done and failed that finished under RECENT_MS ago are drawn, not collapsible', async () => {
  const lanes = [lane(at(1, { ticket: 'D', status: 'done' }), 'here'), lane(at(29, { ticket: 'F', status: 'failed' }), 'none')]
  const groups = groupLanes(lanes, NOW, false)
  expect(groups.map(g => [g.key, g.lanes.length, g.total, g.collapsed, g.collapsible, g.hidden]))
    .toEqual([['failed', 1, 1, false, false, 0], ['done', 1, 1, false, false, 0]])
  expect(visibleLanes(groups).map(l => l.run.ticket)).toEqual(['F', 'D'])
})

test('groupLanes: endedAt, not the newest event, says when a run finished', async () => {
  // The newest event is recent but the run ended long ago: older, so behind the toggle.
  const old = lane(at(1, { ticket: 'D', status: 'done', endedAt: NOW - 90 * MIN }), 'none')
  expect(groupLanes([old], NOW, false)[0]).toMatchObject({ lanes: [], total: 1, collapsed: true, collapsible: true, hidden: 1 })
  // The newest event is old but the run ended a minute ago: drawn.
  const recent = lane(at(90, { ticket: 'D', status: 'done', endedAt: NOW - MIN }), 'none')
  expect(groupLanes([recent], NOW, false)[0]).toMatchObject({ total: 1, collapsed: false, collapsible: false, hidden: 0 })
})

test('groupLanes: older done lanes hide behind the toggle; opening it draws them all', async () => {
  const lanes = [
    lane(at(1, { ticket: 'NEW', status: 'done' }), 'here'), lane(at(90, { ticket: 'OLD1', status: 'done' }), 'none'),
    lane(at(300, { ticket: 'OLD2', status: 'done' }), 'other'),
  ]
  const closed = groupLanes(lanes, NOW, false)
  expect(closed).toHaveLength(1)
  expect(closed[0]).toMatchObject({ key: 'done', label: 'Done', total: 3, collapsed: true, collapsible: true, hidden: 2 })
  expect(visibleLanes(closed).map(l => l.run.ticket)).toEqual(['NEW'])
  const opened = groupLanes(lanes, NOW, false, ['done'])
  expect(opened[0]).toMatchObject({ total: 3, collapsed: false, collapsible: true, hidden: 0 })
  expect(visibleLanes(opened).map(l => l.run.ticket)).toEqual(['NEW', 'OLD1', 'OLD2'])
  // Opening another group leaves this one closed.
  expect(groupLanes(lanes, NOW, false, ['failed'])[0]).toMatchObject({ collapsed: true })
})

test('groupLanes: showAll draws every lane and nothing is collapsible', async () => {
  const lanes = [lane(at(90, { ticket: 'D', status: 'done' }), 'none'), lane(at(90, { ticket: 'F', status: 'failed' }), 'none'), lane(at(90, { ticket: 'O' }), 'other')]
  const groups = groupLanes(lanes, NOW, true)
  expect(groups.every(g => !g.collapsed && !g.collapsible && g.hidden === 0)).toBe(true)
  expect(visibleLanes(groups).map(l => l.run.ticket)).toEqual(['O', 'F', 'D'])
})

test('groupLanes: no lanes, no groups', async () => {
  expect(groupLanes([], NOW, false)).toEqual([])
})

test('partition: shown in display order; hidden counts quiet and collapsed lanes', async () => {
  const lanes = [
    lane(at(1, { ticket: 'A' }), 'other'), lane(at(60, { ticket: 'B' }), 'other'),
    lane(at(90, { ticket: 'C', status: 'done' }), 'none'), lane(at(500, { ticket: 'D' }), 'here', 'running'),
  ]
  const { shown, hidden } = partition(lanes, NOW)
  expect(shown.map(l => l.run.ticket)).toEqual(['D', 'A'])
  expect(hidden).toBe(2)
  expect(partition(lanes, NOW, true).hidden).toBe(0)
})

// ── summaries ──────────────────────────────────────────────────────────────────────────────────

test('summaryParts: counts with colours, zero counts left out', async () => {
  const lanes = [
    lane(at(1, { ticket: 'N', status: 'needs-you' }), 'here'),
    lane(at(1, { ticket: 'R' }), 'here', 'running'),
    lane(at(1, { ticket: 'A' }), 'other'),
    lane(at(1, { ticket: 'S' }), 'here', 'stalled'),
    lane(at(1, { ticket: 'W' }), 'here', 'waiting'),
    lane(at(60, { ticket: 'I' }), 'none'),
    lane(at(1, { ticket: 'F', status: 'failed' }), 'none'),
    lane(at(1, { ticket: 'D', status: 'done' }), 'none'),
  ]
  expect(summaryParts(lanes, NOW)).toEqual([
    { label: '1 needs you', color: 'warning' }, { label: '2 running', color: 'success' }, { label: '1 stalled', color: 'error' },
    { label: '2 idle', color: 'subtle' }, { label: '1 failed', color: 'error' }, { label: '1 done', color: 'subtle' },
  ])
  expect(summaryParts([lane(at(1), 'here', 'running')], NOW)).toEqual([{ label: '1 running', color: 'success' }])
  expect(summaryParts([], NOW)).toEqual([])
})

test('summarize: live work only; undefined when nothing is live', async () => {
  expect(summarize([], NOW)).toBeUndefined()
  expect(summarize([lane(at(1, { status: 'done' }), 'here')], NOW)).toBeUndefined()
  const lanes = [
    lane(at(1, { ticket: 'N', status: 'needs-you' }), 'here'), lane(at(1, { ticket: 'R' }), 'here', 'running'),
    lane(at(60, { ticket: 'I' }), 'other'), lane(at(1, { ticket: 'D', status: 'done' }), 'none'),
    lane(at(1, { ticket: 'F', status: 'failed' }), 'none'),
  ]
  expect(summarize(lanes, NOW)).toBe('fleet: 1 needs you · 1 running · 1 idle · 1 failed')
})

// ── detail lane ────────────────────────────────────────────────────────────────────────────────

test('pickDetailLane: the viewed agent first, then the selection (even collapsed or hidden), then the first shown', async () => {
  const lanes: Lane[] = [
    { ...lane(at(1, { ticket: 'H' }), 'here', 'running'), agentId: 'ag-h' },
    { ...lane(at(1, { ticket: 'O' }), 'other') },
    lane(at(90, { ticket: 'D', status: 'done' }), 'none'),
    lane(at(90, { ticket: 'Q' }), 'other'),
  ]
  expect(pickDetailLane(lanes, 'O', 'ag-h', false, NOW)?.run.ticket).toBe('H')
  expect(pickDetailLane(lanes, 'O', 'ag-unknown', false, NOW)?.run.ticket).toBe('O')
  expect(pickDetailLane(lanes, 'D', undefined, false, NOW)?.run.ticket).toBe('D')        // inside the collapsed Done group
  expect(pickDetailLane(lanes, 'Q', undefined, false, NOW)?.run.ticket).toBe('Q')        // quiet, hidden
  expect(pickDetailLane(lanes, 'GONE', undefined, false, NOW)?.run.ticket).toBe('H')
  expect(pickDetailLane(lanes, null, undefined, false, NOW)?.run.ticket).toBe('H')
  // Only an old finished lane, behind its toggle: nothing to show until the group is opened.
  expect(pickDetailLane([lane(at(90, { status: 'done' }), 'none')], null, undefined, false, NOW)).toBeUndefined()
  expect(pickDetailLane([lane(at(90, { ticket: 'D', status: 'done' }), 'none')], null, undefined, false, NOW, ['done'])?.run.ticket).toBe('D')
  // A recently finished lane is drawn, so it is the fallback.
  expect(pickDetailLane([lane(at(1, { ticket: 'D', status: 'done' }), 'none')], null, undefined, false, NOW)?.run.ticket).toBe('D')
  expect(detailTicket(lanes, null, undefined, false, NOW)).toBe('H')
  expect(detailTicket([], null, undefined, true, NOW)).toBeNull()
})

// ── fingerprint and comments ───────────────────────────────────────────────────────────────────

test('fingerprint: stable across identical input; changes on phase, driver, agent, answer, error, hidden', async () => {
  const base = [lane(run({ phase: 'Planning' }), 'here', 'running')]
  expect(fingerprint(base, null)).toBe(fingerprint([lane(run({ phase: 'Planning' }), 'here', 'running')], null))
  expect(fingerprint([lane(run({ phase: 'Execution' }), 'here', 'running')], null)).not.toBe(fingerprint(base, null))
  expect(fingerprint([lane(run({ phase: 'Planning' }), 'other')], null)).not.toBe(fingerprint(base, null))
  expect(fingerprint([lane(run({ phase: 'Planning' }), 'here', 'stalled')], null)).not.toBe(fingerprint(base, null))
  expect(fingerprint([lane(run({ phase: 'Planning', pendingAnswer: { answer: 'a' } }), 'here', 'running')], null)).not.toBe(fingerprint(base, null))
  expect(fingerprint(base, 'boom')).not.toBe(fingerprint(base, null))
  expect(fingerprint(base, null, 1)).not.toBe(fingerprint(base, null, 0))
  expect(fingerprint(base, null)).toBe(fingerprint(base, null, 0))
})

test('newestComments: oldest-first slice of the newest n, nulls last', async () => {
  const c = (id: string, createdAt: number | null) => ({ id, author: null, body: '', createdAt })
  expect(newestComments([c('3', 3), c('1', 1), c('2', 2), c('n', null)], 3).map(x => x.id)).toEqual(['2', '3', 'n'])
  expect(newestComments([c('2', 2), c('1', 1)], 5).map(x => x.id)).toEqual(['1', '2'])
  expect(newestComments([c('1', 1)], 0)).toEqual([])
})

// ── escalations ────────────────────────────────────────────────────────────────────────────────

test('stripOption: drops the label a raiser numbered an option with', async () => {
  expect(stripOption('a) Map-based LRU')).toBe('Map-based LRU')
  expect(stripOption('(b) lru-cache package')).toBe('lru-cache package')
  expect(stripOption('C. separate class')).toBe('separate class')
  expect(stripOption('2) both')).toBe('both')
  expect(stripOption('(3) all')).toBe('all')
  expect(stripOption('10. ten')).toBe('ten')
  expect(stripOption('- dash')).toBe('dash')
  expect(stripOption('* star')).toBe('star')
  expect(stripOption('  d: colon  ')).toBe('colon')
})

test('stripOption: a plain option is left alone, including one starting with a lone letter word', async () => {
  expect(stripOption('a lru cache')).toBe('a lru cache')
  expect(stripOption('A plain option')).toBe('A plain option')
  expect(stripOption('include')).toBe('include')
  expect(stripOption('e.g. this')).toBe('e.g. this')
  expect(stripOption('v2.0 schema')).toBe('v2.0 schema')
  // A label with nothing after it is kept rather than emptied.
  expect(stripOption('a)')).toBe('a)')
})

test('questionsOf: sub-questions when present, stripped; else the single question with its options', async () => {
  expect(questionsOf(esc())).toEqual([{ question: 'Which cache?', options: ['Map-based LRU', 'lru-cache package'] }])
  expect(questionsOf(esc({ question: '', options: [], subQuestions: [
    { question: ' Schema? ', options: ['1. v1', '2. v2'] }, { question: 'Why?', options: [] },
  ] }))).toEqual([{ question: 'Schema?', options: ['v1', 'v2'] }, { question: 'Why?', options: [] }])
  expect(questionsOf(esc({ subQuestions: [] }))).toHaveLength(1)
})

test('headline: the question, else the first non-empty sub-question, else who escalated; never empty', async () => {
  expect(headline(esc())).toBe('Which cache?')
  expect(headline(esc({ question: '  ', subQuestions: [{ question: ' ', options: [] }, { question: 'Schema?', options: [] }] }))).toBe('Schema?')
  expect(headline(esc({ question: '', subQuestions: [] }))).toBe('skeptic escalated')
  expect(headline(esc({ question: '', role: null }))).toBe('an agent escalated')
})

test('escalationTitle and escalationKey', async () => {
  expect(escalationTitle(esc({ gate: 'design' }))).toBe('Skeptic needs a design call')
  expect(escalationTitle(esc({ gate: null }))).toBe('Skeptic needs you')
  expect(escalationTitle(esc({ role: null }))).toBe('An agent needs you')
  expect(escalationTitle(esc({ role: 'reviewer', gate: 'final' }))).toBe('reviewer needs a final call')
  expect(escalationKey('SBX-4', esc())).toBe('e1')
  expect(escalationKey('SBX-4', esc({ escalationId: null, raisedAt: 123 }))).toBe('SBX-4:123')
})

test('draftFor: an empty draft when none is stored; a stored one padded or cut to the questions', async () => {
  expect(draftFor({}, 'k', 2)).toEqual({ picks: [null, null], note: '' })
  expect(emptyDraft(0)).toEqual({ picks: [], note: '' })
  const drafts = { k: { picks: ['x'], note: 'n' } }
  expect(draftFor(drafts, 'k', 3)).toEqual({ picks: ['x', null, null], note: 'n' })
  expect(draftFor({ k: { picks: ['x', 'y', 'z'], note: '' } }, 'k', 2)).toEqual({ picks: ['x', 'y'], note: '' })
  expect(draftFor({ k: { picks: ['x'] } as never }, 'k', 1)).toEqual({ picks: ['x'], note: '' })
})

test('answeredCount: blank and null picks do not count', async () => {
  expect(answeredCount({ picks: ['a', null, '  ', 'b'], note: '' })).toBe(2)
})

test('draftMessage: one question, picks, note and the instruction to the driver', async () => {
  expect(draftMessage('SBX-4', esc(), { picks: ['Map-based LRU'], note: '  keep it small ' })).toBe([
    "Answer SBX-4's skeptic escalation (e1):",
    'Which cache? → Map-based LRU',
    'Note: keep it small',
    'Record it with `concertino answer` and resume the SBX-4 orchestrator.',
  ].join('\n'))
})

test('draftMessage: sub-questions are numbered; a missing pick says so; no role and no id read cleanly', async () => {
  const e = esc({ role: null, escalationId: null, question: '', options: [], subQuestions: [
    { question: 'Cache?', options: ['a) Map', 'b) lib'] }, { question: 'Scope?', options: [] },
  ] })
  expect(draftMessage('SBX-4', e, { picks: ['Map', null], note: '' })).toBe([
    "Answer SBX-4's escalation:",
    '1. Cache? → Map',
    '2. Scope? → (no answer)',
    'Record it with `concertino answer` and resume the SBX-4 orchestrator.',
  ].join('\n'))
})
