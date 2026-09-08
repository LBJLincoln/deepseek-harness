/**
 * Which product session holds a request's conversation prefix: the key that
 * separates one conversation from another, the digest that decides whether a
 * record still applies, and the bounded table whose eviction is what releases
 * a transcript the route created.
 */

import { describe, expect, it, vi } from 'vitest'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  continuityKey,
  conversationDigest,
  planContinuity,
  ProductSessionTable,
  resumeRefusal,
} from '../src/continuity.ts'
import { renderConversation } from '../src/render.ts'
import type { ProductSessionRecord } from '../src/types.ts'
import { BASH_TOOL, request } from './fixture.ts'

/** A conversation of `rounds` completed exchanges, newest user turn last. */
function history(rounds: number, tail = 'next'): Message[] {
  const messages: Message[] = [
    createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'start' }] }),
  ]
  for (let round = 0; round < rounds; round += 1) {
    messages.push(createAssistantMessage({
      source: { provider: 'claude-code', model: 'default' },
      content: [{ type: 'text', text: `answer ${round}` }],
    }))
    messages.push(createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: `${tail} ${round}` }],
    }))
  }
  return messages
}

/** A request over the default route carrying a harness session identity. */
function sessioned(overrides: Partial<GenerateOptions> = {}): GenerateOptions {
  return request({ sessionId: SessionId('sess-1'), ...overrides })
}

/** The record a route holds after sending a request of `held` messages. */
function record(options: GenerateOptions, held: number, productSessionId = 'p1'): ProductSessionRecord {
  return {
    productSessionId,
    heldMessages: held,
    digest: conversationDigest(options, renderConversation(options), held),
  }
}

/** A table with a release spy, so eviction and retirement are observable. */
function table(limit = 4): { instance: ProductSessionTable; released: string[] } {
  const released: string[] = []
  return { instance: new ProductSessionTable(limit, (id) => { released.push(id) }), released }
}

describe('continuityKey', () => {
  it('separates a conversation from an auxiliary call on the same harness session', () => {
    expect(continuityKey(sessioned())).toBe('sess-1\u0000')
    expect(continuityKey(sessioned({ purpose: 'compaction' }))).toBe('sess-1\u0000compaction')
  })

  it('has no key for a request that carries no session identity', () => {
    expect(continuityKey(request())).toBeUndefined()
  })
})

describe('conversationDigest', () => {
  it('moves when the system prompt, the offered tools, or the model move', () => {
    const base = sessioned({ messages: history(1) })
    const digest = (options: GenerateOptions): string =>
      conversationDigest(options, renderConversation(options), 1)

    expect(digest({ ...base, system: 'a different prompt' })).not.toBe(digest(base))
    expect(digest({ ...base, tools: [BASH_TOOL] })).not.toBe(digest(base))
    expect(digest({ ...base, model: 'default', messages: history(1, 'other') })).toBe(digest(base))
  })

  it('covers only the messages the product session holds', () => {
    const shorter = sessioned({ messages: history(1) })
    const longer = sessioned({ messages: history(2) })

    expect(conversationDigest(longer, renderConversation(longer), 1))
      .toBe(conversationDigest(shorter, renderConversation(shorter), 1))
  })
})

describe('resumeRefusal', () => {
  it('accepts a request that only grew past the prefix the record names', () => {
    const first = sessioned({ messages: history(0) })
    const second = sessioned({ messages: history(1) })

    expect(resumeRefusal(second, renderConversation(second), record(first, 1))).toBeUndefined()
  })

  it('refuses a history that no longer reaches past the record', () => {
    const first = sessioned({ messages: history(1) })
    expect(resumeRefusal(first, renderConversation(first), record(first, 3))).toBe('history-rewound')
  })

  it('refuses a history whose next message is not the product\'s own answer', () => {
    const options = sessioned({ messages: [...history(0), ...history(0)] })
    expect(resumeRefusal(options, renderConversation(options), record(options, 1))).toBe('answer-missing')
  })

  it('refuses a tail carrying an assistant message the product session never wrote', () => {
    const options = sessioned({ messages: history(2) })
    expect(resumeRefusal(options, renderConversation(options), record(options, 1))).toBe('answer-missing')
  })

  it('refuses a prefix whose content moved', () => {
    const sent = sessioned({ messages: history(0) })
    const edited = sessioned({
      messages: [
        createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'summary' }] }),
        ...history(1).slice(1),
      ],
    })

    expect(resumeRefusal(edited, renderConversation(edited), record(sent, 1))).toBe('prefix-changed')
  })
})

describe('ProductSessionTable', () => {
  it('reports what one conversation holds without disturbing recency', () => {
    const { instance } = table()
    const entry = record(sessioned({ messages: history(0) }), 1)
    instance.set('a', entry)

    expect(instance.get('a')).toEqual(entry)
    expect(instance.get('b')).toBeUndefined()
    expect(instance.size).toBe(1)
  })

  it('releases the transcript of a session a conversation replaced', () => {
    const { instance, released } = table()
    const entry = record(sessioned({ messages: history(0) }), 1)
    instance.set('a', entry)
    instance.set('a', { ...entry, productSessionId: 'p2' })

    expect(released).toEqual(['p1'])
    expect(instance.get('a')?.productSessionId).toBe('p2')
  })

  it('keeps a re-recorded session without releasing it', () => {
    const { instance, released } = table()
    const entry = record(sessioned({ messages: history(0) }), 1)
    instance.set('a', entry)
    instance.set('a', { ...entry, heldMessages: 3 })

    expect(released).toEqual([])
  })

  it('evicts the least recently used conversation when the bound is reached', () => {
    const { instance, released } = table(2)
    const entry = record(sessioned({ messages: history(0) }), 1)
    instance.set('a', { ...entry, productSessionId: 'pa' })
    instance.set('b', { ...entry, productSessionId: 'pb' })
    instance.set('a', { ...entry, productSessionId: 'pa' })
    instance.set('c', { ...entry, productSessionId: 'pc' })

    expect(released).toEqual(['pb'])
    expect(instance.get('b')).toBeUndefined()
    expect(instance.size).toBe(2)
  })

  it('retires one conversation and clears every one', () => {
    const { instance, released } = table()
    const entry = record(sessioned({ messages: history(0) }), 1)
    instance.set('a', { ...entry, productSessionId: 'pa' })
    instance.set('b', { ...entry, productSessionId: 'pb' })

    instance.retire('missing')
    instance.retire('a')
    expect(released).toEqual(['pa'])

    instance.clear()
    expect(released).toEqual(['pa', 'pb'])
    expect(instance.size).toBe(0)
  })
})

describe('planContinuity', () => {
  it('sends the whole conversation and persists nothing under per-query', () => {
    const { instance } = table()
    const options = sessioned({ messages: history(1) })
    const plan = planContinuity('per-query', options, renderConversation(options), instance)

    expect(plan).toMatchObject({ kind: 'fresh', fallback: undefined, continuable: false })
    expect(plan.rendered.prompt).toContain('Answer the last turn of the conversation below.')
    expect(instance.size).toBe(0)
  })

  it('starts a continuable session for a conversation it holds nothing for', () => {
    const { instance } = table()
    const options = sessioned({ messages: history(0) })
    const plan = planContinuity('per-session', options, renderConversation(options), instance)

    expect(plan).toMatchObject({ kind: 'fresh', fallback: 'no-record', continuable: true })
  })

  it('refuses to continue a request with no session identity', () => {
    const { instance } = table()
    const options = request({ messages: history(0) })
    const plan = planContinuity('per-session', options, renderConversation(options), instance)

    expect(plan).toMatchObject({ kind: 'fresh', fallback: 'no-session-id', continuable: false })
  })

  it('resumes with the tail that follows the product\'s own answer', () => {
    const { instance } = table()
    const first = sessioned({ messages: history(0) })
    instance.set(continuityKey(first) ?? '', record(first, 1))
    const second = sessioned({ messages: history(1) })
    const plan = planContinuity('per-session', second, renderConversation(second), instance)

    expect(plan).toMatchObject({ kind: 'resumed', productSessionId: 'p1' })
    expect(plan.rendered.prompt).toBe('<dsh-user>\nnext 0\n</dsh-user>\n')
  })

  it('retires the record and its transcript when the prefix no longer matches', () => {
    const { instance, released } = table()
    const sent = sessioned({ messages: history(0) })
    instance.set(continuityKey(sent) ?? '', record(sent, 1))
    const edited = sessioned({
      messages: [
        createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'summary' }] }),
        ...history(1).slice(1),
      ],
    })
    const plan = planContinuity('per-session', edited, renderConversation(edited), instance)

    expect(plan).toMatchObject({ kind: 'fresh', fallback: 'prefix-changed', continuable: true })
    expect(released).toEqual(['p1'])
    expect(instance.size).toBe(0)
  })

  it('mints a distinct product session for every fresh plan', () => {
    const { instance } = table()
    const options = sessioned({ messages: history(0) })
    const rendering = renderConversation(options)
    const first = planContinuity('per-query', options, rendering, instance)
    const second = planContinuity('per-query', options, rendering, instance)

    expect(first.productSessionId).not.toBe(second.productSessionId)
  })
})

describe('release failures', () => {
  it('lets a release that throws reach its owner rather than the table', () => {
    const instance = new ProductSessionTable(1, vi.fn(() => { throw new Error('store refused') }))
    instance.set('a', record(sessioned({ messages: history(0) }), 1))
    expect(() => { instance.clear() }).toThrow('store refused')
  })
})
