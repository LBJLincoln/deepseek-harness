/**
 * Drives the real Claude Code installation on the host's own authentication,
 * so it is opt-in rather than key-gated: set `DSH_E2E_CLAUDE_CODE=1` and run it
 * by hand on a host where `claude -p` already answers. One case is a single
 * query over the mounted route; one drives two steps of one harness session to
 * prove the second reads the conversation prefix from the installation's cache
 * instead of rewriting it; the last is the headless-agent example, whose agent
 * must reach the workspace through the harness's own bash and editor tools,
 * never through the product's.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { listSessions } from '@anthropic-ai/claude-agent-sdk'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, {
  BlockAssembler,
  CallId,
  createAssistantMessage,
  createToolResultMessage,
  createUserMessage,
} from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, TokenUsage } from '@deepseek-ai/dsh-llm'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import * as LlmClaudeCode from '../src/index.ts'
import { BASH_TOOL, request } from './fixture.ts'

const binScript = fileURLToPath(new URL(
  '../../../../examples/headless-agent/tests/fixtures/headless-driver.ts',
  import.meta.url,
))
const configPath = fileURLToPath(new URL(
  '../../../../examples/headless-agent/tests/fixtures/llm/llm-claude-code/cordis.yml',
  import.meta.url,
))
const tsconfigPath = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))
const enabled = process.env['DSH_E2E_CLAUDE_CODE'] === '1'

/**
 * Whether the installation's session store still holds one product session.
 * @param productSessionId - the session the route reported running the step in.
 * @returns true while the transcript is listed for this workspace.
 */
async function stored(productSessionId: string | undefined): Promise<boolean> {
  const sessions = await listSessions({ dir: process.cwd() })
  return sessions.some(session => session.sessionId === productSessionId)
}

describe.skipIf(!enabled)('one query on the operator\'s Claude Code installation', () => {
  it('answers a tool-offering request with one native call carrying JSON arguments', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(LlmClaudeCode, { provider: 'claude-code', models: [{ id: 'default' }] })

    const assembler = new BlockAssembler()
    try {
      for await (const chunk of ctx.llm.stream(request({
        system: 'You are a coding agent. Use the tools you have; never answer from memory.',
        messages: [createUserMessage({
          source: { kind: 'user' },
          content: [{ type: 'text', text: 'List the files in the current directory.' }],
        })],
        tools: [BASH_TOOL],
      }))) assembler.push(chunk)
    } finally {
      await ctx.fiber.dispose()
    }

    const calls = assembler.blocks().filter(block => block.type === 'tool-call')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.name).toBe('bash')
    const args = JSON.parse(calls[0]?.arguments ?? 'null') as { command?: unknown }
    expect(typeof args.command).toBe('string')
    expect(assembler.finish).toEqual({ kind: 'tool-calls' })
  }, 300_000)
})

describe.skipIf(!enabled)('two steps of one harness session on the operator\'s installation', () => {
  it('reads more of the second step\'s prompt from cache than it writes', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(LlmClaudeCode, { provider: 'claude-code', models: [{ id: 'default' }] })

    const sessionId = SessionId(`e2e-continuity-${Date.now()}`)
    const system = 'You are a coding agent driven by a harness. Use the tools you have; never answer from memory.'
    // Long enough that the installation's prompt cache has a prefix worth
    // reading: below its minimum, a resumed step reports no cache read at all.
    const task = `List the files in the current directory. ${'The workspace is a TypeScript monorepo. '.repeat(60)}`
    const step = async (options: GenerateOptions): Promise<BlockAssembler> => {
      const assembler = new BlockAssembler()
      for await (const chunk of ctx.llm.stream(options)) assembler.push(chunk)
      return assembler
    }

    let usage: TokenUsage | undefined
    let productSession: string | undefined
    try {
      const first = await step(request({
        sessionId,
        system,
        messages: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: task }] })],
        tools: [BASH_TOOL],
      }))
      const call = first.blocks().find(block => block.type === 'tool-call')
      expect(call).toBeDefined()
      if (call?.type !== 'tool-call') throw new Error('the first step requested no tool call')
      productSession = (first.replayState as { productSessionId?: string }).productSessionId
      expect(await stored(productSession)).toBe(true)

      const second = await step(request({
        sessionId,
        system,
        messages: [
          createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: task }] }),
          createAssistantMessage({
            source: { provider: 'claude-code', model: 'default', replayState: first.replayState },
            content: first.blocks(),
          }),
          createToolResultMessage({
            callId: CallId(call.id),
            isError: false,
            content: [{ type: 'text', text: 'a.txt\nb.txt\n' }],
          }),
        ],
        tools: [BASH_TOOL],
      }))
      expect(second.replayState).toMatchObject({ continuity: 'resumed', productSessionId: productSession })
      usage = second.usage
    } finally {
      await ctx.fiber.dispose()
    }

    expect(usage?.cacheReadTokens ?? 0).toBeGreaterThan(usage?.cacheWriteTokens ?? 0)
    // Unloading the route deletes what it created; the delete is fire and
    // forget, so the assertion waits for the store rather than the request.
    await expect.poll(() => stored(productSession), { timeout: 30_000 }).toBe(false)
  }, 600_000)
})

describe.skipIf(!enabled)('headless-agent on the operator\'s Claude Code installation', () => {
  it('writes and reads a workspace file through the harness\'s own tools', async () => {
    let written = ''
    const { stdout } = await runLoaderSmoke({
      label: 'llm-claude-code real installation',
      tempDirPrefix: 'dsh-llm-claude-code-real-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [
        configPath,
        'Create hello.txt containing hello in the workspace, then print its contents.',
      ],
      tsconfigPath,
      processTimeoutMs: 600_000,
      inspect: async (cwd) => { written = await readFile(join(cwd, 'hello.txt'), 'utf8') },
    })

    expect(written.trim()).toBe('hello')
    const events = stdout.trimEnd().split('\n')
      .map(line => JSON.parse(line) as { event?: SessionEvent })
      .flatMap(line => line.event === undefined ? [] : [line.event])
    expect(events.some(event => event.type === 'tool/call')).toBe(true)
    expect(events.some(event => event.type === 'assistant/message')).toBe(true)
  }, 660_000)
})
