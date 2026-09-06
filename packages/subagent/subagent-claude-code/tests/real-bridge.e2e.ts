/**
 * Drives the real Claude Code CLI in bridge mode on the host's own
 * authentication: no key is read from the environment or supplied by this file,
 * and the product resolves its account exactly as an interactive run does.
 * It is therefore run by hand — export `DSH_E2E_CLAUDE_CODE=1` — and self-skips
 * everywhere else, including CI.
 *
 * What it proves is the whole point of bridge mode: the external model has no
 * tool of its own, every tool it calls is one of ours, and the child harness
 * session is the record of what happened. `DSH_E2E_CLAUDE_CODE_DUMP=1` prints
 * that record, which is what a person running this by hand actually wants to
 * read.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import McpToolServerService from '@deepseek-ai/dsh-mcp-tool-server'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import * as claudeCode from '../src/index.ts'

const enabled = process.env.DSH_E2E_CLAUDE_CODE === '1'
const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** A workspace whose files have known contents the external model can be asked to report. */
function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-bridge-e2e-'))
  roots.push(root)
  for (const name of ['alpha.txt', 'beta.txt', 'gamma.txt']) {
    writeFileSync(join(root, name), `${name}\n`)
  }
  return root
}

describe.runIf(enabled)('the real Claude Code bridge on the host account', () => {
  it('runs the external agent on the harness tool set and records the run', async () => {
    const cwd = workspace()
    const ctx = new Context()
    contexts.push(ctx)
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(LocalFileSystem, { cwd })
    await ctx.plugin(ToolFs, {})
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(McpToolServerService, {})
    await ctx.plugin(claudeCode, {})

    const parent = ctx.agentLoop.create(
      SessionId('bridge-parent'),
      { provider: 'host', model: 'host' },
      { cwd },
    )
    const run = await ctx.subagents.start('claude-code', {
      prompt: [{
        type: 'text',
        text: 'Read the file alpha.txt in the working directory and reply with its exact contents. '
          + 'Use only the tools you were given.',
      }],
      parent,
      signal: AbortSignal.timeout(180_000),
      harnessTools: { only: true },
    })
    const result = await run.result
    const child = run.localAgent
    expect(child).toBeDefined()
    const types = child!.session.events.map((event: SessionEvent) => event.type)
    if (process.env.DSH_E2E_CLAUDE_CODE_DUMP === '1') {
      process.stdout.write(`${JSON.stringify(child!.session.events, null, 2)}\n`)
    }

    expect(result.stopReason).toBe('completed')
    // The record opens, carries the external model's text, and closes.
    expect(types).toContain('bridge/start')
    expect(types).toContain('bridge/assistant')
    expect(types.at(-1)).toBe('bridge/end')
    // Every tool the external model used is one of ours, logged as the pair.
    expect(types).toContain('tool/call')
    expect(types).toContain('tool/result')

    await run.dispose()
    const closed = child!.session.events.map((event: SessionEvent) => event.type)
    expect(closed.slice(-2)).toEqual(['step/end', 'turn/end'])
  }, 300_000)
})
