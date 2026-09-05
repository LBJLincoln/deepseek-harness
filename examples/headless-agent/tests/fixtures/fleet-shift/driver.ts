#!/usr/bin/env node
/**
 * Test driver: boot the fleet-shift composition, run the training-eligible
 * environments twice each in the `workshop` district under a token ceiling of
 * one, export the persisted sessions twice — once with no district named and
 * once naming the workshop — and print the fleet report, both export reports,
 * and the `cell-*` directories left under the workspace root.
 */

import { readdir } from 'node:fs/promises'
import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { jsonlFileSink } from '@deepseek-ai/dsh-trajectories'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('fleet-shift driver requires a config path')

const ctx = await boot('fleet-shift-e2e', resolveConfigPath(configPath, undefined))
try {
  // Loader siblings mount concurrently; the runner creates agents only over the settled application.
  await ctx.get('loader')?.await()
  const fleet = ctx.get('fleet')
  const trajectories = ctx.get('trajectories')
  if (fleet === undefined || trajectories === undefined) throw new Error('fleet-shift driver requires the fleet and the trajectories service')
  const report = await fleet.run({
    environments: { filter: { heldOut: false } },
    models: [],
    repetitions: 2,
    workspaceRoot: process.cwd(),
    group: 'fleet-shift-e2e',
    district: 'workshop',
    tokenCeiling: 1,
  })
  const withheld = await trajectories.export({ sink: jsonlFileSink('./withheld.jsonl') })
  const named = await trajectories.export({ sink: jsonlFileSink('./workshop.jsonl'), districts: ['workshop'] })
  const workspaces = (await readdir(process.cwd())).filter(entry => entry.startsWith('cell-'))
  process.stdout.write(`${JSON.stringify({ type: 'result', report, withheld, named, workspaces })}\n`)
} finally {
  await ctx.fiber.dispose()
}
