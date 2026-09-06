/**
 * The served MCP surface: the turn one run occupies, the tool list projected
 * from one agent's registry view, the executor path every call takes, and what
 * disposal closes.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId, HarnessError } from '@deepseek-ai/dsh-llm'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { createScope } from '@deepseek-ai/dsh-scope'
import type { Scope } from '@deepseek-ai/dsh-scope'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import McpToolServerService, { DEFAULT_SERVER_NAME } from '../src/index.ts'
import type { McpToolServerHandle } from '../src/index.ts'
import * as invariant from '../src/invariant.ts'
import { buildServedServer, MCP_TOOL_SERVER_VERSION, resultText, turnPosition } from '../src/server.ts'

/** One tool, optionally projecting a presentation payload onto its result. */
function tool(
  name: string,
  execute: ToolDefinition['execute'],
  presentationMeta?: NonNullable<ToolDefinition['output']['presentationMeta']>,
): ToolDefinition {
  return {
    name,
    description: `tool ${name}`,
    parameters: { type: 'object', properties: { text: { type: 'string' } } },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value as string }],
      ...presentationMeta === undefined ? {} : { presentationMeta },
    },
    execute,
  }
}

interface Harness {
  /** The composition root, whose disposal stops the service. */
  readonly root: Context
  /** The consuming plugin's context, where the registry and the service resolve. */
  readonly ctx: Context
  readonly agent: Agent & { session: Session }
  readonly service: McpToolServerService
}

/** Mount the registry, two tools, one scoped agent, and the served service. */
async function harness(config: { serverName?: string } = {}): Promise<Harness> {
  const root = new Context()
  await root.plugin(SystemPrompt)
  await root.plugin(ToolRuntime)
  await root.plugin(McpToolServerService, config)
  root.tools.register(tool(
    'echo',
    (args: unknown) => Promise.resolve(`echo:${(args as { text: string }).text}`),
    (_args, value) => ({ echoed: value }),
  ))
  root.tools.register(tool('blocked', () => Promise.reject(new HarnessError('tool refused', 'TOOL_REFUSED'))))
  const session = Session.create(SessionId('served'))
  const key = { id: session.header.id, session } as unknown as Agent & { session: Session }
  let scope!: Scope
  await root.plugin(Object.assign(
    (inner: Context) => { scope = createScope(inner, key) },
    { inject: ['tools'] },
  ))
  const agent = Object.assign(key, { ctx: scope.ctx })
  return { root, ctx: root, agent, service: root.mcpToolServer }
}

/** Connect an official MCP client to one handle over an in-memory transport. */
async function connect(handle: McpToolServerHandle): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'spec', version: '1' })
  await Promise.all([
    handle.config.instance.connect(serverTransport),
    client.connect(clientTransport),
  ])
  return client
}

/** Every durable event type in append order. */
function types(session: Session): string[] {
  return session.events.map((event: SessionEvent) => event.type)
}

describe('the served run occupies one turn', () => {
  it('opens a turn and step at creation and closes them at disposal', async () => {
    const { agent, service } = await harness()
    const handle = service.instance(agent)
    expect(types(agent.session)).toEqual(['turn/start', 'step/start'])
    expect(turnPosition(agent.session)).toEqual({ last: 1, open: 1 })

    await handle.dispose()
    expect(types(agent.session)).toEqual(['turn/start', 'step/start', 'step/end', 'turn/end'])
    expect(turnPosition(agent.session)).toEqual({ last: 1, open: undefined })
  })

  it('refuses a second live run on one agent', async () => {
    const { agent, service } = await harness()
    const handle = service.instance(agent)
    expect(() => service.instance(agent)).toThrow(/already holds a live served run/)
    await handle.dispose()
    // The reservation is released with the run, so the next one opens turn 2.
    const next = service.instance(agent)
    expect(turnPosition(agent.session)).toEqual({ last: 2, open: 2 })
    await next.dispose()
  })

  it('refuses an agent whose session already has a turn open', async () => {
    const { agent, service } = await harness()
    agent.session.append('turn/start', { turn: 1 })
    expect(() => service.instance(agent)).toThrow(/already has turn 1 open/)
  })

  it('closes every run the service still owns when it stops', async () => {
    const { root, agent, service } = await harness()
    service.instance(agent)
    await root.fiber.dispose()
    expect(types(agent.session)).toEqual(['turn/start', 'step/start', 'step/end', 'turn/end'])
  })
})

describe('the served tool list', () => {
  it('serves exactly the tools the agent sees, with their harness schemas', async () => {
    const { agent, service } = await harness()
    const handle = service.instance(agent)
    expect(handle.toolNames).toEqual(['echo', 'blocked'])
    expect(handle.serves).toBe(agent)
    expect(handle.config.type).toBe('sdk')
    expect(handle.config.name).toBe(DEFAULT_SERVER_NAME)

    const client = await connect(handle)
    const listed = await client.listTools()
    expect(listed.tools.map(entry => entry.name)).toEqual(['echo', 'blocked'])
    expect(listed.tools[0]!.inputSchema).toEqual({ type: 'object', properties: { text: { type: 'string' } } })
    expect(listed.tools[0]!.description).toBe('tool echo')
    await client.close()
    await handle.dispose()
  })

  it('omits a tool the agent scope restricted away', async () => {
    const { agent, service } = await harness()
    agent.ctx.tools.restrict({ deny: ['blocked'] })
    const handle = service.instance(agent)
    expect(handle.toolNames).toEqual(['echo'])
    await handle.dispose()
  })

  it('reports the resolved namespace and this server implementation', async () => {
    const { agent, service } = await harness({ serverName: 'bridge' })
    const handle = service.instance(agent)
    expect(handle.serverName).toBe('bridge')
    const client = await connect(handle)
    expect(client.getServerVersion()).toEqual({ name: 'bridge', version: MCP_TOOL_SERVER_VERSION })
    await client.close()
    await handle.dispose()
  })
})

describe('a served call runs through the harness executor', () => {
  it('records the durable pair and returns the executor content', async () => {
    const { agent, service } = await harness()
    const handle = service.instance(agent)
    const client = await connect(handle)

    const result = await client.callTool({ name: 'echo', arguments: { text: 'hi' } })
    expect(result.content).toEqual([{ type: 'text', text: 'echo:hi' }])
    expect(result.isError).toBe(false)

    expect(types(agent.session)).toEqual(['turn/start', 'step/start', 'tool/call', 'tool/result'])
    const call = agent.session.events[2]!
    expect(call.type === 'tool/call' && call.data).toMatchObject({
      turn: 1, step: 1, name: 'echo', arguments: '{"text":"hi"}', callId: CallId('dsh:1'),
    })
    const settled = agent.session.events[3]!
    expect(settled.type === 'tool/result' && settled.sourceEventSeqs).toEqual([call.seq])
    // The tool's own presentation payload rides the durable result, as it does
    // under the agent loop.
    expect(settled.type === 'tool/result' && settled.data.meta).toEqual({ echoed: 'echo:hi' })
    await client.close()
    await handle.dispose()
  })

  it('carries an executor denial back as an MCP error result', async () => {
    const { agent, ctx, service } = await harness()
    ctx.on('tools/pre-execute', (exec, next) =>
      (exec.name === 'echo' ? Promise.resolve({ kind: 'deny' as const, reason: 'policy' }) : next()))
    const handle = service.instance(agent)
    const client = await connect(handle)

    const result = await client.callTool({ name: 'echo', arguments: { text: 'hi' } })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('policy')
    const settled = agent.session.events.at(-1)!
    expect(settled.type === 'tool/result' && settled.data.message.content[0].isError).toBe(true)
    // The denial never reached the tool body, and the durable pair still records it.
    expect(types(agent.session)).toEqual(['turn/start', 'step/start', 'tool/call', 'tool/result'])
    await client.close()
    await handle.dispose()
  })

  it('refuses a name outside the served snapshot', async () => {
    const { agent, service } = await harness()
    const handle = service.instance(agent)
    const client = await connect(handle)
    await expect(client.callTool({ name: 'absent', arguments: {} }))
      .rejects.toThrow(/"absent" is not a tool of this agent/)
    await client.close()
    await handle.dispose()
  })

  it('records a failing tool body, with its failure identity, from an argumentless call', async () => {
    const { agent, service } = await harness()
    const handle = service.instance(agent)
    const client = await connect(handle)
    const result = await client.callTool({ name: 'blocked' })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('tool refused')
    const call = agent.session.events[2]!
    expect(call.type === 'tool/call' && call.data.arguments).toBe('{}')
    const settled = agent.session.events[3]!
    expect(settled.type === 'tool/result' && settled.data.error).toEqual({ name: 'HarnessError', code: 'TOOL_REFUSED' })
    expect(settled.type === 'tool/result' && settled.data.meta).toBeUndefined()
    await client.close()
    await handle.dispose()
  })
})

describe('disposal', () => {
  it('closes the transport and the turn, and is idempotent', async () => {
    const { agent, service } = await harness()
    const handle = service.instance(agent)
    const client = await connect(handle)
    await handle.dispose()
    await expect(handle.dispose()).resolves.toBeUndefined()
    expect(types(agent.session)).toEqual(['turn/start', 'step/start', 'step/end', 'turn/end'])
    await expect(client.listTools()).rejects.toThrow(/Not connected/)
    await client.close()
  })

  it('refuses every request a closed run still receives', async () => {
    const { ctx, agent } = await harness()
    // The guard is closed BEFORE the transport, so a request already in flight
    // when the run ends is refused rather than executed against a closed turn.
    const served = buildServedServer(
      { ctx, agent, serverName: 'dsh', position: { turn: 1, step: 1 } },
      { serverName: 'dsh' },
    )
    served.close()
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'spec', version: '1' })
    await Promise.all([served.instance.connect(serverTransport), client.connect(clientTransport)])
    await expect(client.listTools()).rejects.toThrow(/the served run is over/)
    await expect(client.callTool({ name: 'echo', arguments: {} })).rejects.toThrow(/the served run is over/)
    await client.close()
    await served.instance.close()
    // The service never opened a turn for this hand-built server.
    expect(types(agent.session)).toEqual([])
  })
})

describe('namespace resolution', () => {
  it('takes the request over the configured default', async () => {
    const { service } = await harness({ serverName: 'configured' })
    expect(service.resolve({})).toEqual({ serverName: 'configured' })
    expect(service.resolve({ serverName: 'run' })).toEqual({ serverName: 'run' })
  })

  it('defaults to the shipped namespace when nothing configures one', async () => {
    const { service } = await harness()
    expect(service.resolve({})).toEqual({ serverName: DEFAULT_SERVER_NAME })
  })

  it('rejects a namespace the client cannot qualify a tool name with', async () => {
    const { service } = await harness()
    expect(() => service.resolve({ serverName: 'not a name' })).toThrow(/must match/)
  })
})

describe('content flattening', () => {
  it('names a non-text block instead of dropping it', () => {
    expect(resultText([{ type: 'text', text: 'a' }, { type: 'reasoning', text: 'b' }], 'echo'))
      .toBe('a\n[reasoning content omitted]')
  })

  it('reports an empty projection rather than an empty string', () => {
    expect(resultText([], 'echo')).toBe('(echo returned no content)')
  })
})

describe('package registration', () => {
  it('registers the service and the package-owned empty invariant', async () => {
    const dispose = vi.fn()
    const register = vi.fn((_packageName: string, _installer: InvariantInstaller) => dispose)
    const ctx = { invariants: { register } } as unknown as Context
    await expect(invariant.apply(ctx)).resolves.toBe(dispose)
    expect(register).toHaveBeenCalledWith('@deepseek-ai/dsh-mcp-tool-server', expect.any(Function))
    const install = register.mock.calls[0]![1]
    await install(new Context(), (message) => { throw new Error(message) })
    expect(invariant.name).toBe('mcp-tool-server-invariant')
    expect(invariant.inject).toEqual(['invariants'])
  })
})
