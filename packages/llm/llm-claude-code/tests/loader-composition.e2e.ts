/**
 * Real-composition guard: the plugin boots from a `cordis.yml` through the
 * actual Loader and Include path, registers the route its config names, and a
 * request placed on `ctx.llm` reaches the query and comes back as seam chunks.
 * The query itself is mocked, so this runs without an installation or a key.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Options, Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LlmRuntime, { BlockAssembler } from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import SubprocessRuntime from '@deepseek-ai/dsh-subprocess'
import type {
  SubprocessHandle,
  SubprocessSpawnSpec,
  SubprocessTerminalHandle,
} from '@deepseek-ai/dsh-subprocess'
import * as LlmClaudeCode from '../src/index.ts'
import { fakeChild, request, successResult } from './fixture.ts'

type QueryFactory = (params: { prompt: string; options: Options }) => Query

const queryMock = vi.hoisted(() => vi.fn<QueryFactory>())

vi.mock('@anthropic-ai/claude-agent-sdk', async importOriginal => ({
  ...await importOriginal<typeof import('@anthropic-ai/claude-agent-sdk')>(),
  query: queryMock,
}))

const child = fakeChild()
const spawned: SubprocessSpawnSpec[] = []

/** The subprocess seam this composition mounts: real service, test-owned world. */
class FixtureSubprocess extends SubprocessRuntime {
  resolveExecutable(): Promise<string> {
    return Promise.resolve('/fixture/bin/claude')
  }

  spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    spawned.push(spec)
    return child.handle
  }

  spawnTerminal(): Promise<SubprocessTerminalHandle> {
    return Promise.reject(new Error('the fixture allocates no terminal'))
  }
}

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  queryMock.mockReset()
})

describe('llm-claude-code real Loader composition', () => {
  it('registers the configured route and answers a request through ctx.llm', async () => {
    queryMock.mockImplementation(({ options }) => {
      options.spawnClaudeCodeProcess?.({
        command: '/fixture/bin/claude',
        args: [],
        cwd: process.cwd(),
        env: { PATH: '/usr/bin' },
      } as never)
      const messages: SDKMessage[] = [successResult({
        content: 'composed',
        toolCalls: [{ name: 'bash', arguments: '{"command":"ls"}' }],
      })]
      const published = (async function* iterate(): AsyncGenerator<SDKMessage> {
        yield* messages
      })()
      return {
        [Symbol.asyncIterator]: () => published,
        close: () => {},
      } as unknown as Query
    })

    root = await mkdtemp(join(tmpdir(), 'dsh-llm-claude-code-composition-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      '- id: llm',
      "  name: 'test-llm-service'",
      '- id: subprocess',
      "  name: 'test-subprocess-service'",
      '- id: llm-claude-code',
      "  name: '@deepseek-ai/dsh-llm-claude-code'",
      '  config:',
      '    provider: claude-code',
      '    models:',
      '      - id: default',
      '        contextWindow: 200000',
      '',
    ].join('\n'))

    const ctx = new Context()
    context = ctx
    ctx.baseUrl = `${pathToFileURL(root).href}/`
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['test-llm-service', LlmRuntime],
      ['test-subprocess-service', FixtureSubprocess],
      ['@deepseek-ai/dsh-llm-claude-code', LlmClaudeCode],
    ])
    ctx.loader.internal = {
      version: 'v2',
      import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return Promise.resolve(modules.get(specifier))
      },
    } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({
      name: 'cordis:include',
      config: { path: pathToFileURL(configPath).href },
    })
    await ctx.loader.await()

    expect(ctx.llm.listProviders()).toEqual([{ id: 'claude-code', name: 'claude-code' }])
    expect(await ctx.llm.resolveModelInfo('claude-code', 'default'))
      .toMatchObject({ context: { contextWindow: 200_000 } })

    const assembler = new BlockAssembler()
    const chunks: StreamChunk[] = []
    for await (const chunk of ctx.llm.stream(request())) {
      chunks.push(chunk)
      assembler.push(chunk)
    }

    expect(assembler.blocks()).toEqual([
      { type: 'text', text: 'composed' },
      { type: 'tool-call', id: 'r1-0', name: 'bash', arguments: '{"command":"ls"}' },
    ])
    expect(assembler.finish).toEqual({ kind: 'tool-calls' })
    // The CLI the SDK asked to spawn went through the mounted subprocess seam.
    expect(spawned).toHaveLength(1)
    expect(spawned[0]?.argv[0]).toBe('/fixture/bin/claude')
  })
})
