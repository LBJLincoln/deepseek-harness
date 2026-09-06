#!/usr/bin/env node
/**
 * Test driver: boot the recreation-instrument composition, let a validator
 * composed from the shipped `validator` preset derive the standard from the
 * staged reference, then run an implementer against exactly that standard.
 *
 * It streams the VALIDATOR session's canonical events as JSONL — and only that
 * session's, so the transcript a snapshot pins is what the instrument answered
 * — and ends with one `result` record carrying the frozen cases and weights,
 * the refused case, the implementer's parity, the clustered directive it read,
 * the authorities its census listed, and the refusal of its read of the
 * reference.
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-presets'
import { EnvironmentId } from '@deepseek-ai/dsh-environments'
import type { EnvironmentDefinition } from '@deepseek-ai/dsh-environments'
import type {} from '@deepseek-ai/dsh-environment-runner'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-read-barrier'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { AuthoredCheck, CheckCase } from '@deepseek-ai/dsh-verification'
import { REFERENCE_PATH_VARIABLE, VALIDATOR_PROVIDER } from './instrument-mock-llm.ts'
import { RECREATION_ENVIRONMENT, TASK_PROMPT } from './register-environment.ts'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('recreation-instrument driver requires a config path')

// The shipped roster lives beside the installed app; the smoke runs in a
// temporary cwd, so the composition reads the absolute path from here.
process.env.DSH_RECREATION_PRESETS ??= fileURLToPath(
  new URL('../../../../../apps/cli/config/agent-presets/', import.meta.url),
)

/** The environment the implementer is measured by: the registered task plus the derived checks. */
const DERIVED_ENVIRONMENT = EnvironmentId('smoke:tally+standard')

/** The text of every failed tool result in one session event, joined per result. */
function refusalTexts(event: SessionEvent): string[] {
  if (event.type !== 'tool/result') return []
  return event.data.message.content.flatMap(block => (
    block.type === 'tool-result' && block.isError === true
      ? [block.content.flatMap(inner => (inner.type === 'text' ? [inner.text] : [])).join('')]
      : []
  ))
}

/** One check's case bodies as the instrument's freeze wrote them into the reservation. */
async function readCaseBodies(reservation: string, checkId: string): Promise<CheckCase[]> {
  const file = join(reservation, 'checks', checkId, 'cases.jsonl')
  return (await readFile(file, 'utf8'))
    .split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line) as CheckCase)
}

const ctx = await boot('recreation-instrument-e2e', resolveConfigPath(configPath, undefined))
try {
  // Loader siblings mount concurrently; nothing below runs before the application settles.
  await ctx.get('loader')?.await()
  const runner = ctx.get('environmentRuns')
  const environments = ctx.get('environments')
  const presets = ctx.get('agentPresets')
  const goals = ctx.get('goals')
  const standards = ctx.get('completionStandards')
  const tools = ctx.get('tools')
  if (runner === undefined || environments === undefined || presets === undefined
    || goals === undefined || standards === undefined || tools === undefined) {
    throw new Error('recreation-instrument driver requires the runner, registry, roster, goals, standards, and tools')
  }

  const validatorSessionId = SessionId(`validator-${randomUUID()}`)
  const validatorEvents: SessionEvent[] = []
  const implementerEvents: SessionEvent[] = []
  const stopStreaming = ctx.on('session/event', (session: Session, event: SessionEvent) => {
    if (session.id === validatorSessionId) validatorEvents.push(event)
    else implementerEvents.push(event)
  }, { global: true })
  // Captured while each agent is live: a disposed agent's scope is unwound, so
  // its composed census is only readable here.
  const censuses = new Map<string, { name: string; authority: string[] }[]>()
  const stopComposing = ctx.on('agent/created', ({ agent }: { agent: Agent }) => {
    censuses.set(agent.id, tools.schemas(agent).map(schema => ({
      name: schema.name,
      authority: [...tools.get(schema.name, agent)?.authority ?? []],
    })).sort((left, right) => (left.name < right.name ? -1 : 1)))
  })

  const validatorHome = join(process.cwd(), 'validator')
  await mkdir(validatorHome)
  const validator = await ctx.agents.create({
    sessionId: validatorSessionId,
    meta: { cwd: validatorHome },
    agentOptions: { provider: VALIDATOR_PROVIDER, model: VALIDATOR_PROVIDER },
    setup: agentCtx => presets.mount(agentCtx, 'validator').then(() => undefined),
  })
  let frozen: readonly AuthoredCheck[] = []
  let reservation = ''
  try {
    await validator.agent.whenIdle()
    reservation = await runner.stageReference(validator.agent, RECREATION_ENVIRONMENT)
    const goal = goals.create(validator.agent, { objective: TASK_PROMPT })
    goals.disarm(validator.agent)
    validator.agent.followup(createUserMessage({
      content: [{ type: 'text', text: TASK_PROMPT }],
      source: { kind: 'user' },
    }))
    await validator.agent.whenIdle()
    const standard = standards.get(validator.agent)
    if (standard === undefined || standard.goalId !== goal.id) {
      throw new Error('the validator froze no standard for its goal')
    }
    frozen = await Promise.all(standard.checks.map(async check => ({
      ...check,
      caseBodies: await readCaseBodies(reservation, check.id),
    })))
  } finally {
    await validator.dispose()
  }

  const base = environments.get(RECREATION_ENVIRONMENT)
  if (base === undefined) throw new Error('recreation-instrument driver requires the registered environment')
  const derived: EnvironmentDefinition = {
    ...base,
    id: DERIVED_ENVIRONMENT,
    name: 'smoke:tally+standard',
    checks: [...base.checks, ...frozen],
  }
  environments.register(derived)

  // What the implementer will try to read: the reference the validator sampled,
  // under the barrier root the implementer's role denies it.
  const referencePath = join(reservation, 'reference', 'run')
  process.env[REFERENCE_PATH_VARIABLE] = referencePath
  const workspace = join(process.cwd(), 'workspace')
  await mkdir(workspace)
  const report = await runner.run({ environment: DERIVED_ENVIRONMENT, workspace })
  stopStreaming()
  stopComposing()

  for (const event of validatorEvents) {
    process.stdout.write(`${JSON.stringify({ type: 'session_event', sessionId: validatorSessionId, event })}\n`)
  }

  process.stdout.write(`${JSON.stringify({
    type: 'result',
    sessionId: validatorSessionId,
    // What the instrument froze: the case ids, their weights, and what each compares.
    standard: frozen.map(check => ({
      checkId: check.id,
      outcome: check.outcome,
      run: check.run,
      weightTotal: check.cases?.weightTotal ?? 0,
      cases: (check.caseBodies ?? []).map(body => ({
        id: body.id,
        weight: body.weight,
        channels: body.comparator.channels,
      })),
    })),
    // The refused case never reached the standard; the tool said why.
    refusals: validatorEvents.flatMap(refusalTexts),
    certified: report.certified,
    parity: implementerEvents.flatMap(event => (
      event.type === 'verification/run' ? [event.data.parity ?? null] : []
    )),
    directives: implementerEvents.flatMap(event => (
      event.type === 'verification/directive'
        ? [{ rootCause: event.data.rootCause, detail: event.data.detail, clusters: event.data.clusters ?? [] }]
        : []
    )),
    checkStatuses: report.attempts.at(0)?.results.map(result => ({
      checkId: result.checkId,
      status: result.status,
      cases: result.cases === undefined
        ? null
        : { passed: result.cases.passed, total: result.cases.total, weightPassed: result.cases.weightPassed },
    })) ?? [],
    // The instrument's authority is the validator's alone; the implementer's
    // census is what proves the tool never reached its side of the wall.
    validatorAuthorities: (censuses.get(validatorSessionId) ?? []).flatMap(entry => entry.authority),
    implementerAuthorities: [...censuses.entries()]
      .filter(([id]) => id !== validatorSessionId)
      .flatMap(([, census]) => census.flatMap(entry => entry.authority)),
    // The refused read of the reference, as the barrier recorded it in the
    // implementer's own log.
    referenceReadDenials: implementerEvents.flatMap(event => (
      event.type === 'read-barrier/denied'
        ? [{ role: event.data.role, capability: event.data.capability, underBarrierRoot: event.data.displayPath === referencePath }]
        : []
    )),
  })}\n`)
} finally {
  await ctx.fiber.dispose()
}
