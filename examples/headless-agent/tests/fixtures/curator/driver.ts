#!/usr/bin/env node
/**
 * Test driver: boot the curator composition, run one ordinary and one held-out
 * environment through the runner, then ask the curator for a `training` export
 * and an `evaluation` export of the same store. The e2e reads both manifests and
 * the evaluation lines the second one wrote.
 */

import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { jsonlFileSink } from '@deepseek-ai/dsh-trajectories'
import { EnvironmentId } from '@deepseek-ai/dsh-environments'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('curator driver requires a config path')

const ctx = await boot('curator-e2e', resolveConfigPath(configPath, undefined))
try {
  // Loader siblings mount concurrently; the runner creates agents only over the settled application.
  await ctx.get('loader')?.await()
  const runner = ctx.get('environmentRuns')
  const curator = ctx.get('curator')
  if (runner === undefined || curator === undefined) throw new Error('curator driver requires the runner and the curator service')
  for (const id of ['smoke:round-trip', 'smoke:reserved']) {
    const workspace = await mkdtemp(join(process.cwd(), 'workspace-'))
    await runner.run({ environment: EnvironmentId(id), workspace })
  }
  const training = await curator.export({
    purpose: 'training',
    sink: jsonlFileSink('./training.jsonl'),
    manifestPath: './training-manifest.json',
  })
  const evaluation = await curator.export({
    purpose: 'evaluation',
    sink: jsonlFileSink('./evaluation.jsonl'),
    manifestPath: './evaluation-manifest.json',
  })
  process.stdout.write(`${JSON.stringify({ type: 'result', training, evaluation })}\n`)
} finally {
  await ctx.fiber.dispose()
}
