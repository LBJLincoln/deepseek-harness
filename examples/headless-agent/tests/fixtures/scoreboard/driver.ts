#!/usr/bin/env node
/**
 * Test driver: boot the scoreboard composition, run the training-eligible
 * environments twice each on the default route, then fold the same cells back
 * out of the persisted logs — a scoreboard, the facts of the first certified
 * cell, and a JSONL export to `./facts.jsonl` — and print both the fleet's
 * in-memory leaderboard and the log-derived one for the e2e's assertions.
 */

import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { jsonlFileSink } from '@deepseek-ai/dsh-trajectories'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('scoreboard driver requires a config path')

const ctx = await boot('scoreboard-e2e', resolveConfigPath(configPath, undefined))
try {
  // Loader siblings mount concurrently; the runner creates agents only over the settled application.
  await ctx.get('loader')?.await()
  const fleet = ctx.get('fleet')
  const scorekeeper = ctx.get('scorekeeper')
  if (fleet === undefined || scorekeeper === undefined) throw new Error('scoreboard driver requires the fleet and the scorekeeper service')
  const report = await fleet.run({
    environments: { filter: { heldOut: false } },
    models: [],
    repetitions: 2,
    workspaceRoot: process.cwd(),
    group: 'scoreboard-e2e',
  })
  const certified = report.cells.find(outcome => 'report' in outcome && outcome.report.certified)
  if (certified === undefined || !('report' in certified)) throw new Error('scoreboard driver expects one certified cell')
  const scoreboard = await scorekeeper.leaderboard({ group: 'scoreboard-e2e' })
  const facts = await scorekeeper.facts(certified.report.sessionId)
  const exported = await scorekeeper.exportFacts({ sink: jsonlFileSink('./facts.jsonl') })
  process.stdout.write(`${JSON.stringify({ type: 'result', leaderboard: report.leaderboard, scoreboard, facts, exported })}\n`)
} finally {
  await ctx.fiber.dispose()
}
