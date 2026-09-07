/**
 * Drives the real Claude Code installation on the host's own authentication,
 * so it is opt-in rather than key-gated: set `DSH_E2E_CLAUDE_CODE=1` and run it
 * by hand on a host where `claude -p` already answers. One case is a single
 * query over the mounted route; the other is the headless-agent example, whose
 * agent must reach the workspace through the harness's own bash and editor
 * tools, never through the product's.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
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
