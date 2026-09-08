/**
 * How one product query becomes seam vocabulary: the reply read out of the
 * assistant messages, token accounting translated, and every query that
 * carries no answer classified into a provider-neutral code.
 */

import { describe, expect, it } from 'vitest'
import { answerChunks, deliversAnswer, mapUsage, parseAnswer, resultFailure } from '../src/response.ts'
import {
  assistantMessage,
  errorResult,
  successResult,
  textBlock,
  toolUseBlock,
  usage,
} from './fixture.ts'

const OFFERED = new Set(['bash'])

/** The continuity record a step that started its own product session carries. */
const FRESH_STATE = { continuity: 'fresh', productSessionId: 'p1' } as const

describe('parseAnswer', () => {
  it('joins text across messages and keeps the calls in published order', () => {
    expect(parseAnswer([
      assistantMessage(textBlock('listing '), textBlock('them')),
      assistantMessage(toolUseBlock('mcp__dsh__bash', { command: 'ls' })),
      assistantMessage(toolUseBlock('mcp__dsh__bash', { command: 'pwd' })),
    ], OFFERED)).toEqual({
      content: 'listing them',
      toolCalls: [
        { name: 'bash', arguments: '{"command":"ls"}' },
        { name: 'bash', arguments: '{"command":"pwd"}' },
      ],
    })
  })

  it('accepts the bare harness name a reply sometimes calls, and ignores thinking', () => {
    expect(parseAnswer([
      assistantMessage({ type: 'thinking', thinking: 'weighing it up' }),
      assistantMessage(toolUseBlock('bash', { command: 'ls' })),
    ], OFFERED)).toEqual({
      content: '',
      toolCalls: [{ name: 'bash', arguments: '{"command":"ls"}' }],
    })
  })

  it('refuses a call to a tool the request did not offer', () => {
    expect(() => parseAnswer([assistantMessage(toolUseBlock('mcp__dsh__rm', {}))], OFFERED))
      .toThrow(expect.objectContaining({ code: 'MALFORMED_RESPONSE' }))
  })

  it.each([
    ['a JSON string', '{"command":"ls"}'],
    ['an array', []],
    ['nothing at all', undefined],
  ])('refuses arguments that crossed as %s', (_case, input) => {
    expect(() => parseAnswer([assistantMessage(toolUseBlock('bash', input))], OFFERED))
      .toThrow(expect.objectContaining({ code: 'MALFORMED_RESPONSE' }))
  })
})

describe('deliversAnswer', () => {
  it('delivers a successful query and a turn bound the reply\'s call ended', () => {
    expect(deliversAnswer(successResult(), [assistantMessage(textBlock('hi'))])).toBe(true)
    expect(deliversAnswer(errorResult('error_max_turns'), [
      assistantMessage(toolUseBlock('mcp__dsh__bash', { command: 'ls' })),
    ])).toBe(true)
  })

  it('withholds a turn bound with no call, a product API failure, and every other subtype', () => {
    expect(deliversAnswer(errorResult('error_max_turns'), [assistantMessage(textBlock('hi'))])).toBe(false)
    expect(deliversAnswer(successResult({ is_error: true }), [assistantMessage(textBlock('hi'))])).toBe(false)
    expect(deliversAnswer(errorResult('error_during_execution'), [
      assistantMessage(toolUseBlock('mcp__dsh__bash', { command: 'ls' })),
    ])).toBe(false)
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

  it('classifies a success result the product itself marked failed as transient', () => {
    const result = successResult({
      is_error: true,
      result: 'API Error: Unable to connect to API: Self-signed certificate detected',
    })
    const failure = resultFailure(result)
    expect(failure.code).toBe('TRANSPORT')
    expect(failure.message).toContain('Self-signed certificate detected')
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
      FRESH_STATE,
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
      { type: 'finish', reason: { kind: 'tool-calls' }, replayState: FRESH_STATE },
    ])
  })

  it('finishes a text-only answer with a plain stop', () => {
    const chunks = answerChunks({ content: 'hello', toolCalls: [] }, usage(), 'r8', FRESH_STATE)
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' }, replayState: FRESH_STATE })
    expect(chunks.filter(chunk => chunk.type === 'block-start')).toHaveLength(1)
  })

  it('opens no text block for a turn that is tool calls alone', () => {
    const chunks = answerChunks(
      { content: '', toolCalls: [{ name: 'bash', arguments: '{}' }] },
      usage(),
      'r9',
      FRESH_STATE,
    )
    expect(chunks[0]).toEqual({ type: 'block-start', index: 0, blockType: 'tool-call' })
  })

  it('refuses a completion that carried nothing at all', () => {
    expect(() => answerChunks({ content: '', toolCalls: [] }, usage(), 'r0', FRESH_STATE))
      .toThrow(expect.objectContaining({ code: 'EMPTY_RESPONSE' }))
  })
})
