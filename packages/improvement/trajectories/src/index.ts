/**
 * Trajectory export: persisted sessions folded into `dsh-trajectory/1`
 * records and written one JSON line at a time to a caller-supplied sink. The
 * service reads through the session persistence seam and writes no session
 * event. The
 * [trajectory-export Agent Note](../../../.agents/notes/proposed/architecture/2026-09-05-trajectory-export-and-environment-registry.md)
 * owns the design rationale.
 * @module @deepseek-ai/dsh-trajectories
 */

import { open } from 'node:fs/promises'
import { Context, Service } from '@deepseek-ai/cordis'
// Type-only: resolves ctx.sessionPersistence.
import type {} from '@deepseek-ai/dsh-session-persistence'
import { foldTrajectory } from './fold.ts'
import type {
  TrajectoryExportReport,
  TrajectoryExportRequest,
  TrajectoryExportSkip,
  TrajectorySink,
} from './types.ts'

export type * from './types.ts'
export { foldTrajectory, foldTrajectoryReward, TRAJECTORY_FORMAT } from './fold.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    trajectories: TrajectoryService
  }
}

/** Render a read or fold failure for the export report without trusting the thrown value. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * A sink that appends lines to one file, created or truncated on first use.
 * @param path - destination file path.
 * @returns a sink the exporter closes when the export settles.
 */
export function jsonlFileSink(path: string): TrajectorySink {
  const handle = open(path, 'w')
  return {
    async write(line) {
      await (await handle).write(line)
    },
    async close() {
      await (await handle).close()
    },
  }
}

/** Trajectory exporter (`ctx.trajectories`): persisted sessions as training and evaluation records. */
export class TrajectoryService extends Service {
  static inject = ['sessionPersistence']

  constructor(ctx: Context) {
    super(ctx, 'trajectories')
  }

  /**
   * Fold the requested sessions and write one line per trajectory. A session
   * that cannot be read or folded is reported and the export continues; the
   * sink is closed exactly once when every session has been handled.
   * @param request - sessions to export, the destination sink, the reward filter, and the held-out opt-in.
   * @returns counts of sessions, written lines, rewarded lines, filtered sessions, withheld held-out sessions, and skips with reasons.
   */
  async export(request: TrajectoryExportRequest): Promise<TrajectoryExportReport> {
    const persistence = this.ctx.sessionPersistence
    const sessions = request.sessions ?? (await persistence.list()).map(header => header.id)
    const skipped: TrajectoryExportSkip[] = []
    let exported = 0
    let rewarded = 0
    let filtered = 0
    let heldOut = 0
    try {
      for (const sessionId of sessions) {
        let line: string
        let outcome: 1 | 0 | null
        let reserved: boolean
        try {
          const { meta, events } = await persistence.inspect(sessionId)
          const trajectory = foldTrajectory(meta, events)
          outcome = trajectory.reward.outcome
          reserved = trajectory.environment?.heldOut === true
          line = `${JSON.stringify(trajectory)}\n`
        } catch (error: unknown) {
          skipped.push({ sessionId, reason: reasonOf(error) })
          continue
        }
        if (reserved && request.includeHeldOut !== true) {
          heldOut += 1
          continue
        }
        if (request.rewardedOnly === true && outcome !== 1) {
          filtered += 1
          continue
        }
        await request.sink.write(line)
        exported += 1
        if (outcome === 1) rewarded += 1
      }
    } finally {
      await request.sink.close()
    }
    return { sessions: sessions.length, exported, rewarded, filtered, heldOut, skipped }
  }
}

export default TrajectoryService
