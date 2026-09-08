/**
 * Keyless adapter that plays every session of one program: a department that
 * writes before it commits, and an integration that probes a department's
 * worktree before it repairs the merged head.
 *
 * A department's first turn writes the file its goal names and commits nothing,
 * which is the state a department must not be certified in; the turn that
 * follows the program's `<uncommitted_work>` directive commits it. The
 * integration takes a turn only when the merged head fails its standard: it
 * reads a department worktree through the `read` tool, which is where the read
 * barrier records a refusal, and then creates and commits the file the failing
 * gate measures.
 *
 * The markers below are pinned by the e2e and by the fixture's spec, so keep
 * them and its check commands together.
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  CallId,
  LlmAdapter,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'

/** The turn text the program delivers when a worktree carries uncommitted work. */
const UNCOMMITTED_MARKER = '<uncommitted_work>'

/** The turn text the program delivers when a standard did not pass. */
const CHECKS_FAILED_MARKER = '<checks_failed>'

/** The file the integration creates and commits, which its own standard measures. */
const INTEGRATED_FILE = 'integrated.md'

/** The department worktree file the integration tries to read, relative to its own worktree. */
const DEPARTMENT_FILE = '../api/api.md'

/** Where in one session's turn the adapter is: the turn's text and the tool results it already has. */
interface Position {
  /** Text of the newest turn the session was handed, empty for a session that was handed none. */
  readonly text: string
  /** Tool results delivered since that turn, which is the step this stream serves. */
  readonly results: number
}

/**
 * Read the newest turn and the steps already taken in it.
 * @param options - the request the loop assembled.
 * @returns the turn text and the tool results that followed it.
 */
function position(options: GenerateOptions): Position {
  let results = 0
  for (let index = options.messages.length - 1; index >= 0; index -= 1) {
    const message = options.messages[index]
    if (message === undefined || message.role !== 'user') continue
    const content = message.content ?? []
    if (content.some(block => block.type === 'tool-result')) {
      results += 1
      continue
    }
    return { text: content.filter(block => block.type === 'text').map(block => block.text).join(''), results }
  }
  return { text: '', results }
}

/**
 * The file one department's goal told it to write.
 * @param options - the request whose history carries the goal text.
 * @returns the file name, or `undefined` for a session that was never given one.
 */
function departmentFile(options: GenerateOptions): string | undefined {
  const history = options.messages
    .flatMap(message => message.content ?? [])
    .flatMap(block => (block.type === 'text' ? [block.text] : []))
    .join('\n')
  return /Write ([a-z0-9-]+\.md)/.exec(history)?.[1]
}

class ProgramAdapter extends LlmAdapter {
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: model }
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const { text, results } = position(options)
    if (results > 0) {
      // Every step but the last of a turn is one tool call; the answer ends it.
      if (!text.includes(CHECKS_FAILED_MARKER) || results > 1) {
        yield * reply('TURN COMPLETE')
        return
      }
      yield * call('integration-repair', 'bash', {
        command: `printf 'merged\\n' > ${INTEGRATED_FILE} && git add -A && git commit -qm 'integrate the departments'`,
        description: 'Create and commit the file the integration standard measures.',
      })
      return
    }
    if (text.includes(CHECKS_FAILED_MARKER)) {
      yield * call('integration-probe', 'read', { file_path: DEPARTMENT_FILE })
      return
    }
    const file = departmentFile(options) ?? INTEGRATED_FILE
    if (text.includes(UNCOMMITTED_MARKER)) {
      yield * call('department-commit', 'bash', {
        command: `git add -A && git commit -qm 'deliver ${file}'`,
        description: 'Commit what this goal delivers.',
      })
      return
    }
    yield * call('department-write', 'bash', {
      command: `printf 'delivered\\n' > ${file}`,
      description: 'Write what this goal delivers.',
    })
  }
}

/** One tool call as the canonical block sequence of a step that stops on tool calls. */
function * call(id: string, name: string, args: object): Generator<StreamChunk> {
  const serialized = JSON.stringify(args)
  yield { type: 'block-start', index: 0, blockType: 'tool-call' }
  yield { type: 'tool-call-delta', index: 0, id: CallId(id), name, argumentsDelta: serialized }
  yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: CallId(id), name, arguments: serialized } }
  yield { type: 'usage', usage: { inputTokens: 17, outputTokens: 5 } }
  yield { type: 'finish', reason: { kind: 'tool-calls' } }
}

/** One text answer as the canonical block sequence of a stopped step. */
function * reply(text: string): Generator<StreamChunk> {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text }
  yield { type: 'block-end', index: 0, block: { type: 'text', text } }
  yield { type: 'usage', usage: { inputTokens: 13, outputTokens: 2 } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

export const name = 'program-llm'

export const inject = ['llm']

/**
 * Register the keyless `program-mock` adapter.
 * @param ctx - the plugin context carrying the LLM runtime.
 */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['program-mock'], new ProgramAdapter())
}
