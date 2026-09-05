#!/usr/bin/env node
/**
 * Test driver: boot the trajectory-export composition, run one turn through
 * the certificate-gated completion lifecycle, then export every persisted
 * session to `./trajectories.jsonl` through the composed service for the
 * e2e's inspect step.
 */

import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { jsonlFileSink } from '@deepseek-ai/dsh-trajectories'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('trajectory-export driver requires a config path')

const ctx = await boot('trajectory-export-e2e', resolveConfigPath(configPath, undefined))
try {
  const result = await runFixtureTurn(ctx, { task: 'prove the certificate-gated completion' })
  const trajectories = ctx.get('trajectories')
  if (trajectories === undefined) throw new Error('trajectory-export driver requires the trajectories service')
  const report = await trajectories.export({ sink: jsonlFileSink('./trajectories.jsonl') })
  process.stdout.write(`${JSON.stringify({ ...result, report })}\n`)
} finally {
  await ctx.fiber.dispose()
}
