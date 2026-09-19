#!/usr/bin/env node
/**
 * Test driver: boot the two-preset experiment composition, run one frozen
 * paired experiment whose arms differ only in the agent preset their cells
 * compose from, and print the result beside what every cell session recorded —
 * the preset on its `environment/run` stamp and which persona section reached
 * its model.
 *
 * The two facts are printed together on purpose: the stamp is what a fold
 * reads, and the persona is what the model saw, so one document shows that the
 * logged composition is the composition that ran.
 *
 *   presets-driver.ts <config> [candidate-preset]
 *
 * A second argument replaces the candidate arm's preset, which is how the e2e
 * drives the refusal a preset no root supplies earns before any cell runs.
 */

import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { parseExperimentGroup } from '@deepseek-ai/dsh-experiments'
import type {} from '@deepseek-ai/dsh-trajectories'
import type { Trajectory, TrajectorySink } from '@deepseek-ai/dsh-trajectories'

/** The preset ids the fixture's roster supplies, baseline arm first. */
const ARM_PRESETS = ['plain', 'briefed'] as const

/** The sentence only the `briefed` preset's own persona row contributes. */
const BRIEFED_SENTENCE = 'state the check you are satisfying'

/** The sentence the deployment's own persona contributes to every unshadowed cell. */
const DEPLOYMENT_SENTENCE = 'Run registered environments as validated sessions.'

/** Which persona section one cell's last request header carried. */
function persona(system: string | undefined): string {
  if (system === undefined) return 'no request'
  if (system.includes(BRIEFED_SENTENCE)) return 'briefed'
  return system.includes(DEPLOYMENT_SENTENCE) ? 'deployment' : 'other'
}

/** One cell session as this scenario reports it. */
interface CellRecord {
  readonly arm: string
  readonly environment: string
  readonly repetition: number
  readonly preset: string | undefined
  readonly persona: string
}

const [configPath, candidatePreset] = process.argv.slice(2)
if (configPath === undefined) throw new Error('experiment preset driver requires a config path')

const ctx = await boot('experiment-presets', resolveConfigPath(configPath, undefined))
try {
  // Loader siblings mount concurrently; the runner creates agents only over the settled application.
  await ctx.get('loader')?.await()
  const experiments = ctx.get('experiments')
  const environments = ctx.get('environments')
  const selection = ctx.get('agentDefaultModel')?.currentSelection()
  const trajectories = ctx.get('trajectories')
  if (experiments === undefined || environments === undefined || selection === undefined || trajectories === undefined) {
    throw new Error('the preset driver requires the experiments, environments, default-model, and trajectories services')
  }
  const route = { provider: selection.provider, model: selection.model }
  const [baseline, candidate] = ARM_PRESETS
  const result = await experiments.run({
    environments: environments.list({ heldOut: false }).map(definition => definition.id),
    repetitions: 1,
    baseline: { ...route, preset: baseline },
    candidate: { ...route, preset: candidatePreset ?? candidate },
    workspaceRoot: process.cwd(),
  })
  const lines: string[] = []
  const sink: TrajectorySink = { write: line => void lines.push(line), close: () => {} }
  await trajectories.export({ sink })
  const cells: CellRecord[] = lines
    .map(line => JSON.parse(line) as Trajectory)
    .flatMap((trajectory) => {
      const stamp = trajectory.environment
      if (stamp === undefined) return []
      const group = stamp.group === undefined ? undefined : parseExperimentGroup(stamp.group)
      return [{
        arm: group?.role ?? 'none',
        environment: stamp.environmentId,
        repetition: stamp.repetition,
        preset: stamp.preset,
        persona: persona(trajectory.system),
      }]
    })
    // The session store's listing order is not promised, so the document orders
    // its own rows: the arm, then the environment, then the repetition.
    .sort((left, right) => `${left.arm}|${left.environment}|${left.repetition}`
      .localeCompare(`${right.arm}|${right.environment}|${right.repetition}`))
  process.stdout.write(`${JSON.stringify({ type: 'result', result, cells })}\n`)
} finally {
  await ctx.fiber.dispose()
}
