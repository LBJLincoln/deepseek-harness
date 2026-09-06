/**
 * Value types shared by this route's configuration, request rendering, and
 * response parsing.
 *
 * @module @deepseek-ai/dsh-llm-claude-code/types
 */

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
  /** Retry policy captured with the route registration. */
  readonly retryPolicy: ResolvedRetryPolicy
}

/** One tool invocation the product returned in its structured answer. */
export interface ClaudeCodeToolCall {
  /** Harness tool name, as offered in the rendered tool section. */
  name: string
  /** Raw JSON arguments, exactly as the seam carries them to the agent loop. */
  arguments: string
}

/** The product's structured answer to one harness request. */
export interface ClaudeCodeAnswer {
  /** Visible assistant text, empty when the turn is tool calls alone. */
  content: string
  /** Tool calls the harness agent loop executes, in returned order. */
  toolCalls: ClaudeCodeToolCall[]
}

/** One harness request rendered into the product's prompt inputs. */
export interface RenderedRequest {
  /**
   * Custom system prompt replacing the product's own preset, so the harness
   * system prompt is the only standing instruction the model reads.
   */
  systemPrompt: string
  /** Tool section and conversation, rendered as one prompt text. */
  prompt: string
}
