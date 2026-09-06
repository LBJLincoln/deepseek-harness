/**
 * Keyless adapter serving both routes of the blind-judge scenario: an
 * implementer that reports without changing anything, and a judge that upholds
 * the attempt's recorded outcome. The two are told apart by the provider route
 * alone, which is what proves the judge's turn is a separate model request.
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  LlmAdapter,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'

/** Provider route the environment runner drives the implementer on. */
export const IMPLEMENTER_PROVIDER = 'implementer-mock'

/** Provider route the judge session is created on. */
export const JUDGE_PROVIDER = 'judge-mock'

/** What the implementer reports without touching the workspace. */
const IMPLEMENTER_REPLY = 'SPEC.txt is already there. I have no tool to write MARKER, so I am reporting instead.'

/** What the judge answers from the evidence alone. */
const JUDGE_REPLY = 'verdict: upheld\nOne of the two checks failed and no certificate was issued, which is the outcome the attempt recorded.'

class BlindJudgeMockAdapter extends LlmAdapter {
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: model }
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield * reply(options.provider === JUDGE_PROVIDER ? JUDGE_REPLY : IMPLEMENTER_REPLY)
  }
}

/** One text answer as the canonical block sequence of a stopped step. */
function * reply(text: string): Generator<StreamChunk> {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text }
  yield { type: 'block-end', index: 0, block: { type: 'text', text } }
  yield { type: 'usage', usage: { inputTokens: 19, outputTokens: 7 } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

export const name = 'judge-mock-llm'
export const inject = ['llm']

/**
 * Register the keyless implementer and judge adapters.
 * @param ctx - the plugin context carrying the LLM runtime.
 */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter([IMPLEMENTER_PROVIDER, JUDGE_PROVIDER], new BlindJudgeMockAdapter())
}
