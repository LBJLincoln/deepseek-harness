/**
 * Value types shared by this route's configuration, request rendering, and
 * response parsing.
 *
 * @module @deepseek-ai/dsh-llm-claude-code/types
 */

import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk'
import type { ResolvedRetryPolicy } from '@deepseek-ai/dsh-llm'

/**
 * One model the operator's installation can run, declared by the operator
 * because the harness has no way to interrogate an installation's entitlements.
 */
export interface ClaudeCodeModel {
  /** Model id harness requests select through `GenerateOptions.model`. */
  id: string
  /**
   * Model the installation is asked to run, sent as the product's `model`
   * option. Absent leaves that option off, so the installation runs whatever
   * it is configured to run.
   */
  productModel?: string
  /** Human-readable name for selectors; the id when absent. */
  name?: string
  /** User-facing distinction from otherwise similar entries. */
  description?: string
  /** Maximum combined request and response context, when the operator knows it. */
  contextWindow?: number
}

/** Response effort passed through to the product's `effort` option. */
export type ClaudeCodeEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/**
 * How a harness session's steps relate to the installation's own sessions.
 *
 * `per-query` sends the whole conversation in a fresh query every step, which
 * rewrites the growing prefix into the prompt cache and reads none of it back.
 * `per-session` keeps one product session per harness session and resumes it
 * with the newest turn alone, which reads that prefix instead.
 */
export type SessionContinuity = 'per-query' | 'per-session'

/** Thinking policy passed through to the product's `thinking` option. */
export type ClaudeCodeThinking =
  | {
    /** The model decides when and how much to think. */
    type: 'adaptive'
  }
  | {
    /** The model thinks within a fixed budget. */
    type: 'enabled'
    /** That budget, in thinking tokens. */
    budgetTokens: number
  }
  | {
    /** The model does not think. */
    type: 'disabled'
  }

/**
 * Validated configuration for the one route this plugin registers, resolved
 * once at load so a misconfigured composition fails before any request.
 */
export interface ResolvedClaudeCodeOptions {
  /** Provider route registered on `ctx.llm`. */
  readonly provider: string
  /** Route name shown by provider selectors and diagnostics. */
  readonly displayName: string
  /** The models this route accepts, in operator-declared order. */
  readonly models: readonly ClaudeCodeModel[]
  /** Explicit entries layered over the subprocess seam's scrubbed parent environment. */
  readonly env: Readonly<Record<string, string>>
  /** Response effort for every query, or the installation's own when absent. */
  readonly effort?: ClaudeCodeEffort
  /** Thinking policy for every query, or the installation's own when absent. */
  readonly thinking?: ClaudeCodeThinking
  /** Maximum idle interval between messages of one query, in milliseconds. */
  readonly queryTimeoutMs: number
  /** Grace between process-tree termination tiers, in milliseconds. */
  readonly disposeGraceMs: number
  /** Whether a harness session's steps share one product session. */
  readonly sessionContinuity: SessionContinuity
  /** Product sessions the route keeps resumable at once under `per-session`. */
  readonly resumableSessionLimit: number
  /** Retry policy captured with the route registration. */
  readonly retryPolicy: ResolvedRetryPolicy
}

/**
 * What one harness conversation's product session holds, recorded when the
 * route sends a step and checked before the next one resumes it.
 */
export interface ProductSessionRecord {
  /** Product session id the route created for this harness conversation. */
  readonly productSessionId: string
  /**
   * Messages of the request whose prompt the product session now holds. The
   * product's own answer to that prompt is the message at this index of the
   * next request.
   */
  readonly heldMessages: number
  /** Digest of everything the route sent for those messages. */
  readonly digest: string
}

/** Why a request could not resume the product session recorded for it. */
export type ContinuityFallback =
  | 'no-session-id'
  | 'no-record'
  | 'history-rewound'
  | 'answer-missing'
  | 'prefix-changed'

/**
 * How one request reached the installation, recorded on the answer's finish
 * chunk so the session log distinguishes a resumed step from a fresh one.
 */
export interface ClaudeCodeReplayState {
  /** Which of the two paths this step took. */
  readonly continuity: 'fresh' | 'resumed'
  /** Product session the step ran in, resumed or newly created. */
  readonly productSessionId: string
  /** Why a `per-session` route still ran a fresh query; absent when it resumed. */
  readonly fallback?: ContinuityFallback
}

/** How one request reaches the installation, decided before the query starts. */
export type ContinuityPlan =
  | {
    /** The whole conversation goes to a new product session. */
    readonly kind: 'fresh'
    /** Product session id the query is asked to use. */
    readonly productSessionId: string
    /** Set when a `per-session` route could not resume; drives the logged reason. */
    readonly fallback: ContinuityFallback | undefined
    /** Whether the route will resume this session later, requiring persistence. */
    readonly continuable: boolean
    /** The rendered system prompt and prompt text. */
    readonly rendered: RenderedRequest
  }
  | {
    /** The newest turn alone goes to the product session that holds the rest. */
    readonly kind: 'resumed'
    /** Product session the query resumes. */
    readonly productSessionId: string
    /** The rendered system prompt and continuation prompt text. */
    readonly rendered: RenderedRequest
  }

/**
 * The harness tools of one request, offered to the product as native tools of
 * an in-process MCP server. Absent for a request that offers none, which is
 * what keeps a tool-free query free of a server it would never call.
 */
export interface ToolOffer {
  /** The in-process server configuration the query mounts, accepted by the SDK verbatim. */
  readonly server: McpSdkServerConfigWithInstance
  /** The qualified names the query allows, one per offered tool. */
  readonly allowedTools: readonly string[]
  /** The harness names a reply may call, after its qualification is stripped. */
  readonly names: ReadonlySet<string>
  /**
   * Release the server's transport once the query is over.
   * @returns fulfillment after the server closed.
   */
  close(): Promise<void>
}

/** One tool invocation the product's reply requested. */
export interface ClaudeCodeToolCall {
  /** Harness tool name, with the product's MCP qualification stripped. */
  name: string
  /** JSON arguments, exactly as the seam carries them to the agent loop. */
  arguments: string
}

/** The product's answer to one harness request, read from its assistant messages. */
export interface ClaudeCodeAnswer {
  /** Visible assistant text, empty when the turn is tool calls alone. */
  content: string
  /** Tool calls the harness agent loop executes, in returned order. */
  toolCalls: ClaudeCodeToolCall[]
}

/**
 * One harness request rendered under a single tag prefix, in every form the
 * route may send or hash it in.
 */
export interface ConversationRendering {
  /** Custom system prompt replacing the product's own preset. */
  readonly systemPrompt: string
  /** Tag prefix framing every element of this request. */
  readonly namespace: string
  /** The whole conversation as one prompt: the reading guide, then every element. */
  readonly whole: string
  /**
   * The framed elements of the first `count` messages and nothing else, which
   * is what the continuity digest is taken over.
   * @param count - messages to include, counted from the start of the conversation.
   * @returns the elements, newline-joined with a trailing newline.
   */
  prefix(count: number): string
  /**
   * The framed elements from `from` onward as a standalone prompt for a
   * product session that already holds the messages before it.
   * @param from - index of the first message to send.
   * @returns the elements, newline-joined with a trailing newline.
   */
  continuation(from: number): string
}

/** One harness request rendered into the product's prompt inputs. */
export interface RenderedRequest {
  /**
   * Custom system prompt replacing the product's own preset, so the harness
   * system prompt is the only standing instruction the model reads.
   */
  systemPrompt: string
  /** The conversation, rendered as one prompt text. */
  prompt: string
}
