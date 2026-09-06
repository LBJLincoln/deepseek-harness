/**
 * Scorekeeper: the session log as the dataset. A `sessionFacts` projection
 * unit serves one live session's facts, and `ctx.scorekeeper` folds the same
 * facts out of persisted logs — one record per session, a scoreboard grouped
 * by model route, environment, isolation, held-out split, and district, and a
 * JSONL export. The service reads through the session persistence seam and
 * writes no session event. The
 * [scorekeeper Agent Note](../../../.agents/notes/proposed/architecture/2026-09-05-scorekeeper.md)
 * owns the design rationale.
 * @module @deepseek-ai/dsh-scorekeeper
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'
import type { ZodType } from 'zod'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
// Type-only: resolves ctx.sessionPersistence.
import type {} from '@deepseek-ai/dsh-session-persistence'
// Type-only: resolves ctx.sessionProjections for the optional unit child.
import type {} from '@deepseek-ai/dsh-session-projection'
import { applySessionFacts, emptySessionFactsState, foldSessionFacts } from './fold.ts'
import type { SessionFactsState } from './fold.ts'
import { foldScoreboard } from './scoreboard.ts'
import type {
  FactsExportReport,
  FactsExportRequest,
  LeaderboardFilter,
  ScoreboardBatch,
  ScorekeeperSkip,
  SessionFacts,
  SessionFactsRecord,
} from './types.ts'

export type * from './types.ts'
export {
  applySessionFacts,
  emptySessionFactsState,
  foldSessionFacts,
  foldSessionFactsState,
} from './fold.ts'
export type { SessionFactsPricing, SessionFactsState } from './fold.ts'
export { foldScoreboard, unbiasedPassAtK } from './scoreboard.ts'
export type { ScoreboardFold } from './scoreboard.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    scorekeeper: ScorekeeperService
  }
}

/** Wire payload schema of one run stamp's fields inside the projection. */
const environmentSchema = zod.object({
  environmentId: zod.string().min(1),
  environmentKind: zod.string().min(1),
  heldOut: zod.boolean(),
  repetition: zod.number().int().nonnegative(),
  group: zod.string().min(1).optional(),
  district: zod.string().min(1).optional(),
  contentSha256: zod.string().min(1),
  provider: zod.string().min(1),
  model: zod.string().min(1),
  isolation: zod.union([zod.literal('none'), zod.literal('process'), zod.literal('host')]),
})

// Cast for the optional values: under exactOptionalPropertyTypes zod infers
// `T | undefined` where the interface declares absent-or-present fields.
/** Wire payload schema of the `sessionFacts` projection (the four fact groups). */
const sessionFactsSchema: ZodType<SessionFacts> = zod.object({
  identity: zod.object({
    environment: environmentSchema.optional(),
    requestProvider: zod.string().min(1).optional(),
    requestModel: zod.string().min(1).optional(),
  }),
  outcome: zod.object({
    reward: zod.union([zod.literal(1), zod.literal(0), zod.null()]),
    rewardBasis: zod.union([
      zod.literal('certificate'),
      zod.literal('uncertified-completion'),
      zod.literal('none'),
    ]),
    certified: zod.boolean(),
    certificateRevision: zod.number().int().positive().optional(),
    certificateExecutor: zod.union([zod.literal('runner'), zod.literal('agent-reported')]).optional(),
    parity: zod.object({
      weightPassed: zod.number().int().nonnegative(),
      weightTotal: zod.number().int().positive(),
    }).optional(),
    runsRecorded: zod.number().int().nonnegative(),
    attempts: zod.number().int().nonnegative(),
    directives: zod.number().int().nonnegative(),
    relaxations: zod.number().int().nonnegative(),
    goalPhase: zod.union([
      zod.literal('active'),
      zod.literal('paused'),
      zod.literal('blocked'),
      zod.literal('complete'),
    ]).optional(),
    goalRoundsStarted: zod.number().int().nonnegative(),
    goalRoundsCap: zod.number().int().positive().optional(),
    budgetBreachCap: zod.string().min(1).optional(),
  }),
  efficiency: zod.object({
    turns: zod.number().int().nonnegative(),
    steps: zod.number().int().nonnegative(),
    inputTokens: zod.number().int().nonnegative(),
    outputTokens: zod.number().int().nonnegative(),
    cacheReadTokens: zod.number().int().nonnegative(),
    cacheWriteTokens: zod.number().int().nonnegative(),
    reasoningTokens: zod.number().int().nonnegative(),
    wallMs: zod.number().int().nonnegative(),
    pricedSteps: zod.number().int().nonnegative(),
    costEur: zod.number().nonnegative().optional(),
    pricingDigests: zod.array(zod.string().min(1)),
  }),
  tools: zod.object({
    toolCalls: zod.number().int().nonnegative(),
    toolCallsByName: zod.record(zod.string(), zod.number().int().nonnegative()),
    toolErrors: zod.number().int().nonnegative(),
    toolTimeouts: zod.number().int().nonnegative(),
    toolAborts: zod.number().int().nonnegative(),
  }),
}) as unknown as ZodType<SessionFacts>

/**
 * Projection-grade transition of the `sessionFacts` unit. The outcome group is
 * decided by the strict goal and verification folds, so a change they reject
 * leaves the value at its previous state instead of tearing the read side;
 * validating a written change is the write side's job.
 * @param state - the accumulator covering all prior events.
 * @param event - the next committed session event.
 * @returns the next accumulator, or the same reference when the change was rejected.
 */
export function applySessionFactsProjection(state: SessionFactsState, event: SessionEvent): SessionFactsState {
  try {
    return applySessionFacts(state, event)
  } catch (_rejectedOutcomeChange) {
    // The goal and verification services own the two streams that can throw
    // here; their own invariant companions reject a malformed change at source.
    return state
  }
}

/** Deployment choices of the scorekeeper, validated from `cordis.yml`. */
export interface Config {
  /** Repetition draws the scoreboard estimates pass@k for. */
  passAtK?: number[]
}

/** The scorekeeper's choices with every default applied. */
export interface ResolvedConfig {
  /** Ascending, de-duplicated pass@k draws. */
  readonly passAtK: readonly number[]
}

/**
 * Apply the scorekeeper's defaults to a validated config.
 * @param config - validated deployment config.
 * @returns the resolved choices: pass@1 alone unless configured otherwise.
 */
export function resolveConfig(config: Config): ResolvedConfig {
  return { passAtK: [...new Set(config.passAtK ?? [1])].sort((left, right) => left - right) }
}

/** Render a read or fold failure for a report without trusting the thrown value. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** One session's facts, or the failure that prevented folding them. */
type FactsOutcome = { readonly record: SessionFactsRecord } | { readonly skip: ScorekeeperSkip }

/** Scorekeeper (`ctx.scorekeeper`): session facts, the scoreboard, and the facts export. */
export class ScorekeeperService extends Service {
  static inject = ['sessionPersistence']

  static Config: z<Config> = z.object({
    passAtK: z.array(z.natural().min(1)).default([1]),
  })

  private readonly resolved: ResolvedConfig

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'scorekeeper')
    this.resolved = resolveConfig(config)
    // The `sessionFacts` projection unit activates only when a projection
    // registry is composed; a headless assembly keeps the service verbs alone.
    ctx.inject(['sessionProjections'], (projectionCtx) => {
      projectionCtx.sessionProjections.register<'sessionFacts', SessionFactsState>({
        key: 'sessionFacts',
        schema: sessionFactsSchema,
        init: emptySessionFactsState,
        apply: applySessionFactsProjection,
        view: state => state.facts,
        stateVersion: 2,
      })
    })
  }

  /**
   * Fold one persisted session into its facts record.
   * @param sessionId - the persisted session to read.
   * @returns the four fact groups with the stored header's identity.
   * @throws when the session cannot be read, or its goal or verification stream is malformed.
   */
  async facts(sessionId: SessionId): Promise<SessionFactsRecord> {
    const { meta, events } = await this.ctx.sessionPersistence.inspect(sessionId)
    return foldSessionFacts(meta, events)
  }

  /**
   * Fold a scoreboard from persisted session logs, one row per model route,
   * environment, isolation level, held-out split, and district. A session that
   * cannot be read or folded is reported and the fold continues.
   * @param filter - the sessions to fold and the group and held-out conditions a stamped session must meet.
   * @returns the rows with their pass@k statistics, the counts of excluded, unstamped, and skipped sessions, and the fold time.
   */
  async leaderboard(filter: LeaderboardFilter = {}): Promise<ScoreboardBatch> {
    const sessions = await this.sessionsOf(filter.sessions)
    const records: SessionFactsRecord[] = []
    const skipped: ScorekeeperSkip[] = []
    for (const sessionId of sessions) {
      const outcome = await this.factsOf(sessionId)
      if ('skip' in outcome) skipped.push(outcome.skip)
      else records.push(outcome.record)
    }
    const fold = foldScoreboard(records, filter, this.resolved.passAtK)
    return {
      rows: fold.rows,
      sessions: sessions.length,
      excluded: fold.excluded,
      unstamped: fold.unstamped,
      skipped,
      computedAt: Date.now(),
    }
  }

  /**
   * Write one JSON line per session's facts record. A session that cannot be
   * read or folded is reported and the export continues; the sink is closed
   * exactly once when every session has been handled.
   * @param request - sessions to export and the destination sink.
   * @returns counts of sessions, written lines, and skips with reasons.
   */
  async exportFacts(request: FactsExportRequest): Promise<FactsExportReport> {
    const sessions = await this.sessionsOf(request.sessions)
    const skipped: ScorekeeperSkip[] = []
    let exported = 0
    try {
      for (const sessionId of sessions) {
        const outcome = await this.factsOf(sessionId)
        if ('skip' in outcome) {
          skipped.push(outcome.skip)
          continue
        }
        await request.sink.write(`${JSON.stringify(outcome.record)}\n`)
        exported += 1
      }
    } finally {
      await request.sink.close()
    }
    return { sessions: sessions.length, exported, skipped }
  }

  /** The requested sessions, or every persisted session when none were named. */
  private async sessionsOf(sessions?: readonly SessionId[]): Promise<readonly SessionId[]> {
    return sessions ?? (await this.ctx.sessionPersistence.list()).map(header => header.id)
  }

  /** Read and fold one session, keeping a read or fold failure as a skip. */
  private async factsOf(sessionId: SessionId): Promise<FactsOutcome> {
    try {
      return { record: await this.facts(sessionId) }
    } catch (error: unknown) {
      return { skip: { sessionId, reason: reasonOf(error) } }
    }
  }
}

export default ScorekeeperService
