// The fleet pane's state contract (docs/superpowers/specs/2026-10-06-fleet-pane-design.md).
export type RunStatus = 'needs-you' | 'failed' | 'running' | 'unknown' | 'done'

export type Gate = { name: string; status: string; durationMs: number | null; firstError: string | null }

export type SubQuestion = { question: string; options: string[] }

export type Escalation = {
  question: string
  options: string[]
  subQuestions?: SubQuestion[]
  raisedAt: number
  escalationId: string | null
  role: string | null
}

export type TimelineEvent = {
  t: number
  kind: string
  phase?: string
  cycle?: number
  agent?: string
  role?: string
  verdict?: string
  gate?: string
  status?: string
  url?: string
  label?: string
}

export type PendingAnswer =
  | { answer: string }
  | { subAnswers: unknown[]; total: number; complete: boolean }
  | null

/** One run as `concertino fleet --json` prints it: the reducer's model minus `events`. */
export type Run = {
  ticket: string
  changeName: string | null
  branch: string | null
  worktree: string | null
  phase: string | null
  cycle: number | null
  gates: Gate[]
  lastVerdict: { role: string; verdict: string; ref: string | null } | null
  escalation: Escalation | null
  costUsd: number | null
  startedAt: number | null
  endedAt: number | null
  endStatus: string | null
  elapsedMs: number | null
  status: RunStatus
  malformed: number
  ticket_doc: { title: string | null; excerpt: string | null }
  pendingAnswer: PendingAnswer
  timeline: TimelineEvent[]
  currentAgent: string | null
}

export type Snapshot = { generatedAt: number; root: string; runs: Run[] }

export type Liveness = 'running' | 'external' | 'stalled' | 'ended'

export type Lane = {
  run: Run
  agentId?: string
  /** Mirrors claude-code's AgentStatus (the contract must not import). */
  agentStatus?: 'pending' | 'running' | 'waiting' | 'idle' | 'completed' | 'failed' | 'killed'
  liveness: Liveness
}

export type FleetState = {
  lanes: Lane[]
  error: string | null
  fingerprint: string
  generatedAt: number
  root: string
}

declare module 'claude-code' {
  interface PluginState {
    concertino: {
      fleet: FleetState
      selected: string | null
      seenEscalations: string[]
    }
  }
}
