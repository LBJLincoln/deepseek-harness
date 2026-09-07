/**
 * Serve the harness LLM seam from a Claude Code installation the operator has
 * already authenticated. One plugin instance registers one provider route on
 * `ctx.llm`; every `generate()` on that route is one stateless query to the
 * installation through the official Agent SDK, with the harness system prompt
 * and conversation rendered into the query's inputs, the harness tools offered
 * as native tools of an in-process MCP server, and the reply's text and tool
 * calls returned as the seam's chunks.
 *
 * The product runs no harness tool and reads no workspace, so tool calls
 * return to the harness agent loop and run under the harness's own tools,
 * session log, read barrier, budget policy, and approvals.
 *
 * ```yaml
 * - id: llm-claude-code
 *   name: '@deepseek-ai/dsh-llm-claude-code'
 *   config:
 *     provider: claude-code
 *     models:
 *       # No productModel: the installation runs whatever it is configured to.
 *       - id: default
 *         name: Claude Code default
 *         contextWindow: 200000
 * ```
 *
 * @module @deepseek-ai/dsh-llm-claude-code
 */

import type { Context } from '@deepseek-ai/cordis'
import { CLAUDE_CODE_COMMAND, ClaudeCodeAdapter } from './adapter.ts'
import { Config, resolveAdapterOptions } from './config.ts'

export {
  CLAUDE_CODE_COMMAND,
  ClaudeCodeAdapter,
  claudeQueryOptions,
  disposeQuery,
  MAX_TURNS,
  MISSING_EXECUTABLE_CODE,
  PERMISSION_MODE,
  STREAM_IDLE_TIMEOUT_CODE,
} from './adapter.ts'
export type { ClaudeCodeAdapterDependencies, ClaudeCodeQuerySpec } from './adapter.ts'
export {
  CLAUDE_CODE_EFFORTS,
  Config,
  DEFAULT_DISPOSE_GRACE_MS,
  DEFAULT_QUERY_TIMEOUT_MS,
  resolveAdapterOptions,
} from './config.ts'
export { claudeSpawnSpec, ManagedClaudeCodeProcess, sdkEnvironmentOverlay } from './process.ts'
export { TAG_BASE, renderRequest, tagNamespace } from './render.ts'
export {
  answerChunks,
  deliversAnswer,
  MALFORMED_RESPONSE_CODE,
  mapUsage,
  MAX_TURNS_CODE,
  parseAnswer,
  PRODUCT_ERROR_CODE,
  resultFailure,
  TRANSPORT_CODE,
} from './response.ts'
export {
  harnessToolName,
  MCP_SERVER_NAME,
  MCP_TOOL_PREFIX,
  OFFER_SERVER_VERSION,
  QUEUED_CALL_TEXT,
  toolOffer,
} from './tools.ts'
export type * from './types.ts'

export const name = 'llm-claude-code'
export const inject = ['llm', 'subprocess']

/**
 * Register one Claude Code provider route on `ctx.llm`.
 * @param ctx - context carrying the LLM registry and the subprocess seam.
 * @param config - the route name, model catalog, and query policy.
 */
export function apply(ctx: Context, config: Config): void {
  const options = resolveAdapterOptions(config)
  const adapter = new ClaudeCodeAdapter(options, {
    resolveExecutable: (env, signal) =>
      ctx.subprocess.resolveExecutable(CLAUDE_CODE_COMMAND, env, signal),
    spawn: spec => ctx.subprocess.spawn(spec),
    // The query reads no workspace; the directory only anchors the CLI process
    // to the one the harness itself was launched in.
    cwd: () => process.cwd(),
  })
  ctx.llm.registerAdapter([options.provider], adapter)
}
