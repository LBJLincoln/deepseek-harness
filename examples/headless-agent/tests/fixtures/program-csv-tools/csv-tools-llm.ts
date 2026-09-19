/**
 * Keyless adapter that plays every department of the csv-tools program: read
 * the specification, write the modules that department owns, commit them.
 *
 * The bodies it writes are the committed files under `scripted/src/`, so what
 * the department delivers is reviewable source rather than a string assembled
 * here, and the session transcript carries the same bytes the branch does. The
 * `join` department deliberately stops before committing on its first attempt:
 * the program refuses to measure a worktree carrying work no commit carries,
 * and the turn that follows its `<uncommitted_work>` directive commits.
 *
 * The markers and the department keys below are pinned by the e2e and by the
 * driver's spec, so keep them and the goal objectives together.
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

/** The specification every department reads before it writes anything. */
const SPEC = 'SPEC.md'

/** The answer that ends a department's turn. */
const DONE = 'TURN COMPLETE'

/** What each department's goal objective states, and what it delivers. */
const DEPARTMENT_FILES: Record<string, readonly string[]> = {
  stats: ['src/csv.js', 'src/stats.js'],
  filter: ['src/filter.js'],
  join: ['src/join.js'],
}

/** The department that leaves its first attempt uncommitted. */
const UNCOMMITTED_DEPARTMENT = 'join'

/** Scripted body per worktree path, read once from the files committed beside this plugin. */
const SOURCES: ReadonlyMap<string, string> = new Map(
  Object.values(DEPARTMENT_FILES).flat().map(path => [
    path,
    readFileSync(new URL(`scripted/${path}`, import.meta.url), 'utf8'),
  ]),
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
 * The department this session works, from the marker its goal objective carries.
 * @param options - the request whose history carries the goal text.
 * @returns the key, or `undefined` for a session that was never given one.
 */
function departmentKey(options: GenerateOptions): string | undefined {
  const history = options.messages
    .flatMap(message => message.content ?? [])
    .flatMap(block => (block.type === 'text' ? [block.text] : []))
    .join('\n')
  const key = /csv-tools department: ([a-z-]+)/.exec(history)?.[1]
  return key !== undefined && Object.hasOwn(DEPARTMENT_FILES, key) ? key : undefined
}

/**
 * The commit one department makes once its files are written.
 * @param key - the department's goal key.
 * @returns the arguments of the `bash` call that commits them.
 */
function commitCall(key: string): object {
  return {
    command: `git add -A && git commit -qm 'deliver the ${key} part of csv-tools'`,
    description: 'Commit what this department delivers.',
  }
}

class CsvToolsAdapter extends LlmAdapter {
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: model }
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const { text, results } = position(options)
    const key = departmentKey(options)
    if (key === undefined) {
      // The integration session and anything else this route is asked for: the
      // scripted implementer answers for departments only, so a turn here means
      // the merged head failed its own standard and the program must say so.
      yield * reply(`NO CSV-TOOLS DEPARTMENT IN THIS SESSION${text.includes(CHECKS_FAILED_MARKER) ? ': the merged head did not pass' : ''}`)
      return
    }
    if (text.includes(UNCOMMITTED_MARKER)) {
      if (results === 0) {
        yield * call('commit-after-directive', 'bash', commitCall(key))
        return
      }
      yield * reply(DONE)
      return
    }
    const files = DEPARTMENT_FILES[key] ?? []
    if (results === 0) {
      yield * call('read-spec', 'read', { file_path: SPEC })
      return
    }
    const pending = files[results - 1]
    if (pending !== undefined) {
      yield * call(`write-${pending.replaceAll('/', '-')}`, 'write', { file_path: pending, content: SOURCES.get(pending) })
      return
    }
    if (results === files.length + 1 && key !== UNCOMMITTED_DEPARTMENT) {
      yield * call('commit', 'bash', commitCall(key))
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

export const name = 'csv-tools-llm'

export const inject = ['llm']

/**
 * Register the keyless `cli-mock` adapter this composition's departments run on.
 * @param ctx - the plugin context carrying the LLM runtime.
 */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['cli-mock'], new CsvToolsAdapter())
}
