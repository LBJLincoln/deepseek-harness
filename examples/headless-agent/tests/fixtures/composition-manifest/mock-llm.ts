import type { Context } from '@deepseek-ai/cordis'
import {
  LlmAdapter,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'

/**
 * Keyless adapter that answers every request with one text block and calls no
 * tool, so each turn is exactly one step and the manifest events a session
 * records are decided by composition changes alone.
 */
class ManifestMockAdapter extends LlmAdapter {
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const last = options.messages.at(-1)?.content.find(block => block.type === 'text')
    const reply = `recorded: ${last?.type === 'text' ? last.text : 'nothing'}`
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: reply }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
    yield { type: 'usage', usage: { inputTokens: 5, outputTokens: 3 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'manifest-mock-llm'
export const inject = ['llm']

/**
 * Register the keyless `manifest-mock` adapter.
 * @param ctx - plugin context carrying the LLM runtime.
 */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['manifest-mock'], new ManifestMockAdapter())
}
