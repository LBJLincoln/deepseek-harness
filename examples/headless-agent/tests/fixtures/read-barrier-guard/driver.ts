#!/usr/bin/env node
/**
 * Test driver: boot the read-barrier-guard composition, then exercise the two
 * authority guards and the certificate precondition over one real runtime.
 *
 * It mounts an implementer preset that composes the shipped session-log tools
 * and reports the mount refusal; mounts a clean implementer preset, registers an
 * authority-bearing tool into that agent's own layer afterwards, and reports the
 * guard denial; takes the barrier's scope census through the same `agent/request`
 * waterfall the loop dispatches; and reports every isolation claim the session's
 * recorded enforcement refuses.
 */

import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ToolAuthority, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { CheckId, VerificationError } from '@deepseek-ai/dsh-verification'
import type { CertificateIsolation, RunExecutor } from '@deepseek-ai/dsh-verification/types'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('read-barrier-guard driver requires a config path')

const signal = new AbortController().signal
const agentOptions = { provider: 'cli-mock', model: 'cli-mock' }

/** One agent composed from `presetId`, exactly as an agent factory's setup does. */
async function createOn(ctx: Context, id: string, presetId: string) {
  return await ctx.agents.create({
    sessionId: SessionId(id),
    meta: { cwd: process.cwd() },
    agentOptions,
    setup: async (agentCtx: Context) => void await ctx.agentPresets.mount(agentCtx, presetId),
  })
}

/** The barrier's census listener runs on this waterfall, which the loop dispatches per request. */
async function takeCensus(ctx: Context, agent: Agent): Promise<void> {
  await agentEvents(ctx, agent).waterfall(
    'agent/request',
    { turn: 1, step: 0, signal },
    () => Promise.resolve(agentOptions as LlmCallConfig),
  )
}

/** Flatten one tool outcome to the fields the e2e asserts. */
function flatten(result: ToolExecutionResult) {
  return {
    isError: result.isError,
    text: result.content.flatMap(block => (block.type === 'text' ? [block.text] : [])).join(''),
  }
}

const ctx = await boot('read-barrier-guard-e2e', resolveConfigPath(configPath, undefined))
try {
  // Loader siblings mount concurrently; the driver creates agents only over the settled application.
  await ctx.get('loader')?.await()

  // An implementer preset composing the shipped session-log tools is refused
  // where the composition is decided, and leaves no session behind.
  let mountRefusal: string | undefined
  try {
    await createOn(ctx, 'guard-log-reading', 'log-reading')
  } catch (error) {
    mountRefusal = error instanceof Error ? error.message : String(error)
  }
  const refusedSessionExists = ctx.agents.get(SessionId('guard-log-reading')) !== undefined

  // The same composition under a preset that claims no role mounts normally.
  const open = await createOn(ctx, 'guard-unrestricted', 'unrestricted')
  const implementer = await createOn(ctx, 'guard-implementer', 'implementing')
  try {
    // The census is a snapshot of the composition the session started with,
    // taken where the loop composes its first request.
    await takeCensus(ctx, implementer.agent)
    const scope = implementer.agent.session.events
      .find((event: SessionEvent) => event.type === 'read-barrier/scope')

    // Registered into the agent's own layer afterwards: no composition audit saw
    // this tool and no census lists it, so only the runtime guard can refuse it.
    const sessionLog: readonly ToolAuthority[] = ['session-log']
    implementer.agent.ctx.tools.register({
      name: 'late_session_read',
      description: 'Read one durable session event, registered after the preset mounted.',
      authority: sessionLog,
      parameters: { type: 'object', properties: {} },
      output: {
        schema: { type: 'string' },
        render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: String(value) }],
      },
      execute: () => Promise.resolve('read the log'),
    })

    const guarded = flatten(await ctx.tools.execute({
      signal, callId: CallId('guard-1'), name: 'late_session_read', arguments: {}, agent: implementer.agent,
    }))

    const goal = ctx.goals.create(implementer.agent, { objective: 'Prove the enforcement-backed certificate' })
    const standard = ctx.completionStandards.author(implementer.agent, {
      goalId: goal.id,
      checks: [{
        id: CheckId('barrier-holds'),
        outcome: 'the barrier denied every validator-owned read',
        run: 'inspect the session log',
      }],
    })
    const ref = { id: standard.id, revision: standard.revision }
    const results = [{ checkId: CheckId('barrier-holds'), status: 'pass' as const, evidence: 'no denial escaped' }]

    /** One isolation claim: the refusal it draws, or the certificate it committed. */
    function claim(isolation: CertificateIsolation, executor: RunExecutor) {
      try {
        const outcome = ctx.completionStandards.recordRun(implementer.agent, ref, isolation, results, { executor })
        return {
          certified: outcome.certified,
          ...outcome.certified ? { isolation: outcome.certificate.isolation, executor: outcome.certificate.executor } : {},
        }
      } catch (error) {
        if (!(error instanceof VerificationError)) throw error
        return { certified: false, code: error.code, message: error.message }
      }
    }

    const hostClaim = claim('host', 'runner')
    const reportedClaim = claim('process', 'agent-reported')
    // The claim the census does prove: `fs` denies at its executor and no other
    // path-opening capability is composed.
    const processClaim = claim('process', 'runner')

    process.stdout.write(`${JSON.stringify({
      type: 'result',
      mountRefusal,
      refusedSessionExists,
      guarded,
      openTools: ctx.tools.schemas(open.agent).map(schema => schema.name).sort(),
      implementerTools: ctx.tools.schemas(implementer.agent).map(schema => schema.name).sort(),
      scope: scope?.data,
      hostClaim,
      reportedClaim,
      processClaim,
    })}\n`)
  } finally {
    await implementer.dispose()
    await open.dispose()
  }
} finally {
  await ctx.fiber.dispose()
}
