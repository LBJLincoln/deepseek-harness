import type { Context } from '@deepseek-ai/cordis'
import {
  LlmAdapter,
  ReasoningEffortId,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'

const HIGH = ReasoningEffortId('high')

/**
 * The scripted transcript of the curator e2e: one answer carrying a fake
 * address and a fake key, so the export has something the shipped rules must
 * catch. Both strings are reserved-for-testing forms that address nothing.
 */
export const FIXTURE_ANSWER = 'Round trip done. Ask nobody@example.invalid, key sk-test-0000, before publishing.'

/** Keyless adapter that answers once with the fixture's fake credentials. */
class CuratorMockAdapter extends LlmAdapter {
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return {
      provider,
      id: model,
      name: model,
      reasoning: { efforts: [{ id: HIGH, name: 'High' }], defaultEffort: HIGH },
    }
  }

  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: FIXTURE_ANSWER }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: FIXTURE_ANSWER } }
    yield { type: 'usage', usage: { inputTokens: 9, outputTokens: 7 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'curator-mock-llm'
export const inject = ['llm']

/** Register the keyless `cli-mock` adapter this fixture's runner drives. */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['cli-mock'], new CuratorMockAdapter())
}
