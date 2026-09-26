/**
 * Keyless adapter that plays an implementer whose first turn misspells the
 * specified line and whose self-review turn corrects it: one bash call and a
 * completion report for the task, then one bash call and a report for the
 * `<self_review>` block. The scenario's model script is this adapter, so the
 * fixture composition is the keyless one and needs no replay counterpart.
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  CallId,
  LlmAdapter,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'

/** The first write, one letter short of the specified line. */
const WRITE_MISSPELLED = "printf 'redy\\n' > MARKER"

/** The correction the review turn makes after re-reading the specification. */
const WRITE_SPECIFIED = "printf 'ready\\n' > MARKER"

/** Every text block of one message, joined. */
function textOf(message: GenerateOptions['messages'][number] | undefined): string {
  return (message?.content ?? []).flatMap(block => (block.type === 'text' ? [block.text] : [])).join('')
}

class ReviewMockAdapter extends LlmAdapter {
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: model }
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const last = options.messages.at(-1)
    const reviewing = options.messages.some(message => textOf(message).includes('<self_review>'))
    if ((last?.content ?? []).some(block => block.type === 'tool-result')) {
      yield * reply(reviewing ? 'REVIEWED: MARKER now holds the specified line.' : 'TASK COMPLETE')
      return
    }
    const command = reviewing ? WRITE_SPECIFIED : WRITE_MISSPELLED
    const description = reviewing ? 'Correct MARKER to the specified line.' : 'Write MARKER.'
    const id = CallId(reviewing ? 'review-call' : 'write-call')
    const args = JSON.stringify({ command, description })
    yield { type: 'block-start', index: 0, blockType: 'tool-call' }
    yield { type: 'tool-call-delta', index: 0, id, name: 'bash', argumentsDelta: args }
    yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'bash', arguments: args } }
    yield { type: 'usage', usage: { inputTokens: 19, outputTokens: 7 } }
    yield { type: 'finish', reason: { kind: 'tool-calls' } }
  }
}

/** One text answer as the canonical block sequence of a stopped step. */
function * reply(text: string): Generator<StreamChunk> {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text }
  yield { type: 'block-end', index: 0, block: { type: 'text', text } }
  yield { type: 'usage', usage: { inputTokens: 29, outputTokens: 4 } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

export const name = 'review-mock-llm'
export const inject = ['llm']

/**
 * Register the keyless `review-mock` adapter.
 * @param ctx - the plugin context carrying the LLM runtime.
 */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['review-mock'], new ReviewMockAdapter())
}
