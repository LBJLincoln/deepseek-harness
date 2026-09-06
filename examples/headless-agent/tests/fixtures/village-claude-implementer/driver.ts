#!/usr/bin/env node
/**
 * Driver: boot the village-claude-implementer composition, run one fleet plan
 * of the two training-eligible smoke environments with the real Claude Code
 * product as the implementer of every cell, then fold the publication side —
 * the observatory page and document, the exported session facts, and the
 * exported trajectories — and print the report, the delegation records, both
 * export reports, and the document.
 */

import { writeFile } from 'node:fs/promises'
import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type { EnvironmentDelegation } from '@deepseek-ai/dsh-environment-runner/types'
import type {} from '@deepseek-ai/dsh-fleet'
import type {} from '@deepseek-ai/dsh-observatory'
import type {} from '@deepseek-ai/dsh-scorekeeper'
import { jsonlFileSink } from '@deepseek-ai/dsh-trajectories'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('village-claude-implementer driver requires a config path')

const ctx = await boot('village-claude-implementer', resolveConfigPath(configPath, undefined))
try {
  // Loader siblings mount concurrently; the runner creates agents only over the settled application.
  await ctx.get('loader')?.await()
  const fleet = ctx.get('fleet')
  const observatory = ctx.get('observatory')
  const scorekeeper = ctx.get('scorekeeper')
  const trajectories = ctx.get('trajectories')
  const persistence = ctx.get('sessionPersistence')
  if (fleet === undefined || observatory === undefined || scorekeeper === undefined
    || trajectories === undefined || persistence === undefined) {
    throw new Error('village-claude-implementer requires the fleet, observatory, scorekeeper, trajectories, and persistence services')
  }
  const report = await fleet.run({
    environments: { filter: { heldOut: false } },
    models: [],
    repetitions: 1,
    workspaceRoot: process.cwd(),
    group: 'village-claude-implementer',
    district: 'proving-ground',
    implementer: { kind: 'subagent', provider: 'claude-code', label: 'external' },
  })

  const delegations: Record<string, EnvironmentDelegation[]> = {}
  for (const outcome of report.cells) {
    if (!('report' in outcome)) continue
    const { events } = await persistence.inspect(outcome.report.sessionId)
    delegations[outcome.cell.environment] = events.flatMap(event => (
      event.type === 'environment/delegation' ? [event.data] : []
    ))
  }

  const snapshot = await observatory.snapshot()
  const page = observatory.render(snapshot, Date.now())
  await writeFile('observatory.html', page.html)
  await writeFile('observatory.json', `${JSON.stringify(page.json, null, 2)}\n`)
  const facts = await scorekeeper.exportFacts({ sink: jsonlFileSink('./facts.jsonl') })
  const exported = await trajectories.export({ sink: jsonlFileSink('./trajectories.jsonl') })
  process.stdout.write(`${JSON.stringify({
    type: 'result',
    report,
    delegations,
    facts,
    exported,
    document: page.json,
  })}\n`)
} finally {
  await ctx.fiber.dispose()
}
