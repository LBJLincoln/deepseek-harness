#!/usr/bin/env node
/**
 * Test driver: boot the environment-run composition, run the three registered
 * environments through the runner in one process, then export every persisted
 * session to `./trajectories.jsonl` for the e2e's inspect step.
 */

import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { EnvironmentId } from '@deepseek-ai/dsh-environments'
import { jsonlFileSink } from '@deepseek-ai/dsh-trajectories'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('environment-run driver requires a config path')

const ctx = await boot('environment-run-e2e', resolveConfigPath(configPath, undefined))
try {
  // Loader siblings mount concurrently; the runner creates agents only over the settled application.
  await ctx.get('loader')?.await()
  const runner = ctx.get('environmentRuns')
  const trajectories = ctx.get('trajectories')
  if (runner === undefined || trajectories === undefined) throw new Error('environment-run driver requires the runner and the trajectories service')
  const reports = []
  for (const id of ['smoke:round-trip', 'smoke:unsatisfiable', 'smoke:reserved']) {
    const workspace = await mkdtemp(join(process.cwd(), 'workspace-'))
    reports.push(await runner.run({ environment: EnvironmentId(id), workspace }))
  }
  const report = await trajectories.export({ sink: jsonlFileSink('./trajectories.jsonl') })
  process.stdout.write(`${JSON.stringify({ type: 'result', reports, report })}\n`)
} finally {
  await ctx.fiber.dispose()
}
