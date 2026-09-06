/**
 * Curated export: the trajectory exporter wrapped in the two rules a transcript
 * may not leave the lab without. It refuses to run without a redaction profile,
 * withholds every session whose pinned `dataUse/terms` do not admit the
 * export's purpose, redacts the record before it reaches the sink, and writes
 * one {@link ExportManifest} beside the lines. It reads persisted logs and
 * writes no session event. The
 * [curator Agent Note](../../../.agents/notes/proposed/architecture/2026-09-06-curator.md)
 * owns the design rationale.
 * @module @deepseek-ai/dsh-curator
 */

import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// The value import also resolves ctx.dataUse.
import { termsOf } from '@deepseek-ai/dsh-data-use'
import type { DataUseTerms } from '@deepseek-ai/dsh-data-use'
// Type-only: resolves ctx.sessionPersistence.
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// The value import also resolves ctx.trajectories.
import { TRAJECTORY_FORMAT } from '@deepseek-ai/dsh-trajectories'
import type { Trajectory, TrajectoryExportSkip } from '@deepseek-ai/dsh-trajectories/types'
import { compileProfile, CuratorError, redactTrajectory } from './redaction.ts'
import type { RedactionProfile } from './redaction.ts'
import type {
  CuratedExportReport,
  CuratedExportRequest,
  CuratedTrajectory,
  ExportManifest,
  RedactionProfileConfig,
} from './types.ts'

export type * from './types.ts'
export {
  applyRules,
  CuratorError,
  redactTrajectory,
  SHIPPED_REDACTION_RULES,
  compileProfile,
  type CompiledRedactionRule,
  type CuratorErrorCode,
  type RedactionProfile,
} from './redaction.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    curator: CuratorService
  }
}

/** Format tag every {@link ExportManifest} carries. */
export const EXPORT_MANIFEST_VERSION = 'dsh-export-manifest/1'

/** Deployment choices of the curated export, validated from `cordis.yml`. */
export interface Config {
  /**
   * Redaction profiles by id, at least one. Redaction is not optional: there is
   * no configuration under which a curated export runs without a profile, so a
   * deployment states here which profiles it can export under.
   */
  profiles: Record<string, RedactionProfileConfig>
  /** Profile an export that names none applies; an export with neither is refused. */
  defaultProfile?: string
}

/** Curated export (`ctx.curator`): redacted, terms-gated trajectory export with a manifest. */
export class CuratorService extends Service {
  static inject = ['trajectories', 'sessionPersistence', 'dataUse']

  // Inline schema call: the config catalog walks `static Config` statically.
  static Config: z<Config> = z.object({
    profiles: z.dict(z.object({
      shipped: z.boolean().required(),
      rules: z.array(z.object({
        id: z.string().required(),
        pattern: z.string().required(),
        flags: z.string(),
        replacement: z.string().required(),
      })).default([]),
    })).required(),
    defaultProfile: z.string(),
  })

  private readonly profiles: Map<string, RedactionProfile>
  private readonly defaultProfile: string | undefined

  constructor(ctx: Context, config: Config) {
    super(ctx, 'curator')
    const entries = Object.entries(config.profiles)
    if (entries.length === 0) {
      throw new CuratorError('profiles is empty, so this deployment could export under no profile at all', 'CURATOR_INVALID_CONFIG')
    }
    this.profiles = new Map(entries.map(([id, profile]) => [id, compileProfile(id, profile)]))
    if (config.defaultProfile !== undefined && !this.profiles.has(config.defaultProfile)) {
      throw new CuratorError(
        `defaultProfile "${config.defaultProfile}" is not one of the configured profiles ${[...this.profiles.keys()].join(', ')}`,
        'CURATOR_INVALID_CONFIG',
      )
    }
    this.defaultProfile = config.defaultProfile
  }

  /**
   * Export the sessions whose pinned terms admit the purpose, redacted under
   * one profile, and write the manifest that accounts for every session the
   * request considered.
   * @param request - the purpose, the profile, the sessions, the sink, and the exporter's own filters.
   * @returns the manifest with the counts behind it, including the sessions withheld by terms and the ones that could not be read.
   * @throws {@link CuratorError} `CURATOR_PROFILE_REQUIRED` when neither the
   *   request nor the configuration names a profile, and `CURATOR_PROFILE_UNKNOWN`
   *   when the request names one this deployment did not configure. Nothing is
   *   written and the sink is not touched in either case.
   */
  async export(request: CuratedExportRequest): Promise<CuratedExportReport> {
    const profile = this.resolveProfile(request.profile)
    const skipped: TrajectoryExportSkip[] = []
    const admitted = new Map<SessionId, DataUseTerms>()
    let withheldByTerms = 0
    const candidates = request.sessions ?? (await this.ctx.sessionPersistence.list()).map(header => header.id)
    for (const sessionId of candidates) {
      let terms: DataUseTerms | undefined
      try {
        terms = termsOf((await this.ctx.sessionPersistence.inspect(sessionId)).events)
      } catch (error: unknown) {
        skipped.push({ sessionId, reason: error instanceof Error ? error.message : String(error) })
        continue
      }
      // No terms, no export: an unpinned transcript states no purpose, and a
      // purpose nobody recorded is never assumed.
      if (terms === undefined || !terms.purposes.includes(request.purpose)) {
        withheldByTerms += 1
        continue
      }
      admitted.set(sessionId, terms)
    }

    const ruleHits = new Map<string, number>()
    const records = createHash('sha256')
    const report = await this.ctx.trajectories.export({
      sessions: [...admitted.keys()],
      sink: {
        write: async (line) => {
          const curated = this.curate(JSON.parse(line) as Trajectory, profile, admitted, ruleHits)
          records.update(curated)
          await request.sink.write(curated)
        },
        close: () => request.sink.close(),
      },
      ...request.rewardedOnly === undefined ? {} : { rewardedOnly: request.rewardedOnly },
      ...request.includeHeldOut === undefined ? {} : { includeHeldOut: request.includeHeldOut },
      ...request.districts === undefined ? {} : { districts: request.districts },
    })

    const manifest: ExportManifest = {
      version: EXPORT_MANIFEST_VERSION,
      exportedAt: Date.now(),
      purpose: request.purpose,
      profile: profile.id,
      profileSha256: profile.sha256,
      records: report.exported,
      withheld: { heldOut: report.heldOut, districts: report.withheld, terms: withheldByTerms },
      // Every rule of the profile is listed, so a reviewer reading the manifest
      // sees which rules never fired at all.
      ruleHits: Object.fromEntries(profile.rules.map(rule => [rule.id, ruleHits.get(rule.id) ?? 0])),
      recordsSha256: records.digest('hex'),
      trajectoryFormat: TRAJECTORY_FORMAT,
    }
    if (request.manifestPath !== undefined) await writeFile(request.manifestPath, `${JSON.stringify(manifest, undefined, 2)}\n`)
    return {
      manifest,
      sessions: candidates.length,
      exported: report.exported,
      rewarded: report.rewarded,
      filtered: report.filtered,
      heldOut: report.heldOut,
      withheldByDistrict: report.withheld,
      withheldByTerms,
      skipped: [...skipped, ...report.skipped],
    }
  }

  /**
   * The profile one export runs under.
   * @param requested - the profile the request named, if any.
   * @returns the compiled profile.
   * @throws {@link CuratorError} when no profile is named or the named one is unknown.
   */
  private resolveProfile(requested: string | undefined): RedactionProfile {
    const id = requested ?? this.defaultProfile
    if (id === undefined) {
      throw new CuratorError(
        'this export names no redaction profile and no defaultProfile is configured; a curated export never runs unredacted',
        'CURATOR_PROFILE_REQUIRED',
      )
    }
    const profile = this.profiles.get(id)
    if (profile === undefined) {
      throw new CuratorError(
        `redaction profile "${id}" is not configured; this deployment configured ${[...this.profiles.keys()].join(', ')}`,
        'CURATOR_PROFILE_UNKNOWN',
      )
    }
    return profile
  }

  /**
   * Redact one folded record and attach the curation block the export states.
   * @param record - the record the exporter serialized.
   * @param profile - the profile this export runs under.
   * @param admitted - the terms of every session the terms pass admitted.
   * @param ruleHits - export-wide replacement counts, incremented in place.
   * @returns the curated line, newline included.
   * @throws {@link CuratorError} when the record names a session the terms pass did not admit.
   */
  private curate(
    record: Trajectory,
    profile: RedactionProfile,
    admitted: ReadonlyMap<SessionId, DataUseTerms>,
    ruleHits: Map<string, number>,
  ): string {
    const terms = admitted.get(record.id)
    /* v8 ignore next 4 -- the exporter reads only the sessions the terms pass admitted and mapped. */
    if (terms === undefined) {
      throw new CuratorError(
        `session ${record.id} reached the sink without admitted terms`,
        'CURATOR_UNADMITTED_RECORD',
      )
    }
    const hits = new Map<string, number>()
    const redacted = redactTrajectory(record, profile.rules, hits)
    for (const [id, count] of hits) ruleHits.set(id, (ruleHits.get(id) ?? 0) + count)
    const curated: CuratedTrajectory = {
      ...redacted,
      curation: {
        redactionApplied: true,
        redaction: { profile: profile.id, profileSha256: profile.sha256, hits: Object.fromEntries(hits) },
        residency: terms.residency,
      },
    }
    return `${JSON.stringify(curated)}\n`
  }
}

export default CuratorService
