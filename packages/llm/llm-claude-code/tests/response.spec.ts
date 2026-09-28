/**
 * How one product query becomes seam vocabulary: the reply read out of the
 * assistant messages, token accounting translated, and every query that
 * carries no answer classified into a provider-neutral code.
 */

import { describe, expect, it } from 'vitest'
import {
  answerChunks,
  deliversAnswer,
  isUsageLimitRefusal,
  mapUsage,
  parseAnswer,
  resultFailure,
} from '../src/response.ts'
import {
  assistantMessage,
  errorResult,
  successResult,
  textBlock,
  toolUseBlock,
  usage,
  usageLimitResult,
  USAGE_LIMIT_NOTICE,
} from './fixture.ts'

const OFFERED = new Set(['bash'])

/** 2026-09-27T17:47:00Z, the minute the recorded run hit its wall. */
const WALL_AT = Date.UTC(2026, 8, 27, 17, 47)

/** 2026-09-27T20:20:00Z, the reset the recorded notice states. */
const RESETS_AT = Date.UTC(2026, 8, 27, 20, 20)

/** A rejected five-hour window, as the installation's rate-limit event states it in unix seconds. */
const REJECTED = { status: 'rejected', rateLimitType: 'five_hour', resetsAt: RESETS_AT / 1000 } as const

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
    expect(failure.failure).not.toHaveProperty('status')
  })

  it('classifies the recorded usage-limit notice as the seam\'s quota code, carrying the stated reset as a delay', () => {
    const failure = resultFailure(usageLimitResult(), undefined, WALL_AT)
    expect(failure.code).toBe('QUOTA')
    expect(failure.message).toBe(`llm-claude-code: the query failed: success api_error stop_sequence ${USAGE_LIMIT_NOTICE}`)
    expect(failure.failure).toEqual({
      message: failure.message,
      code: 'QUOTA',
      providerRetryAfterMs: RESETS_AT - WALL_AT,
    })
  })

  it('reads the refusal and its reset from a rejected rate-limit event ahead of the notice text', () => {
    // The event's unix-second reset is later than the notice's clock time, and
    // the event wins; a result whose text names no limit at all is still the
    // refusal the event states.
    const later = RESETS_AT / 1000 + 600
    const eventFirst = resultFailure(usageLimitResult(), { ...REJECTED, resetsAt: later }, WALL_AT)
    expect(eventFirst.failure).toMatchObject({ code: 'QUOTA', providerRetryAfterMs: later * 1000 - WALL_AT })
    const textless = resultFailure(usageLimitResult({ result: 'API Error: 429', api_error_status: 429 }), REJECTED, WALL_AT)
    expect(textless.failure).toEqual({
      message: 'llm-claude-code: the query failed: success api_error stop_sequence API Error: 429',
      code: 'QUOTA',
      status: 429,
      providerRetryAfterMs: RESETS_AT - WALL_AT,
    })
    // An event that states no reset falls back to the notice's clock time, and
    // one whose reset is already behind `now` states no delay at all.
    expect(resultFailure(usageLimitResult(), { status: 'rejected' }, WALL_AT).failure.providerRetryAfterMs)
      .toBe(RESETS_AT - WALL_AT)
    expect(resultFailure(usageLimitResult({ result: 'API Error: 429' }), REJECTED, RESETS_AT).failure)
      .not.toHaveProperty('providerRetryAfterMs')
    expect(isUsageLimitRefusal({ status: 'allowed_warning' }, 'API Error: 429')).toBe(false)
  })

  it('classifies a 429 the product reports without a usage notice as a rate limit the policy repeats', () => {
    const failure = resultFailure(usageLimitResult({ result: 'API Error: 429 Too Many Requests', api_error_status: 429 }))
    expect(failure.failure).toMatchObject({ code: 'RATE_LIMIT', status: 429 })
  })

  it('carries the reported API status on a transient failure and drops one outside the HTTP range', () => {
    expect(resultFailure(usageLimitResult({ result: 'API Error: 503 upstream unavailable', api_error_status: 503 })).failure)
      .toMatchObject({ code: 'TRANSPORT', status: 503 })
    for (const status of [null, 999, 42.5]) {
      const failure = resultFailure(usageLimitResult({ result: 'API Error', api_error_status: status as never }))
      expect(failure.code).toBe('TRANSPORT')
      expect(failure.failure).not.toHaveProperty('status')
    }
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
