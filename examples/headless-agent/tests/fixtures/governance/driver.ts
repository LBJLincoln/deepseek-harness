#!/usr/bin/env node
/**
 * Test driver: boot the governance composition, run one turn whose command is
 * decided through the approval seam, record and fold one signature, try to
 * widen the session's data-use purposes, and print what the durable log holds.
 */

import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-data-use'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-signoff'

const configPath = process.argv[2]
const task = process.argv.slice(3).join(' ')
if (configPath === undefined || task === '') throw new Error('governance driver requires a config path and a task')

/** The artefact the fixture's signature attests. */
const ARTEFACT = 'c'.repeat(64)

const ctx = await boot('governance-e2e', resolveConfigPath(configPath, undefined))
try {
  // Loader siblings mount concurrently; the spine creates its root agent as it
  // settles, so the driver drives only the settled application.
  await ctx.get('loader')?.await()
  const signoffs = ctx.get('signoffs')
  const dataUse = ctx.get('dataUse')
  const agents = ctx.get('agents')
  if (signoffs === undefined || dataUse === undefined || agents === undefined) {
    throw new Error('governance driver requires the signoffs, dataUse, and agents services')
  }
  const turn = await runFixtureTurn(ctx, { task })
  const [agent] = agents.roots()
  if (agent === undefined) throw new Error('governance driver requires one root agent')

  const recorded = signoffs.record(agent, {
    transition: 'review-acceptance',
    principal: { kind: 'human', id: 'lab-reviewer', displayName: 'Lab Reviewer' },
    artefactSha256: ARTEFACT,
    evidence: [{ kind: 'session', ref: agent.session.id }],
  })
  const folded = signoffs.latest(agent, 'review-acceptance')

  // Widening the purposes the agreement granted is the one change a pin may
  // never make; the refusal is a durable non-event, so the log is printed with it.
  let widening = 'accepted'
  try {
    dataUse.pin(agent, { ...dataUse.defaultTerms, purposes: ['delivery', 'evaluation', 'training'] })
  } catch (error: unknown) {
    widening = error instanceof Error ? error.message : String(error)
  }
  const narrowed = dataUse.pin(agent, { ...dataUse.defaultTerms, purposes: ['delivery'] })

  await ctx.sessions.flush(agent.session)
  const events = agent.session.events.map((event: SessionEvent) => ({ type: event.type, data: event.data }))
  process.stdout.write(`${JSON.stringify({
    type: 'result',
    sessionId: turn.sessionId,
    output: turn.output,
    recorded,
    folded,
    widening,
    narrowed,
    events,
  })}\n`)
} finally {
  await ctx.fiber.dispose()
}
