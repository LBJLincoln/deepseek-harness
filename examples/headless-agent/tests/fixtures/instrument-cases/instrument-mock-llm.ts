/**
 * Keyless adapter that plays an implementer whose program reverses two of the
 * five sampled words, echoes one unreversed, answers one not at all, and fails
 * the last on stderr and its exit code: one bash call, a success report, then
 * one reply to the validation follow-up.
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  CallId,
  LlmAdapter,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'

/** The candidate program: correct for `ab` and `abc`, wrong on distinct channels for the rest. */
const WRITE_SOLVER = [
  "cat > solve.sh <<'SH'",
  'case "$1" in',
  "  ab) printf 'ba\\n' ;;",
  "  abc) printf 'cba\\n' ;;",
  "  xy) printf 'xy\\n' ;;",
  "  bad) printf 'oops\\n' >&2; exit 3 ;;",
  'esac',
  'SH',
].join('\n')

class InstrumentMockAdapter extends LlmAdapter {
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: model }
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const last = options.messages.at(-1)
    const text = (last?.content ?? []).flatMap(block => (block.type === 'text' ? [block.text] : [])).join('')
    if ((last?.content ?? []).some(block => block.type === 'tool-result')) {
      yield * reply('TASK COMPLETE')
      return
    }
    if (text.includes('<validation_failed>')) {
      yield * reply('STOPPED')
      return
    }
    const args = JSON.stringify({ command: WRITE_SOLVER, description: 'Write the solver script.' })
    yield { type: 'block-start', index: 0, blockType: 'tool-call' }
    yield { type: 'tool-call-delta', index: 0, id: CallId('solver-call'), name: 'bash', argumentsDelta: args }
    yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: CallId('solver-call'), name: 'bash', arguments: args } }
    yield { type: 'usage', usage: { inputTokens: 17, outputTokens: 9 } }
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

export const name = 'instrument-mock-llm'
export const inject = ['llm']

/**
 * Register the keyless `instrument-mock` adapter.
 * @param ctx - the plugin context carrying the LLM runtime.
 */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['instrument-mock'], new InstrumentMockAdapter())
}
