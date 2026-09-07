/**
 * One `generate()` is one query: the request rendered into the product's
 * inputs, its tools offered as native MCP tools, the reply read back out of the
 * query's assistant messages, and every failure — cancellation, idle expiry, a
 * refused product result, a missing CLI — mapped onto the seam's codes. The
 * SDK's `query` is mocked throughout; the real installation is exercised by
 * this package's e2e suites.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Options, Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import LlmRuntime, { BlockAssembler } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import SubprocessRuntime from '@deepseek-ai/dsh-subprocess'
import type {
  SubprocessHandle,
  SubprocessSpawnSpec,
  SubprocessTerminalHandle,
} from '@deepseek-ai/dsh-subprocess'
import * as LlmClaudeCode from '../src/index.ts'
import * as invariant from '../src/invariant.ts'
import { ClaudeCodeAdapter, claudeQueryOptions, disposeQuery } from '../src/adapter.ts'
import { resolveAdapterOptions } from '../src/config.ts'
import type { Config } from '../src/config.ts'
import type { ClaudeCodeAdapterDependencies } from '../src/adapter.ts'
import {
  assistantMessage,
  BASE_CONFIG,
  BASH_TOOL,
  routeConfig,
  errorResult,
  fakeChild,
  partialMessage,
  request,
  successResult,
  textBlock,
  toolConversation,
  toolUseBlock,
  type FakeChild,
} from './fixture.ts'

type QueryFactory = (params: { prompt: string; options: Options }) => Query

const queryMock = vi.hoisted(() => vi.fn<QueryFactory>())

vi.mock('@anthropic-ai/claude-agent-sdk', async importOriginal => ({
  ...await importOriginal<typeof import('@anthropic-ai/claude-agent-sdk')>(),
  query: queryMock,
}))

interface QueryScript {
  /** Messages the query publishes, in order. */
  readonly messages?: readonly SDKMessage[]
  /** Milliseconds to wait before each message. */
  readonly gapMs?: number
  /** Thrown while iterating instead of publishing the next message. */
  readonly failWith?: Error
  /** Thrown by `close()` during teardown. */
  readonly closeError?: Error
  /** Managed child the query claims through the SDK's spawn hook. */
  readonly child?: FakeChild
}

let capturedOptions: Options | undefined
const closes = vi.fn()

function script(config: QueryScript = {}): void {
  queryMock.mockImplementation(({ options }) => {
    capturedOptions = options
    if (config.child !== undefined) {
      options.spawnClaudeCodeProcess?.({
        command: '/usr/bin/claude',
        args: [],
        cwd: process.cwd(),
        env: { PATH: '/usr/bin' },
      } as never)
    }
    const signal = options.abortController?.signal
    const iterator = (async function* published(): AsyncGenerator<SDKMessage> {
      for (const message of config.messages ?? []) {
        if (config.gapMs !== undefined) {
          // The real SDK settles promptly once its controller aborts; a mock
          // that ignored the signal would never exercise cancellation.
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, config.gapMs)
            signal?.addEventListener('abort', () => {
              clearTimeout(timer)
              resolve()
            }, { once: true })
          })
        }
        if (signal?.aborted === true) throw new Error('the query was aborted')
        yield message
      }
      if (config.failWith !== undefined) throw config.failWith
    })()
    return {
      [Symbol.asyncIterator]: () => iterator,
      close: () => {
        closes()
        if (config.closeError !== undefined) throw config.closeError
      },
    } as unknown as Query
  })
}

/** A subprocess service whose executable resolution and spawn are test-owned. */
class StubSubprocess extends SubprocessRuntime {
  static executable: string | Error = '/usr/bin/claude'
  static spawned: SubprocessSpawnSpec[] = []
  static child: SubprocessHandle | undefined

  resolveExecutable(): Promise<string> {
    if (StubSubprocess.executable instanceof Error) return Promise.reject(StubSubprocess.executable)
    return Promise.resolve(StubSubprocess.executable)
  }

  spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    StubSubprocess.spawned.push(spec)
    if (StubSubprocess.child === undefined) throw new Error('the fixture spawned no child')
    return StubSubprocess.child
  }

  spawnTerminal(): Promise<SubprocessTerminalHandle> {
    return Promise.reject(new Error('the fixture allocates no terminal'))
  }
}

const spawnCalls: SubprocessSpawnSpec[] = []

function deps(overrides: Partial<ClaudeCodeAdapterDependencies> = {}): ClaudeCodeAdapterDependencies {
  return {
    resolveExecutable: () => Promise.resolve('/usr/bin/claude'),
    spawn: (spec) => {
      spawnCalls.push(spec)
      return fakeChild().handle
    },
    cwd: () => process.cwd(),
    ...overrides,
  }
}

function adapter(config: Config = BASE_CONFIG, overrides: Partial<ClaudeCodeAdapterDependencies> = {}): ClaudeCodeAdapter {
  return new ClaudeCodeAdapter(resolveAdapterOptions(config), deps(overrides))
}

async function collect(chunks: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const seen: StreamChunk[] = []
  for await (const chunk of chunks) seen.push(chunk)
  return seen
}

/** Run one request through the adapter and surface its failure, if any. */
async function failureOf(options: GenerateOptions, instance = adapter()): Promise<unknown> {
  try {
    await collect(instance.stream(options))
    return undefined
  } catch (error: unknown) {
    return error
  }
}

beforeEach(() => {
  capturedOptions = undefined
  closes.mockClear()
  spawnCalls.length = 0
  StubSubprocess.executable = '/usr/bin/claude'
  StubSubprocess.spawned = []
  StubSubprocess.child = undefined
  script()
})

afterEach(() => {
  queryMock.mockReset()
  vi.useRealTimers()
})

describe('one query per request', () => {
  it('renders the request, reads the reply\'s text and call, and reports usage', async () => {
    script({
      messages: [
        partialMessage(),
        assistantMessage(textBlock('done')),
        assistantMessage(toolUseBlock('mcp__dsh__bash', { command: 'ls' })),
        errorResult('error_max_turns', ['Reached maximum number of turns (1)']),
      ],
    })

    const chunks = await collect(adapter().stream(request({
      messages: toolConversation(),
      tools: [BASH_TOOL],
    })))
    const assembler = new BlockAssembler()
    for (const chunk of chunks) assembler.push(chunk)

    expect(assembler.blocks()).toEqual([
      { type: 'text', text: 'done' },
      { type: 'tool-call', id: 'r1-0', name: 'bash', arguments: '{"command":"ls"}' },
    ])
    expect(assembler.finish).toEqual({ kind: 'tool-calls' })
    expect(assembler.usage).toEqual({
      inputTokens: 11,
      outputTokens: 7,
      cacheReadTokens: 3,
      cacheWriteTokens: 2,
    })
    expect(queryMock.mock.calls[0]?.[0].prompt).toContain('<dsh-tool-call id="call-1" name="bash">')
  })

  it('offers the request\'s tools as the only names the query allows', async () => {
    script({ messages: [assistantMessage(textBlock('ok')), successResult()] })
    await collect(adapter().stream(request({ tools: [BASH_TOOL] })))

    expect(capturedOptions?.allowedTools).toEqual(['mcp__dsh__bash'])
    expect(capturedOptions?.tools).toEqual([])
    expect(Object.keys(capturedOptions?.mcpServers ?? {})).toEqual(['dsh'])
    expect(capturedOptions?.mcpServers?.['dsh']).toMatchObject({ type: 'sdk', name: 'dsh' })
  })

  it('builds no MCP server for a request that offers no tools', async () => {
    script({ messages: [assistantMessage(textBlock('ok')), successResult()] })
    await collect(adapter().stream(request()))

    expect(capturedOptions?.mcpServers).toEqual({})
    expect(capturedOptions?.allowedTools).toEqual([])
  })

  it('finishes a text-only reply with a plain stop', async () => {
    script({ messages: [assistantMessage(textBlock('hello')), successResult()] })
    const chunks = await collect(adapter().stream(request()))
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } })
  })

  it('gives the product the harness prompt and no settings or session of its own', async () => {
    script({ messages: [assistantMessage(textBlock('ok')), successResult()] })
    await collect(adapter(routeConfig({
      models: [{ id: 'default', productModel: 'installation-default' }],
      env: { CLAUDE_AGENT_SDK_CLIENT_APP: 'dsh/1' },
      effort: 'high',
      thinking: { type: 'adaptive' },
    })).stream(request()))

    expect(capturedOptions).toMatchObject({
      systemPrompt: 'You are the harness.',
      includePartialMessages: true,
      maxTurns: 1,
      permissionMode: 'dontAsk',
      tools: [],
      disallowedTools: ['AskUserQuestion'],
      strictMcpConfig: true,
      settingSources: [],
      persistSession: false,
      pathToClaudeCodeExecutable: '/usr/bin/claude',
      model: 'installation-default',
      effort: 'high',
      thinking: { type: 'adaptive' },
    })
    expect(capturedOptions).not.toHaveProperty('outputFormat')
    expect(capturedOptions?.env?.['CLAUDE_AGENT_SDK_CLIENT_APP']).toBe('dsh/1')
  })

  it('omits the product model when the operator let the installation choose', async () => {
    script({ messages: [assistantMessage(textBlock('ok')), successResult()] })
    await collect(adapter().stream(request()))
    expect(capturedOptions).not.toHaveProperty('model')
  })

  it('places the SDK-spawned CLI under the shared process owner and tears it down', async () => {
    const child = fakeChild()
    script({ messages: [assistantMessage(textBlock('ok')), successResult()], child })

    await collect(adapter(BASE_CONFIG, { spawn: () => child.handle }).stream(request()))

    expect(child.terminate).toHaveBeenCalledTimes(1)
    expect(closes).toHaveBeenCalledTimes(1)
  })
})

describe('failure classification', () => {
  it('refuses a model the operator did not declare, before any query', async () => {
    expect(await failureOf(request({ model: 'other' })))
      .toMatchObject({ code: 'UNKNOWN_MODEL' })
    expect(queryMock).not.toHaveBeenCalled()
  })

  it('names the missing installation when the host has no CLI', async () => {
    const instance = adapter(BASE_CONFIG, {
      resolveExecutable: () => Promise.reject(new Error('claude not found')),
    })
    expect(await failureOf(request(), instance)).toMatchObject({ code: 'MISSING_EXECUTABLE' })
  })

  it('maps a turn bound reached with no tool call onto the seam code', async () => {
    script({ messages: [assistantMessage(textBlock('thinking out loud')), errorResult('error_max_turns')] })
    expect(await failureOf(request())).toMatchObject({ code: 'MAX_TURNS' })
  })

  it('maps a product-side API failure on a successful result to a retryable transport failure', async () => {
    script({
      messages: [
        assistantMessage(textBlock('API Error: Unable to connect to API: Self-signed certificate detected')),
        successResult({
          is_error: true,
          result: 'API Error: Unable to connect to API: Self-signed certificate detected',
          stop_reason: 'stop_sequence',
        }),
      ],
    })
    const failure = await failureOf(request())
    expect(failure).toMatchObject({ code: 'TRANSPORT' })
    expect((failure as Error).message).toContain('Self-signed certificate detected')
  })

  it('treats a query that ended without a result as a closed stream', async () => {
    script({ messages: [partialMessage()] })
    expect(await failureOf(request())).toMatchObject({ code: 'STREAM_CLOSED' })
  })

  it('refuses a reply that called a tool the request did not offer', async () => {
    script({
      messages: [
        assistantMessage(toolUseBlock('mcp__dsh__write_file', { path: 'a.txt' })),
        errorResult('error_max_turns'),
      ],
    })
    expect(await failureOf(request({ tools: [BASH_TOOL] })))
      .toMatchObject({ code: 'MALFORMED_RESPONSE' })
  })

  it('reports a query that published no assistant message as an empty response', async () => {
    script({ messages: [successResult()] })
    expect(await failureOf(request())).toMatchObject({ code: 'EMPTY_RESPONSE' })
  })

  it('classifies the published result, not the throw the SDK raises after it', async () => {
    script({
      messages: [
        assistantMessage(toolUseBlock('bash', { command: 'ls' })),
        errorResult('error_max_turns', ['Reached maximum number of turns (1)']),
      ],
      failWith: new Error('Claude Code process exited with code 1'),
    })

    const chunks = await collect(adapter().stream(request({ tools: [BASH_TOOL] })))
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'tool-calls' } })
  })

  it('keeps caller cancellation over a result the product had already published', async () => {
    const controller = new AbortController()
    script({
      messages: [assistantMessage(textBlock('done')), successResult(), partialMessage()],
      gapMs: 20,
    })
    const pending = failureOf(request({ signal: controller.signal }))
    await new Promise<void>((resolve) => { setTimeout(resolve, 50) })
    controller.abort(new Error('caller stopped'))
    expect(await pending).toMatchObject({ code: 'ABORTED' })
  })

  it('wraps an unexpected SDK failure that published no result as a transport failure', async () => {
    script({ failWith: new Error('the CLI died') })
    expect(await failureOf(request())).toMatchObject({
      code: 'TRANSPORT',
      message: 'llm-claude-code: the query failed: the CLI died',
    })
  })

  it('reports caller cancellation as an abort', async () => {
    const controller = new AbortController()
    script({ messages: [partialMessage(), assistantMessage(textBlock('late')), successResult()], gapMs: 50 })
    const pending = failureOf(request({ signal: controller.signal }))
    await new Promise<void>((resolve) => { setTimeout(resolve, 10) })
    controller.abort(new Error('caller stopped'))
    expect(await pending).toMatchObject({ code: 'ABORTED' })
  })

  it('reports an installation that produced nothing as a timeout', async () => {
    script({ messages: [assistantMessage(textBlock('late')), successResult()], gapMs: 200 })
    const instance = adapter(routeConfig({ queryTimeoutMs: 20 }))
    expect(await failureOf(request(), instance)).toMatchObject({ code: 'TIMEOUT' })
  })

  it('keeps the query alive across partial events that arrive inside the idle interval', async () => {
    script({
      messages: [partialMessage(), partialMessage(), assistantMessage(textBlock('ok')), successResult()],
      gapMs: 20,
    })
    const instance = adapter(routeConfig({ queryTimeoutMs: 60 }))
    const chunks = await collect(instance.stream(request()))
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } })
  })
})

describe('catalog and route metadata', () => {
  it('describes the route and its declared models', async () => {
    const instance = adapter(routeConfig({
      displayName: 'Claude Code',
      models: [{ id: 'default', name: 'Installation default', description: 'the configured one' }],
    }))
    expect(instance.providerInfo('claude-code')).toEqual({ id: 'claude-code', name: 'Claude Code' })
    expect(instance.providerRetryPolicy('claude-code')).toMatchObject({ mode: 'normal' })
    expect(await instance.listModels('claude-code')).toEqual([{
      provider: 'claude-code',
      id: 'default',
      name: 'Installation default',
      description: 'the configured one',
      inputModalities: ['text'],
    }])
  })

  it('resolves the exact route with its declared capacity and refuses an undeclared model', async () => {
    const instance = adapter()
    expect(await instance.resolveModel('claude-code', 'default')).toEqual({
      provider: 'claude-code',
      id: 'default',
      name: 'Installation default',
      inputModalities: ['text'],
      context: { contextWindow: 200_000 },
    })
    await expect(instance.resolveModel('claude-code', 'other'))
      .rejects.toMatchObject({ code: 'UNKNOWN_MODEL' })
  })

  it('resolves a model whose capacity the operator did not declare', async () => {
    const instance = adapter(routeConfig({ models: [{ id: 'default' }] }))
    expect(await instance.resolveModel('claude-code', 'default')).toEqual({
      provider: 'claude-code',
      id: 'default',
      name: 'default',
      inputModalities: ['text'],
    })
  })
})

describe('claudeQueryOptions', () => {
  it('hands the SDK spawn request to the shared owner and returns the managed view', () => {
    const child = fakeChild()
    const options = claudeQueryOptions({
      options: resolveAdapterOptions(BASE_CONFIG),
      model: { id: 'default' },
      rendered: { systemPrompt: 'system', prompt: 'prompt' },
      offer: undefined,
      executable: '/usr/bin/claude',
      cwd: '/workspace',
      controller: new AbortController(),
      spawn: (spec) => {
        spawnCalls.push(spec)
        return child.handle
      },
      capture: () => {},
    })

    const managed = options.spawnClaudeCodeProcess?.({
      command: '/usr/bin/claude',
      args: ['--print'],
      cwd: '/workspace',
      env: { PATH: '/usr/bin' },
    } as never)
    expect(managed?.stdout).toBe(child.stdout)
    expect(spawnCalls[0]?.argv).toEqual(['/usr/bin/claude', '--print'])
  })
})

describe('disposeQuery', () => {
  it('closes the query and proves the process tree is gone', async () => {
    const child = fakeChild()
    await disposeQuery({ close: closes }, child.handle)
    expect(closes).toHaveBeenCalledTimes(1)
    expect(child.terminate).toHaveBeenCalledTimes(1)
  })

  it('releases the offered tool server with the query', async () => {
    const close = vi.fn(() => Promise.resolve())
    await disposeQuery(undefined, undefined, { close })
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('reports a tool server that refused to close', async () => {
    await expect(disposeQuery(undefined, undefined, {
      close: () => Promise.reject(new Error('transport stuck')),
    })).rejects.toThrow('transport stuck')
  })

  it('skips a handle that never held a process', async () => {
    const child = fakeChild({ pid: 0 })
    await disposeQuery(undefined, child.handle)
    expect(child.terminate).not.toHaveBeenCalled()
  })

  it('reports a single teardown failure as itself', async () => {
    const child = fakeChild({ waitForExitError: new Error('still running') })
    await expect(disposeQuery(undefined, child.handle)).rejects.toThrow('still running')
  })

  it('aggregates a failed close with a failed process teardown', async () => {
    const child = fakeChild({ waitForExitError: new Error('still running') })
    await expect(disposeQuery(
      { close: () => { throw new Error('close refused') } },
      child.handle,
    )).rejects.toThrow(AggregateError)
  })
})

describe('the plugin on a real context', () => {
  it('registers the configured route and serves a request through ctx.llm', async () => {
    const child = fakeChild()
    StubSubprocess.child = child.handle
    script({ messages: [assistantMessage(textBlock('through the seam')), successResult()], child })
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(StubSubprocess)
    const fiber = await ctx.plugin(LlmClaudeCode, BASE_CONFIG)

    expect(ctx.llm.listProviders()).toEqual([{ id: 'claude-code', name: 'claude-code' }])
    const chunks = await collect(ctx.llm.stream(request()))
    expect(chunks).toContainEqual({ type: 'text-delta', index: 0, text: 'through the seam' })
    expect(StubSubprocess.spawned).toHaveLength(1)

    await fiber.dispose()
    expect(ctx.llm.listProviders()).toEqual([])
    await ctx.fiber.dispose()
  })

  it('keeps the Loader namespace and the package-owned empty invariant', async () => {
    expect('default' in LlmClaudeCode).toBe(false)
    expect(LlmClaudeCode.name).toBe('llm-claude-code')
    expect(LlmClaudeCode.inject).toEqual(['llm', 'subprocess'])

    const dispose = vi.fn()
    const register = vi.fn((_packageName: string, _installer: InvariantInstaller) => dispose)
    const ctx = { invariants: { register } } as unknown as Context
    await expect(invariant.apply(ctx)).resolves.toBe(dispose)
    expect(register).toHaveBeenCalledWith('@deepseek-ai/dsh-llm-claude-code', expect.any(Function))
    const install = register.mock.calls[0]![1]
    await install(new Context(), (message) => { throw new Error(message) })
    expect(invariant.name).toBe('llm-claude-code-invariant')
    expect(invariant.inject).toEqual(['invariants'])
  })
})
