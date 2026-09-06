#!/usr/bin/env node
/**
 * Driver: boot the village-live composition and keep its Proving Ground
 * district running on its cadence with the real Claude Code product as the
 * implementer of every cell. After the first slot, every refresh interval,
 * and at stop, it folds the observatory page and document, exports the
 * session facts and the trajectories, and writes `status.json` beside them.
 * `--once` runs the due slot, publishes, and stops, for the with-key e2e.
 */

import { writeFile } from 'node:fs/promises'
import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-fleet'
import type {} from '@deepseek-ai/dsh-observatory'
import type {} from '@deepseek-ai/dsh-scorekeeper'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-shifts'
import { jsonlFileSink } from '@deepseek-ai/dsh-trajectories'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('village-live driver requires a config path')
const once = process.argv.includes('--once')
/** How often the running district republishes its page and exports. */
const REFRESH_MS = 300_000

const ctx = await boot('village-live', resolveConfigPath(configPath, undefined))
try {
  // Loader siblings mount concurrently; a slot freezes its plan against the
  // environment registry, so the driver drives only the settled application.
  await ctx.get('loader')?.await()
  const shifts = ctx.get('shifts')
  const observatory = ctx.get('observatory')
  const scorekeeper = ctx.get('scorekeeper')
  const trajectories = ctx.get('trajectories')
  const persistence = ctx.get('sessionPersistence')
  if (shifts === undefined || observatory === undefined || scorekeeper === undefined
    || trajectories === undefined || persistence === undefined) {
    throw new Error('village-live requires the shifts, observatory, scorekeeper, trajectories, and persistence services')
  }

  const publish = async (phase: string): Promise<void> => {
    const ledgers: { sessionId: string; cells: number; ended: boolean; outcome?: unknown }[] = []
    for (const stored of await persistence.list()) {
      const { events } = await persistence.inspect(stored.id)
      const shiftEvents = events.filter((event: SessionEvent) => event.type.startsWith('shift/'))
      if (shiftEvents.length === 0) continue
      const end = shiftEvents.find(event => event.type === 'shift/end')
      ledgers.push({
        sessionId: stored.id,
        cells: shiftEvents.filter(event => event.type === 'shift/cell').length,
        ended: end !== undefined,
        outcome: end === undefined ? undefined : (end.data as { outcome: unknown }).outcome,
      })
    }
    const snapshot = await observatory.snapshot()
    const page = observatory.render(snapshot, Date.now())
    await writeFile('observatory.html', page.html)
    await writeFile('observatory.json', `${JSON.stringify(page.json, null, 2)}\n`)
    const facts = await scorekeeper.exportFacts({ sink: jsonlFileSink('./facts.jsonl') })
    const exported = await trajectories.export({ sink: jsonlFileSink('./trajectories.jsonl') })
    const status = { type: 'status', phase, at: new Date().toISOString(), ledgers, rows: page.json.rows, facts, exported }
    await writeFile('status.json', `${JSON.stringify(status, null, 2)}\n`)
    process.stdout.write(`${JSON.stringify(status)}\n`)
  }

  const firstSlot = shifts.start()
  if (once) {
    await firstSlot
    await shifts.stop()
    await publish('once')
  } else {
    let settle: (() => void) | undefined
    const stopped = new Promise<void>((resolve) => { settle = resolve })
    const timer = setInterval(() => {
      publish('refresh').catch((error: unknown) => process.stderr.write(`${String(error)}\n`))
    }, REFRESH_MS)
    const onSignal = (): void => {
      clearInterval(timer)
      shifts.stop()
        .then(() => publish('stopped'))
        .catch((error: unknown) => process.stderr.write(`${String(error)}\n`))
        .finally(() => settle?.())
    }
    process.once('SIGTERM', onSignal)
    process.once('SIGINT', onSignal)
    await firstSlot
    await publish('first-slot')
    await stopped
  }
} finally {
  await ctx.fiber.dispose()
}
