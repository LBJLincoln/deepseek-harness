/**
 * Map one product result back onto the seam: parse the structured answer into
 * chunks, translate token accounting, and classify a failed query into the
 * seam's provider-neutral error codes.
 *
 * @module @deepseek-ai/dsh-llm-claude-code/response
 */

import type { NonNullableUsage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk'
import {
  CallId,
  CONTEXT_WINDOW_EXCEEDED_CODE,
  EMPTY_RESPONSE_CODE,
  isContextWindowExceededError,
  isQuotaExceededError,
  LlmError,
  QUOTA_EXCEEDED_CODE,
} from '@deepseek-ai/dsh-llm'
import type { StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm'
import type { ClaudeCodeAnswer, ClaudeCodeToolCall } from './types.ts'

/** Code for a product result the seam cannot read as one model response. */
export const MALFORMED_RESPONSE_CODE = 'MALFORMED_RESPONSE'

/** Code for a query the product ended without producing its answer. */
export const PRODUCT_ERROR_CODE = 'PRODUCT_ERROR'

/** Code for a query the product stopped at its turn bound. */
export const MAX_TURNS_CODE = 'MAX_TURNS'

function malformed(detail: string): LlmError {
  return new LlmError(`llm-claude-code: ${detail}`, MALFORMED_RESPONSE_CODE)
}

/** Read one required string field of the structured answer. */
function requiredString(source: Record<string, unknown>, field: string, where: string): string {
  const value = source[field]
  if (typeof value !== 'string') throw malformed(`${where} must carry a string "${field}"`)
  return value
}

/**
 * Accept the arguments field in either form the product may emit: the JSON
 * string the schema asks for, or a JSON object when its structured-output
 * enforcement passed one through.
 */
function callArguments(raw: unknown): string {
  if (typeof raw === 'string') return raw
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) return JSON.stringify(raw)
  throw malformed('every tool call must carry "arguments" as a JSON string or object')
}

/**
 * Parse the product's structured output into the answer this route returns.
 * A missing or unreadable structured output is a provider failure, never an
 * empty answer that would silently end the turn.
 * @param structured - the result's `structured_output` value, exactly as delivered.
 * @returns the visible text and the tool calls to hand back to the agent loop.
 */
export function parseAnswer(structured: unknown): ClaudeCodeAnswer {
  if (typeof structured !== 'object' || structured === null || Array.isArray(structured)) {
    throw malformed('the query returned no structured answer')
  }
  const source = structured as Record<string, unknown>
  const content = requiredString(source, 'content', 'the structured answer')
  const rawCalls = source['toolCalls']
  if (!Array.isArray(rawCalls)) {
    throw malformed('the structured answer must carry a "toolCalls" array')
  }
  const toolCalls: ClaudeCodeToolCall[] = rawCalls.map((rawCall) => {
    if (typeof rawCall !== 'object' || rawCall === null || Array.isArray(rawCall)) {
      throw malformed('every tool call must be an object')
    }
    const call = rawCall as Record<string, unknown>
    return {
      name: requiredString(call, 'name', 'every tool call'),
      arguments: callArguments(call['arguments']),
    }
  })
  return { content, toolCalls }
}

/** Read one usage counter across the CLI's JSON boundary, where a field may be absent. */
function tokenCount(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

/**
 * Translate the product's token accounting into the seam's disjoint counts.
 * The product already reports uncached input separately from cache reads and
 * writes, so no subtraction is needed.
 * @param usage - the result's usage record.
 * @returns disjoint harness counts; cache fields only when the product reported them.
 */
export function mapUsage(usage: NonNullableUsage): TokenUsage {
  const cacheReadTokens = tokenCount(usage.cache_read_input_tokens)
  const cacheWriteTokens = tokenCount(usage.cache_creation_input_tokens)
  return {
    inputTokens: tokenCount(usage.input_tokens),
    outputTokens: tokenCount(usage.output_tokens),
    ...cacheReadTokens > 0 ? { cacheReadTokens } : {},
    ...cacheWriteTokens > 0 ? { cacheWriteTokens } : {},
  }
}

/**
 * Classify one failed query. Every code, terminal reason, and message the
 * product reported joins one detail string so the seam's shared classifiers
 * see the same evidence they see from an HTTP provider.
 * @param message - the product's result message.
 * @returns the seam-coded failure to throw for this query.
 */
export function resultFailure(message: SDKResultMessage): LlmError {
  const errors = message.subtype === 'success' ? [] : message.errors
  const detail = [message.subtype, message.terminal_reason, message.stop_reason, ...errors]
    .filter(part => typeof part === 'string' && part.length > 0)
    .join(' ')
  const text = `llm-claude-code: the query failed: ${detail}`
  if (isContextWindowExceededError(detail)) return new LlmError(text, CONTEXT_WINDOW_EXCEEDED_CODE)
  if (isQuotaExceededError(detail)) return new LlmError(text, QUOTA_EXCEEDED_CODE)
  switch (message.subtype) {
    case 'success':
      return new LlmError(text, PRODUCT_ERROR_CODE)
    case 'error_max_turns':
      return new LlmError(text, MAX_TURNS_CODE)
    case 'error_max_budget_usd':
      return new LlmError(text, QUOTA_EXCEEDED_CODE)
    case 'error_max_structured_output_retries':
      return new LlmError(text, MALFORMED_RESPONSE_CODE)
    case 'error_during_execution':
      return new LlmError(text, PRODUCT_ERROR_CODE)
  }
}

/**
 * Emit one answer as the seam's chunk protocol: the visible text block first,
 * then one block per tool call, then usage and the terminal finish.
 * @param answer - the parsed structured answer.
 * @param usage - the product's token accounting for this query.
 * @param responseId - the result's own identity, which makes call ids unique per response.
 * @returns the chunks in protocol order.
 */
export function answerChunks(
  answer: ClaudeCodeAnswer,
  usage: NonNullableUsage,
  responseId: string,
): StreamChunk[] {
  if (answer.content.length === 0 && answer.toolCalls.length === 0) {
    throw new LlmError(
      'llm-claude-code: the query completed with no text and no tool calls',
      EMPTY_RESPONSE_CODE,
    )
  }
  const chunks: StreamChunk[] = []
  let index = 0
  if (answer.content.length > 0) {
    chunks.push(
      { type: 'block-start', index, blockType: 'text' },
      { type: 'text-delta', index, text: answer.content },
      { type: 'block-end', index, block: { type: 'text', text: answer.content } },
    )
    index += 1
  }
  for (const [position, call] of answer.toolCalls.entries()) {
    const id = CallId(`${responseId}-${position}`)
    chunks.push(
      { type: 'block-start', index, blockType: 'tool-call' },
      { type: 'tool-call-delta', index, id, name: call.name, argumentsDelta: call.arguments },
      {
        type: 'block-end',
        index,
        block: { type: 'tool-call', id, name: call.name, arguments: call.arguments },
      },
    )
    index += 1
  }
  chunks.push({ type: 'usage', usage: mapUsage(usage) })
  chunks.push({
    type: 'finish',
    reason: answer.toolCalls.length > 0 ? { kind: 'tool-calls' } : { kind: 'stop' },
  })
  return chunks
}
