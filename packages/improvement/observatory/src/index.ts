/**
 * Observatory: the public page, folded from the persisted logs and nothing
 * else. `ctx.observatory.snapshot()` folds the scoreboard through the
 * scorekeeper over every persisted session, withholds the configured districts
 * and the held-out split from its public rows while counting what it dropped,
 * and records when it folded and how new its newest session is;
 * `render(snapshot, now)` turns one snapshot into a self-contained HTML page
 * and the same publication as JSON. The service writes no session event. The
 * [observatory Agent Note](../../../.agents/notes/proposed/architecture/2026-09-06-observatory.md)
 * owns the design rationale.
 * @module @deepseek-ai/dsh-observatory
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
// Type-only: resolves ctx.sessionPersistence.
import type {} from '@deepseek-ai/dsh-session-persistence'
// Type-only: resolves ctx.scorekeeper.
import type {} from '@deepseek-ai/dsh-scorekeeper'
import { orderRows, publishDocument, rankable, withhold } from './publish.ts'
import { renderHtml } from './render.ts'
import type { ObservatoryPage, ObservatorySnapshot, ObservatorySnapshotRequest } from './types.ts'

export type * from './types.ts'
export { OBSERVATORY_DOCUMENT_VERSION } from './types.ts'
export { isStale, orderRows, publishDocument, publishRow, rankable, withhold } from './publish.ts'
export type { WithholdRule, WithholdSplit } from './publish.ts'
export { duration, escapeHtml, NO_RANKING_SENTENCE, renderHtml, STALE_SENTENCE } from './render.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    observatory: ObservatoryService
  }
}

/** What a deployment never publishes. */
export interface WithholdConfig {
  /**
   * Districts whose rows never reach the public page. The package ships no
   * district name: a deployment states the districts whose sessions may not
   * leave it, exactly as the trajectory exporter does.
   */
  districts: string[]
  /** Whether held-out rows are withheld as well. */
  heldOut: boolean
}

/**
 * Deployment choices of the observatory, validated from `cordis.yml`. Every
 * field is required: what a deployment withholds, how old is too old, and how
 * often it refolds are all statements the page makes to its readers, and none
 * of them has a value this package could pick on a deployment's behalf.
 *
 * Publishing a cost without the digest that priced it is not among them. That
 * rule is fixed at `true` and is not a config key, because a row priced under
 * two pricing tables states a sum across tables rather than a price.
 */
export interface Config {
  /** What never reaches the public rows. */
  withhold: WithholdConfig
  /** Age of the newest folded session past which the page shows the staleness notice in place of every figure. */
  staleAfterMs: number
  /** Batch refresh interval, stated on the page as the cadence its numbers were folded under. */
  refreshIntervalMs: number
}

/** Newest `createdAt` among the folded headers, absent when the store held none. */
function newestOf(headers: readonly SessionHeader[]): Pick<ObservatorySnapshot, 'newestSessionAt'> {
  let newest: number | undefined
  for (const header of headers) {
    if (newest === undefined || header.createdAt > newest) newest = header.createdAt
  }
  return newest === undefined ? {} : { newestSessionAt: newest }
}

/** Observatory (`ctx.observatory`): the withheld, staleness-aware scoreboard page. */
export class ObservatoryService extends Service {
  static inject = ['scorekeeper', 'sessionPersistence']

  static Config: z<Config> = z.object({
    withhold: z.object({
      districts: z.array(z.string()).required(),
      heldOut: z.boolean().required(),
    }).required(),
    staleAfterMs: z.natural().min(1).required(),
    refreshIntervalMs: z.natural().min(1).required(),
  })

  private readonly config: Config

  constructor(ctx: Context, config: Config) {
    super(ctx, 'observatory')
    this.config = config
  }

  /**
   * Fold every persisted session into one publication-ready snapshot.
   * @param request - the experiment results the caller holds; absent publishes no ranking.
   * @returns the public rows in the page's stable order, what withholding
   *   removed, the rankable verdicts, the fold time, and the newest folded
   *   session's creation time.
   */
  async snapshot(request: ObservatorySnapshotRequest = {}): Promise<ObservatorySnapshot> {
    const headers = await this.ctx.sessionPersistence.list()
    const batch = await this.ctx.scorekeeper.leaderboard({ sessions: headers.map(header => header.id) })
    const split = withhold(batch.rows, this.config.withhold)
    const rows = orderRows(split.published)
    return {
      rows,
      withheld: {
        districts: this.config.withhold.districts,
        districtRows: split.districtRows,
        districtSessions: split.districtSessions,
        heldOutRows: split.heldOutRows,
        heldOutSessions: split.heldOutSessions,
      },
      experiments: rankable(request.experiments ?? [], rows),
      sessions: batch.sessions,
      unstamped: batch.unstamped,
      skipped: batch.skipped,
      foldedAt: batch.computedAt,
      ...newestOf(headers),
      refreshIntervalMs: this.config.refreshIntervalMs,
    }
  }

  /**
   * Render one snapshot as both faces of one publication.
   * @param snapshot - the fold to publish.
   * @param now - epoch milliseconds the publication is rendered at; it decides staleness against the configured threshold.
   * @returns the self-contained HTML page and the JSON document, which state the same facts.
   */
  render(snapshot: ObservatorySnapshot, now: number): ObservatoryPage {
    const json = publishDocument(snapshot, now, this.config.staleAfterMs)
    return { html: renderHtml(json), json }
  }
}

export default ObservatoryService
