#!/usr/bin/env node
/**
 * Offline fold: pair two fleet runs that differ in something an experiment arm
 * cannot yet carry (a composition overlay such as the attempt cap or a mounted
 * knowledge pack) and compute the same paired certificate-rate delta, bootstrap
 * interval, and verdict the experiments service computes for its own arms.
 *
 *   fold-driver.ts <baseline status.json> <candidate status.json> <out.json> [minimumDelta] [resamples]
 *
 * Both status files come from `fleet-driver.ts` and must cover the same
 * environments at the same repetition count. The digest that seeds the
 * bootstrap is derived from the two plan names and the cell set, so the same
 * pair of reports folds to the same interval in any process. The result is
 * labelled `offline` because the arms were not frozen together before running:
 * it is evidence for a hypothesis, never a promotion.
 */

import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { foldExperiment } from '@deepseek-ai/dsh-experiments'
import type { EnvironmentRunImplementer } from '@deepseek-ai/dsh-environment-runner'
import type { EnvironmentId } from '@deepseek-ai/dsh-environments/types'
import type { FleetRunReport } from '@deepseek-ai/dsh-fleet'

interface FleetStatus {
  readonly plan: string
  readonly environments: readonly string[]
  readonly implementer: EnvironmentRunImplementer
  readonly report: FleetRunReport
}

const [baselinePath, candidatePath, outPath, minimumDeltaArg, resamplesArg] = process.argv.slice(2)
if (baselinePath === undefined || candidatePath === undefined || outPath === undefined) {
  throw new Error('fold-driver requires <baseline status.json> <candidate status.json> <out.json> [minimumDelta] [resamples]')
}
const baseline = JSON.parse(await readFile(baselinePath, 'utf8')) as FleetStatus
const candidate = JSON.parse(await readFile(candidatePath, 'utf8')) as FleetStatus

const environments = [...baseline.environments].sort()
if (environments.join('\n') !== [...candidate.environments].sort().join('\n')) {
  throw new Error('fold-driver: the two runs cover different environments')
}
const repetitionOf = (status: FleetStatus): number[] => status.report.cells.map(outcome => outcome.cell.repetition)
const repetitions = Math.max(...repetitionOf(baseline), ...repetitionOf(candidate)) + 1
const modelOf = (status: FleetStatus): { provider: string; model: string } => {
  const first = status.report.cells[0]
  if (first === undefined) throw new Error(`fold-driver: ${status.plan} reported no cell`)
  return { provider: first.cell.model.provider, model: first.cell.model.model }
}
const digest = createHash('sha256')
  .update(JSON.stringify({ offline: 1, baseline: baseline.plan, candidate: candidate.plan, environments, repetitions }))
  .digest('hex')
const thresholds = {
  bootstrapResamples: resamplesArg === undefined ? 2000 : Number(resamplesArg),
  confidenceLevel: 0.95,
  minimumDelta: minimumDeltaArg === undefined ? 0.05 : Number(minimumDeltaArg),
  cellTokenCap: 600000,
}
const result = foldExperiment({
  digest,
  arms: {
    baseline: { model: modelOf(baseline), implementer: baseline.implementer, group: `offline-${digest}-baseline` },
    candidate: { model: modelOf(candidate), implementer: candidate.implementer, group: `offline-${digest}-candidate` },
  },
  environments: environments as unknown as readonly EnvironmentId[],
  repetitions,
  thresholds,
  baseline: baseline.report,
  candidate: candidate.report,
})
const record = { type: 'offline-fold', baseline: baseline.plan, candidate: candidate.plan, environments, repetitions, thresholds, result }
await writeFile(outPath, `${JSON.stringify(record, null, 2)}\n`)
process.stdout.write(`${JSON.stringify({ type: 'offline-fold', baseline: baseline.plan, candidate: candidate.plan, delta: result.delta, interval: result.interval, verdict: result.verdict })}\n`)
