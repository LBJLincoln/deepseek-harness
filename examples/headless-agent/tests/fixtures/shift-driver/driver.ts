#!/usr/bin/env node
/**
 * Test driver: boot the shift-driver composition, run the district's due slot
 * to completion, and print every shift ledger plus the run stamps the cells
 * left in the persistence root.
 *
 * With `DSH_TEST_SHIFT_KILL_AFTER_CELL` set, the driver instead stays up like
 * an unattended process and exits hard on the first announced cell, leaving a
 * shift whose ledger is open and whose first cell has a session but no record —
 * exactly the state the next boot resumes.
 */

import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-fleet'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-shifts'

/** Exit code the kill switch leaves behind, distinct from every clean exit. */
const KILLED = 9

/** One shift session's ledger as the e2e asserts on it. */
interface LedgerLine {
  readonly sessionId: string
  readonly events: { readonly type: string; readonly data: unknown }[]
}

/** One cell session's run stamp as the e2e asserts on it. */
interface StampLine {
  readonly sessionId: string
  readonly group?: string
  readonly district?: string
  readonly environmentId: string
  readonly repetition: number
}

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('shift-driver requires a config path')

/** Every shift ledger and every grouped run stamp in the persistence root. */
async function readRoot(persistence: SessionPersistence): Promise<{ ledgers: LedgerLine[]; stamps: StampLine[] }> {
  const ledgers: LedgerLine[] = []
  const stamps: StampLine[] = []
  for (const stored of await persistence.list()) {
    const { events } = await persistence.inspect(stored.id)
    const shiftEvents = events.filter((event: SessionEvent) => event.type.startsWith('shift/'))
    if (shiftEvents.length > 0) {
      ledgers.push({ sessionId: stored.id, events: shiftEvents.map(event => ({ type: event.type, data: event.data })) })
    }
    for (const event of events) {
      if (event.type !== 'environment/run') continue
      stamps.push({
        sessionId: stored.id,
        ...event.data.group === undefined ? {} : { group: event.data.group },
        ...event.data.district === undefined ? {} : { district: event.data.district },
        environmentId: event.data.environmentId,
        repetition: event.data.repetition,
      })
    }
  }
  return { ledgers, stamps }
}

const ctx = await boot('shift-driver-e2e', resolveConfigPath(configPath, undefined))
try {
  // Loader siblings mount concurrently; a slot freezes its plan against the
  // environment registry, so the driver drives only the settled application.
  await ctx.get('loader')?.await()
  const shifts = ctx.get('shifts')
  const persistence = ctx.get('sessionPersistence')
  if (shifts === undefined || persistence === undefined) throw new Error('shift-driver requires the shifts and session persistence services')
  if (process.env.DSH_TEST_SHIFT_KILL_AFTER_CELL === '1') {
    // Registered before the shift's own observer, so the process dies before
    // the ledger records the cell whose session is already durable.
    ctx.on('fleet/cell', () => {
      process.exit(KILLED)
    })
    await shifts.start()
    // An unattended driver stays up on its cadence; the kill switch ends it.
    await new Promise<never>(() => {})
  }
  await shifts.start()
  const observed = await readRoot(persistence)
  process.stdout.write(`${JSON.stringify({ type: 'result', ...observed })}\n`)
} finally {
  await ctx.fiber.dispose()
}
