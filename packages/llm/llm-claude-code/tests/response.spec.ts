/**
 * How one product result becomes seam vocabulary: the structured answer parsed
 * into chunks, token accounting translated, and every failed query classified
 * into a provider-neutral code.
 */

import { describe, expect, it } from 'vitest'
import { answerChunks, mapUsage, parseAnswer, resultFailure } from '../src/response.ts'
import { errorResult, successResult, usage } from './fixture.ts'

describe('parseAnswer', () => {
  it('accepts arguments as the JSON string the schema asks for', () => {
    expect(parseAnswer({
      content: 'listing them',
      toolCalls: [{ name: 'bash', arguments: '{"command":"ls"}' }],
    })).toEqual({
      content: 'listing them',
      toolCalls: [{ name: 'bash', arguments: '{"command":"ls"}' }],
    })
  })

  it('accepts arguments the product passed through as a JSON object', () => {
    expect(parseAnswer({ content: '', toolCalls: [{ name: 'bash', arguments: { command: 'ls' } }] }))
      .toEqual({ content: '', toolCalls: [{ name: 'bash', arguments: '{"command":"ls"}' }] })
  })

  it.each([
    ['no structured answer at all', undefined],
    ['a primitive', 'answer'],
    ['an array', []],
    ['a missing content field', { toolCalls: [] }],
    ['a non-array toolCalls field', { content: 'hi', toolCalls: {} }],
    ['a non-object tool call', { content: '', toolCalls: ['bash'] }],
    ['a tool call without a name', { content: '', toolCalls: [{ arguments: '{}' }] }],
    ['tool-call arguments of the wrong type', { content: '', toolCalls: [{ name: 'bash', arguments: 7 }] }],
  ])('refuses %s as a provider failure', (_case, structured) => {
    expect(() => parseAnswer(structured)).toThrow(expect.objectContaining({ code: 'MALFORMED_RESPONSE' }))
  })
})

describe('mapUsage', () => {
  it('keeps the product\'s already-disjoint counters', () => {
    expect(mapUsage(usage())).toEqual({
      inputTokens: 11,
      outputTokens: 7,
      cacheReadTokens: 3,
      cacheWriteTokens: 2,
    })
  })

  it('omits cache fields the product did not report and floors absent counters', () => {
    expect(mapUsage(usage({
      input_tokens: undefined,
      output_tokens: 4,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: undefined,
    } as never))).toEqual({ inputTokens: 0, outputTokens: 4 })
  })
})

describe('resultFailure', () => {
  it.each([
    ['error_max_turns', 'MAX_TURNS'],
    ['error_max_budget_usd', 'QUOTA'],
    ['error_max_structured_output_retries', 'MALFORMED_RESPONSE'],
    ['error_during_execution', 'PRODUCT_ERROR'],
  ] as const)('maps %s to %s', (subtype, code) => {
    expect(resultFailure(errorResult(subtype))).toMatchObject({ code })
  })

  it('classifies a success result the product itself marked failed', () => {
    const result = successResult({ content: '', toolCalls: [] }, { is_error: true })
    expect(resultFailure(result)).toMatchObject({ code: 'PRODUCT_ERROR' })
  })

  it('recognizes context overflow and quota exhaustion in the reported detail', () => {
    expect(resultFailure(errorResult('error_during_execution', [
      'prompt is too long for the model context window',
    ]))).toMatchObject({ code: 'CONTEXT_WINDOW_EXCEEDED' })
    expect(resultFailure(errorResult('error_during_execution', [
      'insufficient quota for this organization',
    ]))).toMatchObject({ code: 'QUOTA' })
  })

  it('names the subtype, terminal reason, and stop reason in its message', () => {
    const result = errorResult('error_during_execution', ['upstream unavailable'], {
      terminal_reason: 'api_error',
      stop_reason: 'refusal',
    })
    expect(resultFailure(result).message)
      .toBe('llm-claude-code: the query failed: error_during_execution api_error refusal upstream unavailable')
  })
})

describe('answerChunks', () => {
  it('emits the text block, one block per tool call, then usage and the finish', () => {
    const chunks = answerChunks(
      { content: 'done', toolCalls: [{ name: 'bash', arguments: '{"command":"ls"}' }] },
      usage(),
      'r7',
    )

    expect(chunks).toEqual([
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'done' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'done' } },
      { type: 'block-start', index: 1, blockType: 'tool-call' },
      {
        type: 'tool-call-delta',
        index: 1,
        id: 'r7-0',
        name: 'bash',
        argumentsDelta: '{"command":"ls"}',
      },
      {
        type: 'block-end',
        index: 1,
        block: { type: 'tool-call', id: 'r7-0', name: 'bash', arguments: '{"command":"ls"}' },
      },
      { type: 'usage', usage: { inputTokens: 11, outputTokens: 7, cacheReadTokens: 3, cacheWriteTokens: 2 } },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ])
  })

  it('finishes a text-only answer with a plain stop', () => {
    const chunks = answerChunks({ content: 'hello', toolCalls: [] }, usage(), 'r8')
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } })
    expect(chunks.filter(chunk => chunk.type === 'block-start')).toHaveLength(1)
  })

  it('opens no text block for a turn that is tool calls alone', () => {
    const chunks = answerChunks(
      { content: '', toolCalls: [{ name: 'bash', arguments: '{}' }] },
      usage(),
      'r9',
    )
    expect(chunks[0]).toEqual({ type: 'block-start', index: 0, blockType: 'tool-call' })
  })

  it('refuses a completion that carried nothing at all', () => {
    expect(() => answerChunks({ content: '', toolCalls: [] }, usage(), 'r0'))
      .toThrow(expect.objectContaining({ code: 'EMPTY_RESPONSE' }))
  })
})
