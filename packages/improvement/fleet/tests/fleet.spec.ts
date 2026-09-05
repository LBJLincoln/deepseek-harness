import { mkdtemp, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { EnvironmentRunError } from '@deepseek-ai/dsh-environment-runner'
import type { EnvironmentRunReport, EnvironmentRunRequest } from '@deepseek-ai/dsh-environment-runner'
import { EnvironmentId } from '@deepseek-ai/dsh-environments'
import type { EnvironmentDefinition, EnvironmentFilter, EnvironmentId as EnvironmentIdType } from '@deepseek-ai/dsh-environments/types'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { CheckId } from '@deepseek-ai/dsh-verification'
import FleetService, { FleetError, leaderboardMarkdown, resolveConfig } from '@deepseek-ai/dsh-fleet'
import type { Config, FleetPlan, LeaderboardRow } from '@deepseek-ai/dsh-fleet'
import * as invariantCompanion from '@deepseek-ai/dsh-fleet/invariant'

declare module '@deepseek-ai/dsh-environments/types' {
  interface EnvironmentKindMap {
    smoke: Record<string, never>
  }
}

const HEX = 'd'.repeat(64)
const ROUND_TRIP = EnvironmentId('smoke:round-trip')
const UNSATISFIABLE = EnvironmentId('smoke:unsatisfiable')
const RESERVED = EnvironmentId('smoke:reserved')
const MODEL_A = { provider: 'mock', model: 'a' }
const MODEL_B = { provider: 'mock', model: 'b' }
const DEFAULT_MODEL = { provider: 'mock', model: 'mock-default' }

function definition(id: EnvironmentIdType, heldOut: boolean): EnvironmentDefinition {
  return {
    id,
    kind: 'smoke',
    name: id,
    description: id,
    task: { prompt: `Run ${id}.` },
    checks: [{ id: CheckId('check'), outcome: 'passes', run: 'true' }],
    heldOut,
    owner: '@deepseek-ai/dsh-fleet-tests',
    provenance: 'curated',
    detail: {},
  }
}

class StubEnvironments extends Service {
  readonly definitions = [definition(ROUND_TRIP, false), definition(UNSATISFIABLE, false), definition(RESERVED, true)]
  constructor(ctx: Context) {
    super(ctx, 'environments')
  }
  get(id: string): EnvironmentDefinition | undefined {
    return this.definitions.find(candidate => candidate.id === id)
  }
  list(filter: EnvironmentFilter = {}): EnvironmentDefinition[] {
    return this.definitions.filter(candidate => (
      (filter.kind === undefined || candidate.kind === filter.kind)
      && (filter.heldOut === undefined || candidate.heldOut === filter.heldOut)
    ))
  }
}

class StubDefaultModel extends Service {
  constructor(ctx: Context) {
    super(ctx, 'agentDefaultModel')
  }
  currentSelection() {
    return DEFAULT_MODEL
  }
}

type Script = (request: EnvironmentRunRequest) => EnvironmentRunReport | Promise<EnvironmentRunReport>

class StubRuns extends Service {
  static current: StubRuns
  readonly requests: EnvironmentRunRequest[] = []
  script: Script = request => report(request, { certified: true })
  inFlight = 0
  maxInFlight = 0
  constructor(ctx: Context) {
    super(ctx, 'environmentRuns')
    StubRuns.current = this
  }
  async run(request: EnvironmentRunRequest): Promise<EnvironmentRunReport> {
    this.requests.push(request)
    this.inFlight += 1
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight)
    try {
      return await this.script(request)
    } finally {
      this.inFlight -= 1
    }
  }
}

interface ReportShape {
  certified: boolean
  attempts?: number
  usage?: { inputTokens: number; outputTokens: number }
}

function report(request: EnvironmentRunRequest, shape: ReportShape): EnvironmentRunReport {
  const model = request.model ?? DEFAULT_MODEL
  const count = shape.attempts ?? 1
  const attempts = Array.from({ length: count }, (_, index) => ({
    attempt: index + 1,
    results: [{
      checkId: CheckId('check'),
      status: shape.certified && index === count - 1 ? 'pass' as const : 'fail' as const,
      evidence: 'exit 0',
    }],
  }))
  return {
    environment: request.environment,
    sessionId: SessionId(`session-${request.environment}-${request.repetition ?? 0}-${model.model}`),
    stamp: {
      kind: 'environment/run',
      version: 1,
      environmentId: request.environment,
      environmentKind: 'smoke',
      heldOut: request.environment === RESERVED,
      promptSha256: HEX,
      checksSha256: HEX,
      contentSha256: HEX,
      repetition: request.repetition ?? 0,
      ...request.group === undefined ? {} : { group: request.group },
      model,
      isolation: 'process',
    },
    attempts,
    certified: shape.certified,
    ...shape.usage === undefined ? {} : { usage: shape.usage },
  }
}

function row(overrides: Partial<LeaderboardRow> & Pick<LeaderboardRow, 'model' | 'environmentId'>): LeaderboardRow {
  return {
    provider: 'mock',
    environmentKind: 'smoke',
    heldOut: false,
    isolation: 'process',
    runs: 2,
    errors: 0,
    certified: 2,
    certificateRate: 1,
    attemptsMean: 1,
    inputTokens: 0,
    outputTokens: 0,
    ...overrides,
  }
}

interface Harness {
  ctx: Context
  root: string
  /** A complete plan over both training environments; `group` is `batch-1` unless the second argument is `null`. */
  plan: (overrides?: Partial<FleetPlan>, group?: string | null) => FleetPlan
}

async function harness(config: Config = {}): Promise<Harness> {
  const ctx = new Context()
  for (const stub of [StubEnvironments, StubDefaultModel, StubRuns]) await ctx.plugin(stub)
  await ctx.plugin(FleetService, config)
  const root = await mkdtemp(join(tmpdir(), 'fleet-'))
  const plan = (overrides: Partial<FleetPlan> = {}, group: string | null = 'batch-1'): FleetPlan => ({
    environments: { ids: [ROUND_TRIP, UNSATISFIABLE] },
    models: [MODEL_A, MODEL_B],
    repetitions: 2,
    workspaceRoot: root,
    ...group === null ? {} : { group },
    ...overrides,
  })
  return { ctx, root, plan }
}

describe('FleetService', () => {
  it('runs every cell in plan order in fresh workspaces and folds one row per route and environment', async () => {
    const { ctx, root, plan } = await harness()
    StubRuns.current.script = request => (
      request.environment === UNSATISFIABLE
        ? report(request, { certified: false, attempts: 2, usage: { inputTokens: 5, outputTokens: 1 } })
        : report(request, { certified: true, usage: { inputTokens: 10, outputTokens: 3 } })
    )
    const result = await ctx.fleet.run(plan())

    expect(result.group).toBe('batch-1')
    expect(result.cells).toHaveLength(8)
    const order = result.cells.map(outcome => [outcome.cell.environment, outcome.cell.model.model, outcome.cell.repetition])
    expect(order).toEqual([
      [ROUND_TRIP, 'a', 0], [ROUND_TRIP, 'a', 1], [ROUND_TRIP, 'b', 0], [ROUND_TRIP, 'b', 1],
      [UNSATISFIABLE, 'a', 0], [UNSATISFIABLE, 'a', 1], [UNSATISFIABLE, 'b', 0], [UNSATISFIABLE, 'b', 1],
    ])
    expect(result.cells.every(outcome => 'report' in outcome)).toBe(true)
    const { requests } = StubRuns.current
    expect(requests).toHaveLength(8)
    expect(requests.map(request => request.group)).toEqual(Array<string>(8).fill('batch-1'))
    expect(requests.map(request => request.repetition)).toEqual([0, 1, 0, 1, 0, 1, 0, 1])
    expect(requests[0]).not.toHaveProperty('signal')
    const workspaces = requests.map(request => request.workspace)
    expect(new Set(workspaces).size).toBe(8)
    for (const workspace of workspaces) {
      expect(workspace.startsWith(join(root, 'cell-'))).toBe(true)
      expect((await stat(workspace)).isDirectory()).toBe(true)
    }
    expect(StubRuns.current.maxInFlight).toBe(1)

    expect(result.leaderboard).toEqual([
      row({ model: 'a', environmentId: ROUND_TRIP, inputTokens: 20, outputTokens: 6 }),
      row({ model: 'b', environmentId: ROUND_TRIP, inputTokens: 20, outputTokens: 6 }),
      row({ model: 'a', environmentId: UNSATISFIABLE, certified: 0, certificateRate: 0, attemptsMean: 2, inputTokens: 10, outputTokens: 2 }),
      row({ model: 'b', environmentId: UNSATISFIABLE, certified: 0, certificateRate: 0, attemptsMean: 2, inputTokens: 10, outputTokens: 2 }),
    ])
  })

  it('selects by registry filter, runs the default route when no model is named, and mints a group', async () => {
    const { ctx, plan } = await harness()
    const result = await ctx.fleet.run(plan({ environments: { filter: { heldOut: true } }, models: [], repetitions: 1 }, null))
    expect(result.group).toMatch(/^fleet-/)
    expect(result.cells).toHaveLength(1)
    expect(result.cells[0]?.cell).toEqual({ environment: RESERVED, model: DEFAULT_MODEL, repetition: 0 })
    expect(StubRuns.current.requests[0]).toMatchObject({ model: DEFAULT_MODEL, group: result.group })
    expect(result.leaderboard).toEqual([
      row({ model: 'mock-default', environmentId: RESERVED, heldOut: true, runs: 1, certified: 1 }),
    ])
    expect(leaderboardMarkdown(result)).toContain('| mock/mock-default | smoke:reserved | yes | process | 1 | 0 | 1 | 1.00 | 1.00 | 0 / 0 |')
  })

  it('keeps a failing cell as an error outcome and leaves its row without an isolation claim', async () => {
    const { ctx, plan } = await harness()
    const exploded: unknown = 'runner exploded'
    StubRuns.current.script = (request) => {
      if (request.environment !== UNSATISFIABLE) return report(request, { certified: true })
      if (request.repetition === 0) throw new EnvironmentRunError('no workspace', 'ENVIRONMENT_RUN_INVALID_WORKSPACE')
      if (request.repetition === 1) throw new Error('workspace vanished')
      throw exploded
    }
    const result = await ctx.fleet.run(plan({ models: [MODEL_A], repetitions: 3 }))
    const failures = result.cells.flatMap(outcome => ('error' in outcome ? [outcome.error] : []))
    expect(failures).toEqual([
      { code: 'ENVIRONMENT_RUN_INVALID_WORKSPACE', message: 'no workspace' },
      { message: 'workspace vanished' },
      { message: 'runner exploded' },
    ])
    const failed = result.leaderboard.find(candidate => candidate.environmentId === UNSATISFIABLE)
    expect(failed).toEqual({
      provider: 'mock',
      model: 'a',
      environmentId: UNSATISFIABLE,
      environmentKind: 'smoke',
      heldOut: false,
      runs: 0,
      errors: 3,
      certified: 0,
      certificateRate: 0,
      attemptsMean: 0,
      inputTokens: 0,
      outputTokens: 0,
    })
    expect(failed).not.toHaveProperty('isolation')
    const markdown = leaderboardMarkdown(result)
    expect(markdown.split('\n')[0]).toBe('Fleet run `batch-1`')
    expect(markdown).toContain('| mock/a | smoke:round-trip | no | process | 3 | 0 | 3 | 1.00 | 1.00 | 0 / 0 |')
    expect(markdown).toContain('| mock/a | smoke:unsatisfiable | no | - | 0 | 3 | 0 | 0.00 | 0.00 | 0 / 0 |')
    expect(markdown.endsWith('|\n')).toBe(true)
  })

  it('refuses a plan it cannot start before running any cell', async () => {
    const { ctx, plan } = await harness()
    const empty = ctx.fleet.run(plan({ environments: { filter: { kind: 'other' as 'smoke' } } }))
    await expect(empty).rejects.toMatchObject({ code: 'FLEET_EMPTY_PLAN' })
    await expect(ctx.fleet.run(plan({ repetitions: 0 }))).rejects.toMatchObject({ code: 'FLEET_INVALID_PLAN' })
    await expect(ctx.fleet.run(plan({ repetitions: 1.5 }))).rejects.toMatchObject({ code: 'FLEET_INVALID_PLAN' })
    const unknown = ctx.fleet.run(plan({ environments: { ids: [EnvironmentId('smoke:missing')] } }))
    await expect(unknown).rejects.toBeInstanceOf(FleetError)
    await expect(unknown).rejects.toMatchObject({ code: 'FLEET_INVALID_PLAN', message: 'environment "smoke:missing" is not registered' })
    expect(StubRuns.current.requests).toEqual([])
  })

  it('bounds concurrency to the configured maximum, keeps plan order, and passes the abort signal through', async () => {
    const { ctx, plan } = await harness({ maxConcurrent: 3 })
    StubRuns.current.script = async (request) => {
      await new Promise(resolve => setTimeout(resolve, request.repetition === 0 ? 20 : 1))
      return report(request, { certified: true })
    }
    const controller = new AbortController()
    const result = await ctx.fleet.run(plan({ models: [MODEL_A], repetitions: 3, signal: controller.signal }))
    expect(StubRuns.current.maxInFlight).toBe(3)
    expect(result.cells.map(outcome => outcome.cell.repetition)).toEqual([0, 1, 2, 0, 1, 2])
    expect(StubRuns.current.requests.every(request => request.signal === controller.signal)).toBe(true)

    const single = await ctx.fleet.run(plan({ environments: { ids: [ROUND_TRIP] }, models: [MODEL_A], repetitions: 1 }))
    expect(single.cells).toHaveLength(1)
  })

  it('resolves defaults once, at the boundary', () => {
    expect(resolveConfig({})).toEqual({ maxConcurrent: 1 })
    expect(resolveConfig({ maxConcurrent: 4 })).toEqual({ maxConcurrent: 4 })
  })

  it('registers its empty invariant companion', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(invariantCompanion)).resolves.toBeDefined()
  })
})
