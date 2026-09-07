import type { Context } from '@deepseek-ai/cordis'
import {
  CallId,
  LlmAdapter,
  ReasoningEffortId,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'

const OFF = ReasoningEffortId('off')
const CATALOG_ENTRY = /^- `([a-z0-9-]+)`:/gm

/** Names published by the newest skill catalog in the request, in catalog order. */
function catalogNames(options: GenerateOptions): string[] {
  for (let index = options.messages.length - 1; index >= 0; index -= 1) {
    for (const block of options.messages[index]?.content ?? []) {
      if (block.type !== 'text' || !block.text.includes('<available_skills>')) continue
      return [...block.text.matchAll(CATALOG_ENTRY)].map(match => match[1] ?? '')
    }
  }
  return []
}

/** Keyless adapter: load one skill named by the session catalog, then report what was loaded. */
class KnowledgeMockAdapter extends LlmAdapter {
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return {
      provider,
      id: model,
      name: model,
      reasoning: { efforts: [{ id: OFF, name: 'Off' }], defaultEffort: OFF },
    }
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const toolResult = options.messages.at(-1)?.content.find(block => block.type === 'tool-result')
    if (toolResult === undefined) {
      const names = catalogNames(options)
      const name = process.env.DSH_KNOWLEDGE_SKILL ?? names[0]
      if (name === undefined) {
        const reply = 'KNOWLEDGE_PACK_CATALOG_MISSING'
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: reply }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
        yield { type: 'finish', reason: { kind: 'stop' } }
        return
      }
      const args = JSON.stringify({ name })
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: CallId('knowledge-load'), name: 'skill', argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: CallId('knowledge-load'), name: 'skill', arguments: args } }
      yield { type: 'usage', usage: { inputTokens: 13, outputTokens: 4 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }

    const text = toolResult.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
    const loaded = /<skill_content name="([^"]+)">/.exec(text)?.[1] ?? 'none'
    const heading = /^# (.+)$/m.exec(text)?.[1] ?? ''
    const reply = `KNOWLEDGE_PACK_LOADED ${loaded}: ${heading}`
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: reply }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
    yield { type: 'usage', usage: { inputTokens: 9, outputTokens: 6 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'knowledge-pack-mock-llm'
export const inject = ['llm']

/** Register the keyless `knowledge-mock` adapter. */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['knowledge-mock'], new KnowledgeMockAdapter())
}
