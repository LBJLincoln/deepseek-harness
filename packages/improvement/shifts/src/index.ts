/**
 * Shifts: the durable driver of an unattended fleet. Each district opens a
 * slot on its cadence, freezes the plan the slot runs into a content digest,
 * and records the whole shift as `shift/*` events in the slot's own session —
 * the ledger a restarted process reads to resume exactly the cells that never
 * started. Refusals are as durable as runs: a slot arriving over a running
 * shift, or one whose district already spent its window, leaves a session
 * holding one `shift/skipped`. Nothing here calls a model. The
 * [village-shifts Agent Note](../../../.agents/notes/proposed/architecture/2026-09-05-village-shifts.md)
 * owns the design rationale.
 * @module @deepseek-ai/dsh-shifts
 */

import { statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
// Type-only: resolves the Loader the driver waits for before its first freeze.
import type {} from '@deepseek-ai/cordis-plugin-loader'
import z from '@deepseek-ai/schemastery'
import { foldBudgetSpend } from '@deepseek-ai/dsh-budget-policy'
// Type-only: resolves ctx.environments, which the fleet's own injection composes.
import type {} from '@deepseek-ai/dsh-environments'
import type { EnvironmentFilter, EnvironmentId } from '@deepseek-ai/dsh-environments/types'
// Type-only: resolves ctx.fleet.
import type {} from '@deepseek-ai/dsh-fleet'
import type { FleetCell, FleetEnvironmentSelection, FleetRunReport } from '@deepseek-ai/dsh-fleet/types'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
// Type-only: resolves ctx.sessionPersistence.
import type {} from '@deepseek-ai/dsh-session-persistence'
import {
  foldShiftLedger,
  previousSlot,
  shiftSpend,
  splitPending,
  stampedCells,
  windowSpend,
} from './ledger.ts'
import type { ShiftLedger, StampedCell } from './ledger.ts'
import { nextSlotAt, shiftCells, shiftDigest, shiftId } from './plan.ts'
import type {
  ShiftCellCounts,
  ShiftCellRecord,
  ShiftDistrictConfig,
  ShiftEndOutcome,
  ShiftPlan,
  ShiftSkipped,
  ShiftSpendWindowConfig,
} from './types.ts'

export type * from './types.ts'
export {
  foldShiftLedger,
  previousSlot,
  shiftSpend,
  splitPending,
  stampedCells,
  windowSpend,
} from './ledger.ts'
export type { ScannedSession, ShiftLedger, ShiftOrphan, ShiftPending, StampedCell } from './ledger.ts'
export { nextSlotAt, parseShiftId, SHIFT_ID_PREFIX, shiftCells, shiftDigest, shiftId } from './plan.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    shifts: ShiftService
  }
}

/** Stable error codes of a refused deployment or a slot that cannot be frozen. */
export type ShiftErrorCode = 'SHIFT_INVALID_CONFIG' | 'SHIFT_INVALID_PLAN'

/** Error returned by the shift boundary for a deployment or slot that cannot run. */
export class ShiftError extends HarnessError {
  /**
   * @param message - human-readable reason.
   * @param code - stable machine-routable classification.
   */
  // Keep the constructor to narrow HarnessError's string code at this boundary.
  // oxlint-disable-next-line typescript/no-useless-constructor -- type-only narrowing
  constructor(message: string, code: ShiftErrorCode) {
    super(message, code)
  }
}

/** Deployment choices of the shift driver, validated from `cordis.yml`. */
export interface Config {
  /** Existing absolute directory the fleet mints each cell's workspace under. */
  workspaceRoot: string
  /** The districts this process drives; at least one, each named once. */
  districts: ShiftDistrictConfig[]
  /** Whether a district with no slot in the ledger opens one as the process starts. */
  startImmediately: boolean
}

/** The environment selection and the token sums one resume scan produced. */
interface ShiftScan {
  /** Every shift session's ledger, finished or not. */
  readonly ledgers: readonly ShiftLedger[]
  /** Every grouped `environment/run` stamp, with the tokens its session accounts for. */
  readonly stamped: readonly StampedCell[]
}

/** Fold `shift/cell` records of one session into counts per outcome. */
function countCells(records: readonly ShiftCellRecord[]): ShiftCellCounts {
  return {
    reported: records.filter(record => record.outcome.kind === 'reported').length,
    error: records.filter(record => record.outcome.kind === 'error').length,
    interrupted: records.filter(record => record.outcome.kind === 'interrupted').length,
  }
}

/**
 * How a finished fleet run ends its shift, read from the records the run left
 * in the ledger rather than from the report, so the closing record and the
 * cells it counts come from one source.
 */
function endOutcome(aborted: boolean, ceilingReached: boolean): ShiftEndOutcome {
  if (aborted) return 'stopped'
  return ceilingReached ? 'ceiling' : 'completed'
}

/** Shifts (`ctx.shifts`): a cadenced, spend-windowed, resumable loop over fleet plans. */
export class ShiftService extends Service {
  static inject = ['fleet', 'sessions', 'sessionPersistence']

  static Config: z<Config> = z.object({
    workspaceRoot: z.string().required(),
    districts: z.array(z.object({
      district: z.string().required(),
      plan: z.object({
        // Branded ids and the merge-extensible kind union have no schemastery
        // primitive; the registry rejects an id or kind it does not hold when
        // the slot freezes.
        environments: z.union([
          z.object({ ids: z.array(z.string()).required() }),
          z.object({ filter: z.object({ kind: z.string() as z<EnvironmentFilter['kind']>, heldOut: z.boolean() }) }),
        ]).required() as z<FleetEnvironmentSelection>,
        models: z.array(z.object({
          provider: z.string().required(),
          model: z.string().required(),
        })).required(),
        repetitions: z.natural().min(1).required(),
        tokenCeiling: z.natural().min(1),
      }).required(),
      cadence: z.object({
        intervalMs: z.natural().min(1).required(),
      }).required(),
      // Prevent Schemastery from materializing an omitted spendWindow as `{}`,
      // whose missing fields would reject every district that runs uncapped.
      spendWindow: z.object({
        windowMs: z.natural().min(1).required(),
        maxTokens: z.natural().min(1).required(),
      }).default(undefined as unknown as ShiftSpendWindowConfig),
    })).required(),
    startImmediately: z.boolean().required(),
  })

  private readonly config: Config
  /** The single run of the loop; a second `start()` joins the first. */
  private opening: Promise<void> | undefined
  /** District to the slot it is running, so a slot over a running shift is refused. */
  private readonly running = new Map<string, Promise<void>>()
  /** District to the disposer of its armed cadence timer. */
  private readonly timers = new Map<string, () => unknown>()
  /** Cancellation of the fleet run in flight, absent between runs. */
  private controller: AbortController | undefined
  private stopping = false

  constructor(ctx: Context, config: Config) {
    super(ctx, 'shifts')
    this.config = config
    if (!isAbsolute(config.workspaceRoot) || !isDirectory(config.workspaceRoot)) {
      throw new ShiftError(`workspaceRoot "${config.workspaceRoot}" is not an existing absolute directory`, 'SHIFT_INVALID_CONFIG')
    }
    if (config.districts.length === 0) throw new ShiftError('the driver is composed with no district', 'SHIFT_INVALID_CONFIG')
    const named = new Set<string>()
    for (const district of config.districts) {
      if (named.has(district.district)) {
        throw new ShiftError(`district "${district.district}" is configured twice`, 'SHIFT_INVALID_CONFIG')
      }
      named.add(district.district)
      if (district.plan.models.length === 0) {
        throw new ShiftError(`district "${district.district}" names no model route`, 'SHIFT_INVALID_CONFIG')
      }
    }
    ctx.effect(() => () => this.stop(), 'shifts.driver()')
    void this.boot()
  }

  /**
   * Resume every interrupted shift, then open each district's due slot and arm
   * its cadence timer. The loop runs once per process: a second call joins the
   * first, so the plugin's own start and a driver awaiting the first slot
   * observe the same run.
   * @returns a promise settling once every resumed shift has ended and every
   *   district is either running its due slot or armed for its next one.
   */
  async start(): Promise<void> {
    this.opening ??= this.open()
    await this.opening
  }

  /**
   * Stop the loop: disarm every cadence timer, cancel the fleet run in flight
   * through its signal, and wait for the slots that are settling. The
   * interrupted cells end as the runner ends them and their sessions become
   * the orphans the next process records.
   * @returns a promise settling once no slot is in flight.
   */
  async stop(): Promise<void> {
    this.stopping = true
    this.controller?.abort(new Error('the shift driver is stopping'))
    for (const disarm of this.timers.values()) await disarm()
    this.timers.clear()
    await Promise.allSettled([...this.running.values()])
  }

  /** Start the loop over a settled application; a failure leaves the process running and logged. */
  private async boot(): Promise<void> {
    try {
      // A slot freezes its plan against the environment registry, which sibling
      // Loader entries fill; a hand-built tree has no Loader and is settled already.
      await this.ctx.get('loader')?.await()
      await this.start()
    } catch (error: unknown) {
      this.ctx.logger.error(`the shift driver did not start: ${String(error)}`)
    }
  }

  /** One pass of resume and district opening. */
  private async open(): Promise<void> {
    const scan = await this.scan()
    for (const ledger of scan.ledgers) {
      if (this.stopping) return
      if (ledger.end === undefined) await this.resume(ledger, scan.stamped)
    }
    for (const district of this.config.districts) {
      if (this.stopping) return
      await this.openDistrict(district, previousSlot(scan.ledgers, district.district))
    }
  }

  /** Arm the district's cadence, then run the slot it already owes. */
  private async openDistrict(district: ShiftDistrictConfig, previous: number | undefined): Promise<void> {
    const at = nextSlotAt(previous, district.cadence.intervalMs, Date.now(), this.config.startImmediately)
    if (at > Date.now()) {
      this.arm(district, at)
      return
    }
    this.arm(district, nextSlotAt(at, district.cadence.intervalMs, Date.now(), false))
    await this.slot(district, at)
  }

  /**
   * Replace one district's cadence timer with one firing at `at`. Each firing
   * arms the next slot before it runs this one, so slots keep arriving on the
   * cadence and a slot that lands on a still-running shift is refused rather
   * than delayed into it.
   */
  private arm(district: ShiftDistrictConfig, at: number): void {
    void this.timers.get(district.district)?.()
    const disarm = this.ctx.effect(() => {
      const timer = setTimeout(() => {
        this.arm(district, nextSlotAt(at, district.cadence.intervalMs, Date.now(), false))
        // A slot that cannot be frozen must not take the loop down with it: the
        // next slot is already armed and the failure is the operator's signal.
        void this.slot(district, at).catch((error: unknown) => {
          this.ctx.logger.error(`district "${district.district}" slot ${at} failed: ${String(error)}`)
        })
      }, Math.max(0, at - Date.now()))
      return () => {
        clearTimeout(timer)
      }
    }, `shifts.cadence(${district.district})`)
    this.timers.set(district.district, disarm)
  }

  /** Freeze one slot and either refuse it or run it, keeping one shift per district in flight. */
  private async slot(district: ShiftDistrictConfig, scheduledAt: number): Promise<void> {
    const plan = this.freeze(district)
    const digest = shiftDigest(plan)
    const id = shiftId(digest, scheduledAt)
    if (this.running.has(plan.district)) {
      await this.skip(id, { digest, scheduledAt, reason: 'overlap' })
      return
    }
    const inFlight = this.runSlot(district, plan, digest, id, scheduledAt)
      .finally(() => {
        this.running.delete(plan.district)
      })
    this.running.set(plan.district, inFlight)
    await inFlight
  }

  /** Refuse the slot for its district's spend window, or open the shift and drive it. */
  private async runSlot(
    district: ShiftDistrictConfig,
    plan: ShiftPlan,
    digest: string,
    id: string,
    scheduledAt: number,
  ): Promise<void> {
    const window = district.spendWindow
    if (window !== undefined) {
      const scan = await this.scan()
      const spent = windowSpend(scan.ledgers, plan.district, window.windowMs, Date.now())
      if (spent >= window.maxTokens) {
        await this.skip(id, { digest, scheduledAt, reason: 'spend-window' })
        return
      }
    }
    const cells = shiftCells(plan)
    const session = this.ctx.sessions.prepare(SessionId(id), { meta: { cwd: this.config.workspaceRoot } })
    await this.publish(session, async () => {
      session.append('shift/start', { shiftId: id, digest, plan, scheduledAt })
      await this.ctx.sessions.flush(session)
      await this.drive(session, id, plan, cells, 0)
    })
  }

  /** Record one refused slot as its own session, holding that one event. */
  private async skip(id: string, skipped: ShiftSkipped): Promise<void> {
    const session = this.ctx.sessions.prepare(SessionId(id), { meta: { cwd: this.config.workspaceRoot } })
    await this.publish(session, () => {
      session.append('shift/skipped', skipped)
    })
  }

  /** Record the orphans of an interrupted process, then run what never started. */
  private async resume(ledger: ShiftLedger, stamped: readonly StampedCell[]): Promise<void> {
    const { plan, shiftId: id } = ledger.start
    const cells = shiftCells(plan)
    const split = splitPending(cells, ledger, stamped)
    const preparation = await this.ctx.sessionPersistence.prepare(ledger.sessionId)
    const { session } = preparation
    try {
      await this.publish(session, async () => {
        for (const orphan of split.orphans) {
          session.append('shift/cell', {
            shiftId: id,
            cell: orphan.cell,
            sessionId: orphan.sessionId,
            outcome: { kind: 'interrupted' },
          })
        }
        session.append('shift/resume', { shiftId: id, done: split.done, pending: split.pending })
        await this.ctx.sessions.flush(session)
        await this.drive(session, id, plan, split.pending, shiftSpend(stamped, id))
      })
    } finally {
      preparation[Symbol.dispose]()
    }
  }

  /**
   * Run the pending cells of one shift through the fleet, writing one
   * `shift/cell` per announced cell, and close the ledger.
   */
  private async drive(
    session: Session,
    id: string,
    plan: ShiftPlan,
    pending: readonly FleetCell[],
    spent: number,
  ): Promise<void> {
    if (pending.length === 0) {
      await this.close(session, id, 'completed', 0)
      return
    }
    const remaining = plan.tokenCeiling === undefined ? undefined : plan.tokenCeiling - spent
    if (remaining !== undefined && remaining < 1) {
      await this.close(session, id, 'ceiling', 0)
      return
    }
    const controller = new AbortController()
    this.controller = controller
    let ceilingReached = false
    // The fleet announces a cell after its session is durable and its
    // workspace reaped, so the ledger entry only ever follows the fact.
    const unobserve = this.ctx.on('fleet/cell', (payload) => {
      if (payload.group !== id) return
      if (payload.outcome.kind === 'error' && payload.outcome.code === 'FLEET_TOKEN_CEILING_REACHED') ceilingReached = true
      session.append('shift/cell', {
        shiftId: id,
        cell: payload.cell,
        ...payload.outcome.kind === 'reported' ? { sessionId: payload.outcome.sessionId } : {},
        outcome: payload.outcome.kind === 'reported'
          ? { kind: 'reported', certified: payload.outcome.certified }
          : { kind: 'error', ...payload.outcome.code === undefined ? {} : { code: payload.outcome.code }, message: payload.outcome.message },
      })
    })
    let report: FleetRunReport
    try {
      report = await this.ctx.fleet.run({
        environments: { ids: plan.environments },
        models: plan.models,
        repetitions: plan.repetitions,
        cells: pending,
        workspaceRoot: this.config.workspaceRoot,
        group: id,
        district: plan.district,
        ...remaining === undefined ? {} : { tokenCeiling: remaining },
        signal: controller.signal,
      })
    } finally {
      unobserve()
      this.controller = undefined
    }
    const outcome = endOutcome(controller.signal.aborted, ceilingReached)
    await this.close(session, id, outcome, report.spend.inputTokens + report.spend.outputTokens)
  }

  /** Append the closing record over every cell the session holds and flush it. */
  private async close(session: Session, id: string, outcome: ShiftEndOutcome, spend: number): Promise<void> {
    const records = session.events.flatMap(event => (event.type === 'shift/cell' ? [event.data] : []))
    session.append('shift/end', { shiftId: id, outcome, spend, cells: countCells(records) })
    await this.ctx.sessions.flush(session)
  }

  /**
   * Publish one slot session for the length of the slot, flush it, and detach.
   * The entry is owned by this fiber, so a disposal that races a slot removes
   * it after {@link ShiftService.stop} has let the slot settle.
   */
  private async publish(session: Session, body: () => Promise<void> | void): Promise<void> {
    const detach = this.ctx.effect(function* (this: ShiftService) {
      yield this.ctx.sessions.enter(session)
      this.ctx.sessions.announce(session)
    }.bind(this), `shifts.slot(${session.id})`)
    try {
      await body()
    } finally {
      await this.ctx.sessions.flush(session)
      await detach()
    }
  }

  /** Read every persisted session once: the shift ledgers and the grouped run stamps. */
  private async scan(): Promise<ShiftScan> {
    const ledgers: ShiftLedger[] = []
    const stamped: StampedCell[] = []
    for (const header of await this.ctx.sessionPersistence.list()) {
      const inspection = await this.ctx.sessionPersistence.inspect(header.id)
      const scanned = { meta: inspection.meta, events: inspection.events }
      const ledger = foldShiftLedger(scanned)
      if (ledger !== undefined) ledgers.push(ledger)
      stamped.push(...stampedCells(scanned, foldBudgetSpend(inspection.events, {}).totalTokens))
    }
    return { ledgers, stamped }
  }

  /** Resolve one district's environment selection against the registry and freeze its plan. */
  private freeze(district: ShiftDistrictConfig): ShiftPlan {
    const environments = this.select(district.district, district.plan.environments)
    if (environments.length === 0) {
      throw new ShiftError(`district "${district.district}" selects no environment`, 'SHIFT_INVALID_PLAN')
    }
    return {
      district: district.district,
      environments,
      models: district.plan.models,
      repetitions: district.plan.repetitions,
      ...district.plan.tokenCeiling === undefined ? {} : { tokenCeiling: district.plan.tokenCeiling },
    }
  }

  /** The environment ids one selection names, in registry order for a filter. */
  private select(district: string, selection: FleetEnvironmentSelection): EnvironmentId[] {
    // The fleet declares the registry injection this driver reads through; a
    // composition without it cannot run a cell at all.
    const registry = this.ctx.get('environments')
    if (registry === undefined) {
      throw new ShiftError(`district "${district}" cannot freeze a plan without the environment registry`, 'SHIFT_INVALID_PLAN')
    }
    if ('ids' in selection) {
      return selection.ids.map((id) => {
        if (registry.get(id) === undefined) {
          throw new ShiftError(`environment "${id}" of district "${district}" is not registered`, 'SHIFT_INVALID_PLAN')
        }
        return id
      })
    }
    return registry.list(selection.filter).map(definition => definition.id)
  }
}

/** Directory test that treats a missing or unreadable path as no directory. */
function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    // statSync throws for a missing or unreadable path; both mean the
    // deployment named no usable workspace root.
    return false
  }
}

export default ShiftService
