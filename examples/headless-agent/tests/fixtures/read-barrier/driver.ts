#!/usr/bin/env node
/**
 * Test driver: boot the read-barrier composition, reserve the barrier's run
 * directory for one of two sessions, then read the same validator-owned file
 * from the implementer session, from a session holding no reservation, and
 * directly through `ctx.fs` as a trusted plugin. It reports every outcome plus
 * the implementer's durable refusal records for the e2e's assertions.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { Context } from '@deepseek-ai/cordis'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('read-barrier driver requires a config path')

const signal = new AbortController().signal
let calls = 0

/** Execute the `read` tool exactly as the agent loop does, and flatten the outcome. */
async function read(ctx: Context, agent: Agent, path: string) {
  const result = await ctx.tools.execute({
    signal,
    callId: CallId(`read-${++calls}`),
    name: 'read',
    arguments: { file_path: path },
    agent,
  })
  return {
    isError: result.isError,
    code: result.error?.info?.code,
    text: result.content.flatMap(block => (block.type === 'text' ? [block.text] : [])).join(''),
  }
}

const ctx = await boot('read-barrier-e2e', resolveConfigPath(configPath, undefined))
try {
  // Loader siblings mount concurrently; the driver creates agents only over the settled application.
  await ctx.get('loader')?.await()
  const barrier = ctx.get('readBarrier')
  if (barrier === undefined) throw new Error('read-barrier driver requires the barrier service')

  const agentOptions = { provider: 'cli-mock', model: 'cli-mock' }
  const implementer = await ctx.agents.create({ sessionId: SessionId('read-barrier-implementer'), meta: { cwd: process.cwd() }, agentOptions })
  const validator = await ctx.agents.create({ sessionId: SessionId('read-barrier-validator'), meta: { cwd: process.cwd() }, agentOptions })
  try {
    const runDirectory = barrier.reserve(implementer.agent)
    await mkdir(join(runDirectory, 'checks'), { recursive: true, mode: 0o700 })
    const check = join(runDirectory, 'checks', 'marker')
    await writeFile(check, 'test -f MARKER\n', { mode: 0o600 })
    const workspaceFile = join(process.cwd(), 'work.txt')
    await writeFile(workspaceFile, 'implementer work\n')

    const implementerCheck = await read(ctx, implementer.agent, check)
    const implementerWorkspace = await read(ctx, implementer.agent, workspaceFile)
    const validatorCheck = await read(ctx, validator.agent, check)
    // A trusted plugin reads the same target directly: the barrier denies at the
    // executor, never by removing the capability.
    const trustedRead = await ctx.fs.readText(await ctx.fs.resolve(check))

    process.stdout.write(`${JSON.stringify({
      type: 'result',
      root: barrier.root,
      check,
      tools: ctx.tools.schemas().map(schema => schema.name).sort(),
      implementerCheck,
      implementerWorkspace,
      validatorCheck,
      trustedRead,
      denials: implementer.agent.session.events
        .filter((event: SessionEvent) => event.type === 'read-barrier/denied')
        .map((event: SessionEvent) => event.data),
      validatorDenials: validator.agent.session.events.filter((event: SessionEvent) => event.type === 'read-barrier/denied').length,
    })}\n`)
  } finally {
    await validator.dispose()
    await implementer.dispose()
  }
} finally {
  await ctx.fiber.dispose()
}
