/**
 * Serve the harness LLM seam from a Claude Code installation the operator has
 * already authenticated. One plugin instance registers one provider route on
 * `ctx.llm`; every `generate()` on that route is one query to the installation
 * through the official Agent SDK, with the harness system prompt and
 * conversation rendered into the query's inputs, the harness tools offered as
 * native tools of an in-process MCP server, and the reply's text and tool calls
 * returned as the seam's chunks.
 *
 * The product runs no harness tool and reads no workspace, so tool calls
 * return to the harness agent loop and run under the harness's own tools,
 * session log, read barrier, budget policy, and approvals. The query runs in
 * the requesting harness session's working directory, read from the session
 * store through the request's session id, so the installation's own envelope
 * states that session's workspace to the model as its working directory.
 *
 * By default a harness session's steps share one product session, resumed with
 * the newest turn alone so the installation reads the conversation prefix from
 * its prompt cache; `sessionContinuity: per-query` sends the whole conversation
 * in a fresh query every step instead.
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
import { LlmError } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import type { SessionStore } from '@deepseek-ai/dsh-session'
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
  replayState,
  STREAM_IDLE_TIMEOUT_CODE,
} from './adapter.ts'
export type { ClaudeCodeAdapterDependencies, ClaudeCodeQuerySpec } from './adapter.ts'
export {
  CLAUDE_CODE_EFFORTS,
  Config,
  DEFAULT_DISPOSE_GRACE_MS,
  DEFAULT_QUERY_TIMEOUT_MS,
  DEFAULT_RESUMABLE_SESSION_LIMIT,
  DEFAULT_SESSION_CONTINUITY,
  resolveAdapterOptions,
  SESSION_CONTINUITIES,
} from './config.ts'
export {
  continuityKey,
  conversationDigest,
  planContinuity,
  ProductSessionTable,
  resumeRefusal,
} from './continuity.ts'
export type { TranscriptRelease } from './continuity.ts'
export { claudeSpawnSpec, ManagedClaudeCodeProcess, sdkEnvironmentOverlay } from './process.ts'
export { TAG_BASE, renderConversation, tagNamespace } from './render.ts'
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
export const inject = ['llm', 'subprocess', 'sessions']

/** Code for a request naming a harness session the session store does not hold. */
export const UNKNOWN_SESSION_CODE = 'UNKNOWN_SESSION'

/**
 * Resolve the directory one request's query runs in, which is also where the
 * installation files the product session that query creates.
 *
 * A request from a harness session runs in that session's working directory,
 * the `meta.cwd` it was created with. A request that names no session — a
 * hand-built one-shot — and a session that recorded no directory run in the
 * harness process's own. A request naming a session the store does not hold is
 * refused rather than defaulted: the seam stamps session identity from a live
 * session, so an unknown id is a caller error, not a session without a
 * directory, and a query silently run elsewhere is the failure this resolution
 * exists to prevent.
 * @param sessions - the live session store.
 * @param sessionId - the request's session identity, absent for a one-shot.
 * @returns the absolute directory the query runs in.
 * @throws {LlmError} `UNKNOWN_SESSION` when the store holds no session with that id.
 */
export function queryDirectory(sessions: Pick<SessionStore, 'get'>, sessionId: GenerateOptions['sessionId']): string {
  if (sessionId === undefined) return process.cwd()
  const session = sessions.get(sessionId)
  if (session === undefined) {
    throw new LlmError(
      `llm-claude-code: the request names harness session "${String(sessionId)}", which the session store does not hold`,
      UNKNOWN_SESSION_CODE,
    )
  }
  return session.header.cwd ?? process.cwd()
}

/**
 * Register one Claude Code provider route on `ctx.llm`.
 * @param ctx - context carrying the LLM registry, the subprocess seam, and the session store.
 * @param config - the route name, model catalog, and query policy.
 */
export function apply(ctx: Context, config: Config): void {
  const options = resolveAdapterOptions(config)
  const adapter = new ClaudeCodeAdapter(options, {
    resolveExecutable: (env, signal) =>
      ctx.subprocess.resolveExecutable(CLAUDE_CODE_COMMAND, env, signal),
    spawn: spec => ctx.subprocess.spawn(spec),
    cwd: sessionId => queryDirectory(ctx.sessions, sessionId),
  })
  ctx.llm.registerAdapter([options.provider], adapter)
  // Unloading the route releases every product session it created, so a
  // resumable route leaves no transcript behind in the operator's store.
  ctx.effect(function* () {
    yield () => { adapter.dispose() }
  }, 'llm-claude-code product sessions')
}
