// hooks/fleet-pane/render.test.ts
import { test, expect, mock } from 'claude-code/testing'
import type { Lane, Run } from '../../types'

const PANE = { title: 'Fleet', isFocused: true, bodyColumns: 80, placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 }, view: {} }

const run = (over: Partial<Run>): Run => ({
  ticket: 'CON-1', changeName: 'thing', branch: 'feature/thing/CON-1', worktree: '/w/CON-1', phase: 'Execution', cycle: 1,
  gates: [{ name: 'a', status: 'pass', durationMs: null, firstError: null }, { name: 'b', status: 'fail', durationMs: null, firstError: null }],
  lastVerdict: null, escalation: null, costUsd: 1.84, startedAt: 0, endedAt: null, endStatus: null,
  elapsedMs: 12 * 60_000, status: 'unknown', malformed: 0, ticket_doc: { title: 'Add the thing', excerpt: 'Line one.\nLine two.' },
  pendingAnswer: null, timeline: [{ t: 0, kind: 'phase.enter', phase: 'Execution', cycle: 1 }], currentAgent: 'executor', ...over,
})
const lane = (over: Partial<Run>, liveness: Lane['liveness'] = 'running'): Lane => ({ run: run(over), liveness })

// The kit's `$` has no `state` noun, so state is seeded through hooks beneath the plugin.
type On = (name: any, fn: (...a: any[]) => any) => void
function seed(on: On, lanes: Lane[], error: string | null = null, selected: string | null = null) {
  const store = new Map<string, unknown>([
    ['fleet', { lanes, error, fingerprint: 'f', generatedAt: 0, root: '/r' }],
    ['selected', selected],
  ])
  on('state.get', async (_$: unknown, e: { key: string }) => ({ value: { value: store.get(e.key), version: 1 } }))
  on('state.set', async (_$: unknown, e: { key: string; value: unknown }) => { store.set(e.key, e.value); return { value: { isSet: true, version: 2 } } })
  mock.clock(on as never)
  return store
}

for (const surface of ['terminal', 'desktop'] as const) {
  const mount = ($: any, props: object = PANE) =>
    $.ui.mount({ plugin: 'concertino', surface, component: 'Pane', props, requestId: 'fleet' })

  test(`list: empty state names the runs dir (${surface})`, async ($, on) => {
    seed(on, [])
    const ui = await mount($)
    expect((await ui.find({ key: 'empty' }))?.text).toMatch(/No concertino runs under \/r\/\.concertino\/runs/)
  })

  test(`list: one row per lane with ticket, status, phase, cycle, gates, elapsed, agent (${surface})`, async ($, on) => {
    seed(on, [lane({ ticket: 'CON-231', status: 'needs-you', phase: 'Evaluation', cycle: 2, currentAgent: 'skeptic' }),
              lane({ ticket: 'CON-228' }), lane({ ticket: 'CON-219' }, 'external')])
    const ui = await mount($)
    const rows = await ui.findAll({ type: 'Button' })
    expect(rows.map((r: any) => r.key)).toEqual(['lane:CON-231', 'lane:CON-228', 'lane:CON-219'])
    expect(rows[0]?.text).toMatch(/CON-231\s+needs-you\s+Evaluation\s+c2\s+\S+ 1\/2\s+12m\s+skeptic/)
    expect(rows[2]?.text).toMatch(/external$/)
    expect((await ui.find({ key: 'header' }))?.text).toMatch(/2 running · 1 needs you/)
  })

  test(`list: stalled lane is labelled (${surface})`, async ($, on) => {
    seed(on, [lane({}, 'stalled')])
    const ui = await mount($)
    expect((await ui.find({ key: 'lane:CON-1' }))?.text).toMatch(/stalled/)
  })

  test(`list: pressing a row selects it (${surface})`, async ($, on) => {
    const store = seed(on, [lane({ ticket: 'A' }), lane({ ticket: 'B' })])
    const ui = await mount($)
    await ui.press({ key: 'lane:B' })
    expect(store.get('selected')).toBe('B')
  })

  test(`list: an error line is drawn above stale lanes (${surface})`, async ($, on) => {
    seed(on, [lane({})], 'concertino: exit 127 command not found')
    const ui = await mount($)
    expect((await ui.find({ key: 'error' }))?.text).toMatch(/exit 127/)
    expect(await ui.find({ key: 'lane:CON-1' })).toBeDefined()
  })

  test(`list: truncates every row to bodyColumns (${surface})`, async ($, on) => {
    seed(on, [lane({ ticket: 'CON-123456', currentAgent: 'evaluator' })])
    const ui = await mount($, { ...PANE, bodyColumns: 40 })
    const row = await ui.find({ key: 'lane:CON-123456' })
    expect(row?.text.length).toBeLessThanOrEqual(40)
    expect(row?.text).not.toMatch(/\n/)
  })
}
