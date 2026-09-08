/**
 * Fleet runs: the deterministic spine of the harness capability program. A
 * plan of environment × model × repetition cells runs through the environment
 * runner, every cell's report or failure is kept in plan order, and a
 * leaderboard is folded from the reports without averaging across isolation
 * levels or the held-out split. The
 * [four-goal-workflows Agent Note](../../../.agents/notes/proposed/architecture/2026-09-05-four-goal-workflows.md)
 * owns the design rationale.
 * @module @deepseek-ai/dsh-fleet
 */

import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-environment-runner'
import type { EnvironmentRunReport } from '@deepseek-ai/dsh-environment-runner/types'
import { isSeed, ROUTE_IMPLEMENTER } from '@deepseek-ai/dsh-environments'
import type { EnvironmentDefinition, EnvironmentId, EnvironmentRunModel } from '@deepseek-ai/dsh-environments/types'
import { assertNever, HarnessError } from '@deepseek-ai/dsh-llm'
import type {
  FleetCell,
  FleetCellError,
  FleetCellErrorCode,
  FleetCellEvent,
  FleetCellOutcome,
  FleetPlan,
  FleetRunReport,
  FleetSpend,
  LeaderboardRow,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    fleet: FleetService
  }

  interface Events {
    /**
     * One cell of a running plan settled: the fleet has recorded its outcome
     * and applied the configured workspace retention. Observe-only — a
     * listener cannot change the outcome, and its failure is contained without
     * failing the cell. Cells are emitted in settle order, which equals plan
     * order only while `maxConcurrent` is `1`.
     * @param payload.group - batch identity every run stamp of this fleet run carries.
     * @param payload.district - district the plan stamped its cells with, absent for a plan outside every district.
     * @param payload.cell - the environment, model route, and repetition that settled.
     * @param payload.outcome - the session and certification of a reported cell, or the code and message of a cell that produced none.
     * @mode emit
     */
    'fleet/cell'(payload: FleetCellEvent): void
  }
}

/** Stable error codes of a refused plan. */
export type FleetErrorCode = 'FLEET_EMPTY_PLAN' | 'FLEET_INVALID_PLAN'

/** Error returned by the fleet boundary for a plan that cannot run. */
export class FleetError extends HarnessError {
  /**
   * @param message - human-readable reason.
   * @param code - stable machine-routable classification.
   */
  // Keep the constructor to narrow HarnessError's string code at this boundary.
  // oxlint-disable-next-line typescript/no-useless-constructor -- type-only narrowing
  constructor(message: string, code: FleetErrorCode) {
    super(message, code)
  }
}

/** What happens to a cell's `cell-*` workspace directory once its outcome is recorded. */
export type WorkspaceRetention = 'keep' | 'remove-certified' | 'remove-all'

/** Per-route circuit breaker: how many consecutive error cells stop a model route. */
export interface RouteBreakerConfig {
  /** Consecutive error outcomes on one route inside one plan before its remaining cells are refused. */
  consecutiveErrors: number
}

/** Deployment choices of the fleet, validated from `cordis.yml`. */
export interface Config {
  /** Cells run at the same time; each cell is its own session and workspace. */
  maxConcurrent?: number
  /** Per-route circuit breaker; absent keeps scheduling a route however often it fails. */
  routeBreaker?: RouteBreakerConfig
  /**
   * Fate of each cell's workspace directory: `keep` leaves every directory
   * under `workspaceRoot`, `remove-certified` removes the directories of
   * certified cells, `remove-all` removes each cell's directory once its
   * report or error is recorded. The session log, not the checkout, is the record.
   */
  workspaceRetention: WorkspaceRetention
}

/** The fleet's choices with every default applied. */
export interface ResolvedConfig {
  readonly maxConcurrent: number
  readonly routeBreaker: RouteBreakerConfig | undefined
  readonly workspaceRetention: WorkspaceRetention
}

/**
 * Apply the fleet's defaults to a validated config.
 * @param config - validated deployment config.
 * @returns the resolved choices: one cell at a time and no route breaker unless configured.
 */
export function resolveConfig(config: Config): ResolvedConfig {
  return {
    maxConcurrent: config.maxConcurrent ?? 1,
    routeBreaker: config.routeBreaker,
    workspaceRetention: config.workspaceRetention,
  }
}

/** Render a thrown value as a cell error without trusting it. */
function cellError(error: unknown): FleetCellError {
  if (error instanceof HarnessError) return { code: error.code, message: error.message }
  return { message: error instanceof Error ? error.message : String(error) }
}

/** Run `tasks` with at most `limit` in flight, keeping results in task order. */
async function bounded<T>(tasks: readonly (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results = new Array<T>(tasks.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < tasks.length) {
      const index = next
      next += 1
      results[index] = await (tasks[index] as () => Promise<T>)()
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker))
  return results
}

/** Human-readable identity of one model route, used in a breaker message. */
function routeName(model: EnvironmentRunModel): string {
  return `${model.provider}/${model.model}`
}

/**
 * Running state of one plan: the consecutive errors each model route has
 * produced and the spend the reported cells have folded. Both are read as a
 * cell is about to start, so a refusal only ever keeps an unstarted cell out of
 * the runner and never interrupts one in flight.
 */
class PlanLedger {
  private readonly consecutiveErrors = new Map<string, number>()
  private inputTokens = 0
  private outputTokens = 0

  constructor(
    private readonly breaker: RouteBreakerConfig | undefined,
    private readonly ceiling: number | undefined,
  ) {}

  /** Model usage of every cell folded so far. */
  get spend(): FleetSpend {
    return { inputTokens: this.inputTokens, outputTokens: this.outputTokens }
  }

  /**
   * The refusal that keeps a cell out of the runner.
   * @param cell - the cell about to start.
   * @returns the error to record for the cell, or `undefined` when nothing refuses it.
   */
  refusal(cell: FleetCell): FleetCellError | undefined {
    const spent = this.inputTokens + this.outputTokens
    if (this.ceiling !== undefined && spent >= this.ceiling) {
      return {
        code: 'FLEET_TOKEN_CEILING_REACHED' satisfies FleetCellErrorCode,
        message: `the plan's token ceiling of ${this.ceiling} was reached at ${spent} tokens`,
      }
    }
    const errors = this.consecutiveErrors.get(routeName(cell.model)) ?? 0
    if (this.breaker !== undefined && errors >= this.breaker.consecutiveErrors) {
      return {
        code: 'FLEET_ROUTE_BREAKER_OPEN' satisfies FleetCellErrorCode,
        message: `route ${routeName(cell.model)} stopped after ${errors} consecutive errors`,
      }
    }
    return undefined
  }

  /**
   * Fold one outcome the runner produced. A refused cell never reaches this,
   * so a refusal neither opens another route's breaker nor moves the spend.
   * @param outcome - the settled outcome of one cell the runner handled.
   */
  record(outcome: FleetCellOutcome): void {
    const route = routeName(outcome.cell.model)
    if ('error' in outcome) {
      this.consecutiveErrors.set(route, (this.consecutiveErrors.get(route) ?? 0) + 1)
      return
    }
    this.consecutiveErrors.set(route, 0)
    this.inputTokens += outcome.report.usage?.inputTokens ?? 0
    this.outputTokens += outcome.report.usage?.outputTokens ?? 0
  }
}

/** Key of the leaderboard row a cell belongs to. */
function rowKey(cell: FleetCell): string {
  return `${cell.model.provider}\0${cell.model.model}\0${cell.environment}`
}

/**
 * Keep the enumerated cells a plan named, in plan order.
 * @throws {@link FleetError} when the selection is empty or names a cell the
 *   plan's environments, routes, and repetition count do not enumerate.
 */
function restrict(enumerated: readonly FleetCell[], selected: readonly FleetCell[]): FleetCell[] {
  if (selected.length === 0) throw new FleetError('the plan names no cell to run', 'FLEET_INVALID_PLAN')
  const wanted = new Set(selected.map(fleetCellKey))
  const kept = enumerated.filter(cell => wanted.has(fleetCellKey(cell)))
  for (const key of kept.map(fleetCellKey)) wanted.delete(key)
  const unenumerated = [...wanted]
  if (unenumerated.length > 0) {
    throw new FleetError(`cell "${unenumerated[0] as string}" is not one this plan enumerates`, 'FLEET_INVALID_PLAN')
  }
  return kept
}

/**
 * Identity of one cell inside its batch. Two cells with the same key are the
 * same unit of the same plan, so a driver indexing cells across processes —
 * against a ledger or against the run stamps already in the session logs —
 * keys them by this instead of comparing the records field by field.
 * @param cell - the cell to name.
 * @returns the key, unique inside one plan.
 */
export function fleetCellKey(cell: FleetCell): string {
  return `${cell.environment} ${cell.model.provider}/${cell.model.model} ${cell.repetition}`
}

/** Fold the leaderboard from the cell outcomes, one row per model route and environment. */
function foldLeaderboard(
  outcomes: readonly FleetCellOutcome[],
  definitions: ReadonlyMap<EnvironmentId, EnvironmentDefinition>,
): LeaderboardRow[] {
  const rows = new Map<string, LeaderboardRow>()
  for (const outcome of outcomes) {
    const key = rowKey(outcome.cell)
    const definition = definitions.get(outcome.cell.environment) as EnvironmentDefinition
    const row = rows.get(key) ?? {
      provider: outcome.cell.model.provider,
      model: outcome.cell.model.model,
      environmentId: outcome.cell.environment,
      environmentKind: definition.kind,
      heldOut: definition.heldOut,
      runs: 0,
      errors: 0,
      certified: 0,
      certificateRate: 0,
      attemptsMean: 0,
      inputTokens: 0,
      outputTokens: 0,
    }
    rows.set(key, 'report' in outcome ? withReport(row, outcome.report) : { ...row, errors: row.errors + 1 })
  }
  return [...rows.values()]
}

/** Add one report to a row, recomputing the derived rates. */
function withReport(row: LeaderboardRow, report: EnvironmentRunReport): LeaderboardRow {
  const runs = row.runs + 1
  const certified = row.certified + (report.certified ? 1 : 0)
  const attempts = row.attemptsMean * row.runs + report.attempts.length
  return {
    ...row,
    ...report.stamp.ladder === undefined ? {} : { ladder: report.stamp.ladder },
    isolation: report.stamp.isolation,
    implementer: report.stamp.implementer ?? ROUTE_IMPLEMENTER,
    runs,
    certified,
    certificateRate: certified / runs,
    attemptsMean: attempts / runs,
    inputTokens: row.inputTokens + (report.usage?.inputTokens ?? 0),
    outputTokens: row.outputTokens + (report.usage?.outputTokens ?? 0),
  }
}

/**
 * Render a leaderboard as a Markdown table for people; the report stays the record.
 * @param report - a fleet run report.
 * @returns one table with a header row and one row per leaderboard entry.
 */
export function leaderboardMarkdown(report: FleetRunReport): string {
  const header = '| Model | Ladder | Implementer | Environment | Held out | Isolation | Runs | Errors | Certified | Rate | Attempts | Tokens in / out |'
  const rule = '|---|---|---|---|---|---|---|---|---|---|---|---|'
  const lines = report.leaderboard.map(row => (
    `| ${row.provider}/${row.model} | ${ladderCell(row.ladder)} | ${row.implementer ?? '-'} | ${row.environmentId} | ${row.heldOut ? 'yes' : 'no'} | ${row.isolation ?? '-'} | ${row.runs} | ${row.errors} | ${row.certified} | ${row.certificateRate.toFixed(2)} | ${row.attemptsMean.toFixed(2)} | ${row.inputTokens} / ${row.outputTokens} |`
  ))
  return [`Fleet run \`${report.group}\``, '', header, rule, ...lines].join('\n') + '\n'
}

/** One row's ladder as its Markdown cell: the rungs in attempt order, or the dash of a row that ran none. */
function ladderCell(ladder: readonly EnvironmentRunModel[] | undefined): string {
  return ladder === undefined ? '-' : ladder.map(routeName).join(' > ')
}

/** Fleet runs (`ctx.fleet`): a plan of environment cells through the runner, with a leaderboard. */
export class FleetService extends Service {
  static inject = ['environments', 'environmentRuns', 'agentDefaultModel']

  static Config: z<Config> = z.object({
    maxConcurrent: z.natural().min(1).default(1),
    // Prevent Schemastery from materializing an omitted routeBreaker as `{}`,
    // whose missing `consecutiveErrors` would reject every breakerless deployment.
    routeBreaker: z.object({
      consecutiveErrors: z.natural().min(1).required(),
    }).default(undefined as unknown as RouteBreakerConfig),
    workspaceRetention: z.union(['keep', 'remove-certified', 'remove-all'] as const).required(),
  })

  private readonly resolved: ResolvedConfig

  constructor(ctx: Context, config: Config) {
    super(ctx, 'fleet')
    this.resolved = resolveConfig(config)
  }

  /**
   * Run every cell of a plan and fold the leaderboard. A cell whose run
   * throws is kept as an error outcome, as is a cell the route breaker or the
   * token ceiling refused to start; the fleet run itself rejects only for a
   * plan it cannot start.
   * @param plan - environments, model routes, an optional attempt ladder and
   *   implementer, repetitions, an optional exact cell selection, workspace
   *   root, group, district, policy version, base seed, token ceiling, and
   *   abort signal.
   * @returns every cell's outcome in plan order, the leaderboard folded from the reports, and the run's spend.
   * @throws {@link FleetError} when the plan selects no environment, asks for
   *   no repetition, names no or an unenumerated cell, sets a token ceiling
   *   that is not a positive integer, sets a seed that is not a safe
   *   non-negative integer, or carries an attempt ladder with no rung.
   */
  async run(plan: FleetPlan): Promise<FleetRunReport> {
    if (!Number.isInteger(plan.repetitions) || plan.repetitions < 1) {
      throw new FleetError(`repetitions must be a positive integer, got ${String(plan.repetitions)}`, 'FLEET_INVALID_PLAN')
    }
    if (plan.tokenCeiling !== undefined && (!Number.isInteger(plan.tokenCeiling) || plan.tokenCeiling < 1)) {
      throw new FleetError(`tokenCeiling must be a positive integer, got ${String(plan.tokenCeiling)}`, 'FLEET_INVALID_PLAN')
    }
    // The base seed is refused here rather than per cell: it is arithmetic the
    // fleet performs, so a bad base would otherwise surface as every cell failing.
    if (plan.seed !== undefined && !isSeed(plan.seed)) {
      throw new FleetError(`seed must be a non-negative integer, got ${String(plan.seed)}`, 'FLEET_INVALID_PLAN')
    }
    // An empty ladder is the whole plan's, so it is refused once here instead of
    // once per cell; the runner still owns the rung ceiling, which is its config.
    if (plan.ladder !== undefined && plan.ladder.length === 0) {
      throw new FleetError('the plan\'s attempt ladder names no rung', 'FLEET_INVALID_PLAN')
    }
    const definitions = this.select(plan)
    if (definitions.size === 0) throw new FleetError('the plan selects no environment', 'FLEET_EMPTY_PLAN')
    const models = plan.models.length === 0 ? [this.defaultModel()] : plan.models
    const group = plan.group ?? `fleet-${randomUUID()}`
    const enumerated: FleetCell[] = []
    for (const environment of definitions.keys()) {
      for (const model of models) {
        for (let repetition = 0; repetition < plan.repetitions; repetition += 1) enumerated.push({ environment, model, repetition })
      }
    }
    const cells = plan.cells === undefined ? enumerated : restrict(enumerated, plan.cells)
    const ledger = new PlanLedger(this.resolved.routeBreaker, plan.tokenCeiling)
    const tasks = cells.map(cell => () => this.runCell(cell, plan, group, ledger))
    const outcomes = await bounded(tasks, this.resolved.maxConcurrent)
    return { group, cells: outcomes, leaderboard: foldLeaderboard(outcomes, definitions), spend: ledger.spend }
  }

  /** Resolve the plan's environment selection against the registry, in registry order. */
  private select(plan: FleetPlan): Map<EnvironmentId, EnvironmentDefinition> {
    const selected = 'ids' in plan.environments
      ? plan.environments.ids.flatMap((id) => {
        const definition = this.ctx.environments.get(id)
        if (definition === undefined) throw new FleetError(`environment "${id}" is not registered`, 'FLEET_INVALID_PLAN')
        return [definition]
      })
      : this.ctx.environments.list(plan.environments.filter)
    return new Map(selected.map(definition => [definition.id, definition]))
  }

  /** The composition's default model route, detached from the selection service. */
  private defaultModel(): EnvironmentRunModel {
    const selection = this.ctx.agentDefaultModel.currentSelection()
    return { provider: selection.provider, model: selection.model }
  }

  /**
   * Run one cell unless the ledger refuses it, fold the outcome back into the
   * ledger, and apply the configured workspace retention.
   */
  private async runCell(cell: FleetCell, plan: FleetPlan, group: string, ledger: PlanLedger): Promise<FleetCellOutcome> {
    const refusal = ledger.refusal(cell)
    if (refusal !== undefined) return this.settle({ cell, error: refusal }, plan, group)
    const { outcome, workspace } = await this.execute(cell, plan, group)
    ledger.record(outcome)
    if (workspace !== undefined && this.removes(outcome)) await rm(workspace, { recursive: true, force: true })
    return this.settle(outcome, plan, group)
  }

  /** Announce one settled cell after its workspace retention has run. */
  private settle(outcome: FleetCellOutcome, plan: FleetPlan, group: string): FleetCellOutcome {
    const payload: FleetCellEvent = {
      group,
      ...plan.district === undefined ? {} : { district: plan.district },
      cell: outcome.cell,
      outcome: 'report' in outcome
        ? { kind: 'reported', sessionId: outcome.report.sessionId, certified: outcome.report.certified }
        : { kind: 'error', ...outcome.error.code === undefined ? {} : { code: outcome.error.code }, message: outcome.error.message },
    }
    this.ctx.emit('fleet/cell', payload)
    return outcome
  }

  /** Whether the configured retention removes the workspace of a settled cell. */
  private removes(outcome: FleetCellOutcome): boolean {
    const retention = this.resolved.workspaceRetention
    switch (retention) {
      case 'keep': return false
      case 'remove-certified': return 'report' in outcome && outcome.report.certified
      case 'remove-all': return true
      default: return assertNever(retention, 'workspace retention')
    }
  }

  /**
   * Run one cell in a fresh workspace directory; a thrown error becomes the
   * cell's outcome. The workspace is returned when one was minted, so retention
   * can reach a directory whose run then failed.
   */
  private async execute(
    cell: FleetCell,
    plan: FleetPlan,
    group: string,
  ): Promise<{ outcome: FleetCellOutcome; workspace?: string }> {
    let workspace: string | undefined
    try {
      workspace = await mkdtemp(join(plan.workspaceRoot, 'cell-'))
      const report = await this.ctx.environmentRuns.run({
        environment: cell.environment,
        workspace,
        model: cell.model,
        ...plan.ladder === undefined ? {} : { ladder: plan.ladder },
        ...plan.implementer === undefined ? {} : { implementer: plan.implementer },
        repetition: cell.repetition,
        group,
        ...plan.district === undefined ? {} : { district: plan.district },
        ...plan.policyVersion === undefined ? {} : { policyVersion: plan.policyVersion },
        ...plan.seed === undefined ? {} : { seed: plan.seed + cell.repetition },
        ...plan.signal === undefined ? {} : { signal: plan.signal },
      })
      return { outcome: { cell, report }, workspace }
    } catch (error: unknown) {
      const outcome: FleetCellOutcome = { cell, error: cellError(error) }
      return workspace === undefined ? { outcome } : { outcome, workspace }
    }
  }
}

export default FleetService
