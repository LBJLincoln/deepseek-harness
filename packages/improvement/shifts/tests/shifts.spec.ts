/**
 * `ctx.shifts` over a real session store and JSONL backend with a hand-built
 * fleet: what a slot records, what a restarted process resumes, the two
 * refusals, the ceiling a resumed shift runs under, and disposal.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { EnvironmentId } from '@deepseek-ai/dsh-environments'
import type { EnvironmentDefinition, EnvironmentFilter, EnvironmentId as EnvironmentIdType } from '@deepseek-ai/dsh-environments/types'
import type { FleetCell, FleetCellEvent, FleetPlan, FleetRunReport } from '@deepseek-ai/dsh-fleet'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { CheckId } from '@deepseek-ai/dsh-verification'
import ShiftService, { shiftDigest, ShiftError, shiftId } from '@deepseek-ai/dsh-shifts'
import type { Config, ShiftDistrictConfig, ShiftEnd, ShiftPlan, ShiftSkipped, ShiftStart } from '@deepseek-ai/dsh-shifts'
import { cell, cellLog, DISTRICT, header, Log, plan, RESERVED, ROUND_TRIP, ROUTE, UNSATISFIABLE } from './log.ts'

declare module '@deepseek-ai/dsh-environments/types' {
  interface EnvironmentKindMap {
    smoke: Record<string, never>
  }
}

const HUGE_INTERVAL = 86_400_000

const roots: string[] = []
const trees: Context[] = []

afterEach(async () => {
  for (const ctx of trees.splice(0)) await ctx.fiber.dispose()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function definition(id: EnvironmentIdType, heldOut: boolean): EnvironmentDefinition {
  return {
    id,
    kind: 'smoke',
    name: id,
    description: id,
    task: { prompt: `Run ${id}.` },
    checks: [{ id: CheckId('check'), outcome: 'passes', run: 'true' }],
    heldOut,
    owner: '@deepseek-ai/dsh-shifts-tests',
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

/** How one stub cell settles, and what its session records. */
interface CellScript {
  readonly certified?: boolean
  readonly code?: string
  readonly message?: string
  /** Tokens the cell's own session log accounts for; `0` writes no assistant message. */
  readonly tokens?: number
  /** Awaited before the cell settles, so a spec can hold a run open. */
  readonly before?: () => Promise<void> | void
}

/**
 * A fleet that persists one session per cell exactly as the runner does — a
 * grouped, districted `environment/run` stamp — and announces each settled
 * cell on `fleet/cell` after that session is durable.
 */
class StubFleet extends Service {
  static current: StubFleet
  static inject = ['sessionPersistence']
  readonly plans: FleetPlan[] = []
  script: (target: FleetCell) => CellScript = () => ({ certified: true, tokens: 10 })
  constructor(ctx: Context) {
    super(ctx, 'fleet')
    StubFleet.current = this
  }

  async run(fleetPlan: FleetPlan): Promise<FleetRunReport> {
    this.plans.push(fleetPlan)
    const group = fleetPlan.group as string
    const run = this.plans.length
    let inputTokens = 0
    for (const target of fleetPlan.cells ?? []) {
      const script = this.script(target)
      await script.before?.()
      const tokens = script.tokens ?? 0
      inputTokens += tokens
      const sessionId = SessionId(`cell-${target.environment}-${target.repetition}-${run}`)
      const meta: SessionHeader = header(sessionId, Date.now())
      await this.ctx.sessionPersistence.create(meta)
      await this.ctx.sessionPersistence.append(sessionId, cellLog(target, group, fleetPlan.district, tokens))
      const payload: FleetCellEvent = {
        group,
        ...fleetPlan.district === undefined ? {} : { district: fleetPlan.district },
        cell: target,
        outcome: script.message === undefined
          ? { kind: 'reported', sessionId, certified: script.certified === true }
          : { kind: 'error', ...script.code === undefined ? {} : { code: script.code }, message: script.message },
      }
      this.ctx.emit('fleet/cell', payload)
    }
    return { group, cells: [], leaderboard: [], spend: { inputTokens, outputTokens: 0 } }
  }
}

/** A Loader stand-in whose settlement the driver waits for before its first freeze. */
class StubLoader extends Service {
  constructor(ctx: Context) {
    super(ctx, 'loader')
  }
  async await(): Promise<void> {
    await Promise.resolve()
  }
}

/** The district config every spec starts from. */
function district(overrides: Partial<ShiftDistrictConfig> = {}): ShiftDistrictConfig {
  return {
    district: DISTRICT,
    plan: { environments: { filter: { heldOut: false } }, models: [ROUTE], repetitions: 1 },
    cadence: { intervalMs: HUGE_INTERVAL },
    ...overrides,
  }
}

interface HarnessOptions {
  /** Persistence and workspace root; a fresh temporary directory unless a spec reuses one. */
  readonly root?: string
  /** Compose a `loader` service the driver waits for. */
  readonly loader?: boolean
  /** Leave the environment registry out, so a slot cannot freeze its plan. */
  readonly registry?: boolean
}

/** Store, JSONL backend, environment registry, stub fleet, and the driver. */
async function harness(config: Partial<Config> = {}, options: HarnessOptions = {}) {
  const root = options.root ?? await mkdtemp(join(tmpdir(), 'dsh-shifts-'))
  if (options.root === undefined) roots.push(root)
  const ctx = new Context()
  trees.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  if (options.registry !== false) await ctx.plugin(StubEnvironments)
  if (options.loader === true) await ctx.plugin(StubLoader)
  await ctx.plugin(StubFleet)
  await ctx.plugin(ShiftService, {
    workspaceRoot: root,
    districts: [district()],
    startImmediately: true,
    ...config,
  } satisfies Config)
  return { ctx, root }
}

/** Ids of every persisted session. */
async function sessionIds(ctx: Context): Promise<string[]> {
  return (await ctx.sessionPersistence.list()).map(stored => stored.id)
}

/** The `shift/*` events of one persisted session, as type and payload pairs. */
async function ledgerOf(ctx: Context, id: string): Promise<{ type: string; data: unknown }[]> {
  const inspection = await ctx.sessionPersistence.inspect(SessionId(id))
  return inspection.events
    .filter(event => event.type.startsWith('shift/'))
    .map(event => ({ type: event.type, data: event.data }))
}

/** Every shift session's ledger, keyed by session id. */
async function ledgers(ctx: Context): Promise<Map<string, { type: string; data: unknown }[]>> {
  const shifts = (await sessionIds(ctx)).filter(id => id.startsWith('shift-'))
  return new Map(await Promise.all(shifts.map(async id => [id, await ledgerOf(ctx, id)] as const)))
}

/** The one shift session a spec's slot created. */
async function shiftSessionOf(ctx: Context): Promise<string> {
  const shifts = (await sessionIds(ctx)).filter(id => id.startsWith('shift-'))
  expect(shifts).toHaveLength(1)
  return shifts[0] as string
}

/**
 * Persist a shift that started and never ended, plus one session per cell that
 * already ran — exactly what a killed process leaves behind.
 * @param stamped - the cells whose sessions exist.
 * @param tokens - tokens each of those sessions accounts for.
 * @param frozen - the plan the seeded `shift/start` carries.
 * @returns the persistence root and the seeded shift id.
 */
async function seedInterrupted(
  stamped: readonly FleetCell[],
  tokens: number,
  frozen: ShiftPlan = plan(),
): Promise<{ root: string; shift: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-shifts-'))
  roots.push(root)
  const shift = shiftId(shiftDigest(frozen), 1_000)
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  await ctx.sessionPersistence.create(header(shift, 500))
  await ctx.sessionPersistence.append(SessionId(shift), new Log().push('shift/start', {
    shiftId: shift,
    digest: shiftDigest(frozen),
    plan: frozen,
    scheduledAt: 1_000,
  }).events)
  for (const target of stamped) {
    const id = `orphan-${target.environment}-${target.repetition}`
    await ctx.sessionPersistence.create(header(id, 600))
    await ctx.sessionPersistence.append(SessionId(id), cellLog(target, shift, DISTRICT, tokens))
  }
  await ctx.fiber.dispose()
  return { root, shift }
}

describe('ShiftService config', () => {
  it('refuses a deployment it cannot run, at load', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-shifts-'))
    roots.push(root)
    const compose = async (config: Partial<Config>): Promise<void> => {
      const ctx = new Context()
      trees.push(ctx)
      await ctx.plugin(SessionStore)
      await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
      await ctx.plugin(StubEnvironments)
      await ctx.plugin(StubFleet)
      await ctx.plugin(ShiftService, {
        workspaceRoot: root,
        districts: [district()],
        startImmediately: false,
        ...config,
      } satisfies Config)
    }
    await expect(compose({ workspaceRoot: join(root, 'absent') })).rejects.toBeInstanceOf(ShiftError)
    await expect(compose({ workspaceRoot: 'relative/root' })).rejects.toMatchObject({ code: 'SHIFT_INVALID_CONFIG' })
    await expect(compose({ districts: [] })).rejects.toMatchObject({
      code: 'SHIFT_INVALID_CONFIG',
      message: 'the driver is composed with no district',
    })
    await expect(compose({ districts: [district(), district()] })).rejects.toMatchObject({
      message: `district "${DISTRICT}" is configured twice`,
    })
    const routeless = district({ plan: { environments: { ids: [ROUND_TRIP] }, models: [], repetitions: 1 } })
    await expect(compose({ districts: [routeless] })).rejects.toMatchObject({
      message: `district "${DISTRICT}" names no model route`,
    })
  })

  it('rejects a non-positive cadence or window in the schema and leaves an omitted window absent', () => {
    const validate = (districts: ShiftDistrictConfig[]): Config =>
      ShiftService.Config({ workspaceRoot: '/tmp', districts, startImmediately: true })
    expect(() => validate([district({ cadence: { intervalMs: 0 } })])).toThrow()
    expect(() => validate([district({ spendWindow: { windowMs: 0, maxTokens: 5 } })])).toThrow()
    expect(() => validate([district({ spendWindow: { windowMs: 5, maxTokens: 0 } })])).toThrow()
    const zeroReps = district({ plan: { environments: { ids: [ROUND_TRIP] }, models: [ROUTE], repetitions: 0 } })
    expect(() => validate([zeroReps])).toThrow()
    expect(validate([district()]).districts[0]?.spendWindow).toBeUndefined()
    const byId = district({ plan: { environments: { ids: [ROUND_TRIP] }, models: [ROUTE], repetitions: 1 } })
    expect(validate([byId]).districts[0]?.plan.environments).toEqual({ ids: [ROUND_TRIP] })
  })

  it('refuses a slot whose plan the registry cannot freeze', async () => {
    const missing = district({ plan: { environments: { ids: [EnvironmentId('smoke:missing')] }, models: [ROUTE], repetitions: 1 } })
    const unknown = await harness({ districts: [missing] })
    await expect(unknown.ctx.shifts.start()).rejects.toMatchObject({
      code: 'SHIFT_INVALID_PLAN',
      message: `environment "smoke:missing" of district "${DISTRICT}" is not registered`,
    })

    const empty = district({ plan: { environments: { filter: { kind: 'other' as 'smoke' } }, models: [ROUTE], repetitions: 1 } })
    const selectsNothing = await harness({ districts: [empty] })
    await expect(selectsNothing.ctx.shifts.start()).rejects.toMatchObject({
      message: `district "${DISTRICT}" selects no environment`,
    })

    // The registry is the fleet's own injection; without it the driver refuses
    // the slot instead of freezing a plan over an empty inventory.
    const registryless = await harness({}, { registry: false })
    await expect(registryless.ctx.shifts.start()).rejects.toMatchObject({
      message: `district "${DISTRICT}" cannot freeze a plan without the environment registry`,
    })
  })
})

describe('ShiftService slots', () => {
  it('opens one slot over the settled application, records every cell, and closes the ledger', async () => {
    const { ctx } = await harness({}, { loader: true })
    await ctx.shifts.start()

    const frozen: ShiftPlan = { district: DISTRICT, environments: [ROUND_TRIP, UNSATISFIABLE], models: [ROUTE], repetitions: 1 }
    const digest = shiftDigest(frozen)
    const shift = await shiftSessionOf(ctx)
    expect(shift.startsWith(`shift-${digest}-`)).toBe(true)

    const ledger = await ledgerOf(ctx, shift)
    expect(ledger.map(entry => entry.type)).toEqual(['shift/start', 'shift/cell', 'shift/cell', 'shift/end'])
    const start = ledger[0]?.data as ShiftStart
    expect(start.digest).toBe(digest)
    expect(start.plan).toEqual(frozen)
    expect(shiftId(start.digest, start.scheduledAt)).toBe(shift)
    expect(ledger[1]?.data).toEqual({
      shiftId: shift,
      cell: cell(ROUND_TRIP),
      sessionId: `cell-${ROUND_TRIP}-0-1`,
      outcome: { kind: 'reported', certified: true },
    })
    expect(ledger[3]?.data).toEqual({
      shiftId: shift,
      outcome: 'completed',
      spend: 20,
      cells: { reported: 2, error: 0, interrupted: 0 },
    })

    const fleetPlan = StubFleet.current.plans[0]
    expect(fleetPlan?.group).toBe(shift)
    expect(fleetPlan?.district).toBe(DISTRICT)
    expect(fleetPlan?.cells).toEqual([cell(ROUND_TRIP), cell(UNSATISFIABLE)])
    expect(fleetPlan?.tokenCeiling).toBeUndefined()
    expect(fleetPlan?.workspaceRoot).toBeDefined()
  })

  it('keeps a refused cell as an error row and closes on the ceiling it reports', async () => {
    const capped = district({
      plan: { environments: { filter: { heldOut: false } }, models: [ROUTE], repetitions: 1, tokenCeiling: 500 },
    })
    const { ctx } = await harness({ districts: [capped] })
    StubFleet.current.script = target => (target.environment === ROUND_TRIP
      ? { certified: false, tokens: 4 }
      : { code: 'FLEET_TOKEN_CEILING_REACHED', message: 'the ceiling was reached' })
    await ctx.shifts.start()

    const shift = await shiftSessionOf(ctx)
    const ledger = await ledgerOf(ctx, shift)
    expect(StubFleet.current.plans[0]?.tokenCeiling).toBe(500)
    expect(ledger[1]?.data).toMatchObject({ outcome: { kind: 'reported', certified: false } })
    expect(ledger[2]?.data).toEqual({
      shiftId: shift,
      cell: cell(UNSATISFIABLE),
      outcome: { kind: 'error', code: 'FLEET_TOKEN_CEILING_REACHED', message: 'the ceiling was reached' },
    })
    expect(ledger[3]?.data).toMatchObject({ outcome: 'ceiling', cells: { reported: 1, error: 1, interrupted: 0 } })
  })

  it('records an uncoded failure without a code and passes another batch by', async () => {
    const byId = district({ plan: { environments: { ids: [ROUND_TRIP, UNSATISFIABLE] }, models: [ROUTE], repetitions: 1 } })
    const { ctx } = await harness({ districts: [byId] })
    StubFleet.current.script = target => ({
      message: 'the runner exploded',
      before: () => {
        ctx.emit('fleet/cell', {
          group: 'fleet-elsewhere',
          cell: target,
          outcome: { kind: 'reported', sessionId: SessionId('other'), certified: true },
        })
      },
    })
    await ctx.shifts.start()

    const shift = await shiftSessionOf(ctx)
    const ledger = await ledgerOf(ctx, shift)
    expect(ledger.map(entry => entry.type)).toEqual(['shift/start', 'shift/cell', 'shift/cell', 'shift/end'])
    expect(ledger[1]?.data).toEqual({
      shiftId: shift,
      cell: cell(ROUND_TRIP),
      outcome: { kind: 'error', message: 'the runner exploded' },
    })
    expect(ledger[3]?.data).toMatchObject({ outcome: 'completed', spend: 0, cells: { reported: 0, error: 2, interrupted: 0 } })
  })
})

describe('ShiftService resume', () => {
  it('records the orphan, resumes with the right pending set, and runs only the missing cells', async () => {
    const { root, shift } = await seedInterrupted([cell(ROUND_TRIP)], 30)
    const { ctx } = await harness({}, { root })
    await ctx.shifts.start()

    const ledger = await ledgerOf(ctx, shift)
    expect(ledger.map(entry => entry.type)).toEqual(['shift/start', 'shift/cell', 'shift/resume', 'shift/cell', 'shift/end'])
    expect(ledger[1]?.data).toEqual({
      shiftId: shift,
      cell: cell(ROUND_TRIP),
      sessionId: `orphan-${ROUND_TRIP}-0`,
      outcome: { kind: 'interrupted' },
    })
    expect(ledger[2]?.data).toEqual({ shiftId: shift, done: [cell(ROUND_TRIP)], pending: [cell(UNSATISFIABLE)] })
    expect(StubFleet.current.plans[0]?.cells).toEqual([cell(UNSATISFIABLE)])
    expect(StubFleet.current.plans[0]?.group).toBe(shift)
    expect(ledger[4]?.data).toMatchObject({
      outcome: 'completed',
      spend: 10,
      cells: { reported: 1, error: 0, interrupted: 1 },
    })
    // The district's previous slot is the resumed one, so no fresh slot opens.
    expect((await sessionIds(ctx)).filter(id => id.startsWith('shift-'))).toEqual([shift])
  })

  it('reduces the resumed ceiling by what the shift already spent', async () => {
    const capped = plan({ tokenCeiling: 100 })
    const { root } = await seedInterrupted([cell(ROUND_TRIP)], 30, capped)
    const { ctx } = await harness({}, { root })
    await ctx.shifts.start()
    expect(StubFleet.current.plans[0]?.tokenCeiling).toBe(70)
  })

  it('closes a resumed shift whose ceiling is already gone, without running a cell', async () => {
    const capped = plan({ tokenCeiling: 100 })
    const { root, shift } = await seedInterrupted([cell(ROUND_TRIP)], 120, capped)
    const { ctx } = await harness({}, { root })
    await ctx.shifts.start()
    expect(StubFleet.current.plans).toEqual([])
    const ledger = await ledgerOf(ctx, shift)
    expect(ledger.map(entry => entry.type)).toEqual(['shift/start', 'shift/cell', 'shift/resume', 'shift/end'])
    expect(ledger[3]?.data).toMatchObject({ outcome: 'ceiling', spend: 0, cells: { reported: 0, error: 0, interrupted: 1 } })
  })

  it('closes a resumed shift with nothing left to run', async () => {
    const { root, shift } = await seedInterrupted([cell(ROUND_TRIP), cell(UNSATISFIABLE)], 5)
    const { ctx } = await harness({}, { root })
    await ctx.shifts.start()
    expect(StubFleet.current.plans).toEqual([])
    const ledger = await ledgerOf(ctx, shift)
    expect(ledger.map(entry => entry.type)).toEqual(['shift/start', 'shift/cell', 'shift/cell', 'shift/resume', 'shift/end'])
    expect(ledger[3]?.data).toMatchObject({ done: [cell(ROUND_TRIP), cell(UNSATISFIABLE)], pending: [] })
    expect(ledger[4]?.data).toMatchObject({ outcome: 'completed', cells: { reported: 0, error: 0, interrupted: 2 } })
  })
})

describe('ShiftService refusals and disposal', () => {
  it('refuses a slot that lands on a running shift of the same district', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const { ctx } = await harness({ districts: [district({ cadence: { intervalMs: 1 } })] })
    StubFleet.current.script = () => ({ certified: true, tokens: 1, before: () => gate })
    const started = ctx.shifts.start()
    await vi.waitFor(async () => {
      expect((await sessionIds(ctx)).filter(id => id.startsWith('shift-')).length).toBeGreaterThan(1)
    })
    const stopping = ctx.shifts.stop()
    release()
    await Promise.all([started, stopping])

    const entries = [...(await ledgers(ctx)).values()]
    const opened = entries.filter(events => events[0]?.type === 'shift/start')
    expect(opened).toHaveLength(1)
    const refused = entries.filter(events => events[0]?.type === 'shift/skipped')
    expect(refused.length).toBeGreaterThan(0)
    for (const events of refused) {
      expect(events).toHaveLength(1)
      expect(events[0]?.data).toMatchObject({ reason: 'overlap' })
    }
  })

  it('refuses a slot whose district already spent its window', async () => {
    const windowed = { windowMs: 3_600_000, maxTokens: 5 }
    const first = await harness({ districts: [district({ spendWindow: windowed })] })
    await first.ctx.shifts.start()
    const closed = (await ledgerOf(first.ctx, await shiftSessionOf(first.ctx))).at(-1)?.data as ShiftEnd
    expect(closed.spend).toBe(20)
    await first.ctx.fiber.dispose()

    const second = await harness(
      { districts: [district({ cadence: { intervalMs: 1 }, spendWindow: windowed })] },
      { root: first.root },
    )
    await second.ctx.shifts.start()
    // Booting the second process and its first slot can take longer than the
    // default wait under a loaded test host; the assertion is about count, not time.
    await vi.waitFor(async () => {
      expect((await sessionIds(second.ctx)).filter(id => id.startsWith('shift-')).length).toBeGreaterThan(1)
    }, { timeout: 15_000 })
    await second.ctx.shifts.stop()

    const refused = [...(await ledgers(second.ctx)).values()].filter(events => events[0]?.type === 'shift/skipped')
    // A refused slot holds that one event; a slot landing on one still reading
    // the window is refused for the overlap instead, so both reasons appear.
    for (const events of refused) expect(events).toHaveLength(1)
    const reasons = refused.map(events => (events[0]?.data as ShiftSkipped).reason)
    expect(reasons).toContain('spend-window')
    expect(reasons.every(reason => reason === 'spend-window' || reason === 'overlap')).toBe(true)
    expect(StubFleet.current.plans).toEqual([])
  })

  it('cancels the run in flight when the driver stops, and closes the shift as stopped', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const { ctx } = await harness()
    StubFleet.current.script = () => ({ certified: true, tokens: 1, before: () => gate })
    const started = ctx.shifts.start()
    await vi.waitFor(() => {
      expect(StubFleet.current.plans).toHaveLength(1)
    })
    const stopping = ctx.shifts.stop()
    expect(StubFleet.current.plans[0]?.signal?.aborted).toBe(true)
    release()
    await Promise.all([started, stopping])

    const ledger = await ledgerOf(ctx, await shiftSessionOf(ctx))
    expect(ledger.at(-1)?.data).toMatchObject({ outcome: 'stopped' })
  })

  it('resumes nothing and opens nothing once the driver has been asked to stop', async () => {
    const { root, shift } = await seedInterrupted([cell(ROUND_TRIP)], 3)
    const interrupted = await harness({}, { root })
    const resuming = interrupted.ctx.shifts.start()
    await interrupted.ctx.shifts.stop()
    await resuming
    expect(StubFleet.current.plans).toEqual([])
    expect(await ledgerOf(interrupted.ctx, shift)).toHaveLength(1)

    const fresh = await harness()
    const opening = fresh.ctx.shifts.start()
    await fresh.ctx.shifts.stop()
    await opening
    expect((await sessionIds(fresh.ctx)).filter(id => id.startsWith('shift-'))).toEqual([])
  })

  it('logs the failure of a slot its cadence opened instead of taking the loop down', async () => {
    const missing = district({
      plan: { environments: { ids: [EnvironmentId('smoke:missing')] }, models: [ROUTE], repetitions: 1 },
      cadence: { intervalMs: 1 },
    })
    const { ctx } = await harness({ districts: [missing], startImmediately: false })
    const logged: unknown[] = []
    ctx.logger.exporter({ colors: 0, export: message => logged.push(message) })
    await expect(ctx.shifts.start()).resolves.toBeUndefined()
    await vi.waitFor(() => {
      expect(logged.length).toBeGreaterThan(0)
    })
    await ctx.shifts.stop()
    expect((await sessionIds(ctx)).filter(id => id.startsWith('shift-'))).toEqual([])
  })
})
