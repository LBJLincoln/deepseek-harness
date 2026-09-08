#!/usr/bin/env node
/**
 * Test driver: boot the external-implementer composition under a session budget
 * one delegated attempt exhausts, run the training-eligible environments once
 * each with the `spawn` subagent provider as the implementer, and print each
 * cell's delegations, its budget records, and the facts the scorekeeper folds
 * from its persisted log, for the e2e's assertions.
 */

import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type { BudgetBreach, UsageForeign } from '@deepseek-ai/dsh-budget-policy'
import type { EnvironmentDelegation } from '@deepseek-ai/dsh-environment-runner/types'
import type { FleetCellOutcome } from '@deepseek-ai/dsh-fleet/types'
import type { SessionId } from '@deepseek-ai/dsh-session'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('external-implementer-budget driver requires a config path')

const ctx = await boot('external-implementer-budget-e2e', resolveConfigPath(configPath, undefined))
try {
  // Loader siblings mount concurrently; the runner creates agents only over the settled application.
  await ctx.get('loader')?.await()
  const fleet = ctx.get('fleet')
  const scorekeeper = ctx.get('scorekeeper')
  const persistence = ctx.get('sessionPersistence')
  if (fleet === undefined || scorekeeper === undefined || persistence === undefined) {
    throw new Error('external-implementer-budget driver requires the fleet, the scorekeeper, and session persistence')
  }
  const delegated = await fleet.run({
    environments: { filter: { heldOut: false } },
    models: [],
    repetitions: 1,
    workspaceRoot: process.cwd(),
    group: 'external-implementer-budget-e2e',
    implementer: { kind: 'subagent', provider: 'spawn', label: 'external' },
  })

  const sessionOf = (outcome: FleetCellOutcome): SessionId => {
    if (!('report' in outcome)) throw new Error(`cell ${outcome.cell.environment} produced no report`)
    return outcome.report.sessionId
  }
  const cells: Record<string, {
    certified: boolean
    caps: readonly (readonly [string, number])[]
    attempts: number
    delegations: EnvironmentDelegation[]
    foreign: UsageForeign[]
    breaches: BudgetBreach[]
    breachCap: string | undefined
  }> = {}
  for (const outcome of delegated.cells) {
    if (!('report' in outcome)) throw new Error(`cell ${outcome.cell.environment} produced no report`)
    const { events } = await persistence.inspect(sessionOf(outcome))
    const facts = await scorekeeper.facts(sessionOf(outcome))
    cells[outcome.cell.environment] = {
      certified: outcome.report.certified,
      caps: outcome.report.caps,
      attempts: outcome.report.attempts.length,
      delegations: events.flatMap(event => (event.type === 'environment/delegation' ? [event.data] : [])),
      foreign: events.flatMap(event => (event.type === 'usage/foreign' ? [event.data] : [])),
      breaches: events.flatMap(event => (event.type === 'budget/breach' ? [event.data] : [])),
      breachCap: facts.outcome.budgetBreachCap,
    }
  }
  process.stdout.write(`${JSON.stringify({ type: 'result', leaderboard: delegated.leaderboard, cells })}\n`)
} finally {
  await ctx.fiber.dispose()
}
