#!/usr/bin/env node
/**
 * Test driver: run one unsatisfiable environment twice over the same two-rung
 * attempt ladder — once on the session's own model route and once delegated to
 * one fresh in-process child per attempt — and print each report beside the
 * models its cell asked its provider for and the user messages each attempt
 * carried, for the e2e's assertions.
 *
 * Both cells run the same environment, whose check never passes, so each spends
 * exactly the ladder's two attempts and the report states the route of each.
 */

import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type { EnvironmentRunReport, EnvironmentRunRung } from '@deepseek-ai/dsh-environment-runner'
import { EnvironmentId } from '@deepseek-ai/dsh-environments'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('attempt-ladder driver requires a config path')

const SMALL = { provider: 'cli-mock', model: 'cli-mock-small' }
const LARGE = { provider: 'cli-mock', model: 'cli-mock-large' }
const LADDER: readonly EnvironmentRunRung[] = [{}, { model: LARGE }]

/** One cell as the driver reports it: the run, the routes it asked for, and the texts each attempt carried. */
interface Cell {
  readonly report: EnvironmentRunReport
  /** Model of every `request/header` the cell session recorded, in log order. */
  readonly requestedModels: string[]
  /** Text of every user message the implementer received, in log order. */
  readonly prompts: string[]
  /** Attempt number, restated-task flag, and child run of every delegation the cell recorded. */
  readonly delegations: { attempt: number; restatedTask: boolean; runId: string }[]
}

/**
 * The texts one implementer was handed, in log order. Only a message the runner
 * sent counts: a child session also carries the subagent seam's own runtime
 * context, which no attempt asked for.
 */
function promptsOf(events: readonly SessionEvent[]): string[] {
  return events.flatMap(event => (
    event.type === 'user/message' && event.data.source.kind === 'user'
      ? event.data.content.flatMap(block => (block.type === 'text' ? [block.text] : []))
      : []
  ))
}

const ctx = await boot('attempt-ladder-e2e', resolveConfigPath(configPath, undefined))
try {
  // Loader siblings mount concurrently; the runner creates agents only over the settled application.
  await ctx.get('loader')?.await()
  const runner = ctx.get('environmentRuns')
  const persistence = ctx.get('sessionPersistence')
  if (runner === undefined || persistence === undefined) {
    throw new Error('attempt-ladder driver requires the runner and session persistence')
  }

  // A delegated child is a session of its own; the cell's own log is the one
  // that states what the cell asked for, so each cell is read back by its id.
  const read = async (report: EnvironmentRunReport): Promise<Cell> => {
    const { events } = await persistence.inspect(report.sessionId)
    return {
      report,
      requestedModels: events.flatMap(event => (event.type === 'request/header' ? [event.data.header.config.model] : [])),
      prompts: promptsOf(events),
      delegations: events.flatMap(event => (
        event.type === 'environment/delegation'
          ? [{ attempt: event.data.attempt, restatedTask: event.data.restatedTask, runId: event.data.runId }]
          : []
      )),
    }
  }

  const cell = async (implementer?: { kind: 'subagent'; provider: string }): Promise<Cell> => {
    const workspace = await mkdtemp(join(process.cwd(), 'workspace-'))
    return read(await runner.run({
      environment: EnvironmentId('smoke:unsatisfiable'),
      workspace,
      model: SMALL,
      ladder: LADDER,
      ...implementer === undefined ? {} : { implementer },
    }))
  }

  const route = await cell()
  const delegated = await cell({ kind: 'subagent', provider: 'spawn' })

  // Each delegated attempt ran as a child session of its own, so what the
  // second child was actually asked to do is only in that child's log. An
  // in-process child's run id IS its session id, so the cell's own delegation
  // records name the children in attempt order.
  const childPrompts: string[][] = []
  for (const delegation of delegated.delegations) {
    const { events } = await persistence.inspect(delegation.runId as SessionId)
    childPrompts.push(promptsOf(events))
  }
  process.stdout.write(`${JSON.stringify({ type: 'result', route, delegated, childPrompts })}\n`)
} finally {
  await ctx.fiber.dispose()
}
