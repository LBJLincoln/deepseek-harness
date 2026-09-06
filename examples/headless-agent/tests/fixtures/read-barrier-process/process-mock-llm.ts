/**
 * Keyless adapter that plays an implementer which first tries to read the
 * validator's standard through the shell and then does the task it was given.
 * One bash call carries both, so a single transcript records what the confined
 * process could reach.
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  CallId,
  LlmAdapter,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-read-barrier'

/** What the tool result says when the confined shell could read the reserved standard. */
const LEAKED_MARKER = 'STANDARD-LEAKED'

/** What the tool result says when it could not. */
const DENIED_MARKER = 'STANDARD-DENIED'

/**
 * The one command the implementer runs: read every reserved standard the
 * barrier root holds, report which way that went, then satisfy the check.
 * The e2e pins both markers, so keep them and its literals together.
 */
function probeCommand(root: string): string {
  return `if cat ${root}/runs/*/standard.json > leaked.txt 2>/dev/null; then echo ${LEAKED_MARKER}; else echo ${DENIED_MARKER}; fi; touch MARKER`
}

class ProcessMockAdapter extends LlmAdapter {
  constructor(private readonly root: string) {
    super()
  }

  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: model }
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const last = options.messages.at(-1)
    if ((last?.content ?? []).some(block => block.type === 'tool-result')) {
      yield * reply('TASK COMPLETE')
      return
    }
    const args = JSON.stringify({
      command: probeCommand(this.root),
      description: 'Read the standard, then create MARKER.',
    })
    yield { type: 'block-start', index: 0, blockType: 'tool-call' }
    yield { type: 'tool-call-delta', index: 0, id: CallId('probe-call'), name: 'bash', argumentsDelta: args }
    yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: CallId('probe-call'), name: 'bash', arguments: args } }
    yield { type: 'usage', usage: { inputTokens: 17, outputTokens: 5 } }
    yield { type: 'finish', reason: { kind: 'tool-calls' } }
  }
}

/** One text answer as the canonical block sequence of a stopped step. */
function * reply(text: string): Generator<StreamChunk> {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text }
  yield { type: 'block-end', index: 0, block: { type: 'text', text } }
  yield { type: 'usage', usage: { inputTokens: 23, outputTokens: 2 } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

export const name = 'process-mock-llm'

/** The barrier supplies the root the scripted command targets, so nothing guesses a path. */
export const inject = ['llm', 'readBarrier']

/**
 * Register the keyless `process-mock` adapter.
 * @param ctx - the plugin context carrying the LLM runtime and the barrier.
 */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['process-mock'], new ProcessMockAdapter(ctx.readBarrier.root))
}
