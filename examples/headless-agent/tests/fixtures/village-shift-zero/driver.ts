#!/usr/bin/env node
/**
 * Driver: boot the village-shift-zero composition, run the due slot of both
 * districts through the shift loop, fold the observatory page and document,
 * export the session facts and the withheld-aware trajectories beside them,
 * and print the ledgers with the counts an inspection needs.
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
if (configPath === undefined) throw new Error('village-shift-zero driver requires a config path')

const ctx = await boot('village-shift-zero', resolveConfigPath(configPath, undefined))
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
    throw new Error('village-shift-zero requires the shifts, observatory, scorekeeper, trajectories, and persistence services')
  }
  await shifts.start()
  await shifts.stop()

  const ledgers: { sessionId: string; events: { type: string; data: unknown }[] }[] = []
  for (const stored of await persistence.list()) {
    const { events } = await persistence.inspect(stored.id)
    const shiftEvents = events.filter((event: SessionEvent) => event.type.startsWith('shift/'))
    if (shiftEvents.length > 0) {
      ledgers.push({ sessionId: stored.id, events: shiftEvents.map(event => ({ type: event.type, data: event.data })) })
    }
  }

  const snapshot = await observatory.snapshot()
  const page = observatory.render(snapshot, Date.now())
  await writeFile('observatory.html', page.html)
  await writeFile('observatory.json', `${JSON.stringify(page.json, null, 2)}\n`)
  const facts = await scorekeeper.exportFacts({ sink: jsonlFileSink('./facts.jsonl') })
  const exported = await trajectories.export({ sink: jsonlFileSink('./trajectories.jsonl') })
  process.stdout.write(`${JSON.stringify({ type: 'result', ledgers, document: page.json, facts, exported })}\n`)
} finally {
  await ctx.fiber.dispose()
}
