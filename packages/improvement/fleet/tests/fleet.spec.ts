import { mkdtemp, readdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
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
import type { Config, FleetPlan, LeaderboardRow, WorkspaceRetention } from '@deepseek-ai/dsh-fleet'
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
    treeHash: HEX,
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

async function harness(config: Partial<Config> = {}): Promise<Harness> {
  const ctx = new Context()
  for (const stub of [StubEnvironments, StubDefaultModel, StubRuns]) await ctx.plugin(stub)
  await ctx.plugin(FleetService, { workspaceRetention: 'keep', ...config } satisfies Config)
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
    expect(requests[0]).not.toHaveProperty('district')
    expect(result.spend).toEqual({ inputTokens: 60, outputTokens: 16 })
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
    await expect(ctx.fleet.run(plan({ tokenCeiling: 0 }))).rejects.toMatchObject({ code: 'FLEET_INVALID_PLAN' })
    const fractional = ctx.fleet.run(plan({ tokenCeiling: 2.5 }))
    await expect(fractional).rejects.toMatchObject({ message: 'tokenCeiling must be a positive integer, got 2.5' })
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

  it('carries the plan district into every cell request', async () => {
    const { ctx, plan } = await harness()
    const result = await ctx.fleet.run(plan({ environments: { ids: [ROUND_TRIP] }, models: [MODEL_A], repetitions: 2, district: 'workshop' }))
    expect(StubRuns.current.requests.map(request => request.district)).toEqual(['workshop', 'workshop'])
    expect(result.cells.every(outcome => 'report' in outcome)).toBe(true)
  })

  it('stops scheduling a route once it errors consecutively, keeping the plan order and the row counts', async () => {
    const { ctx, plan } = await harness({ routeBreaker: { consecutiveErrors: 2 } })
    StubRuns.current.script = (request) => {
      if (request.model?.model === 'a') throw new Error('route a is down')
      return report(request, { certified: true, usage: { inputTokens: 4, outputTokens: 1 } })
    }
    const result = await ctx.fleet.run(plan())

    const order = result.cells.map(outcome => [outcome.cell.environment, outcome.cell.model.model, outcome.cell.repetition])
    expect(order).toEqual([
      [ROUND_TRIP, 'a', 0], [ROUND_TRIP, 'a', 1], [ROUND_TRIP, 'b', 0], [ROUND_TRIP, 'b', 1],
      [UNSATISFIABLE, 'a', 0], [UNSATISFIABLE, 'a', 1], [UNSATISFIABLE, 'b', 0], [UNSATISFIABLE, 'b', 1],
    ])
    expect(result.cells.flatMap(outcome => ('error' in outcome ? [outcome.error] : []))).toEqual([
      { message: 'route a is down' },
      { message: 'route a is down' },
      { code: 'FLEET_ROUTE_BREAKER_OPEN', message: 'route mock/a stopped after 2 consecutive errors' },
      { code: 'FLEET_ROUTE_BREAKER_OPEN', message: 'route mock/a stopped after 2 consecutive errors' },
    ])
    expect(StubRuns.current.requests.map(request => request.model?.model)).toEqual(['a', 'a', 'b', 'b', 'b', 'b'])
    expect(result.leaderboard.map(row => [row.model, row.environmentId, row.runs, row.errors])).toEqual([
      ['a', ROUND_TRIP, 0, 2], ['b', ROUND_TRIP, 2, 0],
      ['a', UNSATISFIABLE, 0, 2], ['b', UNSATISFIABLE, 2, 0],
    ])
    expect(result.spend).toEqual({ inputTokens: 16, outputTokens: 4 })

    StubRuns.current.script = (request) => {
      if (request.model?.model === 'a' && request.repetition === 0) throw new Error('route a flickered')
      return report(request, { certified: true })
    }
    const recovered = await ctx.fleet.run(plan())
    expect(recovered.cells.flatMap(outcome => ('error' in outcome ? [outcome.error] : []))).toEqual([
      { message: 'route a flickered' },
      { message: 'route a flickered' },
    ])
  })

  it('refuses every unstarted cell once the reported spend crosses the ceiling, and lets the in-flight ones finish', async () => {
    const { ctx, plan } = await harness({ maxConcurrent: 2 })
    StubRuns.current.script = async (request) => {
      await new Promise(resolve => setTimeout(resolve, request.repetition === 0 ? 20 : 1))
      return report(request, { certified: true, usage: { inputTokens: 10, outputTokens: 0 } })
    }
    const result = await ctx.fleet.run(plan({
      environments: { ids: [ROUND_TRIP] },
      models: [MODEL_A],
      repetitions: 4,
      tokenCeiling: 10,
    }))

    expect(result.cells.map(outcome => ('report' in outcome ? 'report' : outcome.error.code))).toEqual([
      'report', 'report', 'FLEET_TOKEN_CEILING_REACHED', 'FLEET_TOKEN_CEILING_REACHED',
    ])
    expect(result.cells.at(-1)).toMatchObject({
      error: { message: "the plan's token ceiling of 10 was reached at 10 tokens" },
    })
    expect(StubRuns.current.requests.map(request => request.repetition)).toEqual([0, 1])
    expect(result.spend).toEqual({ inputTokens: 20, outputTokens: 0 })
    expect(result.leaderboard).toEqual([
      row({ model: 'a', environmentId: ROUND_TRIP, errors: 2, inputTokens: 20 }),
    ])
  })

  it('removes each settled cell workspace as the configured retention says', async () => {
    const script: Script = (request) => {
      if (request.environment === RESERVED) throw new Error('the cell could not boot')
      return report(request, { certified: request.environment === ROUND_TRIP })
    }
    const observe = async (workspaceRetention: WorkspaceRetention): Promise<string[]> => {
      const { ctx, root, plan } = await harness({ workspaceRetention })
      StubRuns.current.script = script
      await ctx.fleet.run(plan({
        environments: { ids: [ROUND_TRIP, UNSATISFIABLE, RESERVED] },
        models: [MODEL_A],
        repetitions: 1,
      }))
      const kept = new Set(await readdir(root))
      return StubRuns.current.requests
        .filter(request => kept.has(basename(request.workspace)))
        .map(request => request.environment)
    }
    expect(await observe('keep')).toEqual([ROUND_TRIP, UNSATISFIABLE, RESERVED])
    expect(await observe('remove-certified')).toEqual([UNSATISFIABLE, RESERVED])
    expect(await observe('remove-all')).toEqual([])
  })

  it('keeps a cell whose workspace could not be minted as an error outcome with nothing to reap', async () => {
    const { ctx, root, plan } = await harness({ workspaceRetention: 'remove-all' })
    const result = await ctx.fleet.run(plan({
      environments: { ids: [ROUND_TRIP] },
      models: [MODEL_A],
      repetitions: 1,
      workspaceRoot: join(root, 'absent'),
    }))
    expect(result.cells).toHaveLength(1)
    const failure = result.cells[0]
    expect(failure !== undefined && 'error' in failure && failure.error.message).toContain('ENOENT')
    expect(StubRuns.current.requests).toEqual([])
  })

  it('throws through the exhaustiveness guard for a rogue retention value (closed union)', async () => {
    // Only a cast reaches this tag: the config schema refuses it, so a retention
    // mode added later fails to compile here instead of silently keeping a workspace.
    const { ctx, plan } = await harness()
    ;(ctx.fleet as unknown as { resolved: { workspaceRetention: string } }).resolved.workspaceRetention = 'archive'
    const rogue = ctx.fleet.run(plan({ environments: { ids: [ROUND_TRIP] }, models: [MODEL_A], repetitions: 1 }))
    await expect(rogue).rejects.toThrow('unreachable variant')
  })

  it('resolves defaults once, at the boundary', () => {
    expect(resolveConfig({ workspaceRetention: 'keep' }))
      .toEqual({ maxConcurrent: 1, routeBreaker: undefined, workspaceRetention: 'keep' })
    expect(resolveConfig({ maxConcurrent: 4, routeBreaker: { consecutiveErrors: 3 }, workspaceRetention: 'remove-all' }))
      .toEqual({ maxConcurrent: 4, routeBreaker: { consecutiveErrors: 3 }, workspaceRetention: 'remove-all' })
  })

  it('registers its empty invariant companion', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(invariantCompanion)).resolves.toBeDefined()
  })
})
