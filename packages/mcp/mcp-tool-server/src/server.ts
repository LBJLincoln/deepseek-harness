/**
 * The served MCP server itself: the durable turn one run occupies, the tool
 * list projected from one agent's registry view, and the call handler that
 * routes every MCP `tools/call` through the harness executor.
 *
 * @module @deepseek-ai/dsh-mcp-tool-server/server
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type { McpToolServerSpec } from './types.ts'

/**
 * MCP `serverInfo.version` this implementation reports. It identifies the
 * server a client is talking to, not the harness release, so it moves only
 * when the served protocol surface changes.
 */
export const MCP_TOOL_SERVER_VERSION = '1'

/** The single step every served run occupies inside its own turn. */
const SERVED_STEP = 1

/** One tool as the MCP tool list presents it. */
interface ServedTool {
  readonly name: string
  readonly description: string
  readonly inputSchema: Record<string, unknown>
}

/** The turn and step a run's durable tool events name. */
interface ServedTurn {
  readonly turn: number
  readonly step: number
}

/**
 * Where the log stands before the server opens its own turn: the highest turn
 * ever started, and whether one is still open.
 * @param session - the agent's live session.
 * @returns the last started turn number and the open turn, if any.
 */
export function turnPosition(session: Session): { last: number; open: number | undefined } {
  let last = 0
  let open: number | undefined
  for (const event of session.events) {
    if (event.type === 'turn/start') {
      last = event.data.turn
      open = event.data.turn
    } else if (event.type === 'turn/end') {
      open = undefined
    }
  }
  return { last, open }
}

/**
 * Open the turn this run's tool events belong to. `tool/call` and `tool/result`
 * are step-scoped, so a served run needs an open turn and step of its own; the
 * served agent is driven by nobody else, which is what makes writing one here
 * safe.
 * @param session - the served agent's session.
 * @param serverName - the MCP namespace, for the refusal.
 * @returns the turn and step every durable event of this run names.
 * @throws when a turn is already open on that session.
 */
export function openServedTurn(session: Session, serverName: string): ServedTurn {
  const position = turnPosition(session)
  if (position.open !== undefined) {
    throw new Error(
      `mcp-tool-server(${serverName}): session "${session.header.id}" already has turn ${position.open} open`
      + ' — serve an agent no loop is driving',
    )
  }
  const turn = position.last + 1
  session.append('turn/start', { turn })
  session.append('step/start', { turn, step: SERVED_STEP })
  return { turn, step: SERVED_STEP }
}

/**
 * Close the run's turn. Appended once, from disposal, so a handler that somehow
 * outlived the run cannot land a step-scoped event outside its step.
 * @param session - the served agent's session.
 * @param position - the turn and step {@link openServedTurn} opened.
 */
export function closeServedTurn(session: Session, position: ServedTurn): void {
  session.append('step/end', position)
  session.append('turn/end', { turn: position.turn, reason: { kind: 'completed' } })
}

/**
 * Project one agent's visible tools onto the MCP tool list. The registry has
 * already deep-cloned each schema, so the served list shares nothing mutable
 * with a live definition.
 * @param ctx - context carrying the tool registry.
 * @param agent - the agent whose scope decides visibility.
 * @returns one MCP tool per visible harness tool, in registry order.
 */
export function servedTools(ctx: Context, agent: Agent): ServedTool[] {
  return ctx.tools.schemas(agent).map(schema => ({
    name: schema.name,
    description: schema.description,
    inputSchema: schema.parameters,
  }))
}

/**
 * Flatten an executor result to the text an MCP client receives. Text blocks
 * are the model-facing projection the harness already built; a non-text block
 * is named rather than dropped, because the external model must not read a
 * silent omission as an empty result.
 * @param content - the executor's model-facing content.
 * @param name - the tool name, for the no-output notice.
 * @returns one text payload.
 */
export function resultText(content: readonly ContentBlock[], name: string): string {
  const parts = content.map(block => (block.type === 'text' ? block.text : `[${block.type} content omitted]`))
  return parts.join('\n') || `(${name} returned no content)`
}

/** Everything one call handler needs from the run that owns it. */
export interface ServedCallContext {
  /** Context carrying the tool registry that executes the call. */
  readonly ctx: Context
  /** The agent the call runs as. */
  readonly agent: Agent
  /** The resolved MCP namespace, for diagnostics. */
  readonly serverName: string
  /** The turn and step the durable events name. */
  readonly position: ServedTurn
}

/**
 * Execute one MCP tool call through the harness executor and record it as the
 * ordinary durable pair. Every authority the harness has — approval, guards,
 * the filesystem policy each tool dispatches, the around-dispatch wrappers,
 * the content projection — applies because this is the same `execute` call the
 * agent loop makes.
 * @param call - the run's registry, agent, namespace, and turn position.
 * @param name - the harness tool name the client asked for.
 * @param args - the client's arguments, already defaulted for an argumentless call.
 * @param callId - the identity shared by the durable call/result pair.
 * @param signal - the client's cancellation for this request.
 * @returns the executor's outcome after both durable events are appended.
 */
export async function executeServedCall(
  call: ServedCallContext,
  name: string,
  args: Record<string, unknown>,
  callId: CallId,
  signal: AbortSignal,
): Promise<ToolExecutionResult> {
  const session = call.agent.session
  const { turn, step } = call.position
  const started = session.append('tool/call', {
    turn,
    step,
    callId,
    name,
    arguments: JSON.stringify(args),
  })
  const result = await call.ctx.tools.execute({ callId, name, arguments: args, agent: call.agent, signal })
  session.append('tool/result', {
    turn,
    step,
    message: createToolResultMessage({ callId, content: result.content, isError: result.isError }),
    ...result.error?.info ? { error: result.error.info } : {},
    ...result.meta !== undefined ? { meta: result.meta } : {},
  }, { surfaceOp: 'append', sourceEventSeqs: [started.seq] })
  return result
}

/** One live served server with the state its handlers read. */
export interface ServedServer {
  /** The official MCP server the consumer connects a transport to. */
  readonly instance: McpServer
  /** The tool names served, snapshotted when the server was built. */
  readonly toolNames: readonly string[]
  /** Stop answering calls; later requests fail with the closed-run error. */
  close(): void
}

/**
 * Build one agent's MCP server. The tool list is snapshotted here: it is what
 * the external model plans against and what the run's durable record names, so
 * a set that changed underneath it would make both wrong.
 * @param call - the run's registry, agent, namespace, and turn position.
 * @param spec - the resolved server inputs.
 * @returns the server and the names it serves.
 */
export function buildServedServer(call: ServedCallContext, spec: McpToolServerSpec): ServedServer {
  const tools = servedTools(call.ctx, call.agent)
  const names = new Set(tools.map(tool => tool.name))
  const instance = new McpServer(
    { name: spec.serverName, version: MCP_TOOL_SERVER_VERSION },
    { capabilities: { tools: {} } },
  )
  let calls = 0
  let closed = false
  const requireOpen = (): void => {
    if (closed) {
      throw new Error(`mcp-tool-server(${spec.serverName}): the served run is over; no further tool calls are accepted`)
    }
  }
  // The low-level request handlers, not `registerTool`: harness tools carry
  // JSON Schema, and the high-level registration takes a Zod shape instead.
  instance.server.setRequestHandler(ListToolsRequestSchema, () => {
    requireOpen()
    return { tools }
  })
  instance.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    requireOpen()
    const name = request.params.name
    // A name outside the served snapshot is refused here AND would fail
    // `UNKNOWN_TOOL` at the executor: the list is presentation, the executor is
    // the authority, and neither stands alone.
    if (!names.has(name)) {
      throw new Error(`mcp-tool-server(${spec.serverName}): "${name}" is not a tool of this agent`)
    }
    const result = await executeServedCall(
      call,
      name,
      // An argumentless MCP call omits the member; the executor requires
      // lossless JSON, and `{}` is what an empty argument list means.
      request.params.arguments ?? {},
      CallId(`${spec.serverName}:${++calls}`),
      extra.signal,
    )
    return { content: [{ type: 'text' as const, text: resultText(result.content, name) }], isError: result.isError }
  })
  return {
    instance,
    toolNames: tools.map(tool => tool.name),
    close(): void {
      closed = true
    },
  }
}
