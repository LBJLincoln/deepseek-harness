/**
 * Keyless adapter that plays an agent writing and mounting its own package: one
 * `cordis_define` call, one `cordis_run` call over the identity that define
 * returned, then a report. The package it writes is the synthesized code the
 * composition manifest has to name.
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  CallId,
  LlmAdapter,
  type ContentBlock,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'

/** The Host half this agent writes: a plain function body returning a Cordis Plugin. */
const HOST_CODE = `
  return {
    name: 'quarantine-probe',
    apply(ctx) {
      ctx.provide('quarantineProbe', { ok: true })
    },
  }
`

/** The define receipt's rendered line, which is where the ids reach the model. */
const DEFINED = /Defined (\S+)\/(\S+) \(/

class QuarantineMockAdapter extends LlmAdapter {
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const results = options.messages.flatMap(message => message.content.filter(block => block.type === 'tool-result'))
    const defined = DEFINED.exec(resultText(results))
    if (defined === null) {
      yield * call('define-call', 'cordis_define', {
        plugin: { kind: 'new', idPrefix: 'quar' },
        name: 'quarantine-probe',
        purpose: 'Prove that a session can mount code it wrote itself.',
        code: { host: HOST_CODE },
      })
      return
    }
    if (results.length === 1) {
      yield * call('run-call', 'cordis_run', {
        pluginId: defined[1],
        packageId: defined[2],
        mode: 'run',
      })
      return
    }
    yield * reply('mounted')
  }
}

/** Every text fragment of the tool results seen so far, in order. */
function resultText(results: readonly ContentBlock[]): string {
  return results
    .flatMap(block => block.type === 'tool-result' ? block.content : [])
    .flatMap(block => block.type === 'text' ? [block.text] : [])
    .join('\n')
}

/** One tool call as the canonical block sequence of a dispatching step. */
function * call(id: string, name: string, args: unknown): Generator<StreamChunk> {
  const callId = CallId(id)
  const encoded = JSON.stringify(args)
  yield { type: 'block-start', index: 0, blockType: 'tool-call' }
  yield { type: 'tool-call-delta', index: 0, id: callId, name, argumentsDelta: encoded }
  yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: callId, name, arguments: encoded } }
  yield { type: 'usage', usage: { inputTokens: 11, outputTokens: 6 } }
  yield { type: 'finish', reason: { kind: 'tool-calls' } }
}

/** One text answer as the canonical block sequence of a stopped step. */
function * reply(text: string): Generator<StreamChunk> {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text }
  yield { type: 'block-end', index: 0, block: { type: 'text', text } }
  yield { type: 'usage', usage: { inputTokens: 15, outputTokens: 2 } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

export const name = 'quarantine-mock-llm'
export const inject = ['llm']

/**
 * Register the keyless `quarantine-mock` adapter.
 * @param ctx - plugin context carrying the LLM runtime.
 */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['quarantine-mock'], new QuarantineMockAdapter())
}
