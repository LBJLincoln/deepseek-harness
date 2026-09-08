/**
 * Which product session, if any, already holds a request's conversation prefix.
 *
 * A step that resumes sends only the newest turn, so the installation reads the
 * prefix from its prompt cache instead of being sent it again. That is only
 * correct while the product session holds exactly the conversation the harness
 * log holds, so every step recomputes a digest over everything the route sent
 * for the recorded prefix and compares it with the digest recorded when that
 * prefix was sent. Compaction, a spliced message, and a rewound retry all
 * change what the request carries, so all three fail the comparison and run a
 * fresh query.
 *
 * @module @deepseek-ai/dsh-llm-claude-code/continuity
 */

import { createHash, randomUUID } from 'node:crypto'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import type {
  ContinuityFallback,
  ContinuityPlan,
  ConversationRendering,
  ProductSessionRecord,
  SessionContinuity,
} from './types.ts'

/** Separator between digest parts; no rendered element can contain it. */
const PART_SEPARATOR = '\u0000'

/**
 * Identify the harness conversation a product session continues.
 *
 * An auxiliary call is a conversation of its own: a compaction or session-title
 * request carries the harness session it belongs to but not its messages, so
 * the purpose joins the key rather than sharing the conversation's session.
 * @param options - the harness request.
 * @returns the key, or `undefined` for a request that carries no session identity.
 */
export function continuityKey(options: GenerateOptions): string | undefined {
  if (options.sessionId === undefined) return undefined
  return `${String(options.sessionId)}${PART_SEPARATOR}${options.purpose ?? ''}`
}

/**
 * Digest everything the route sent for the first `count` messages of a request.
 *
 * The system prompt, the offered tool definitions, and the selected model join
 * the messages because all three reach the model and all three are fixed for
 * the product session once its first query has run.
 * @param options - the harness request.
 * @param rendering - that request rendered under its chosen tag prefix.
 * @param count - messages the product session holds the prompt for.
 * @returns a hex digest of the complete prefix.
 */
export function conversationDigest(
  options: GenerateOptions,
  rendering: ConversationRendering,
  count: number,
): string {
  const tools = (options.tools ?? []).map(tool => JSON.stringify(tool)).join(PART_SEPARATOR)
  return createHash('sha256')
    .update([rendering.systemPrompt, tools, options.model, rendering.prefix(count)].join(PART_SEPARATOR))
    .digest('hex')
}

/**
 * Decide whether a record still describes the request's own conversation.
 *
 * The record names how many messages' prompt the product session holds; the
 * product's answer to that prompt is the message at exactly that index, and
 * everything after it is the turn this step must send. A request that is
 * shorter than the record, that does not carry the product's answer where the
 * record puts it, that carries a further assistant message the product did not
 * write, or whose prefix digest moved is a conversation the product session
 * does not hold.
 * @param options - the harness request.
 * @param rendering - that request rendered under its chosen tag prefix.
 * @param record - what the product session held when this route last sent to it.
 * @returns the reason the record does not apply, or `undefined` when it does.
 */
export function resumeRefusal(
  options: GenerateOptions,
  rendering: ConversationRendering,
  record: ProductSessionRecord,
): ContinuityFallback | undefined {
  if (options.messages.length <= record.heldMessages) return 'history-rewound'
  const answer = options.messages[record.heldMessages]
  if (answer?.role !== 'assistant') return 'answer-missing'
  if (options.messages.slice(record.heldMessages + 1).some(message => message.role === 'assistant')) {
    return 'answer-missing'
  }
  if (conversationDigest(options, rendering, record.heldMessages) !== record.digest) return 'prefix-changed'
  return undefined
}

/** Release one product session's transcript from the installation's store. */
export type TranscriptRelease = (productSessionId: string) => void

/**
 * The product sessions this route keeps resumable, newest use last.
 *
 * Bounded because each entry owns a transcript on disk under the operator's
 * configuration directory: evicting the least recently used entry is what
 * releases that transcript, so the bound is the route's cleanup policy for a
 * harness process whose sessions never end.
 */
export class ProductSessionTable {
  private readonly entries = new Map<string, ProductSessionRecord>()

  /**
   * @param limit - product sessions kept resumable at once.
   * @param release - releases the transcript of a session leaving the table.
   */
  constructor(private readonly limit: number, private readonly release: TranscriptRelease) {}

  /** Product sessions currently resumable. */
  get size(): number {
    return this.entries.size
  }

  /**
   * Read one conversation's record without changing its recency.
   * @param key - the conversation's continuity key.
   * @returns the record, or `undefined` when the route holds no session for it.
   */
  get(key: string): ProductSessionRecord | undefined {
    return this.entries.get(key)
  }

  /**
   * Record what a product session holds after a step sent to it, evicting the
   * least recently used entry when the table is full.
   * @param key - the conversation's continuity key.
   * @param record - what that conversation's product session now holds.
   */
  set(key: string, record: ProductSessionRecord): void {
    const previous = this.entries.get(key)
    if (previous !== undefined && previous.productSessionId !== record.productSessionId) {
      this.release(previous.productSessionId)
    }
    // Re-inserting moves the key to the end, which is what makes the first
    // key of the iteration the least recently used one.
    this.entries.delete(key)
    this.entries.set(key, record)
    while (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next()
      /* v8 ignore next -- a map larger than a positive limit always has a first key. */
      if (oldest.done === true) break
      this.retire(oldest.value)
    }
  }

  /**
   * Drop one conversation's record and release its transcript.
   * @param key - the conversation's continuity key.
   */
  retire(key: string): void {
    const record = this.entries.get(key)
    if (record === undefined) return
    this.entries.delete(key)
    this.release(record.productSessionId)
  }

  /** Drop every record and release every transcript the route created. */
  clear(): void {
    for (const key of [...this.entries.keys()]) this.retire(key)
  }
}

/**
 * Plan how one request reaches the installation.
 *
 * A `per-query` route never resumes and never persists, which is the behavior
 * of a route that keeps no product session at all. A `per-session` route
 * resumes when a record still describes this request's own conversation, and
 * otherwise sends the whole conversation to a new product session and names
 * why in the plan.
 * @param mode - the route's configured continuity.
 * @param options - the harness request.
 * @param rendering - that request rendered under its chosen tag prefix.
 * @param table - the product sessions this route keeps resumable.
 * @returns the query's product session, prompt, and persistence for this step.
 */
export function planContinuity(
  mode: SessionContinuity,
  options: GenerateOptions,
  rendering: ConversationRendering,
  table: ProductSessionTable,
): ContinuityPlan {
  const whole = { systemPrompt: rendering.systemPrompt, prompt: rendering.whole }
  if (mode === 'per-query') {
    return { kind: 'fresh', productSessionId: randomUUID(), fallback: undefined, continuable: false, rendered: whole }
  }
  const key = continuityKey(options)
  const fresh = (fallback: ContinuityFallback): ContinuityPlan => {
    if (key !== undefined) table.retire(key)
    return {
      kind: 'fresh',
      productSessionId: randomUUID(),
      fallback,
      continuable: key !== undefined,
      rendered: whole,
    }
  }
  if (key === undefined) return fresh('no-session-id')
  const record = table.get(key)
  if (record === undefined) return fresh('no-record')
  const refusal = resumeRefusal(options, rendering, record)
  if (refusal !== undefined) return fresh(refusal)
  return {
    kind: 'resumed',
    productSessionId: record.productSessionId,
    rendered: {
      systemPrompt: rendering.systemPrompt,
      // The product session holds the prompt for `heldMessages` messages and
      // its own answer at that index; this step sends everything after it.
      prompt: rendering.continuation(record.heldMessages + 1),
    },
  }
}
