// Pure helpers for the detail's Ticket and Activity tabs: a ticket body split into its summary,
// the rest and its acceptance criteria; priorities in words; a timeline cut into phase spans.
import type { TimelineEvent } from '../../types'

export type Criterion = { text: string; done: boolean }
/** `notes`: any non-item text inside the acceptance section ("All of:"), shown above the list. */
export type TicketBody = { summary: string; body: string; acceptance: Criterion[]; notes: string }

// A markdown heading, or a whole-line bold label (`**Acceptance criteria**`, `__Acceptance:__`).
const ACCEPTANCE = /^\s{0,3}(?:#{1,6}\s*|\*\*|__)\s*acceptance(?:\s+criteria)?\s*:?\s*(?:\*\*|__)?\s*:?\s*$/i
const HEADING = /^\s{0,3}(?:#{1,6}\s|(?:\*\*|__)[^*_]+(?:\*\*|__)\s*:?\s*$)/
const ITEM = /^\s{0,3}(?:[-*+]|\d{1,3}[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/

/**
 * The body's first paragraph (heading lines skipped), the body without its acceptance-criteria
 * section, that section's list items (`- [x]` marked done) and its other text. An item's
 * continuation lines join onto it until a blank line; the section ends at the next heading.
 */
export function splitTicketBody(markdown: string): TicketBody {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const kept: string[] = []
  const notes: string[] = []
  const acceptance: Criterion[] = []
  let inAcceptance = false
  let continuing = false
  for (const line of lines) {
    if (ACCEPTANCE.test(line)) { inAcceptance = true; continuing = false; continue }
    if (inAcceptance && HEADING.test(line)) inAcceptance = false
    if (!inAcceptance) { kept.push(line); continue }
    const m = ITEM.exec(line)
    if (m) { acceptance.push({ text: m[2]!.trim(), done: !!m[1] && m[1] !== ' ' }); continuing = true; continue }
    if (!line.trim()) { continuing = false; continue }
    if (continuing && acceptance.length) acceptance.at(-1)!.text += ' ' + line.trim()
    else notes.push(line.trim())
  }
  const body = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  const summary = body.split(/\n\s*\n/)
    .map(p => p.split('\n').filter(l => !HEADING.test(l)).join(' ').replace(/\s+/g, ' ').trim())
    .find(p => p) ?? ''
  return { summary, body, acceptance, notes: notes.join(' ') }
}

/** Linear's scale, which the local provider shares: 0 none, 1 urgent … 4 low. */
export function priorityName(p: number | null): string | null {
  switch (p) {
    case 1: return 'Urgent'
    case 2: return 'High'
    case 3: return 'Medium'
    case 4: return 'Low'
    default: return null
  }
}

export type PhaseSpan = { phase: string; cycle: number | null; start: number; end: number | null; events: TimelineEvent[]; implicit?: true }

/**
 * The timeline cut at each `phase.enter`: one span per entry, ending where the next begins (the
 * last ends at `endedAt`, or is open). Events before the first entry form a "Setup" span.
 */
export function phaseSpans(timeline: readonly TimelineEvent[], endedAt: number | null): PhaseSpan[] {
  const spans: PhaseSpan[] = []
  for (const ev of timeline) {
    if (ev.kind === 'phase.enter') {
      const prev = spans.at(-1)
      // run.start lands before `phase.enter Setup`: fold the implicit span into the explicit one.
      if (prev?.implicit && spans.length === 1 && ev.phase === 'Setup') {
        delete prev.implicit
        prev.cycle = ev.cycle ?? null
        continue
      }
      if (prev && prev.end == null) prev.end = ev.t
      spans.push({ phase: ev.phase ?? 'Phase', cycle: ev.cycle ?? null, start: ev.t, end: null, events: [] })
      continue
    }
    if (!spans.length) spans.push({ phase: 'Setup', cycle: null, start: ev.t, end: null, events: [], implicit: true })
    spans.at(-1)!.events.push(ev)
  }
  const last = spans.at(-1)
  if (last && last.end == null && endedAt != null) last.end = endedAt
  for (const sp of spans) delete sp.implicit
  return spans
}
