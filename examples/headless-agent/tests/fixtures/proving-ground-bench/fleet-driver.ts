#!/usr/bin/env node
/**
 * Driver: boot the bench composition and run one fleet plan from a plan file,
 * then publish the observatory page and document, the session facts, the
 * trajectories, and `status.json` beside the report.
 *
 *   fleet-driver.ts <config> <plan.json>
 *
 * The plan file holds `{ name, environments?, tier?, domain?, heldOut?,
 * models: [{ provider, model }], implementer?, repetitions, seed?,
 * policyVersion?, district? }`. Environment selection follows the experiment
 * driver's rules. A fleet plan runs every model over every selected
 * environment, which is how one run compares several product models, or one
 * implementer against the same cells another run measured.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type { EnvironmentRunImplementer } from '@deepseek-ai/dsh-environment-runner'
import { EnvironmentId } from '@deepseek-ai/dsh-environments'
import type { EnvironmentId as EnvironmentIdType } from '@deepseek-ai/dsh-environments/types'
import type { FleetPlan } from '@deepseek-ai/dsh-fleet'
import type {} from '@deepseek-ai/dsh-observatory'
import type {} from '@deepseek-ai/dsh-scorekeeper'
import { jsonlFileSink } from '@deepseek-ai/dsh-trajectories'

interface PlanFile {
  readonly name: string
  readonly environments?: readonly string[]
  readonly tier?: number
  readonly domain?: string
  readonly heldOut?: boolean
  readonly models: readonly { readonly provider: string; readonly model: string }[]
  readonly implementer?: EnvironmentRunImplementer
  readonly repetitions: number
  readonly seed?: number
  readonly policyVersion?: string
  readonly district?: string
}

const [configPath, planPath] = process.argv.slice(2)
if (configPath === undefined || planPath === undefined) throw new Error('fleet-driver requires <config> <plan.json>')
const plan = JSON.parse(await readFile(planPath, 'utf8')) as PlanFile

const ctx = await boot('proving-ground-bench', resolveConfigPath(configPath, undefined))
try {
  await ctx.get('loader')?.await()
  const fleet = ctx.get('fleet')
  const environments = ctx.get('environments')
  const observatory = ctx.get('observatory')
  const scorekeeper = ctx.get('scorekeeper')
  const trajectories = ctx.get('trajectories')
  if (fleet === undefined || environments === undefined || observatory === undefined
    || scorekeeper === undefined || trajectories === undefined) {
    throw new Error('the bench requires the fleet, environments, observatory, scorekeeper, and trajectories services')
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
  const request: FleetPlan = {
    environments: { ids: selected },
    models: plan.models,
    repetitions: plan.repetitions,
    workspaceRoot: process.cwd(),
    ...(plan.implementer === undefined ? {} : { implementer: plan.implementer }),
    ...(plan.seed === undefined ? {} : { seed: plan.seed }),
    ...(plan.policyVersion === undefined ? {} : { policyVersion: plan.policyVersion }),
    ...(plan.district === undefined ? {} : { district: plan.district }),
  }
  const report = await fleet.run(request)
  const snapshot = await observatory.snapshot()
  const page = observatory.render(snapshot, Date.now())
  await writeFile('observatory.html', page.html)
  await writeFile('observatory.json', `${JSON.stringify(page.json, null, 2)}\n`)
  const facts = await scorekeeper.exportFacts({ sink: jsonlFileSink('./facts.jsonl') })
  const exported = await trajectories.export({ sink: jsonlFileSink('./trajectories.jsonl') })
  const status = { type: 'result', plan: plan.name, environments: selected, startedAt, endedAt: new Date().toISOString(), report, rows: page.json.rows, facts, exported }
  await writeFile('status.json', `${JSON.stringify(status, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify(status)}\n`)
} finally {
  await ctx.fiber.dispose()
}
