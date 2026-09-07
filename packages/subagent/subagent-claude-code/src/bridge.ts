/**
 * Bridge mode: the external agent runs on the harness's own tools and nothing
 * else. This module owns the child harness agent it runs as, the SDK options
 * that pin its tool surface shut, and the fold from the SDK message stream into
 * the child session's durable record.
 *
 * @module @deepseek-ai/dsh-subagent-claude-code/bridge
 */

import { randomUUID } from 'node:crypto'
import type { Options, PermissionResult, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { McpToolServerHandle } from '@deepseek-ai/dsh-mcp-tool-server'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEventMap } from '@deepseek-ai/dsh-session'
import {
  applyChildComposition,
  appendDelegatedPolicyOverrides,
  captureDelegatedPolicyOverrides,
  childSessionMeta,
  resolveChildAgentOptions,
  resolveChildDepth,
  SubagentError,
} from '@deepseek-ai/dsh-subagent'
import type { ResolvedSubagentStartRequest, SubagentStopReason } from '@deepseek-ai/dsh-subagent'
import type { BridgeAssistantData, BridgeEndData, BridgeStartData } from './types.ts'

/** MCP namespace the bridged server answers under, and the prefix its tools carry. */
export const BRIDGE_SERVER_NAME = 'dsh'

/** The only tool-name prefix a bridged external model may call. */
export const BRIDGE_TOOL_PREFIX = `mcp__${BRIDGE_SERVER_NAME}__`

/** Refusal a bridged run answers every tool outside the harness namespace with. */
export const BRIDGE_TOOL_DENIAL = 'this run may only call the harness tools served under '
  + `"${BRIDGE_TOOL_PREFIX}"`

/**
 * Code carried by the refusal to bridge without the tool server composed, so a
 * caller routes it without parsing the message.
 */
export const SUBAGENT_BRIDGE_UNAVAILABLE = 'BRIDGE_UNAVAILABLE'

/**
 * Read the token accounting an SDK message reports. The stream crosses a
 * process boundary, so each field is accepted only as a number and a partial
 * report yields none rather than a fabricated zero.
 * @param usage - the SDK's usage record, whatever it carried.
 * @returns the harness token accounting, or `undefined` when the product reported none.
 */
export function bridgeUsage(usage: unknown): TokenUsage | undefined {
  if (typeof usage !== 'object' || usage === null) return undefined
  const record = usage as Record<string, unknown>
  const input = record['input_tokens']
  const output = record['output_tokens']
  if (typeof input !== 'number' || typeof output !== 'number') return undefined
  const cacheRead = record['cache_read_input_tokens']
  const cacheWrite = record['cache_creation_input_tokens']
  return {
    inputTokens: input,
    outputTokens: output,
    ...typeof cacheRead === 'number' ? { cacheReadTokens: cacheRead } : {},
    ...typeof cacheWrite === 'number' ? { cacheWriteTokens: cacheWrite } : {},
  }
}

/**
 * Read the model the product states it is running from its opening `init`
 * message, which is the only place the SDK stream names it. The stream crosses
 * a process boundary, so a message that is not that opening record yields none
 * rather than a guess.
 * @param message - one message from the SDK stream.
 * @returns the product's own model identifier, or `undefined` for every other message.
 */
export function initReportedModel(message: SDKMessage): string | undefined {
  return message.type === 'system' && message.subtype === 'init' ? message.model : undefined
}

/**
 * Read the whole-run token accounting the product reported, carried by its
 * terminal `result` message.
 * @param message - one message from the SDK stream.
 * @returns the harness token accounting, or `undefined` for every other message.
 */
export function resultReportedUsage(message: SDKMessage): TokenUsage | undefined {
  return message.type === 'result' ? bridgeUsage(message.usage) : undefined
}

/**
 * Read the whole-run cost the product priced its own work at, carried by the
 * same terminal message. Same process boundary as the usage beside it: a value
 * that is not a number yields none rather than a fabricated zero.
 * @param message - one message from the SDK stream.
 * @returns the product's own US-dollar total, or `undefined` for every other message.
 */
export function resultReportedCostUsd(message: SDKMessage): number | undefined {
  if (message.type !== 'result') return undefined
  const cost: unknown = message.total_cost_usd
  return typeof cost === 'number' ? cost : undefined
}

/**
 * Project one SDK assistant message onto its durable record. Text blocks only:
 * the tool calls in the same message are already the executor's `tool/call`
 * events.
 * @param message - one message from the SDK stream.
 * @returns the payload to append, or `undefined` when the message carries no text.
 */
export function bridgeAssistantRecord(message: SDKMessage): BridgeAssistantData | undefined {
  if (message.type !== 'assistant') return undefined
  const blocks = message.message.content
  const text = blocks
    .flatMap(block => (block.type === 'text' ? [block.text] : []))
    .join('')
  if (text.length === 0) return undefined
  const usage = bridgeUsage(message.message.usage)
  return { text, ...usage === undefined ? {} : { usage } }
}

/**
 * The SDK options that make the harness tool set the external model's ONLY
 * surface. `tools` and `allowedTools` decide what the model is told about;
 * `canUseTool` is the fence, because a model that names something else anyway
 * is denied in the operation that would run it.
 * @param server - the in-process MCP server configuration serving the child's registry.
 * @param maxTurns - the caller's turn ceiling, when one was requested.
 * @returns the options merged over the provider's ordinary query options.
 */
export function bridgeQueryOptions(
  server: McpToolServerHandle['config'],
  maxTurns: number | undefined,
): Partial<Options> {
  return {
    tools: [],
    mcpServers: { [BRIDGE_SERVER_NAME]: server },
    allowedTools: [`${BRIDGE_TOOL_PREFIX}*`],
    strictMcpConfig: true,
    settingSources: [],
    canUseTool: (toolName: string, input: Record<string, unknown>): Promise<PermissionResult> =>
      Promise.resolve(toolName.startsWith(BRIDGE_TOOL_PREFIX)
        ? { behavior: 'allow', updatedInput: input }
        : { behavior: 'deny', message: `${toolName}: ${BRIDGE_TOOL_DENIAL}`, interrupt: false }),
    ...maxTurns === undefined ? {} : { maxTurns },
  }
}

/** The live bridge one run holds: its child agent, its served tools, and its record. */
export interface BridgedRun {
  /** The published child harness agent every served call runs as. */
  readonly agent: Agent
  /** The child's session id, which is also the run id. */
  readonly id: SessionId
  /** SDK options pinning the external model to the served harness tools. */
  readonly options: Partial<Options>
  /** Fold one SDK message into the child's durable record. */
  observe(message: SDKMessage): void
  /** Close the durable record with its terminal reason. Only the first call records one. */
  settle(stopReason: SubagentStopReason): void
  /** Close the served server and dispose the child agent. Idempotent. */
  release(): Promise<void>
}

/** What {@link openBridgedRun} needs from the provider's context and request. */
export interface BridgeInputs {
  /** The provider's plugin context, where the tool server resolves. */
  readonly ctx: Context
  /** The resolved one-shot request, whose parent supplies lineage and composition. */
  readonly request: ResolvedSubagentStartRequest
  /** The provider name recorded in the run's opening event. */
  readonly provider: string
}

/**
 * Resolve the composed MCP tool server or refuse loudly. A deployment that
 * advertises the capability without composing the server is a misconfiguration,
 * and the earliest point that can see it is the start it would silently
 * degrade.
 * @param ctx - the provider's plugin context.
 * @returns the tool-server service.
 * @throws {@link SubagentError} with {@link SUBAGENT_BRIDGE_UNAVAILABLE} when none is composed.
 */
function requireToolServer(ctx: Context) {
  const server = ctx.get('mcpToolServer')
  if (server === undefined) {
    throw new SubagentError(
      'subagent-claude-code: harnessTools requires @deepseek-ai/dsh-mcp-tool-server in the composition',
      SUBAGENT_BRIDGE_UNAVAILABLE,
    )
  }
  return server
}

/** The three log-only events this package owns. */
interface BridgeEventMap {
  'bridge/start': BridgeStartData
  'bridge/assistant': BridgeAssistantData
  'bridge/end': BridgeEndData
}

/**
 * Narrow the generic append face to this package's own events, which
 * discharges `Session.append`'s conditional surface-options tuple: all three
 * are log-only.
 * @param session - the child session recording the run.
 * @returns the narrowed append function.
 */
function bridgeRecorder(session: Session) {
  return session.append.bind(session) as <Event extends keyof BridgeEventMap>(
    event: Event,
    value: SessionEventMap[Event],
  ) => void
}

/**
 * Create the child harness agent, serve its tools, and open the run's durable
 * record. Rejection leaves nothing published: the agent factory's creation
 * transaction rolls back, and a failure after publication releases the child
 * before rethrowing.
 * @param inputs - the provider context, the resolved request, and the provider name.
 * @returns the live bridge the run is driven through.
 */
export async function openBridgedRun(inputs: BridgeInputs): Promise<BridgedRun> {
  const { ctx, request, provider } = inputs
  const toolServer = requireToolServer(ctx)
  const parent = request.parent
  const childDepth = resolveChildDepth(parent, request.maxDepth)
  const childId = SessionId(randomUUID())
  // Captured before the first await: a later parent switch belongs to the
  // parent's future, not to this child.
  const inherited = captureDelegatedPolicyOverrides(parent)

  const handle: AgentHandle = await parent.ctx.agents.create({
    sessionId: childId,
    meta: childSessionMeta(parent, childDepth, 0),
    agentOptions: resolveChildAgentOptions(parent, request.agentOptions, childDepth),
    signal: request.signal,
    setup: (childCtx: Context): void => {
      appendDelegatedPolicyOverrides((childCtx.agent as Agent).session, inherited)
      // The composition carries no per-child persona or tool filter: this
      // provider advertises neither capability, so the service has already
      // rejected a request that asked for one.
      applyChildComposition(childCtx, parent, {})
      ;(childCtx.agent as Agent).session.append('subagent/descriptor', request.descriptor)
    },
  })

  const agent = handle.agent
  let served: McpToolServerHandle
  try {
    served = toolServer.instance(agent, { serverName: BRIDGE_SERVER_NAME })
  } catch (error: unknown) {
    await handle.dispose()
    throw error
  }

  const record = bridgeRecorder(agent.session)
  record('bridge/start', {
    provider,
    tools: served.toolNames.map(name => `${BRIDGE_TOOL_PREFIX}${name}`),
  })

  let settled = false
  let lastUsage: TokenUsage | undefined
  let lastModel: string | undefined
  let lastCostUsd: number | undefined
  let released: Promise<void> | undefined
  const settle = (stopReason: SubagentStopReason): void => {
    if (settled) return
    settled = true
    record('bridge/end', {
      stopReason,
      ...lastUsage === undefined ? {} : { usage: lastUsage },
      ...lastModel === undefined ? {} : { model: lastModel },
      ...lastCostUsd === undefined ? {} : { costUsd: lastCostUsd },
    })
  }

  return {
    agent,
    id: childId,
    options: bridgeQueryOptions(served.config, request.agentOptions?.maxTurns),
    observe(message: SDKMessage): void {
      lastModel = initReportedModel(message) ?? lastModel
      lastUsage = resultReportedUsage(message) ?? lastUsage
      lastCostUsd = resultReportedCostUsd(message) ?? lastCostUsd
      const assistant = bridgeAssistantRecord(message)
      if (assistant !== undefined) record('bridge/assistant', assistant)
    },
    settle,
    release(): Promise<void> {
      if (released !== undefined) return released
      // The run's record closes before the served turn does, so `bridge/end`
      // always lands inside the turn its tool calls occupy.
      settle('aborted')
      released = served.dispose().then(() => handle.dispose())
      return released
    },
  }
}
