/**
 * Durable bridge-run vocabulary: what the child harness session records about
 * an external agent's run over the harness tool set, plus the turn ceiling a
 * caller passes through `AgentOptions`.
 *
 * @module @deepseek-ai/dsh-subagent-claude-code/types
 */

import type { TokenUsage } from '@deepseek-ai/dsh-llm/types'
import type { SubagentStopReason } from '@deepseek-ai/dsh-subagent'

declare module '@deepseek-ai/dsh-agent' {
  interface AgentOptions {
    /**
     * Turn ceiling for a bridged external-agent run — one turn is that agent's
     * user message plus its model response. Read only by a subagent provider
     * running in bridge mode; the harness agent loop has no such bound.
     */
    maxTurns?: number
  }
}

/** Opens the durable record of one bridged external-agent run. */
export interface BridgeStartData {
  /** The subagent provider whose product ran. */
  readonly provider: string
  /** The tool names the external model was served, as that model sees them. */
  readonly tools: readonly string[]
}

/**
 * One assistant message the external agent produced, text blocks only. Its tool
 * calls are absent here on purpose: the executor already recorded each as the
 * ordinary `tool/call`/`tool/result` pair, and a second copy would be a second
 * source for one fact.
 */
export interface BridgeAssistantData {
  /** The message's concatenated text. */
  readonly text: string
  /** Token accounting the external product reported, absent when it reported none. */
  readonly usage?: TokenUsage
}

/** Closes the durable record of one bridged run. */
export interface BridgeEndData {
  /** The terminal reason, in the subagent seam's own vocabulary. */
  readonly stopReason: SubagentStopReason
  /** Whole-run token accounting the external product reported, absent when it reported none. */
  readonly usage?: TokenUsage
  /**
   * The model the external product stated it was running, verbatim from its
   * opening `init` message; it is what a reader of this log has instead of the
   * product's own transcript. Absent when the run ended before the product
   * stated one.
   */
  readonly model?: string
  /**
   * Whole-run cost in US dollars as the external product priced it. It is that
   * product's own accounting of a spend no harness pricing table covers, so it
   * is never comparable with a `usage/priced` cost by arithmetic alone. Absent
   * when the run ended before the product stated one.
   */
  readonly costUsd?: number
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Opens one bridged external-agent run in the child harness session that
     * authorizes it. Log-only: `deriveMessages()` ignores it, so nothing here
     * re-enters a harness model's context.
     */
    'bridge/start': BridgeStartData
    /**
     * One assistant message from the external model. Log-only, for the same
     * reason: the child session is the run's record, not its context.
     */
    'bridge/assistant': BridgeAssistantData
    /** Closes one bridged run with its terminal reason. Log-only. */
    'bridge/end': BridgeEndData
  }
}
