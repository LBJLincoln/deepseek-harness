/**
 * Caller-facing vocabulary of the MCP tool server: what a consumer asks for
 * and what the service resolved it to. The live handle stays in the entry
 * module, because it carries an MCP SDK server instance rather than data.
 *
 * @module @deepseek-ai/dsh-mcp-tool-server/types
 */

/** What a consumer asks for when serving one agent's tools. */
export interface McpToolServerRequest {
  /**
   * MCP namespace this server answers under, which the consuming client
   * qualifies its tool names with (`mcp__<serverName>__<tool>`). Omitted means
   * the deployment's configured `serverName`.
   */
  readonly serverName?: string
}

/** One server's inputs after {@link McpToolServerRequest} defaulting. */
export interface McpToolServerSpec {
  /** The resolved MCP namespace. */
  readonly serverName: string
}
