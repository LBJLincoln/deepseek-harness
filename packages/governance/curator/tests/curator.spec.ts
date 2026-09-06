/**
 * The curated export over a real session store, a real persistence backend, and
 * the real trajectory exporter: which profile an export may run under, which
 * sessions its purpose admits, what each written record carries, and what the
 * manifest accounts for.
 */

import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import DataUseService from '@deepseek-ai/dsh-data-use'
import type { Config as DataUseConfig, DataUseTerms } from '@deepseek-ai/dsh-data-use'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import TrajectoryService from '@deepseek-ai/dsh-trajectories'
import type { TrajectorySink } from '@deepseek-ai/dsh-trajectories'
import CuratorService, { EXPORT_MANIFEST_VERSION } from '@deepseek-ai/dsh-curator'
import type { Config, CuratedTrajectory, CuratorError } from '@deepseek-ai/dsh-curator'
import * as invariantCompanion from '@deepseek-ai/dsh-curator/invariant'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

/** The deployment's terms, admitting everything but training. */
const TERMS: DataUseConfig = {
  clientId: 'acme',
  agreementId: 'msa-2026-1',
  purposes: ['delivery', 'evaluation'],
  residency: 'eu-west',
  retentionDays: 90,
  redactionProfile: 'village-v1',
}

/** A profile of the shipped rules alone, which every case exports under. */
const PROFILES: Config = { profiles: { 'village-v1': { shipped: true } }, defaultProfile: 'village-v1' }

async function harness(config: Config = PROFILES): Promise<{ ctx: Context; root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-curator-'))
  roots.push(root)
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  await ctx.plugin(TrajectoryService, {})
  await ctx.plugin(DataUseService, TERMS)
  await ctx.plugin(CuratorService, config)
  return { ctx, root }
}

const HEX = 'b'.repeat(64)

/** What one persisted session states about itself. */
interface Persisted {
  /** Terms pinned in the log; absent leaves the session unpinned. */
  readonly terms?: DataUseTerms
  /** Whether the run's environment is reserved for evaluation. */
  readonly heldOut?: boolean
  /** District the run belonged to. */
  readonly district?: string
  /** Text of the session's one assistant message. */
  readonly text?: string
}

/** A balanced one-step log carrying a run stamp, an answer, and optionally its terms. */
function events(persisted: Persisted): SessionEvent[] {
  const raw: unknown[] = [
    ...persisted.terms === undefined ? [] : [{ type: 'dataUse/terms', data: persisted.terms }],
    {
      type: 'environment/run',
      data: {
        kind: 'environment/run', version: 1, environmentId: 'smoke:round-trip', environmentKind: 'smoke',
        heldOut: persisted.heldOut === true, promptSha256: HEX, checksSha256: HEX, contentSha256: HEX, repetition: 0,
        ...persisted.district === undefined ? {} : { district: persisted.district },
        model: { provider: 'cli-mock', model: 'cli-mock' }, isolation: 'none',
      },
    },
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'step/start', data: { turn: 1, step: 1 } },
    { type: 'request/header', data: { header: { config: { provider: 'cli-mock', model: 'cli-mock' } }, reason: 'initial' } },
    { type: 'user/message', data: createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }), surfaceOp: 'append' },
    {
      type: 'assistant/message',
      data: {
        turn: 1,
        step: 1,
        message: createAssistantMessage({
          content: [{ type: 'text', text: persisted.text ?? 'done' }],
          source: { provider: 'cli-mock', model: 'cli-mock' },
        }),
      },
      surfaceOp: 'append',
      sourceEventSeqs: [],
    },
    { type: 'step/end', data: { turn: 1, step: 1 } },
    { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ]
  return raw.map((event, seq) => ({ ...event as object, seq, time: 1_000 + seq }) as SessionEvent)
}

async function persist(ctx: Context, id: string, persisted: Persisted): Promise<SessionId> {
  const header: SessionHeader = { version: SESSION_FORMAT_VERSION, id: SessionId(id), createdAt: 100 }
  await ctx.sessionPersistence.create(header)
  await ctx.sessionPersistence.append(header.id, events(persisted))
  return header.id
}

function memorySink(): TrajectorySink & { lines: string[]; closed: number } {
  const sink = {
    lines: [] as string[],
    closed: 0,
    write(line: string) { sink.lines.push(line) },
    close() { sink.closed += 1 },
  }
  return sink
}

/** The one exported record of a sink that wrote exactly one line. */
function only(sink: { lines: string[] }): CuratedTrajectory {
  expect(sink.lines).toHaveLength(1)
  return JSON.parse(sink.lines[0] as string) as CuratedTrajectory
}

describe('choosing the profile an export runs under', () => {
  it('refuses an export that names no profile when none is configured by default', async () => {
    const { ctx } = await harness({ profiles: PROFILES.profiles })
    await persist(ctx, 'certified', { terms: TERMS })
    const sink = memorySink()
    await expect(ctx.curator.export({ purpose: 'evaluation', sink }))
      .rejects.toThrow('this export names no redaction profile and no defaultProfile is configured')
    await expect(ctx.curator.export({ purpose: 'evaluation', sink }))
      .rejects.toThrow(expect.objectContaining<Partial<CuratorError>>({ code: 'CURATOR_PROFILE_REQUIRED' }))
    expect(sink.lines).toEqual([])
    expect(sink.closed).toBe(0)
  })

  it('refuses a profile this deployment did not configure', async () => {
    const { ctx } = await harness()
    await expect(ctx.curator.export({ purpose: 'evaluation', profile: 'client-v3', sink: memorySink() }))
      .rejects.toThrow('redaction profile "client-v3" is not configured; this deployment configured village-v1')
    await expect(ctx.curator.export({ purpose: 'evaluation', profile: 'client-v3', sink: memorySink() }))
      .rejects.toThrow(expect.objectContaining<Partial<CuratorError>>({ code: 'CURATOR_PROFILE_UNKNOWN' }))
  })

  it('refuses a configuration that could export under no profile at all', async () => {
    await expect(harness({ profiles: {} }))
      .rejects.toThrow('profiles is empty, so this deployment could export under no profile at all')
    await expect(harness({ profiles: PROFILES.profiles, defaultProfile: 'missing' }))
      .rejects.toThrow('defaultProfile "missing" is not one of the configured profiles village-v1')
    await expect(harness({ profiles: { broken: { shipped: false, rules: [{ id: 'x', pattern: '(', replacement: 'y' }] } } }))
      .rejects.toThrow('does not compile')
  })

  it('runs the profile the request names over the configured default', async () => {
    const { ctx } = await harness({
      profiles: { 'village-v1': { shipped: true }, 'marker-only': { shipped: false, rules: [{ id: 'marker', pattern: 'done', replacement: 'MARKED' }] } },
      defaultProfile: 'village-v1',
    })
    await persist(ctx, 'certified', { terms: TERMS })
    const sink = memorySink()
    const report = await ctx.curator.export({ purpose: 'evaluation', profile: 'marker-only', sink })
    expect(report.manifest.profile).toBe('marker-only')
    expect(report.manifest.ruleHits).toEqual({ marker: 1 })
    expect(only(sink).messages.at(-1)?.content).toEqual([{ type: 'text', text: 'MARKED' }])
  })
})

describe('gating one export by the terms each session carries', () => {
  it('withholds every session a training export may not read, and admits them for evaluation', async () => {
    const { ctx } = await harness()
    await persist(ctx, 'pinned', { terms: TERMS, text: 'reach nobody@example.invalid with sk-test-0000' })
    await persist(ctx, 'unpinned', {})

    const training = memorySink()
    const withheld = await ctx.curator.export({ purpose: 'training', sink: training })
    expect(withheld.withheldByTerms).toBe(2)
    expect(withheld.exported).toBe(0)
    expect(training.lines).toEqual([])
    expect(training.closed).toBe(1)
    expect(withheld.manifest).toMatchObject({
      purpose: 'training',
      records: 0,
      withheld: { heldOut: 0, districts: 0, terms: 2 },
      recordsSha256: createHash('sha256').update('').digest('hex'),
    })

    const evaluation = memorySink()
    const exported = await ctx.curator.export({ purpose: 'evaluation', sink: evaluation })
    expect(exported.withheldByTerms).toBe(1)
    expect(exported.exported).toBe(1)
    expect(only(evaluation).id).toBe('pinned')
  })

  it('withholds a session whose terms admit some other purpose', async () => {
    const { ctx } = await harness()
    await persist(ctx, 'delivery-only', { terms: { ...TERMS, purposes: ['delivery'] } })
    const sink = memorySink()
    const report = await ctx.curator.export({ purpose: 'evaluation', sink })
    expect(report).toMatchObject({ sessions: 1, exported: 0, withheldByTerms: 1, skipped: [] })
  })

  it('reports a session it could not read while looking for its terms', async () => {
    const { ctx } = await harness()
    const known = await persist(ctx, 'pinned', { terms: TERMS })
    const sink = memorySink()
    const report = await ctx.curator.export({ purpose: 'evaluation', sessions: [SessionId('missing'), known], sink })
    expect(report.sessions).toBe(2)
    expect(report.exported).toBe(1)
    expect(report.skipped).toHaveLength(1)
    expect(report.skipped[0]?.sessionId).toBe('missing')
  })

  it('reports a backend rejection that is not an Error by its string form', async () => {
    class RejectingPersistence extends Service {
      constructor(ctx: Context) {
        super(ctx, 'sessionPersistence')
      }

      list(): Promise<SessionHeader[]> {
        return Promise.resolve([{ version: SESSION_FORMAT_VERSION, id: SessionId('broken'), createdAt: 1 }])
      }

      inspect(): Promise<never> {
        // A backend rejecting with a bare string is the non-Error path the report must still render.
        // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- the string rejection is the case under test
        return Promise.reject('artifact unreadable')
      }
    }
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(RejectingPersistence)
    await ctx.plugin(TrajectoryService, {})
    await ctx.plugin(DataUseService, TERMS)
    await ctx.plugin(CuratorService, PROFILES)
    const report = await ctx.curator.export({ purpose: 'evaluation', sink: memorySink() })
    expect(report.skipped).toEqual([{ sessionId: 'broken', reason: 'artifact unreadable' }])
    expect(report.manifest.records).toBe(0)
  })
})

describe('what one exported record carries', () => {
  it('redacts the transcript, states the profile that ran, and copies the residency', async () => {
    const { ctx } = await harness()
    await persist(ctx, 'pinned', { terms: TERMS, text: 'mail nobody@example.invalid, key sk-test-0000' })
    const sink = memorySink()
    const report = await ctx.curator.export({ purpose: 'evaluation', sink })
    const record = only(sink)
    expect(record.messages.at(-1)?.content).toEqual([{ type: 'text', text: 'mail [redacted:email], key [redacted:api-key]' }])
    expect(sink.lines[0]).not.toContain('nobody@example.invalid')
    expect(sink.lines[0]).not.toContain('sk-test-0000')
    expect(record.curation).toEqual({
      redactionApplied: true,
      redaction: {
        profile: 'village-v1',
        profileSha256: report.manifest.profileSha256,
        hits: { 'shipped:email': 1, 'shipped:api-key': 1 },
      },
      residency: 'eu-west',
    })
    expect(record.id).toBe('pinned')
    expect(record.environment?.environmentId).toBe('smoke:round-trip')
    expect(report.manifest.ruleHits).toEqual({
      'shipped:email': 1,
      'shipped:bearer-token': 0,
      'shipped:api-key': 1,
      'shipped:ipv4': 0,
      'shipped:e164-phone': 0,
    })
  })

  it('copies the residency named by each session\'s own terms', async () => {
    const { ctx } = await harness()
    await persist(ctx, 'eu', { terms: TERMS })
    await persist(ctx, 'us', { terms: { ...TERMS, residency: 'us-east' } })
    const sink = memorySink()
    await ctx.curator.export({ purpose: 'evaluation', sink })
    const residencies = sink.lines.map(line => (JSON.parse(line) as CuratedTrajectory))
    expect(new Map(residencies.map(record => [record.id, record.curation.residency])))
      .toEqual(new Map([['eu', 'eu-west'], ['us', 'us-east']]))
  })
})

describe('the export manifest', () => {
  it('accounts for held-out and district withholding beside the terms, and digests the lines it wrote', async () => {
    const { ctx } = await harness()
    await persist(ctx, 'exported', { terms: TERMS, district: 'proving-ground' })
    await persist(ctx, 'reserved', { terms: TERMS, heldOut: true, district: 'proving-ground' })
    await persist(ctx, 'workshop', { terms: TERMS, district: 'workshop' })
    const sink = memorySink()
    const report = await ctx.curator.export({ purpose: 'evaluation', sink, districts: ['proving-ground'], rewardedOnly: false, includeHeldOut: false })
    expect(report).toMatchObject({
      sessions: 3,
      exported: 1,
      rewarded: 0,
      filtered: 0,
      heldOut: 1,
      withheldByDistrict: 1,
      withheldByTerms: 0,
      skipped: [],
    })
    expect(report.manifest).toMatchObject({
      version: EXPORT_MANIFEST_VERSION,
      purpose: 'evaluation',
      profile: 'village-v1',
      records: 1,
      withheld: { heldOut: 1, districts: 1, terms: 0 },
      trajectoryFormat: 'dsh-trajectory/1',
    })
    expect(report.manifest.exportedAt).toBeGreaterThan(0)
    expect(report.manifest.recordsSha256).toBe(createHash('sha256').update(sink.lines.join('')).digest('hex'))
  })

  it('digests the same records identically on a second export', async () => {
    const { ctx } = await harness()
    await persist(ctx, 'pinned', { terms: TERMS, text: 'mail nobody@example.invalid' })
    const first = await ctx.curator.export({ purpose: 'evaluation', sink: memorySink() })
    const second = await ctx.curator.export({ purpose: 'evaluation', sink: memorySink() })
    expect(second.manifest.recordsSha256).toBe(first.manifest.recordsSha256)
    expect(second.manifest.profileSha256).toBe(first.manifest.profileSha256)
  })

  it('writes the manifest beside the lines when the request names a path', async () => {
    const { ctx, root } = await harness()
    await persist(ctx, 'pinned', { terms: TERMS })
    const manifestPath = join(root, 'export-manifest.json')
    const report = await ctx.curator.export({ purpose: 'evaluation', sink: memorySink(), manifestPath })
    expect(JSON.parse(await readFile(manifestPath, 'utf8'))).toEqual(report.manifest)
  })
})

describe('the plugin itself', () => {
  it('registers its empty invariant companion', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(invariantCompanion)).resolves.toBeDefined()
  })

  it('withdraws the service when its fiber is disposed', async () => {
    const { ctx } = await harness()
    expect(ctx.get('curator')).toBeDefined()
    await ctx.fiber.dispose()
    expect(ctx.get('curator')).toBeUndefined()
  })
})
