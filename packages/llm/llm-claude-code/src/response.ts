/**
 * Map one product query back onto the seam: read the answer out of the query's
 * assistant messages, translate token accounting, and classify a result that
 * carries no answer into the seam's provider-neutral error codes.
 *
 * @module @deepseek-ai/dsh-llm-claude-code/response
 */

import type {
  NonNullableUsage,
  SDKAssistantMessage,
  SDKResultMessage,
} from '@anthropic-ai/claude-agent-sdk'
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
import { harnessToolName } from './tools.ts'
import type { ClaudeCodeAnswer, ClaudeCodeReplayState, ClaudeCodeToolCall } from './types.ts'

/** Code for a reply the seam cannot read as one model response. */
export const MALFORMED_RESPONSE_CODE = 'MALFORMED_RESPONSE'

/** Code for a query the product ended without producing its answer. */
export const PRODUCT_ERROR_CODE = 'PRODUCT_ERROR'

/** Code for a query the product stopped at its turn bound with nothing to deliver. */
export const MAX_TURNS_CODE = 'MAX_TURNS'

/**
 * Code for a transient failure of the query itself rather than of the model's
 * answer: a product-side API failure reported on an otherwise successful
 * result, and any SDK failure raised without a result at all.
 */
export const TRANSPORT_CODE = 'TRANSPORT'

function malformed(detail: string): LlmError {
  return new LlmError(`llm-claude-code: ${detail}`, MALFORMED_RESPONSE_CODE)
}

/**
 * Read one call's arguments. The API delivers the model's arguments already
 * parsed, so re-serializing them is the only representation this route can
 * carry; anything but a JSON object means the value did not survive the CLI's
 * process boundary intact.
 */
function callArguments(raw: unknown, name: string): string {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw malformed(`the call to "${name}" carried no JSON object of arguments`)
  }
  return JSON.stringify(raw)
}

/** Translate one `tool_use` block into the call the agent loop executes. */
function toolCall(called: string, input: unknown, offered: ReadonlySet<string>): ClaudeCodeToolCall {
  const name = harnessToolName(called)
  if (!offered.has(name)) {
    throw malformed(`the reply called "${called}", which this request did not offer`)
  }
  return { name, arguments: callArguments(input, name) }
}

/**
 * Read the answer out of the query's assistant messages, in the order the
 * product published them. One API message may arrive as several assistant
 * messages, one per block, so text joins across messages and calls keep their
 * order across them.
 * @param messages - every assistant message the query published.
 * @param offered - the harness tool names this request offered.
 * @returns the visible text and the tool calls to hand back to the agent loop.
 */
export function parseAnswer(
  messages: readonly SDKAssistantMessage[],
  offered: ReadonlySet<string>,
): ClaudeCodeAnswer {
  const texts: string[] = []
  const toolCalls: ClaudeCodeToolCall[] = []
  for (const message of messages) {
    for (const block of message.message.content) {
      switch (block.type) {
        case 'text':
          texts.push(block.text)
          break
        case 'tool_use':
          toolCalls.push(toolCall(block.name, block.input, offered))
          break
        default:
          // Thinking and every other block the product may publish carry
          // nothing this seam delivers: an answer is text and tool calls.
          break
      }
    }
  }
  return { content: texts.join(''), toolCalls }
}

/**
 * Decide whether a result delivers the reply the assistant messages carry.
 *
 * A reply that calls tools ends the query at the turn bound, because the
 * product runs the call it just asked for and has no turn left to speak again.
 * That terminal is this route's normal end for a tool-calling reply; a bound
 * reached with no call is the failure {@link resultFailure} codes as
 * `MAX_TURNS`.
 * @param result - the product's result message.
 * @param messages - every assistant message the query published.
 * @returns true when the answer is the query's outcome rather than a failure.
 */
export function deliversAnswer(
  result: SDKResultMessage,
  messages: readonly SDKAssistantMessage[],
): boolean {
  if (result.subtype === 'success') return !result.is_error
  return result.subtype === 'error_max_turns'
    && messages.some(message => message.message.content.some(block => block.type === 'tool_use'))
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
 * Classify one query that carries no answer. Every code, terminal reason, and
 * message the product reported joins one detail string so the seam's shared
 * classifiers see the same evidence they see from an HTTP provider. A
 * successful query the product itself marked failed carries an API failure of
 * its own in `result` — a connection, rate, or capacity failure of the request
 * it made — so that text joins the detail and the residue is transient.
 * @param message - the product's result message.
 * @returns the seam-coded failure to throw for this query.
 */
export function resultFailure(message: SDKResultMessage): LlmError {
  const reported = message.subtype === 'success' ? [message.result] : message.errors
  const detail = [message.subtype, message.terminal_reason, message.stop_reason, ...reported]
    .filter(part => typeof part === 'string' && part.length > 0)
    .join(' ')
  const text = `llm-claude-code: the query failed: ${detail}`
  if (isContextWindowExceededError(detail)) return new LlmError(text, CONTEXT_WINDOW_EXCEEDED_CODE)
  if (isQuotaExceededError(detail)) return new LlmError(text, QUOTA_EXCEEDED_CODE)
  switch (message.subtype) {
    case 'success':
      return new LlmError(text, TRANSPORT_CODE)
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
 * @param answer - the answer read from the query's assistant messages.
 * @param usage - the product's token accounting for this query.
 * @param responseId - the result's own identity, which makes call ids unique per response.
 * @param replayState - how this step reached the installation, carried on the finish chunk.
 * @returns the chunks in protocol order.
 */
export function answerChunks(
  answer: ClaudeCodeAnswer,
  usage: NonNullableUsage,
  responseId: string,
  replayState: ClaudeCodeReplayState,
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
    replayState,
  })
  return chunks
}
