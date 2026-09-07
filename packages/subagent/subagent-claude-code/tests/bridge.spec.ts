/**
 * Bridge mode: the child harness agent a bridged run is authorized by, the SDK
 * options that pin the external model to the served harness tools, and the
 * three durable records the SDK message stream folds into.
 *
 * Isolated file so the SDK mock does not reach the black-box suite.
 */

import type { Options, PermissionResult, Query, SDKMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import type { Agent } from '@deepseek-ai/dsh-agent'
import McpToolServerService from '@deepseek-ai/dsh-mcp-tool-server'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import type { SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import type { SubprocessHandle, SubprocessOutcome } from '@deepseek-ai/dsh-subprocess'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { PassThrough } from 'node:stream'
import { MockAdapter } from '../../../core/agent-loop/tests/mock-adapter.ts'
import {
  BRIDGE_TOOL_DENIAL,
  BRIDGE_TOOL_PREFIX,
  bridgeAssistantRecord,
  bridgeQueryOptions,
  bridgeUsage,
  initReportedModel,
  openBridgedRun,
  resultReportedCostUsd,
  resultReportedUsage,
  SUBAGENT_BRIDGE_UNAVAILABLE,
} from '../src/bridge.ts'
import * as claudeCode from '../src/index.ts'

type QueryFactory = (params: { prompt: string; options: Options }) => Query

const queryMock = vi.hoisted(() => vi.fn<QueryFactory>())

vi.mock('@anthropic-ai/claude-agent-sdk', async importOriginal => ({
  ...await importOriginal<typeof import('@anthropic-ai/claude-agent-sdk')>(),
  query: queryMock,
}))

/** One harness tool the served registry exposes to the external model. */
const echo: ToolDefinition = {
  name: 'echo',
  description: 'echo the text back',
  parameters: { type: 'object', properties: { text: { type: 'string' } } },
  output: {
    schema: { type: 'string' },
    render: (_args, value) => [{ type: 'text', text: value as string }],
  },
  execute: (args: unknown) => Promise.resolve(`echo:${(args as { text: string }).text}`),
}

/** A subprocess handle the fake SDK spawn hook publishes. */
function fakeChild(): { handle: SubprocessHandle; settle: () => void; stdout: PassThrough } {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  let resolveDone!: (outcome: SubprocessOutcome) => void
  const done = new Promise<SubprocessOutcome>((resolve) => { resolveDone = resolve })
  return {
    handle: {
      pid: 4321,
      stdin,
      stdout,
      stderr: undefined,
      collected: {},
      done,
      terminate: () => { resolveDone({ exitCode: 0, signal: null }) },
      waitForExit: () => Promise.resolve(true),
    },
    settle: () => { resolveDone({ exitCode: 0, signal: null }) },
    stdout,
  }
}

/** One SDK stream over fixed messages. */
function queryFrom(messages: readonly SDKMessage[]): Query {
  async function* stream(): AsyncGenerator<SDKMessage, void> {
    for (const message of messages) yield message
  }
  return Object.assign(stream(), { close: vi.fn() }) as unknown as Query
}

/**
 * Answer one `query()` call the way the official SDK does: publish the managed
 * process through the custom-spawn hook, then return the stream.
 */
function respondWith(build: () => Query): void {
  queryMock.mockImplementation(({ options }) => {
    options.spawnClaudeCodeProcess!({
      command: '/native/claude',
      args: ['--output-format', 'stream-json'],
      cwd: options.cwd!,
      env: {},
      signal: options.abortController!.signal,
    })
    return build()
  })
}

/** A successful SDK result message with the whole-run usage the product reports. */
function success(result = 'bridged answer'): SDKResultMessage {
  return {
    type: 'result',
    subtype: 'success',
    is_error: false,
    result,
    usage: { input_tokens: 11, output_tokens: 3, cache_read_input_tokens: 5, cache_creation_input_tokens: 2 },
    total_cost_usd: 0.0412,
  } as unknown as SDKResultMessage
}

/** The product's opening record, which is the only message that names the model it runs. */
function init(model: string): SDKMessage {
  return { type: 'system', subtype: 'init', model } as unknown as SDKMessage
}

/** One SDK assistant message carrying text plus a tool call the executor already logged. */
function assistant(text: string): SDKMessage {
  return {
    type: 'assistant',
    message: {
      content: [
        { type: 'text', text },
        { type: 'tool_use', id: 'u1', name: `${BRIDGE_TOOL_PREFIX}echo`, input: {} },
      ],
      usage: { input_tokens: 7, output_tokens: 2 },
    },
  } as unknown as SDKMessage
}

/** Compose a real parent agent, the tool registry, the tool server, and the provider. */
async function setup(options: { withToolServer?: boolean } = {}) {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(LocalSubprocessRuntime)
  if (options.withToolServer !== false) await ctx.plugin(McpToolServerService, {})
  ctx.llm.registerAdapter(['mock'], new MockAdapter([]))
  ctx.tools.register(echo)
  const child = fakeChild()
  vi.spyOn(ctx.subprocess, 'spawn').mockImplementation(() => child.handle)
  vi.spyOn(ctx.subprocess, 'resolveExecutable').mockResolvedValue('/native/claude')
  await ctx.plugin(claudeCode, {})
  const parent = ctx.agentLoop.create(SessionId('bridge-parent'), { provider: 'mock', model: 'mock' }, { cwd: process.cwd() })
  return { ctx, parent, child }
}

/** A black-box start request over the composed parent. */
function blackBoxRequest(parent: Agent, overrides: Partial<SubagentStartRequest> = {}): SubagentStartRequest {
  return {
    prompt: [{ type: 'text', text: 'do the task' }],
    parent,
    signal: new AbortController().signal,
    ...overrides,
  }
}

/** A bridged start request over the composed parent. */
function request(parent: Agent, overrides: Partial<SubagentStartRequest> = {}): SubagentStartRequest {
  return { ...blackBoxRequest(parent, overrides), harnessTools: { only: true } }
}

/** The permission-callback options the SDK supplies alongside a tool name. */
function permissionOptions(): Parameters<NonNullable<Options['canUseTool']>>[2] {
  return { signal: new AbortController().signal, toolUseID: 'u1', requestId: 'r1' }
}

/** Every durable event type of a session, in append order. */
function types(agent: Agent): string[] {
  return agent.session.events.map((event: SessionEvent) => event.type)
}

beforeEach(() => { queryMock.mockReset() })

afterEach(() => { vi.restoreAllMocks() })

describe('the capability advertisement', () => {
  it('is the tool surface this provider enforces and the model the product accepts', async () => {
    const { ctx } = await setup()
    expect(ctx.subagents.getProvider('claude-code')?.capabilities).toEqual({
      outputSchema: false,
      depthLimit: false,
      toolFilter: false,
      persona: false,
      harnessTools: true,
      model: true,
    })
    await ctx.fiber.dispose()
  })

  it('refuses a bridged start with no tool server composed', async () => {
    const { ctx, parent } = await setup({ withToolServer: false })
    await expect(ctx.subagents.start('claude-code', request(parent)))
      .rejects.toMatchObject({ code: SUBAGENT_BRIDGE_UNAVAILABLE })
    expect(queryMock).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })
})

describe('the SDK options a bridged run passes', () => {
  it('replaces the product tool surface and fences every name outside it', async () => {
    const { ctx, parent } = await setup()
    respondWith(() => queryFrom([assistant('working'), success()]))
    const run = await ctx.subagents.start('claude-code', request(parent))
    const options = queryMock.mock.calls[0]![0].options
    expect(options.tools).toEqual([])
    expect(options.allowedTools).toEqual([`${BRIDGE_TOOL_PREFIX}*`])
    expect(options.strictMcpConfig).toBe(true)
    expect(options.settingSources).toEqual([])
    expect(options.persistSession).toBe(false)
    expect(options.maxTurns).toBeUndefined()
    expect(Object.keys(options.mcpServers ?? {})).toEqual(['dsh'])
    expect(options.mcpServers?.['dsh']).toMatchObject({ type: 'sdk', name: 'dsh' })

    const canUseTool = options.canUseTool!
    await expect(canUseTool(`${BRIDGE_TOOL_PREFIX}echo`, { text: 'hi' }, permissionOptions()))
      .resolves.toEqual({ behavior: 'allow', updatedInput: { text: 'hi' } })
    await expect(canUseTool('Bash', { command: 'ls' }, permissionOptions()))
      .resolves.toEqual({ behavior: 'deny', message: `Bash: ${BRIDGE_TOOL_DENIAL}`, interrupt: false })

    await run.dispose()
    await ctx.fiber.dispose()
  })

  it('carries the caller turn ceiling into the external loop', async () => {
    const { ctx, parent } = await setup()
    respondWith(() => queryFrom([success()]))
    const run = await ctx.subagents.start('claude-code', request(parent, { agentOptions: { maxTurns: 4 } }))
    expect(queryMock.mock.calls[0]![0].options.maxTurns).toBe(4)
    await run.dispose()
    await ctx.fiber.dispose()
  })

  it('keeps the black-box mode untouched when no harness tools were asked for', async () => {
    const { ctx, parent } = await setup()
    respondWith(() => queryFrom([success()]))
    const run = await ctx.subagents.start('claude-code', blackBoxRequest(parent))
    const options = queryMock.mock.calls[0]![0].options
    expect(options.tools).toBeUndefined()
    expect(options.mcpServers).toBeUndefined()
    expect(options.canUseTool).toBeUndefined()
    expect(run.localAgent).toBeUndefined()
    await run.dispose()
    await ctx.fiber.dispose()
  })
})

describe('the child harness agent', () => {
  it('is published under the parent lineage and records the run in order', async () => {
    const { ctx, parent } = await setup()
    respondWith(() => queryFrom([init('product-sonnet-2026-01'), assistant('working'), success()]))
    const run = await ctx.subagents.start('claude-code', request(parent, { model: 'sonnet' }))
    expect(queryMock.mock.calls[0]?.[0].options.model).toBe('sonnet')
    await expect(run.result).resolves.toEqual({
      output: [{ type: 'text', text: 'bridged answer' }],
      stopReason: 'completed',
      reportedModel: 'product-sonnet-2026-01',
      reportedUsage: { inputTokens: 11, outputTokens: 3, cacheReadTokens: 5, cacheWriteTokens: 2 },
      reportedCostUsd: 0.0412,
    })

    const child = run.localAgent!
    expect(child.id).toBe(run.id)
    expect(child.session.header.parentSession).toBe(parent.session.header.id)
    expect(child.session.header.delegationDepth).toBe(1)
    expect(child.session.header.cwd).toBe(process.cwd())

    expect(types(child)).toEqual([
      'subagent/descriptor', 'turn/start', 'step/start', 'bridge/start', 'bridge/assistant', 'bridge/end',
    ])
    const events = child.session.events
    expect(events[3]!.type === 'bridge/start' && events[3]!.data)
      .toEqual({ provider: 'claude-code', tools: [`${BRIDGE_TOOL_PREFIX}echo`] })
    expect(events[4]!.type === 'bridge/assistant' && events[4]!.data)
      .toEqual({ text: 'working', usage: { inputTokens: 7, outputTokens: 2 } })
    // The child's own log states which model produced its turn and what the
    // product priced it at, which is what a reader has instead of the product's
    // transcript.
    expect(events[5]!.type === 'bridge/end' && events[5]!.data).toEqual({
      stopReason: 'completed',
      usage: { inputTokens: 11, outputTokens: 3, cacheReadTokens: 5, cacheWriteTokens: 2 },
      model: 'product-sonnet-2026-01',
      costUsd: 0.0412,
    })

    await run.dispose()
    expect(types(child).slice(-2)).toEqual(['step/end', 'turn/end'])
    expect(ctx.agents.get(run.id)).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('closes the record without accounting the product did not report, and disposes once', async () => {
    const { ctx, parent } = await setup()
    respondWith(() => queryFrom([
      { type: 'result', subtype: 'success', is_error: false, result: 'done' } as unknown as SDKResultMessage,
    ]))
    const run = await ctx.subagents.start('claude-code', request(parent))
    const child = run.localAgent!
    await run.result
    const end = child.session.events.find((event: SessionEvent) => event.type === 'bridge/end')!
    expect(end.type === 'bridge/end' && end.data).toEqual({ stopReason: 'completed' })
    await run.dispose()
    await run.dispose()
    expect(types(child).filter(type => type === 'turn/end')).toEqual(['turn/end'])
    await ctx.fiber.dispose()
  })

  it('records an aborted run when disposal wins before the stream settles', async () => {
    const { ctx, parent } = await setup()
    respondWith(() => Object.assign(
      (async function* (): AsyncGenerator<SDKMessage, void> {
        await new Promise<void>(() => {})
      })(),
      { close: vi.fn() },
    ) as unknown as Query)
    const run = await ctx.subagents.start('claude-code', request(parent))
    const child = run.localAgent!
    await run.dispose()
    const end = child.session.events.find((event: SessionEvent) => event.type === 'bridge/end')!
    expect(end.type === 'bridge/end' && end.data.stopReason).toBe('aborted')
    expect(types(child).slice(-2)).toEqual(['step/end', 'turn/end'])
    await ctx.fiber.dispose()
  })

  it('releases the child when the served run cannot be opened', async () => {
    const { ctx, parent } = await setup()
    const failure = new Error('server refused')
    vi.spyOn(ctx.mcpToolServer, 'instance').mockImplementationOnce(() => { throw failure })
    await expect(ctx.subagents.start('claude-code', request(parent))).rejects.toThrow('server refused')
    expect(ctx.agents.list().map(agent => agent.id)).toEqual([parent.id])
    await ctx.fiber.dispose()
  })

  it('releases the child when the SDK never publishes a process', async () => {
    const { ctx, parent } = await setup()
    queryMock.mockImplementation(() => { throw new Error('sdk refused to start') })
    await expect(ctx.subagents.start('claude-code', request(parent))).rejects.toThrow('sdk refused to start')
    expect(ctx.agents.list().map(agent => agent.id)).toEqual([parent.id])
    await ctx.fiber.dispose()
  })
})

describe('the durable projection of one SDK message', () => {
  it('keeps text and drops the tool calls the executor already logged', () => {
    expect(bridgeAssistantRecord(assistant('hello'))).toEqual({
      text: 'hello',
      usage: { inputTokens: 7, outputTokens: 2 },
    })
  })

  it('records the text alone when the product reported no accounting', () => {
    expect(bridgeAssistantRecord({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'plain' }], usage: null },
    } as unknown as SDKMessage)).toEqual({ text: 'plain' })
  })

  it('records nothing for a non-assistant message or an assistant message with no text', () => {
    expect(bridgeAssistantRecord(success())).toBeUndefined()
    expect(bridgeAssistantRecord({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id: 'u1', name: 'x', input: {} }], usage: {} },
    } as unknown as SDKMessage)).toBeUndefined()
  })

  it('reports no usage rather than a fabricated one', () => {
    expect(bridgeUsage(undefined)).toBeUndefined()
    expect(bridgeUsage('not a record')).toBeUndefined()
    expect(bridgeUsage({ output_tokens: 3 })).toBeUndefined()
    expect(bridgeUsage({ input_tokens: 1, output_tokens: 2 })).toEqual({ inputTokens: 1, outputTokens: 2 })
  })

  it('reads the model from the opening record and the accounting from the terminal one', () => {
    expect(initReportedModel(init('product-sonnet-2026-01'))).toBe('product-sonnet-2026-01')
    expect(initReportedModel(success())).toBeUndefined()
    expect(initReportedModel(assistant('working'))).toBeUndefined()

    expect(resultReportedUsage(success()))
      .toEqual({ inputTokens: 11, outputTokens: 3, cacheReadTokens: 5, cacheWriteTokens: 2 })
    expect(resultReportedUsage(init('m'))).toBeUndefined()

    expect(resultReportedCostUsd(success())).toBe(0.0412)
    expect(resultReportedCostUsd(init('m'))).toBeUndefined()
    // The stream crosses a process boundary: a non-numeric total states none.
    expect(resultReportedCostUsd({ type: 'result', total_cost_usd: 'free' } as unknown as SDKMessage)).toBeUndefined()
  })
})

describe('the bridged options builder', () => {
  it('omits the turn ceiling when the caller set none', () => {
    const config = { type: 'sdk' as const, name: 'dsh', instance: {} as never }
    expect('maxTurns' in bridgeQueryOptions(config, undefined)).toBe(false)
  })
})

describe('the bridge opener', () => {
  it('releases once however many times the owner asks', async () => {
    const { ctx, parent } = await setup()
    const bridge = await openBridgedRun({
      ctx,
      request: { ...request(parent), descriptor: { version: 1, mode: 'one-shot', provider: 'claude-code' } },
      provider: 'claude-code',
    })
    await bridge.release()
    await bridge.release()
    const closed = bridge.agent.session.events.filter((event: SessionEvent) => event.type === 'turn/end')
    expect(closed).toHaveLength(1)
    expect(ctx.agents.list().map(agent => agent.id)).toEqual([parent.id])
    await ctx.fiber.dispose()
  })

  it('refuses without the tool server, before any agent is created', async () => {
    const { ctx, parent } = await setup({ withToolServer: false })
    await expect(openBridgedRun({
      ctx,
      request: { ...request(parent), descriptor: { version: 1, mode: 'one-shot', provider: 'claude-code' } },
      provider: 'claude-code',
    })).rejects.toMatchObject({ code: SUBAGENT_BRIDGE_UNAVAILABLE })
    expect(ctx.agents.list().map(agent => agent.id)).toEqual([parent.id])
    await ctx.fiber.dispose()
  })
})

describe('the permission callback type', () => {
  it('answers every name with one of the two documented behaviors', async () => {
    const config = { type: 'sdk' as const, name: 'dsh', instance: {} as never }
    const canUseTool = bridgeQueryOptions(config, 2).canUseTool!
    const decisions: (PermissionResult | null)[] = [
      await canUseTool(`${BRIDGE_TOOL_PREFIX}read`, {}, permissionOptions()),
      await canUseTool('Read', {}, permissionOptions()),
    ]
    expect(decisions.map(decision => decision?.behavior)).toEqual(['allow', 'deny'])
  })
})
