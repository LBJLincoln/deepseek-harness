/**
 * The MCP tool server (`ctx.mcpToolServer`): serves ONE harness agent's own
 * tool registry to an external agent over MCP, and executes every call it
 * receives through `ctx.tools.execute()` on that agent. It is the inverse of
 * [`dsh-mcp-client`](../../mcp-client/README.md), which registers a foreign
 * server's tools on `ctx.tools`; here a foreign model reaches the harness's
 * tools instead, so approval, guards, the filesystem policy, the timeout
 * wrappers, and the durable `tool/call`/`tool/result` pair all apply to work a
 * model outside this process asked for.
 *
 * A served run is one turn of the served agent's session — the step-scoped
 * durable pair needs one — so the agent handed to {@link
 * McpToolServerService.instance} must be a child nothing else drives. The
 * [external-agent bridge Agent Note](../../../.agents/notes/proposed/architecture/2026-09-06-external-agent-bridge.md)
 * owns the design rationale.
 *
 * @module @deepseek-ai/dsh-mcp-tool-server
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
// Side-effect type import: declaration-merges `ctx.tools` onto Context.
import type {} from '@deepseek-ai/dsh-tools'
import { buildServedServer, closeServedTurn, openServedTurn } from './server.ts'
import type { McpToolServerRequest, McpToolServerSpec } from './types.ts'

export type * from './types.ts'
export { MCP_TOOL_SERVER_VERSION } from './server.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    mcpToolServer: McpToolServerService
  }
}

/**
 * Valid `serverName`. The consuming client qualifies every served tool as
 * `mcp__<serverName>__<tool>`, so the namespace must survive that composition
 * as an ordinary function name.
 */
const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

/** Default MCP namespace, which the shipped bridge consumer names in its allowlist. */
export const DEFAULT_SERVER_NAME = 'dsh'

/**
 * The in-process server configuration an Agent SDK accepts verbatim. It is the
 * MCP SDK's own `McpServer` behind the two identity fields such an SDK reads.
 */
export interface McpToolServerInstanceConfig {
  /** Selects the in-process transport rather than a spawned or remote server. */
  readonly type: 'sdk'
  /** The resolved MCP namespace. */
  readonly name: string
  /** The live server; not serializable. */
  readonly instance: McpServer
}

/**
 * One live served run. The consumer connects {@link config} to its external
 * agent, and MUST {@link dispose} it: disposal closes the run's turn, which is
 * what makes the served agent's log well-formed.
 */
export interface McpToolServerHandle {
  /** The resolved MCP namespace this server answers under. */
  readonly serverName: string
  /** The agent every served call runs as, and whose session records the run. */
  readonly serves: Agent
  /** The in-process configuration to hand an Agent SDK. */
  readonly config: McpToolServerInstanceConfig
  /** The harness tool names served, snapshotted at creation. */
  readonly toolNames: readonly string[]
  /**
   * Close the transport, refuse every later call, and close the run's turn.
   * Idempotent.
   * @returns fulfillment after the server released its transport.
   */
  dispose(): Promise<void>
}

/** Deployment-owned MCP identity of the served registry. */
export interface Config {
  /**
   * MCP namespace a served run answers under when its request omits one
   * (default `dsh`). Matches `[A-Za-z0-9_-]{1,32}`.
   */
  serverName?: string
}

/**
 * The MCP tool server service. One instance serves any number of agents; each
 * `instance()` call owns one run, and one agent may hold only one live run.
 */
export class McpToolServerService extends Service {
  static inject = ['tools']

  // Inline schema call: the config catalog walks `static Config` statically.
  static Config: z<Config> = z.object({
    serverName: z.string().pattern(SERVER_NAME_PATTERN).default(DEFAULT_SERVER_NAME),
  })

  /** Live runs keyed by served agent, so a second concurrent run fails loud. */
  private readonly live = new Map<SessionId, McpToolServerHandle>()

  /** The schema-defaulted configuration; every field is present after validation. */
  private readonly config: Required<Config>

  constructor(ctx: Context, config: Config) {
    super(ctx, 'mcpToolServer')
    this.config = config as Required<Config>
    // A disposed plugin must leave no run's turn open, so releasing the live
    // runs is an effect of this service rather than a consumer's obligation.
    ctx.effect(() => () => this.releaseLive(), 'mcp-tool-server.runs')
  }

  /**
   * Release every run this service still owns. A consumer that disposed its
   * own handle leaves nothing for this to do.
   */
  private async releaseLive(): Promise<void> {
    await Promise.all([...this.live.values()].map(handle => handle.dispose()))
  }

  /**
   * Resolve one request against the deployment's configuration. Defaulting
   * happens here and nowhere else, so a caller reading a resolved spec sees
   * exactly what the run uses.
   * @param request - the caller's optional namespace override.
   * @returns the resolved server inputs.
   */
  resolve(request: McpToolServerRequest): McpToolServerSpec {
    const serverName = request.serverName ?? this.config.serverName
    if (!SERVER_NAME_PATTERN.test(serverName)) {
      throw new Error(`mcp-tool-server: serverName ${JSON.stringify(serverName)} must match ${String(SERVER_NAME_PATTERN)}`)
    }
    return { serverName }
  }

  /**
   * Serve one agent's tools as an in-process MCP server and open the turn its
   * calls are recorded in.
   * @param agent - the agent whose registry view is served and whose session records the run.
   * @param request - optional namespace override for this run.
   * @returns the handle carrying the SDK configuration, the served names, and disposal.
   * @throws when that agent already holds a live run, or when its session has a turn open.
   */
  instance(agent: Agent, request: McpToolServerRequest = {}): McpToolServerHandle {
    const spec = this.resolve(request)
    const existing = this.live.get(agent.id)
    if (existing !== undefined) {
      throw new Error(
        `mcp-tool-server(${spec.serverName}): agent "${agent.id}" already holds a live served run`
        + ' — dispose it before serving that agent again',
      )
    }
    const position = openServedTurn(agent.session, spec.serverName)
    const served = buildServedServer({ ctx: this.ctx, agent, serverName: spec.serverName, position }, spec)
    let disposal: Promise<void> | undefined
    const handle: McpToolServerHandle = {
      serverName: spec.serverName,
      serves: agent,
      config: { type: 'sdk', name: spec.serverName, instance: served.instance },
      toolNames: served.toolNames,
      dispose: (): Promise<void> => {
        if (disposal !== undefined) return disposal
        served.close()
        this.live.delete(agent.id)
        disposal = served.instance.close().finally(() => { closeServedTurn(agent.session, position) })
        return disposal
      },
    }
    this.live.set(agent.id, handle)
    return handle
  }
}

export default McpToolServerService
