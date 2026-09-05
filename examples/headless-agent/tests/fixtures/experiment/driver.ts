#!/usr/bin/env node
/**
 * Test driver: boot the experiment composition, run one frozen experiment over
 * the training-eligible environments with the composition's default route as
 * both arms, write the result to `./experiment.jsonl`, export every persisted
 * session to `./trajectories.jsonl`, and print the result for the e2e's
 * assertions.
 */

import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-experiments'
import { jsonlFileSink } from '@deepseek-ai/dsh-trajectories'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('experiment driver requires a config path')

const ctx = await boot('experiment-e2e', resolveConfigPath(configPath, undefined))
try {
  // Loader siblings mount concurrently; the runner creates agents only over the settled application.
  await ctx.get('loader')?.await()
  const experiments = ctx.get('experiments')
  const environments = ctx.get('environments')
  const selection = ctx.get('agentDefaultModel')?.currentSelection()
  const trajectories = ctx.get('trajectories')
  if (experiments === undefined || environments === undefined || selection === undefined || trajectories === undefined) {
    throw new Error('experiment driver requires the experiments, environments, default-model, and trajectories services')
  }
  const route = { provider: selection.provider, model: selection.model }
  const result = await experiments.run({
    environments: environments.list({ heldOut: false }).map(definition => definition.id),
    repetitions: 2,
    baseline: route,
    candidate: route,
    workspaceRoot: process.cwd(),
    sink: jsonlFileSink('./experiment.jsonl'),
  })
  const exported = await trajectories.export({ sink: jsonlFileSink('./trajectories.jsonl') })
  process.stdout.write(`${JSON.stringify({ type: 'result', result, exported })}\n`)
} finally {
  await ctx.fiber.dispose()
}
