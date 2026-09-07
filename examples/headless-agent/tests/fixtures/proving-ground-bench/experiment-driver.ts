#!/usr/bin/env node
/**
 * Driver: boot the bench composition and run one frozen paired experiment from
 * a plan file, then publish the observatory page and document, the session
 * facts, the trajectories, and `status.json` beside the result.
 *
 *   experiment-driver.ts <config> <plan.json>
 *
 * The plan file holds `{ name, environments?, tier?, domain?, heldOut?,
 * repetitions, baseline, candidate, seed?, policyVersion? }`. `environments`
 * lists registered ids; when absent, every environment whose registered
 * `heldOut` flag equals the plan's `heldOut` (default false) is selected, then
 * narrowed by `tier` and `domain` read from each definition's detail. An arm is
 * `{ provider, model, implementer? }`; `implementer` is forwarded when the
 * experiments service accepts it.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type { EnvironmentRunImplementer } from '@deepseek-ai/dsh-environment-runner'
import { EnvironmentId } from '@deepseek-ai/dsh-environments'
import type { EnvironmentId as EnvironmentIdType } from '@deepseek-ai/dsh-environments/types'
import type { ExperimentPlan } from '@deepseek-ai/dsh-experiments'
import type {} from '@deepseek-ai/dsh-observatory'
import type {} from '@deepseek-ai/dsh-scorekeeper'
import { jsonlFileSink } from '@deepseek-ai/dsh-trajectories'

interface Arm {
  readonly provider: string
  readonly model: string
  readonly implementer?: EnvironmentRunImplementer
}

interface PlanFile {
  readonly name: string
  readonly environments?: readonly string[]
  readonly tier?: number
  readonly domain?: string
  readonly heldOut?: boolean
  readonly repetitions: number
  readonly baseline: Arm
  readonly candidate: Arm
  readonly seed?: number
  readonly policyVersion?: string
}

const [configPath, planPath] = process.argv.slice(2)
if (configPath === undefined || planPath === undefined) throw new Error('experiment-driver requires <config> <plan.json>')
const plan = JSON.parse(await readFile(planPath, 'utf8')) as PlanFile

const ctx = await boot('proving-ground-bench', resolveConfigPath(configPath, undefined))
try {
  // Loader siblings mount concurrently; the plan freezes against the settled registry.
  await ctx.get('loader')?.await()
  const experiments = ctx.get('experiments')
  const environments = ctx.get('environments')
  const observatory = ctx.get('observatory')
  const scorekeeper = ctx.get('scorekeeper')
  const trajectories = ctx.get('trajectories')
  if (experiments === undefined || environments === undefined || observatory === undefined
    || scorekeeper === undefined || trajectories === undefined) {
    throw new Error('the bench requires the experiments, environments, observatory, scorekeeper, and trajectories services')
  }
  const selected: readonly EnvironmentIdType[] = plan.environments === undefined
    ? environments
      .list({ heldOut: plan.heldOut ?? false })
      .filter((definition) => {
        const detail = definition.detail as { tier?: number; domain?: string }
        return (plan.tier === undefined || detail.tier === plan.tier) && (plan.domain === undefined || detail.domain === plan.domain)
      })
      .map(definition => definition.id)
    : plan.environments.map(id => EnvironmentId(id))
  const startedAt = new Date().toISOString()
  // An arm's optional implementer rides through as the experiments service defines its arm.
  const request: ExperimentPlan = {
    environments: selected,
    repetitions: plan.repetitions,
    baseline: plan.baseline,
    candidate: plan.candidate,
    workspaceRoot: process.cwd(),
    ...(plan.seed === undefined ? {} : { seed: plan.seed }),
    ...(plan.policyVersion === undefined ? {} : { policyVersion: plan.policyVersion }),
    sink: jsonlFileSink('./experiment.jsonl'),
  }
  const result = await experiments.run(request)
  const snapshot = await observatory.snapshot()
  const page = observatory.render(snapshot, Date.now())
  await writeFile('observatory.html', page.html)
  await writeFile('observatory.json', `${JSON.stringify(page.json, null, 2)}\n`)
  const facts = await scorekeeper.exportFacts({ sink: jsonlFileSink('./facts.jsonl') })
  const exported = await trajectories.export({ sink: jsonlFileSink('./trajectories.jsonl') })
  const status = { type: 'result', plan: plan.name, environments: selected, startedAt, endedAt: new Date().toISOString(), result, rows: page.json.rows, facts, exported }
  await writeFile('status.json', `${JSON.stringify(status, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify(status)}\n`)
} finally {
  await ctx.fiber.dispose()
}
