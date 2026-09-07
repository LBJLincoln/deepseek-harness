/**
 * Offer one request's harness tools to the product as native tools of an
 * in-process MCP server, and translate between the harness tool names and the
 * qualified names the product calls them by.
 *
 * The server executes nothing. Its handler exists because the product runs the
 * call it just asked for, and it answers with one fixed text; the harness runs
 * the real call after the query ends, as it does for every other provider.
 *
 * @module @deepseek-ai/dsh-llm-claude-code/tools
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { ToolSchema } from '@deepseek-ai/dsh-llm'
import type { ToolOffer } from './types.ts'

/** MCP namespace the offered tools answer under. */
export const MCP_SERVER_NAME = 'dsh'

/** Qualification the product adds to every name this server offers. */
export const MCP_TOOL_PREFIX = `mcp__${MCP_SERVER_NAME}__`

/**
 * `serverInfo.version` the offer reports. It identifies the server a client is
 * talking to, not the harness release, so it moves only when the offered
 * protocol surface changes.
 */
export const OFFER_SERVER_VERSION = '1'

/**
 * The text every handler answers with. The product records it in its own
 * transcript and then reaches the query's turn bound, so no model ever reads
 * it; the harness runs the call and its real result reaches the model in the
 * next request's conversation.
 */
export const QUEUED_CALL_TEXT = 'Queued for the harness.'

/**
 * Recover the harness tool name from the name a reply called.
 * @param called - the tool name exactly as the reply wrote it.
 * @returns the name without the product's MCP qualification, which some replies omit.
 */
export function harnessToolName(called: string): string {
  return called.startsWith(MCP_TOOL_PREFIX) ? called.slice(MCP_TOOL_PREFIX.length) : called
}

/**
 * Build the in-process offer for one request's tools.
 *
 * Each definition is served through the low-level MCP request handlers rather
 * than `registerTool`, so the model reads the harness JSON Schema verbatim —
 * the same schema `request/header` recorded — instead of a converted one.
 * @param tools - the harness tool definitions this request offers.
 * @returns the offer, or `undefined` when the request offers no tools and needs no server.
 */
export function toolOffer(tools: readonly ToolSchema[]): ToolOffer | undefined {
  if (tools.length === 0) return undefined
  const offered = tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.parameters,
  }))
  const instance = new McpServer(
    { name: MCP_SERVER_NAME, version: OFFER_SERVER_VERSION },
    { capabilities: { tools: {} } },
  )
  instance.server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: offered }))
  instance.server.setRequestHandler(CallToolRequestSchema, () => ({
    content: [{ type: 'text' as const, text: QUEUED_CALL_TEXT }],
  }))
  return {
    server: { type: 'sdk', name: MCP_SERVER_NAME, instance },
    allowedTools: offered.map(tool => `${MCP_TOOL_PREFIX}${tool.name}`),
    names: new Set(offered.map(tool => tool.name)),
    close: (): Promise<void> => instance.close(),
  }
}
