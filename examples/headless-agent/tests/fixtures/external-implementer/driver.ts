#!/usr/bin/env node
/**
 * Test driver: boot the external-implementer composition, run the
 * training-eligible environments once each with the `spawn` subagent provider
 * as the implementer, run the same environments again on their own model route,
 * and print both fleet reports, the delegation events each delegated cell
 * session recorded, the facts of the certified delegated cell, and the
 * scoreboard folded from every persisted log, for the e2e's assertions.
 */

import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type { EnvironmentDelegation } from '@deepseek-ai/dsh-environment-runner/types'
import type { FleetCellOutcome, FleetPlan } from '@deepseek-ai/dsh-fleet/types'
import type { SessionId } from '@deepseek-ai/dsh-session'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('external-implementer driver requires a config path')

const ctx = await boot('external-implementer-e2e', resolveConfigPath(configPath, undefined))
try {
  // Loader siblings mount concurrently; the runner creates agents only over the settled application.
  await ctx.get('loader')?.await()
  const fleet = ctx.get('fleet')
  const scorekeeper = ctx.get('scorekeeper')
  const persistence = ctx.get('sessionPersistence')
  if (fleet === undefined || scorekeeper === undefined || persistence === undefined) {
    throw new Error('external-implementer driver requires the fleet, the scorekeeper, and session persistence')
  }
  const plan = (group: string, implementer?: FleetPlan['implementer']): FleetPlan => ({
    environments: { filter: { heldOut: false } },
    models: [],
    repetitions: 1,
    workspaceRoot: process.cwd(),
    group,
    ...implementer === undefined ? {} : { implementer },
  })
  const delegated = await fleet.run(plan('external-implementer-e2e', { kind: 'subagent', provider: 'spawn', label: 'external' }))
  const routed = await fleet.run(plan('route-implementer-e2e'))

  const sessionOf = (outcome: FleetCellOutcome): SessionId => {
    if (!('report' in outcome)) throw new Error(`cell ${outcome.cell.environment} produced no report`)
    return outcome.report.sessionId
  }
  const delegations: Record<string, EnvironmentDelegation[]> = {}
  for (const outcome of delegated.cells) {
    const { events } = await persistence.inspect(sessionOf(outcome))
    delegations[outcome.cell.environment] = events.flatMap(event => (
      event.type === 'environment/delegation' ? [event.data] : []
    ))
  }

  const certified = delegated.cells.find(outcome => 'report' in outcome && outcome.report.certified)
  if (certified === undefined) throw new Error('external-implementer driver expects one certified delegated cell')
  const facts = await scorekeeper.facts(sessionOf(certified))
  const scoreboard = await scorekeeper.leaderboard({})
  process.stdout.write(`${JSON.stringify({
    type: 'result',
    delegated: { leaderboard: delegated.leaderboard, stamps: delegated.cells.map(outcome => ('report' in outcome ? outcome.report.stamp : null)) },
    routed: { leaderboard: routed.leaderboard },
    delegations,
    facts,
    scoreboard,
  })}\n`)
} finally {
  await ctx.fiber.dispose()
}
