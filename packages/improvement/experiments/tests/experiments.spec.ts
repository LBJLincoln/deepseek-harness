import { describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import type { EnvironmentRunReport } from '@deepseek-ai/dsh-environment-runner/types'
import { EnvironmentId } from '@deepseek-ai/dsh-environments'
import type { EnvironmentDefinition, EnvironmentId as EnvironmentIdType, EnvironmentRunModel } from '@deepseek-ai/dsh-environments/types'
import type { FleetCell, FleetCellOutcome, FleetPlan, FleetRunReport } from '@deepseek-ai/dsh-fleet/types'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { TrajectorySink } from '@deepseek-ai/dsh-trajectories/types'
import { CheckId } from '@deepseek-ai/dsh-verification'
import ExperimentService, {
  EXPERIMENT_ARM_ROLES,
  EXPERIMENT_GROUP_PREFIX,
  ExperimentError,
  experimentGroup,
  foldExperiment,
  parseExperimentGroup,
  planDigest,
  projectedTokens,
  resolveConfig,
} from '@deepseek-ai/dsh-experiments'
import type { Config, ExperimentPlan, ExperimentThresholds } from '@deepseek-ai/dsh-experiments'

declare module '@deepseek-ai/dsh-environments/types' {
  interface EnvironmentKindMap {
    smoke: Record<string, never>
  }
}

const HEX = 'c'.repeat(64)
const ROUND_TRIP = EnvironmentId('smoke:round-trip')
const UNSATISFIABLE = EnvironmentId('smoke:unsatisfiable')
const BASELINE = { provider: 'mock', model: 'base' }
const CANDIDATE = { provider: 'mock', model: 'next' }

/** One cell's run as the stub fleet reports it; `undefined` makes the cell an error outcome. */
interface CellShape {
  certified: boolean
  attempts?: number
  usage?: { inputTokens: number; outputTokens: number }
}

type CellScript = (cell: FleetCell) => CellShape | undefined

function definition(id: EnvironmentIdType): EnvironmentDefinition {
  return {
    id,
    kind: 'smoke',
    name: id,
    description: id,
    task: { prompt: `Run ${id}.` },
    checks: [{ id: CheckId('check'), outcome: 'passes', run: 'true' }],
    heldOut: false,
    owner: '@deepseek-ai/dsh-experiments-tests',
    provenance: 'curated',
    detail: {},
  }
}

class StubEnvironments extends Service {
  readonly definitions = [definition(ROUND_TRIP), definition(UNSATISFIABLE)]
  constructor(ctx: Context) {
    super(ctx, 'environments')
  }
  get(id: string): EnvironmentDefinition | undefined {
    return this.definitions.find(candidate => candidate.id === id)
  }
}

function runReport(cell: FleetCell, group: string, shape: CellShape): EnvironmentRunReport {
  const attempts = shape.attempts ?? 1
  return {
    environment: cell.environment,
    sessionId: SessionId(`${group}-${cell.environment}-${cell.repetition}`),
    stamp: {
      kind: 'environment/run',
      version: 1,
      environmentId: cell.environment,
      environmentKind: 'smoke',
      heldOut: false,
      promptSha256: HEX,
      checksSha256: HEX,
      contentSha256: HEX,
      repetition: cell.repetition,
      group,
      model: cell.model,
      isolation: 'none',
    },
    attempts: Array.from({ length: attempts }, (_, index) => ({ attempt: index + 1, results: [], treeHash: HEX })),
    certified: shape.certified,
    ...shape.usage === undefined ? {} : { usage: shape.usage },
  }
}

/** Enumerate one arm's cells the way the fleet does and apply the script to each. */
function fleetReport(plan: FleetPlan, script: CellScript): FleetRunReport {
  const ids = 'ids' in plan.environments ? plan.environments.ids : []
  const model = plan.models[0] as EnvironmentRunModel
  const group = plan.group as string
  const cells: FleetCellOutcome[] = []
  for (const environment of ids) {
    for (let repetition = 0; repetition < plan.repetitions; repetition += 1) {
      const cell: FleetCell = { environment, model, repetition }
      const shape = script(cell)
      cells.push(shape === undefined
        ? { cell, error: { message: 'the cell could not boot' } }
        : { cell, report: runReport(cell, group, shape) })
    }
  }
  const reports = cells.flatMap(outcome => ('report' in outcome ? [outcome.report] : []))
  return {
    group,
    cells,
    leaderboard: [],
    spend: {
      inputTokens: reports.reduce((sum, entry) => sum + (entry.usage?.inputTokens ?? 0), 0),
      outputTokens: reports.reduce((sum, entry) => sum + (entry.usage?.outputTokens ?? 0), 0),
    },
  }
}

class StubFleet extends Service {
  static current: StubFleet
  readonly plans: FleetPlan[] = []
  script: CellScript = () => ({ certified: true })
  constructor(ctx: Context) {
    super(ctx, 'fleet')
    StubFleet.current = this
  }
  run(plan: FleetPlan): Promise<FleetRunReport> {
    this.plans.push(plan)
    return Promise.resolve(fleetReport(plan, cell => this.script(cell)))
  }
}

/** A sink recording what one run wrote and how often it closed. */
function recordingSink(failWrite = false): TrajectorySink & { lines: string[]; closes: number } {
  const sink = {
    lines: [] as string[],
    closes: 0,
    write(line: string): void {
      if (failWrite) throw new Error('the sink is full')
      sink.lines.push(line)
    },
    close(): void {
      sink.closes += 1
    },
  }
  return sink
}

interface Harness {
  ctx: Context
  /** A complete two-environment plan; overrides replace any field. */
  plan: (overrides?: Partial<ExperimentPlan>) => ExperimentPlan
}

async function harness(config: Partial<Config> = {}): Promise<Harness> {
  const ctx = new Context()
  for (const stub of [StubEnvironments, StubFleet]) await ctx.plugin(stub)
  await ctx.plugin(ExperimentService, { cellTokenCap: 1000, tokenBudget: 1_000_000, ...config })
  const plan = (overrides: Partial<ExperimentPlan> = {}): ExperimentPlan => ({
    environments: [ROUND_TRIP, UNSATISFIABLE],
    repetitions: 2,
    baseline: BASELINE,
    candidate: CANDIDATE,
    workspaceRoot: '/tmp/experiment',
    ...overrides,
  })
  return { ctx, plan }
}

/** Certified when the cell's arm is the named route. */
function certifiedFor(model: EnvironmentRunModel): CellScript {
  return cell => ({ certified: cell.model.model === model.model })
}

describe('ExperimentService', () => {
  it('freezes the plan, runs both arms at paired repetitions under digest-derived groups, and folds a null comparison', async () => {
    const { ctx, plan } = await harness()
    const result = await ctx.experiments.run(plan({ baseline: BASELINE, candidate: BASELINE }))

    const digest = planDigest(plan({ baseline: BASELINE, candidate: BASELINE }), result.thresholds)
    expect(result.digest).toBe(digest)
    expect(result.arms).toEqual({
      baseline: { model: BASELINE, group: `${EXPERIMENT_GROUP_PREFIX}${digest}-baseline` },
      candidate: { model: BASELINE, group: `${EXPERIMENT_GROUP_PREFIX}${digest}-candidate` },
    })
    expect(EXPERIMENT_ARM_ROLES.map(role => experimentGroup(digest, role)))
      .toEqual([result.arms.baseline.group, result.arms.candidate.group])

    const { plans } = StubFleet.current
    expect(plans).toHaveLength(2)
    expect(plans.map(fleet => fleet.group)).toEqual([result.arms.baseline.group, result.arms.candidate.group])
    for (const fleet of plans) {
      expect(fleet.environments).toEqual({ ids: [ROUND_TRIP, UNSATISFIABLE] })
      expect(fleet.repetitions).toBe(2)
      expect(fleet.workspaceRoot).toBe('/tmp/experiment')
      expect(fleet).not.toHaveProperty('signal')
    }
    expect(plans.map(fleet => fleet.models)).toEqual([[BASELINE], [BASELINE]])

    expect(result.seedsPaired).toBe(4)
    expect(result.delta).toBe(0)
    expect(result.interval).toEqual({ lower: 0, upper: 0 })
    expect(result.verdict).toBe('inconclusive')
    const shared = { pairs: 2, unpaired: 0, baselineRate: 1, candidateRate: 1, delta: 0, interval: { lower: 0, upper: 0 } }
    const zeroDeltas = { attemptsDelta: 0, inputTokenDelta: 0, outputTokenDelta: 0 }
    expect(result.cells).toEqual([
      { environment: ROUND_TRIP, ...shared, ...zeroDeltas },
      { environment: UNSATISFIABLE, ...shared, ...zeroDeltas },
    ])
    expect(result.spend).toEqual({ inputTokens: 0, outputTokens: 0 })
    expect(result.thresholds).toEqual({ bootstrapResamples: 1000, confidenceLevel: 0.95, minimumDelta: 0, cellTokenCap: 1000 })
  })

  it('promotes a candidate that certifies everywhere the baseline fails, and reports its attempts and token deltas', async () => {
    const { ctx, plan } = await harness()
    StubFleet.current.script = (cell) => {
      const candidate = cell.model.model === CANDIDATE.model
      return {
        certified: candidate,
        attempts: candidate ? 1 : 3,
        usage: { inputTokens: candidate ? 40 : 10, outputTokens: candidate ? 4 : 1 },
      }
    }
    const result = await ctx.experiments.run(plan())

    expect(result.verdict).toBe('promote')
    expect(result.delta).toBe(1)
    expect(result.interval).toEqual({ lower: 1, upper: 1 })
    expect(result.cells[0]).toEqual({
      environment: ROUND_TRIP,
      pairs: 2,
      unpaired: 0,
      baselineRate: 0,
      candidateRate: 1,
      delta: 1,
      interval: { lower: 1, upper: 1 },
      attemptsDelta: -2,
      inputTokenDelta: 60,
      outputTokenDelta: 6,
    })
    expect(result.spend).toEqual({ inputTokens: 200, outputTokens: 20 })
  })

  it('rejects a candidate strictly worse than the baseline, and stays inconclusive under a minimum delta it does not clear', async () => {
    const { ctx, plan } = await harness()
    StubFleet.current.script = certifiedFor(BASELINE)
    await expect(ctx.experiments.run(plan())).resolves.toMatchObject({
      verdict: 'reject',
      delta: -1,
      interval: { lower: -1, upper: -1 },
    })

    const demanding = await harness({ minimumDelta: 1 })
    StubFleet.current.script = certifiedFor(CANDIDATE)
    await expect(demanding.ctx.experiments.run(demanding.plan())).resolves.toMatchObject({ delta: 1, verdict: 'inconclusive' })
  })

  it('leaves a repetition an arm did not report out of every statistic and counts it as unpaired', async () => {
    const { ctx, plan } = await harness()
    StubFleet.current.script = (cell) => {
      if (cell.environment === UNSATISFIABLE) return undefined
      if (cell.model.model === CANDIDATE.model && cell.repetition === 1) return undefined
      return { certified: cell.model.model === CANDIDATE.model, usage: { inputTokens: 7, outputTokens: 2 } }
    }
    const result = await ctx.experiments.run(plan())

    expect(result.seedsPaired).toBe(1)
    const zeroDeltas = { attemptsDelta: 0, inputTokenDelta: 0, outputTokenDelta: 0 }
    const paired = { pairs: 1, unpaired: 1, baselineRate: 0, candidateRate: 1, delta: 1, interval: { lower: 1, upper: 1 } }
    expect(result.cells).toEqual([
      { environment: ROUND_TRIP, ...paired, ...zeroDeltas },
      { environment: UNSATISFIABLE, pairs: 0, unpaired: 2, baselineRate: 0, candidateRate: 0, delta: 0, ...zeroDeltas },
    ])
    expect(result.cells[1]).not.toHaveProperty('interval')
    expect(result.spend).toEqual({ inputTokens: 21, outputTokens: 6 })
    expect(result.verdict).toBe('promote')
  })

  it('stays inconclusive with no interval when nothing paired at all', async () => {
    const { ctx, plan } = await harness()
    StubFleet.current.script = () => undefined
    const result = await ctx.experiments.run(plan())

    expect(result.seedsPaired).toBe(0)
    expect(result.delta).toBe(0)
    expect(result).not.toHaveProperty('interval')
    expect(result.verdict).toBe('inconclusive')
    expect(result.cells.every(cell => cell.pairs === 0 && cell.unpaired === 2)).toBe(true)
  })

  it('accepts a digest the caller froze earlier and refuses one the plan no longer freezes to', async () => {
    const { ctx, plan } = await harness()
    const frozen = planDigest(plan(), resolveConfig({ cellTokenCap: 1000, tokenBudget: 1_000_000 }).thresholds)
    await expect(ctx.experiments.run(plan({ digest: frozen }))).resolves.toMatchObject({ digest: frozen })

    const edited = ctx.experiments.run(plan({ digest: frozen, repetitions: 3 }))
    await expect(edited).rejects.toBeInstanceOf(ExperimentError)
    await expect(edited).rejects.toMatchObject({ code: 'EXPERIMENT_PLAN_NOT_FROZEN' })
    expect(StubFleet.current.plans).toHaveLength(2)
  })

  it('refuses a plan it cannot start before any fleet call', async () => {
    const { ctx, plan } = await harness({ tokenBudget: 4000 })
    const refusals: [ExperimentPlan, string][] = [
      [plan({ repetitions: 0 }), 'EXPERIMENT_INVALID_PLAN'],
      [plan({ repetitions: 1.5 }), 'EXPERIMENT_INVALID_PLAN'],
      [plan({ environments: [] }), 'EXPERIMENT_INVALID_PLAN'],
      [plan({ environments: [ROUND_TRIP, ROUND_TRIP] }), 'EXPERIMENT_INVALID_PLAN'],
      [plan({ environments: [EnvironmentId('smoke:missing')] }), 'EXPERIMENT_INVALID_PLAN'],
      [plan(), 'EXPERIMENT_OVER_BUDGET'],
    ]
    for (const [refused, code] of refusals) await expect(ctx.experiments.run(refused)).rejects.toMatchObject({ code })
    expect(StubFleet.current.plans).toEqual([])

    expect(projectedTokens(plan(), 1000)).toBe(8000)
    expect(projectedTokens(plan({ repetitions: 1 }), 1000)).toBe(4000)
    await expect(ctx.experiments.run(plan({ repetitions: 1 }))).resolves.toMatchObject({ seedsPaired: 2 })
  })

  it('passes the abort signal to both arms and writes the result through the sink exactly once', async () => {
    const { ctx, plan } = await harness()
    const controller = new AbortController()
    const sink = recordingSink()
    const result = await ctx.experiments.run(plan({ signal: controller.signal, sink }))

    expect(StubFleet.current.plans.every(fleet => fleet.signal === controller.signal)).toBe(true)
    expect(sink.closes).toBe(1)
    expect(sink.lines).toHaveLength(1)
    expect(JSON.parse(sink.lines[0] as string)).toEqual(JSON.parse(JSON.stringify(result)))
    expect(sink.lines[0]?.endsWith('\n')).toBe(true)
  })

  it('closes the sink when the write fails', async () => {
    const { ctx, plan } = await harness()
    const sink = recordingSink(true)
    await expect(ctx.experiments.run(plan({ sink }))).rejects.toThrow('the sink is full')
    expect(sink.closes).toBe(1)
  })

  it('folds the same reports into the same intervals, so a frozen plan replays', async () => {
    const { ctx, plan } = await harness()
    StubFleet.current.script = cell => ({ certified: cell.repetition % 2 === (cell.model.model === CANDIDATE.model ? 0 : 1) })
    const result = await ctx.experiments.run(plan({ repetitions: 4 }))
    const request = {
      digest: result.digest,
      arms: result.arms,
      environments: [ROUND_TRIP, UNSATISFIABLE],
      repetitions: 4,
      thresholds: result.thresholds,
      baseline: fleetReport(StubFleet.current.plans[0] as FleetPlan, cell => ({ certified: cell.repetition % 2 === 1 })),
      candidate: fleetReport(StubFleet.current.plans[1] as FleetPlan, cell => ({ certified: cell.repetition % 2 === 0 })),
    }
    expect(foldExperiment(request)).toEqual(result)
    expect(foldExperiment(request)).toEqual(foldExperiment(request))
    expect(result.interval?.lower).toBeLessThan(result.interval?.upper as number)
  })

  it('reads back the group it minted and ignores every group outside its namespace', async () => {
    const { ctx, plan } = await harness()
    const result = await ctx.experiments.run(plan())
    expect(parseExperimentGroup(result.arms.candidate.group)).toEqual({ digest: result.digest, role: 'candidate' })
    expect(parseExperimentGroup('fleet-batch-1')).toBeUndefined()
    expect(parseExperimentGroup(`${EXPERIMENT_GROUP_PREFIX}not-a-digest-baseline`)).toBeUndefined()
  })

  it('resolves defaults once, at the boundary, and digests only what decides the comparison', () => {
    const thresholds: ExperimentThresholds = { bootstrapResamples: 1000, confidenceLevel: 0.95, minimumDelta: 0, cellTokenCap: 500 }
    expect(resolveConfig({ cellTokenCap: 500, tokenBudget: 9000 })).toEqual({ thresholds, tokenBudget: 9000 })
    expect(resolveConfig({ bootstrapResamples: 200, confidenceLevel: 0.9, minimumDelta: 0.05, cellTokenCap: 500, tokenBudget: 9000 }))
      .toEqual({ thresholds: { bootstrapResamples: 200, confidenceLevel: 0.9, minimumDelta: 0.05, cellTokenCap: 500 }, tokenBudget: 9000 })

    const ordered: ExperimentPlan = {
      environments: [ROUND_TRIP, UNSATISFIABLE],
      repetitions: 2,
      baseline: BASELINE,
      candidate: CANDIDATE,
      workspaceRoot: '/tmp/one',
    }
    const reordered: ExperimentPlan = { ...ordered, environments: [UNSATISFIABLE, ROUND_TRIP], workspaceRoot: '/tmp/other' }
    expect(planDigest(ordered, thresholds)).toBe(planDigest(reordered, thresholds))
    expect(planDigest(ordered, thresholds)).not.toBe(planDigest({ ...ordered, baseline: CANDIDATE }, thresholds))
    expect(planDigest(ordered, thresholds)).not.toBe(planDigest(ordered, { ...thresholds, minimumDelta: 0.1 }))
  })
})
