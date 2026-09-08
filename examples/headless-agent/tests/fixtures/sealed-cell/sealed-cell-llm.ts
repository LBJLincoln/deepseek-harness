/**
 * Keyless adapter that plays a cell agent probing the run directory its
 * workspace sits in. Its first step runs one bash command that tries to list the
 * parent, read the run's plan, and read a sibling cell, then reads and writes
 * its own workspace; its second step reads the plan again through the `read`
 * tool, which is the seam that records a refusal. The markers below are pinned
 * by the e2e, so keep them and its literals together.
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  CallId,
  LlmAdapter,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'

/**
 * Prefix of the line carrying what the confined shell listed in the parent
 * directory, one space-separated entry each. The names, not the count, are what
 * the e2e reads: a backend that refuses the listing outright and one that mounts
 * an empty directory with the workspace bound back into it produce different
 * counts and the same absence of every sibling name.
 */
const PARENT_LISTING_MARKER = 'PARENT-LISTING-'

/** What the tool result says when the confined shell read the run's plan, and when it could not. */
const PLAN_LEAKED_MARKER = 'PLAN-LEAKED'
const PLAN_DENIED_MARKER = 'PLAN-DENIED'

/** What the tool result says when the confined shell read a sibling cell's file, and when it could not. */
const SIBLING_LEAKED_MARKER = 'SIBLING-LEAKED'
const SIBLING_DENIED_MARKER = 'SIBLING-DENIED'

/** What the tool result says when the confined shell read and wrote its own workspace. */
const OWN_READ_MARKER = 'OWN-READ-OK'
const OWN_WRITE_MARKER = 'OWN-WRITE-OK'

/**
 * One command, so a single transcript records everything the confined process
 * could reach. Every probe is written to fail silently: a backend that denies by
 * hiding the directory and one that denies by refusing the open must both land
 * on the denied marker rather than on a shell error.
 */
const PROBE_COMMAND = [
  `echo ${PARENT_LISTING_MARKER}$(ls -A .. 2>/dev/null | tr '\\n' ' ')`,
  `if cat ../plan.json > leaked-plan.txt 2>/dev/null; then echo ${PLAN_LEAKED_MARKER}; else echo ${PLAN_DENIED_MARKER}; fi`,
  `if cat ../cell-sibling/src.js > leaked-sibling.txt 2>/dev/null; then echo ${SIBLING_LEAKED_MARKER}; else echo ${SIBLING_DENIED_MARKER}; fi`,
  `if grep -q own-file own.txt 2>/dev/null; then echo ${OWN_READ_MARKER}; fi`,
  `if touch MARKER && test -f MARKER; then echo ${OWN_WRITE_MARKER}; fi`,
].join('; ')

/** The path the second step reads through the `read` tool, which is where a refusal is recorded. */
const PLAN_PATH = '../plan.json'

class SealedCellAdapter extends LlmAdapter {
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: model }
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const results = options.messages.filter(message => (message.content ?? []).some(block => block.type === 'tool-result'))
    if (results.length === 0) {
      yield * call('probe-shell', 'bash', { command: PROBE_COMMAND, description: 'Probe the run directory, then create MARKER.' })
      return
    }
    if (results.length === 1) {
      yield * call('probe-read', 'read', { file_path: PLAN_PATH })
      return
    }
    yield * reply('TASK COMPLETE')
  }
}

/** One tool call as the canonical block sequence of a step that stops on tool calls. */
function * call(id: string, name: string, args: object): Generator<StreamChunk> {
  const serialized = JSON.stringify(args)
  yield { type: 'block-start', index: 0, blockType: 'tool-call' }
  yield { type: 'tool-call-delta', index: 0, id: CallId(id), name, argumentsDelta: serialized }
  yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: CallId(id), name, arguments: serialized } }
  yield { type: 'usage', usage: { inputTokens: 19, outputTokens: 7 } }
  yield { type: 'finish', reason: { kind: 'tool-calls' } }
}

/** One text answer as the canonical block sequence of a stopped step. */
function * reply(text: string): Generator<StreamChunk> {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text }
  yield { type: 'block-end', index: 0, block: { type: 'text', text } }
  yield { type: 'usage', usage: { inputTokens: 21, outputTokens: 2 } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

export const name = 'sealed-cell-llm'

export const inject = ['llm']

/**
 * Register the keyless `sealed-cell` adapter.
 * @param ctx - the plugin context carrying the LLM runtime.
 */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['sealed-cell'], new SealedCellAdapter())
}
