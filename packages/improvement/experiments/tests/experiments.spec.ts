import { describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import type { BudgetCap } from '@deepseek-ai/dsh-budget-policy'
import { EnvironmentRunError } from '@deepseek-ai/dsh-environment-runner'
import type { EnvironmentRunImplementer, EnvironmentRunReport } from '@deepseek-ai/dsh-environment-runner/types'
import { EnvironmentId } from '@deepseek-ai/dsh-environments'
import type { EnvironmentDefinition, EnvironmentId as EnvironmentIdType, EnvironmentRunModel } from '@deepseek-ai/dsh-environments/types'
import type { FleetCell, FleetCellOutcome, FleetPlan, FleetRunReport } from '@deepseek-ai/dsh-fleet/types'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { TrajectorySink } from '@deepseek-ai/dsh-trajectories/types'
import { CheckId } from '@deepseek-ai/dsh-verification'
import ExperimentService, {
  capsAgree,
  describeCaps,
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
import type { Config, ExperimentPlan, ExperimentResult, ExperimentThresholds } from '@deepseek-ai/dsh-experiments'

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
const ROUTE: EnvironmentRunImplementer = { kind: 'route' }
const DELEGATED = { kind: 'subagent', provider: 'external-agent' } as const satisfies EnvironmentRunImplementer
/** The caps the stub runner resolves for every implementer unless a test narrows one. */
const CAPS: readonly BudgetCap[] = [['maxTotalTokens', 5000], ['maxWallMs', 60_000]]
/** The digest this file's default plan freezes to at plan format version 2; the current version must never reproduce it. */
const PRE_SLICE_DIGEST = '619c25f5f81d0f75fda33381464b9c41f8383dc19100dc400d1804b28bf868b2'

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
    attempts: Array.from({ length: attempts }, (_, index) => ({
      attempt: index + 1,
      model: cell.model,
      transcript: 'kept' as const,
      results: [],
      treeHash: HEX,
    })),
    certified: shape.certified,
    ...shape.usage === undefined ? {} : { usage: shape.usage },
    caps: CAPS,
    escapesDenied: 0,
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

/** The runner as the experiment reads it: the implementer preflight and the caps one implementer's cells run under. */
class StubEnvironmentRuns extends Service {
  static current: StubEnvironmentRuns
  /** Caps per implementer kind; the unequal-caps case narrows the delegated one. */
  caps: (implementer: EnvironmentRunImplementer) => readonly BudgetCap[] = () => CAPS
  /** Every preflight the experiment ran, with the arm route it stamped. */
  readonly checked: { implementer: EnvironmentRunImplementer; model: EnvironmentRunModel }[] = []
  /** Providers this composition holds; a subagent implementer naming another is refused. */
  providers = new Set<string>([DELEGATED.provider])
  constructor(ctx: Context) {
    super(ctx, 'environmentRuns')
    StubEnvironmentRuns.current = this
  }
  checkImplementer(implementer: EnvironmentRunImplementer, model: EnvironmentRunModel): void {
    this.checked.push({ implementer, model })
    if (implementer.kind === 'route' || this.providers.has(implementer.provider)) return
    throw new EnvironmentRunError(
      `implementer provider "${implementer.provider}" is unavailable: no subagent provider is registered under that name`,
      'ENVIRONMENT_RUN_IMPLEMENTER_UNAVAILABLE',
    )
  }
  cellCaps(implementer: EnvironmentRunImplementer): readonly BudgetCap[] {
    return this.caps(implementer)
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
  for (const stub of [StubEnvironments, StubEnvironmentRuns, StubFleet]) await ctx.plugin(stub)
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

    const digest = planDigest(plan({ baseline: BASELINE, candidate: BASELINE }), result.thresholds, CAPS)
    expect(result.digest).toBe(digest)
    expect(result.arms).toEqual({
      baseline: { model: BASELINE, implementer: ROUTE, group: `${EXPERIMENT_GROUP_PREFIX}${digest}-baseline` },
      candidate: { model: BASELINE, implementer: ROUTE, group: `${EXPERIMENT_GROUP_PREFIX}${digest}-candidate` },
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
      expect(fleet.implementer).toEqual(ROUTE)
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

  it('forwards the policy version and the base seed to both arms and freezes both into the digest', async () => {
    const { ctx, plan } = await harness()
    const versioned = plan({ policyVersion: 'policy-2026-09', seed: 100 })
    const result = await ctx.experiments.run(versioned)
    expect(StubFleet.current.plans.map(fleet => [fleet.policyVersion, fleet.seed]))
      .toEqual([['policy-2026-09', 100], ['policy-2026-09', 100]])

    // Two comparisons that differ only in policy version or seed are two experiments.
    expect(result.digest).not.toBe(planDigest(plan(), result.thresholds, CAPS))
    expect(result.digest).not.toBe(planDigest(plan({ policyVersion: 'policy-2026-09', seed: 101 }), result.thresholds, CAPS))
    expect(result.digest).toBe(planDigest(versioned, result.thresholds, CAPS))

    const bare = await ctx.experiments.run(plan())
    expect(StubFleet.current.plans[2]).not.toHaveProperty('policyVersion')
    expect(StubFleet.current.plans[2]).not.toHaveProperty('seed')
    expect(bare.digest).toBe(planDigest(plan(), bare.thresholds, CAPS))
  })

  it('runs each arm under the implementer it names and states it beside the arm route in the written result', async () => {
    const { ctx, plan } = await harness()
    const sink = recordingSink()
    const result = await ctx.experiments.run(plan({ candidate: { ...CANDIDATE, implementer: DELEGATED }, sink }))

    expect(StubFleet.current.plans.map(fleet => fleet.implementer)).toEqual([ROUTE, DELEGATED])
    expect(result.arms.baseline).toEqual({ model: BASELINE, implementer: ROUTE, group: result.arms.baseline.group })
    expect(result.arms.candidate).toEqual({ model: CANDIDATE, implementer: DELEGATED, group: result.arms.candidate.group })
    expect(StubFleet.current.plans.map(fleet => fleet.models)).toEqual([[BASELINE], [CANDIDATE]])
    expect(EXPERIMENT_ARM_ROLES.map(role => experimentGroup(result.digest, role)))
      .toEqual([result.arms.baseline.group, result.arms.candidate.group])

    const written = JSON.parse(sink.lines[0] as string) as ExperimentResult
    expect(written.arms.candidate.implementer).toEqual(DELEGATED)
  })

  it('runs each arm over the ladder it names, restates it, and refuses a first rung that is another route', async () => {
    const { ctx, plan } = await harness()
    const ladder = [{}, { model: CANDIDATE }]
    const result = await ctx.experiments.run(plan({ candidate: { ...CANDIDATE, ladder } }))

    expect(StubFleet.current.plans.map(fleet => fleet.ladder)).toEqual([undefined, ladder])
    expect(result.arms.baseline).not.toHaveProperty('ladder')
    expect(result.arms.candidate).toEqual({ model: CANDIDATE, ladder, implementer: ROUTE, group: result.arms.candidate.group })

    // The arm is what the result is published under, so its first attempt must
    // be the arm's own route.
    const conflicting = plan({ candidate: { ...CANDIDATE, ladder: [{ model: BASELINE }, {}] } })
    await expect(ctx.experiments.run(conflicting)).rejects.toThrow(new ExperimentError(
      'the candidate arm runs mock/next but its first ladder rung names mock/base, so its first attempt would not be the arm it is published under',
      'EXPERIMENT_LADDER_CONFLICT',
    ))
    await expect(ctx.experiments.run(plan({ baseline: { ...BASELINE, ladder: [] } }))).rejects.toThrow(new ExperimentError(
      'the baseline arm\'s attempt ladder names no rung',
      'EXPERIMENT_INVALID_PLAN',
    ))
    expect(StubFleet.current.plans).toHaveLength(2)
  })

  it('freezes each arm ladder in role order, taking an omitted rung model as the arm route', async () => {
    const { plan } = await harness()
    const thresholds = resolveConfig({ cellTokenCap: 1000, tokenBudget: 1_000_000 }).thresholds
    const routes = plan()
    const laddered = plan({ candidate: { ...CANDIDATE, ladder: [{}, { model: BASELINE }] } })
    expect(planDigest(laddered, thresholds, CAPS)).not.toBe(planDigest(routes, thresholds, CAPS))

    // A rung naming the arm's own route and one naming no model are two ways of
    // writing one rung, and the digest keeps them apart because only the
    // written model decides what a later reader can compare.
    const spelledOut = plan({ candidate: { ...CANDIDATE, ladder: [{ model: CANDIDATE }, { model: BASELINE }] } })
    expect(planDigest(spelledOut, thresholds, CAPS)).not.toBe(planDigest(laddered, thresholds, CAPS))

    const longer = plan({ candidate: { ...CANDIDATE, ladder: [{}, { model: BASELINE }, { model: BASELINE }] } })
    expect(planDigest(longer, thresholds, CAPS)).not.toBe(planDigest(laddered, thresholds, CAPS))
    expect(planDigest(plan({ baseline: { ...BASELINE, ladder: [{}, { model: CANDIDATE }] } }), thresholds, CAPS))
      .not.toBe(planDigest(laddered, thresholds, CAPS))
  })

  it('freezes each arm implementer in role order, taking an omitted one as the route', async () => {
    const { plan } = await harness()
    const thresholds = resolveConfig({ cellTokenCap: 1000, tokenBudget: 1_000_000 }).thresholds
    const routes = plan()
    const spelledOut = plan({ baseline: { ...BASELINE, implementer: ROUTE }, candidate: { ...CANDIDATE, implementer: ROUTE } })
    expect(planDigest(spelledOut, thresholds, CAPS)).toBe(planDigest(routes, thresholds, CAPS))
    expect(planDigest(routes, thresholds, CAPS)).not.toBe(PRE_SLICE_DIGEST)

    const delegated = plan({ candidate: { ...CANDIDATE, implementer: DELEGATED } })
    expect(planDigest(delegated, thresholds, CAPS)).not.toBe(planDigest(routes, thresholds, CAPS))
    expect(planDigest(plan({ baseline: { ...BASELINE, implementer: DELEGATED } }), thresholds, CAPS))
      .not.toBe(planDigest(delegated, thresholds, CAPS))

    const labelled = plan({ candidate: { ...CANDIDATE, implementer: { ...DELEGATED, label: 'nightly' } } })
    expect(planDigest(labelled, thresholds, CAPS)).not.toBe(planDigest(delegated, thresholds, CAPS))
    const elsewhere = plan({ candidate: { ...CANDIDATE, implementer: { kind: 'subagent', provider: 'other-agent' } } })
    expect(planDigest(elsewhere, thresholds, CAPS)).not.toBe(planDigest(delegated, thresholds, CAPS))
  })

  it('states the caps both arms ran under and freezes them into the digest', async () => {
    const { ctx, plan } = await harness()
    const sink = recordingSink()
    const result = await ctx.experiments.run(plan({ sink }))
    expect(result.caps).toEqual(CAPS)

    const written = JSON.parse(sink.lines[0] as string) as ExperimentResult
    expect(written.caps).toEqual([['maxTotalTokens', 5000], ['maxWallMs', 60_000]])

    // Two comparisons under different ceilings are two experiments.
    const looser: readonly BudgetCap[] = [['maxTotalTokens', 5000], ['maxWallMs', 120_000]]
    expect(planDigest(plan(), result.thresholds, looser)).not.toBe(result.digest)
  })

  it('refuses a plan whose two arms would run under different caps, before either arm starts', async () => {
    const { ctx, plan } = await harness()
    // The delegated arm's cost cap is one the runner cannot measure for it.
    StubEnvironmentRuns.current.caps = implementer => (
      implementer.kind === 'route' ? [...CAPS, ['maxCostEur', 5]] : CAPS
    )
    const unequal = ctx.experiments.run(plan({ candidate: { ...CANDIDATE, implementer: DELEGATED } }))
    await expect(unequal).rejects.toBeInstanceOf(ExperimentError)
    await expect(unequal).rejects.toMatchObject({ code: 'EXPERIMENT_UNEQUAL_CAPS' })
    await expect(unequal).rejects.toThrow(/maxTotalTokens=5000, maxWallMs=60000, maxCostEur=5/)
    expect(StubFleet.current.plans).toHaveLength(0)

    // Two delegated arms agree again, so the same deployment still compares them.
    await expect(ctx.experiments.run(plan({
      baseline: { ...BASELINE, implementer: DELEGATED },
      candidate: { ...CANDIDATE, implementer: DELEGATED },
    }))).resolves.toMatchObject({ caps: CAPS })
  })

  it('refuses an arm implementer the composition cannot honor, before the baseline arm runs a cell', async () => {
    const { ctx, plan } = await harness()
    const absent = { kind: 'subagent', provider: 'spawn' } as const
    await expect(ctx.experiments.run(plan({ candidate: { ...CANDIDATE, implementer: absent } })))
      .rejects.toThrow(new EnvironmentRunError(
        'implementer provider "spawn" is unavailable: no subagent provider is registered under that name',
        'ENVIRONMENT_RUN_IMPLEMENTER_UNAVAILABLE',
      ))
    // The candidate arm's provider is missing, and the baseline arm — which
    // would otherwise run in full first — never reaches the fleet.
    expect(StubFleet.current.plans).toHaveLength(0)

    // Both arms are checked, each against its own route.
    const checked = await harness()
    await checked.ctx.experiments.run(checked.plan({ candidate: { ...CANDIDATE, implementer: DELEGATED } }))
    expect(StubEnvironmentRuns.current.checked).toEqual([
      { implementer: ROUTE, model: BASELINE },
      { implementer: DELEGATED, model: CANDIDATE },
    ])
  })

  it('compares and renders cap lists by value', () => {
    expect(capsAgree(CAPS, [['maxTotalTokens', 5000], ['maxWallMs', 60_000]])).toBe(true)
    expect(capsAgree(CAPS, [['maxTotalTokens', 5000]])).toBe(false)
    expect(capsAgree(CAPS, [['maxTotalTokens', 5000], ['maxWallMs', 60_001]])).toBe(false)
    expect(capsAgree(CAPS, [['maxTotalTokens', 5000], ['maxInputTokens', 60_000]])).toBe(false)
    expect(describeCaps(CAPS)).toBe('maxTotalTokens=5000, maxWallMs=60000')
    expect(describeCaps([])).toBe('none')
  })

  it('accepts a digest the caller froze earlier and refuses one the plan no longer freezes to', async () => {
    const { ctx, plan } = await harness()
    const frozen = planDigest(plan(), resolveConfig({ cellTokenCap: 1000, tokenBudget: 1_000_000 }).thresholds, CAPS)
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
      [plan({ seed: -1 }), 'EXPERIMENT_INVALID_PLAN'],
      [plan({ seed: 1.5 }), 'EXPERIMENT_INVALID_PLAN'],
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
      caps: CAPS,
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
    expect(planDigest(ordered, thresholds, CAPS)).toBe(planDigest(reordered, thresholds, CAPS))
    expect(planDigest(ordered, thresholds, CAPS)).not.toBe(planDigest({ ...ordered, baseline: CANDIDATE }, thresholds, CAPS))
    expect(planDigest(ordered, thresholds, CAPS)).not.toBe(planDigest(ordered, { ...thresholds, minimumDelta: 0.1 }, CAPS))
  })
})
