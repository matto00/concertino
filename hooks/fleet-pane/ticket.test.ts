import { test, expect } from 'claude-code/testing'
import { phaseSpans, priorityName, splitTicketBody } from './ticket'
import { newestFirst, openLabel } from './render'

// ── splitTicketBody ────────────────────────────────────────────────────────────────────────────

const TICKET = [
  '## Description',
  '',
  'Add an LRU cache',
  'in front of the store.',
  '',
  'Second paragraph.',
  '',
  '## Acceptance criteria',
  '',
  '- [x] Hits are served from memory',
  '- [ ] Misses fall through to the store',
  '  and are cached afterwards',
  '* plain item',
  '1. numbered item',
  '- [X] upper-case X counts as done',
  '',
  '## Notes',
  '',
  'Ship behind a flag.',
].join('\r\n')

test('splitTicketBody: the summary is the first non-heading paragraph, its lines joined', async () => {
  expect(splitTicketBody(TICKET).summary).toBe('Add an LRU cache in front of the store.')
  expect(splitTicketBody('Just one line.').summary).toBe('Just one line.')
  expect(splitTicketBody('').summary).toBe('')
  expect(splitTicketBody('# Title\n\n## Sub').summary).toBe('')
})

test('splitTicketBody: the body drops the acceptance section, keeps what follows, and normalises CRLF', async () => {
  const { body } = splitTicketBody(TICKET)
  expect(body).not.toMatch(/\r/)
  expect(body).not.toMatch(/Acceptance/)
  expect(body).not.toMatch(/Hits are served/)
  expect(body).toMatch(/^## Description\n\nAdd an LRU cache\nin front of the store\.\n\nSecond paragraph\.\n\n## Notes\n\nShip behind a flag\.$/)
})

test('splitTicketBody: acceptance items with done marks; continuation lines join the item', async () => {
  expect(splitTicketBody(TICKET).acceptance).toEqual([
    { text: 'Hits are served from memory', done: true },
    { text: 'Misses fall through to the store and are cached afterwards', done: false },
    { text: 'plain item', done: false },
    { text: 'numbered item', done: false },
    { text: 'upper-case X counts as done', done: true },
  ])
})

test('splitTicketBody: heading variants for the acceptance section', async () => {
  for (const h of ['# Acceptance', '### acceptance criteria:', '## ACCEPTANCE CRITERIA']) {
    const got = splitTicketBody(`Intro.\n\n${h}\n- one\n- two`)
    expect(got.acceptance.map(c => c.text)).toEqual(['one', 'two'])
    expect(got.body).toBe('Intro.')
  }
  // Not a heading: stays in the body, no criteria.
  const plain = splitTicketBody('Acceptance criteria\n- one')
  expect(plain.acceptance).toEqual([])
  expect(plain.body).toBe('Acceptance criteria\n- one')
})

test('splitTicketBody: no acceptance section, no criteria', async () => {
  expect(splitTicketBody('Para.\n\n- a list\n- not criteria').acceptance).toEqual([])
})

test('splitTicketBody: regression: a heading directly above the first paragraph does not swallow it', async () => {
  expect(splitTicketBody('## Description\nAdd the thing.\n\nMore.').summary).toBe('Add the thing.')
})

test('splitTicketBody: regression: a blank line ends a criterion; later text is a note, not glued on', async () => {
  const got = splitTicketBody('## Acceptance criteria\n- [ ] works\n\nOut of scope: perf.')
  expect(got.acceptance).toEqual([{ text: 'works', done: false }])
  expect(got.notes).toBe('Out of scope: perf.')
})

test('splitTicketBody: regression: text inside the acceptance section before the list is kept as notes', async () => {
  const got = splitTicketBody('Intro.\n\n## Acceptance criteria\nAll of:\n- one')
  expect(got.notes).toBe('All of:')
  expect(got.acceptance).toEqual([{ text: 'one', done: false }])
  expect(got.body).toBe('Intro.')
  expect(splitTicketBody(TICKET).notes).toBe('')
})

test('splitTicketBody: a whole-line bold label starts the acceptance section too', async () => {
  for (const h of ['**Acceptance criteria**', '**Acceptance criteria:**', '__Acceptance:__']) {
    expect(splitTicketBody(`Intro.\n\n${h}\n- one`).acceptance.map(c => c.text)).toEqual(['one'])
  }
})

// ── priorityName ───────────────────────────────────────────────────────────────────────────────

test('priorityName: Linear\'s scale in words, none for 0, null and anything else', async () => {
  expect(priorityName(1)).toBe('Urgent')
  expect(priorityName(2)).toBe('High')
  expect(priorityName(3)).toBe('Medium')
  expect(priorityName(4)).toBe('Low')
  expect(priorityName(0)).toBeNull()
  expect(priorityName(null)).toBeNull()
  expect(priorityName(5)).toBeNull()
})

// ── phaseSpans ─────────────────────────────────────────────────────────────────────────────────

test('phaseSpans: one span per phase.enter, each ending where the next begins; the last open', async () => {
  const spans = phaseSpans([
    { t: 10, kind: 'phase.enter', phase: 'Planning', cycle: 1 },
    { t: 11, kind: 'evidence', label: 'plan.md' },
    { t: 20, kind: 'phase.enter', phase: 'Execution', cycle: 2 },
    { t: 21, kind: 'agent.spawn', agent: 'executor' },
    { t: 22, kind: 'verdict', role: 'evaluator', verdict: 'PASS' },
  ], null)
  expect(spans.map(s => [s.phase, s.cycle, s.start, s.end, s.events.map(e => e.kind)])).toEqual([
    ['Planning', 1, 10, 20, ['evidence']],
    ['Execution', 2, 20, null, ['agent.spawn', 'verdict']],
  ])
})

test('phaseSpans: events before the first phase.enter form a Setup span; endedAt closes the last', async () => {
  const spans = phaseSpans([
    { t: 1, kind: 'run.start' },
    { t: 2, kind: 'evidence', label: 'ticket.md' },
    { t: 5, kind: 'phase.enter', phase: 'Planning' },
    { t: 9, kind: 'run.end', status: 'done' },
  ], 12)
  expect(spans.map(s => [s.phase, s.cycle, s.start, s.end, s.events.length])).toEqual([
    ['Setup', null, 1, 5, 2],
    ['Planning', null, 5, 12, 1],
  ])
})

test('phaseSpans: regression: run.start then phase.enter Setup is one Setup span', async () => {
  const spans = phaseSpans([
    { t: 1, kind: 'run.start' }, { t: 2, kind: 'phase.enter', phase: 'Setup', cycle: 1 },
    { t: 3, kind: 'evidence', label: 'ticket.md' }, { t: 5, kind: 'phase.enter', phase: 'Planning' },
  ], null)
  expect(spans.map(s => [s.phase, s.cycle, s.start, s.end, s.events.map(e => e.kind)])).toEqual([
    ['Setup', 1, 1, 5, ['run.start', 'evidence']],
    ['Planning', null, 5, null, []],
  ])
})

test('phaseSpans: an empty timeline has no spans; a phase.enter with no phase is named Phase', async () => {
  expect(phaseSpans([], 5)).toEqual([])
  expect(phaseSpans([{ t: 3, kind: 'phase.enter' }], null)).toEqual([{ phase: 'Phase', cycle: null, start: 3, end: null, events: [] }])
})

// Regressions found while testing the v2 tabs.
test('splitTicketBody: a heading directly above the first paragraph does not swallow the summary', () => {
  expect(splitTicketBody('## Description\nAdd the thing.\n\nMore.').summary).toBe('Add the thing.')
})

test('splitTicketBody: a blank line ends a criterion; text after the list is a note, not glued on', () => {
  const got = splitTicketBody('## Acceptance criteria\n- [ ] works\n\nOut of scope: perf.')
  expect(got.acceptance).toEqual([{ text: 'works', done: false }])
  expect(got.notes).toBe('Out of scope: perf.')
})

test('splitTicketBody: non-item text in the acceptance section is kept as notes', () => {
  const got = splitTicketBody('## Acceptance criteria\nAll of:\n- one')
  expect(got.notes).toBe('All of:')
  expect(got.acceptance).toEqual([{ text: 'one', done: false }])
})

test('splitTicketBody: a bold acceptance label is recognised and ends at the next bold label', () => {
  const got = splitTicketBody('Intro.\n\n**Acceptance criteria**\n- a\n- b\n\n**Notes**\nlater')
  expect(got.acceptance.map(c => c.text)).toEqual(['a', 'b'])
  expect(got.body).toContain('**Notes**')
})

test('phaseSpans: run.start before phase.enter Setup makes one Setup span', () => {
  const spans = phaseSpans([{ t: 1, kind: 'run.start' }, { t: 2, kind: 'phase.enter', phase: 'Setup' }, { t: 3, kind: 'phase.enter', phase: 'Planning' }], null)
  expect(spans.map(s => [s.phase, s.start, s.end, s.events.length])).toEqual([['Setup', 1, 3, 1], ['Planning', 3, null, 0]])
})

test('openLabel: Linear tickets say "Open in Linear", anything else "Open ticket"', () => {
  const meta = (over: object) => ({ url: null, ...over }) as never
  expect(openLabel(meta({ source: 'linear', url: 'https://linear.app/x/issue/A-1' }))).toBe('Open in Linear')
  expect(openLabel(meta({ url: 'https://linear.app/x/issue/A-1' }))).toBe('Open in Linear')
  expect(openLabel(meta({ url: 'https://github.com/x/y/issues/4' }))).toBe('Open ticket')
})

test('newestFirst: dated comments newest first, undated last; an undated comment is never the latest', () => {
  const c = (author: string, createdAt: number | null) => ({ id: author, author, body: '', createdAt })
  expect(newestFirst([c('old', 1), c('undated', null), c('new', 2)]).map(x => x.author)).toEqual(['new', 'old', 'undated'])
})

test('phaseSpans: a phase.enter without a phase is not folded into the implicit Setup span', () => {
  const spans = phaseSpans([{ t: 1, kind: 'run.start' }, { t: 2, kind: 'phase.enter' }], null)
  expect(spans.map(s => s.phase)).toEqual(['Setup', 'Phase'])
})
