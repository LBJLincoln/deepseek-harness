/**
 * Keyless adapter that plays the one department of the readme-rows program:
 * read the task statement, write the tool and its test, commit them with the
 * two trailer lines the objective requires.
 *
 * The bodies it writes are the committed files under `scripted/`, so what the
 * department delivers is reviewable source rather than a string assembled
 * here, and the session transcript carries the same bytes the branch does.
 * The scripted route never leaves work uncommitted and never fails a check;
 * the csv-tools fixture beside this one pins those two paths of the program.
 *
 * The marker and the file paths below are pinned by the e2e and by the
 * driver's spec, so keep them and the goal objective together.
 */

import { readFileSync } from 'node:fs'
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

/** The first sentence of the department's goal objective. */
const DEPARTMENT_MARKER = 'readme-rows department.'

/** The task statement the department reads before it writes anything. */
const TASK = 'TASK.md'

/** The answer that ends a department's turn. */
const DONE = 'TURN COMPLETE'

/** What the department delivers, in the order it writes them. */
const FILES = ['data/proving-ground/tools/readme-rows.mjs', 'data/proving-ground/tools/readme-rows.test.mjs'] as const

/** The commit message, ending with the two trailer lines the objective requires. */
const COMMIT_MESSAGE = [
  'deliver readme-rows: the README rows of one recorded run',
  '',
  'Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>',
  'Claude-Session: https://claude.ai/code/session_01HEXjzxR7CyMizem5kFAB4C',
].join('\n')

/** Scripted body per worktree path, read once from the files committed beside this plugin. */
const SOURCES: ReadonlyMap<string, string> = new Map(
  FILES.map(path => [path, readFileSync(new URL(`scripted/${path}`, import.meta.url), 'utf8')]),
)

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
 * Whether this session works the department, from the marker its goal objective carries.
 * @param options - the request whose history carries the goal text.
 * @returns `true` for the department session, `false` for the integration and anything else.
 */
function isDepartment(options: GenerateOptions): boolean {
  return options.messages
    .flatMap(message => message.content ?? [])
    .some(block => block.type === 'text' && block.text.includes(DEPARTMENT_MARKER))
}

/**
 * The commit that delivers the department's files.
 * @returns the arguments of the `bash` call that commits them.
 */
function commitCall(): object {
  return {
    command: `git add -A && git commit -q -F - <<'EOF'\n${COMMIT_MESSAGE}\nEOF`,
    description: 'Commit the tool and its test, with the trailer lines the task requires.',
  }
}

class ReadmeRowsAdapter extends LlmAdapter {
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: model }
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const { text, results } = position(options)
    if (!isDepartment(options)) {
      // The integration session and anything else this route is asked for: the
      // scripted implementer answers for the department only, so a turn here
      // means the merged head failed its own standard and the program must say so.
      yield * reply(`NO README-ROWS DEPARTMENT IN THIS SESSION${text.includes(CHECKS_FAILED_MARKER) ? ': the merged head did not pass' : ''}`)
      return
    }
    if (text.includes(UNCOMMITTED_MARKER) || text.includes(CHECKS_FAILED_MARKER)) {
      // The scripted files pass every check and are committed in the first
      // turn; a directive means the fixture itself drifted from the rows.
      yield * reply(`SCRIPTED DEPARTMENT CANNOT ANSWER ${text.includes(UNCOMMITTED_MARKER) ? UNCOMMITTED_MARKER : CHECKS_FAILED_MARKER}`)
      return
    }
    if (results === 0) {
      yield * call('read-task', 'read', { file_path: TASK })
      return
    }
    const pending = FILES[results - 1]
    if (pending !== undefined) {
      yield * call(`write-${pending.replaceAll('/', '-')}`, 'write', { file_path: pending, content: SOURCES.get(pending) })
      return
    }
    if (results === FILES.length + 1) {
      yield * call('commit', 'bash', commitCall())
      return
    }
    yield * reply(DONE)
  }
}

/**
 * One tool call as the canonical block sequence of a step that stops on tool calls.
 * @param id - the call's id, which the e2e and the transcript read.
 * @param name - the tool to call.
 * @param args - the call's arguments.
 * @yields the block sequence of one tool-calling step.
 */
function * call(id: string, name: string, args: object): Generator<StreamChunk> {
  const serialized = JSON.stringify(args)
  yield { type: 'block-start', index: 0, blockType: 'tool-call' }
  yield { type: 'tool-call-delta', index: 0, id: CallId(id), name, argumentsDelta: serialized }
  yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: CallId(id), name, arguments: serialized } }
  yield { type: 'usage', usage: { inputTokens: 23, outputTokens: 7 } }
  yield { type: 'finish', reason: { kind: 'tool-calls' } }
}

/**
 * One text answer as the canonical block sequence of a stopped step.
 * @param text - what the step answers.
 * @yields the block sequence of one stopped step.
 */
function * reply(text: string): Generator<StreamChunk> {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text }
  yield { type: 'block-end', index: 0, block: { type: 'text', text } }
  yield { type: 'usage', usage: { inputTokens: 19, outputTokens: 3 } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

export const name = 'readme-rows-llm'

export const inject = ['llm']

/**
 * Register the keyless `cli-mock` adapter this composition's department runs on.
 * @param ctx - the plugin context carrying the LLM runtime.
 */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['cli-mock'], new ReadmeRowsAdapter())
}
