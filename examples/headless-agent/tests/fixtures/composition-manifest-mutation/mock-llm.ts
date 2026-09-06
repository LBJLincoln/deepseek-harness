/**
 * Keyless adapter that calls the `skill` tool exactly once, on the session's
 * first step, and answers with text everywhere else — so the one skill
 * generation in play afterwards is whatever the composition itself re-addresses
 * it to, never a second load.
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  CallId,
  LlmAdapter,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'

/** The skill this composition puts in play, named by every turn's prompt. */
const SKILL = 'manifest-demo'

class MutationMockAdapter extends LlmAdapter {
  private loaded = false

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }

  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (this.loaded) {
      yield * reply('answered')
      return
    }
    this.loaded = true
    const callId = CallId('skill-call-1')
    const args = JSON.stringify({ name: SKILL })
    yield { type: 'block-start', index: 0, blockType: 'tool-call' }
    yield { type: 'tool-call-delta', index: 0, id: callId, name: 'skill', argumentsDelta: args }
    yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: callId, name: 'skill', arguments: args } }
    yield { type: 'usage', usage: { inputTokens: 7, outputTokens: 4 } }
    yield { type: 'finish', reason: { kind: 'tool-calls' } }
  }
}

/** One text answer as the canonical block sequence of a stopped step. */
function * reply(text: string): Generator<StreamChunk> {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text }
  yield { type: 'block-end', index: 0, block: { type: 'text', text } }
  yield { type: 'usage', usage: { inputTokens: 9, outputTokens: 2 } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

export const name = 'mutation-mock-llm'
export const inject = ['llm']

/**
 * Register the keyless `mutation-mock` adapter.
 * @param ctx - plugin context carrying the LLM runtime.
 */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['mutation-mock'], new MutationMockAdapter())
}
