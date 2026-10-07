// hooks/fleet-pane/snapshot.ts
import type { EngineInterface } from 'claude-code'
import type { Snapshot } from '../../types'

export const FLEET_ARGV = ['concertino', 'fleet', '--json'] as const
export const POLL_MS = 2000
/** Poll delay while there are no runs (or the CLI is failing). */
export const IDLE_POLL_MS = 15000
export const CLI_TIMEOUT_MS = 5000

export type SnapshotResult = { ok: true; snapshot: Snapshot } | { ok: false; error: string }

const tail = (s: string, n = 200) => s.trim().split('\n').slice(-3).join(' ').slice(-n)

/** Runs `concertino fleet --json` in `cwd`; never throws. */
export async function runFleetSnapshot($: EngineInterface, cwd: string, tickets: readonly string[] = []): Promise<SnapshotResult> {
  const argv = tickets.length ? [...FLEET_ARGV, `--tickets=${tickets.join(',')}`] : [...FLEET_ARGV]
  let ran
  try {
    ran = await $.process.run(argv, { cwd, timeoutMs: CLI_TIMEOUT_MS })
  } catch (e) {
    return { ok: false, error: `concertino: ${e instanceof Error ? e.message : String(e)}` }
  }
  if (ran.exitCode !== 0) return { ok: false, error: `concertino: exit ${ran.exitCode} ${tail(ran.stderr)}`.trim() }
  if (!ran.stdout.trim()) return { ok: false, error: 'concertino: no output' }
  if (!ran.stdout.trimStart().startsWith('{')) return { ok: false, error: 'concertino on PATH has no `fleet` command — upgrade it' }
  try {
    const parsed = JSON.parse(ran.stdout) as Snapshot
    if (!parsed || !Array.isArray(parsed.runs)) return { ok: false, error: 'concertino: unexpected JSON shape' }
    return { ok: true, snapshot: parsed }
  } catch (e) {
    return { ok: false, error: `concertino: bad JSON ${tail(ran.stdout, 80)}` }
  }
}
