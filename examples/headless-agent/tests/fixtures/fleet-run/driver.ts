#!/usr/bin/env node
/**
 * Test driver: boot the fleet-run composition, run the training-eligible
 * environments twice each on the default route under a named policy version
 * and a base seed, export every persisted session to `./trajectories.jsonl`,
 * and print the fleet report with its Markdown leaderboard for the e2e's
 * assertions.
 */

import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { leaderboardMarkdown } from '@deepseek-ai/dsh-fleet'
import { jsonlFileSink } from '@deepseek-ai/dsh-trajectories'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('fleet-run driver requires a config path')

const ctx = await boot('fleet-run-e2e', resolveConfigPath(configPath, undefined))
try {
  // Loader siblings mount concurrently; the runner creates agents only over the settled application.
  await ctx.get('loader')?.await()
  const fleet = ctx.get('fleet')
  const trajectories = ctx.get('trajectories')
  if (fleet === undefined || trajectories === undefined) throw new Error('fleet-run driver requires the fleet and the trajectories service')
  const report = await fleet.run({
    environments: { filter: { heldOut: false } },
    models: [],
    repetitions: 2,
    workspaceRoot: process.cwd(),
    group: 'fleet-e2e',
    policyVersion: 'policy-2026-09',
    seed: 100,
  })
  const exported = await trajectories.export({ sink: jsonlFileSink('./trajectories.jsonl') })
  process.stdout.write(`${JSON.stringify({ type: 'result', report, markdown: leaderboardMarkdown(report), exported })}\n`)
} finally {
  await ctx.fiber.dispose()
}
