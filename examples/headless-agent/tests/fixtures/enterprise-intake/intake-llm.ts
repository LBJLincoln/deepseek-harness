/**
 * Keyless adapter that plays the departments of the intake program from a
 * script: for each department the script names by its key — a refilling
 * coordinator's seat id, or a request's `request-<name>` — either commit the
 * proposals file under `scripted/`, or refuse the request the way the Claude
 * Code route classifies a spent usage window. A department's key is the stem
 * of the proposals path its objective names.
 *
 * `DSH_TEST_INTAKE_SCRIPT` is the script, a JSON object from department key to
 * `{ "proposals": "<file under scripted/>" }` or `{ "limit": "<the product's notice>" }`.
 * `DSH_TEST_INTAKE_CALLS`, when set, is a file the adapter appends one line
 * per request it serves to, naming the department key, so a test sees which
 * departments reached the route. A department answers a `<checks_failed>` or
 * `<uncommitted_work>` turn with a refusal to continue, so a department whose
 * proposals admission refused fails on its rounds instead of repeating itself.
 */

import { appendFileSync, readFileSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import {
  CallId,
  isQuotaExceededError,
  LlmAdapter,
  LlmError,
  QUOTA_EXCEEDED_CODE,
  quotaRetryAfter,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'

/** The turn texts the program delivers after a measured attempt that did not certify. */
const RETRY_MARKERS = ['<checks_failed>', '<uncommitted_work>']

/** The instruction every department objective carries, naming the proposals file whose stem is the department key. */
const KEY_MARKER = / to `\.intake\/([a-z0-9-]+)\.json` at the root of this worktree/

/** The answer that ends a department's turn. */
const DONE = 'TURN COMPLETE'

/** One department's scripted part. */
type Part = { readonly proposals: string } | { readonly limit: string }

/** The script, read once at load. */
function readScript(): ReadonlyMap<string, Part> {
  const path = process.env['DSH_TEST_INTAKE_SCRIPT']
  if (path === undefined) throw new Error('intake-llm requires DSH_TEST_INTAKE_SCRIPT')
  return new Map(Object.entries(JSON.parse(readFileSync(path, 'utf8')) as Record<string, Part>))
}

/** The newest turn's text and the tool results already delivered in it. */
function position(options: GenerateOptions): { readonly text: string; readonly results: number } {
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

/** The department key this session works, from its goal objective. */
function keyOf(options: GenerateOptions): string | undefined {
  for (const message of options.messages) {
    for (const block of message.content ?? []) {
      if (block.type !== 'text') continue
      const match = KEY_MARKER.exec(block.text)
      if (match?.[1] !== undefined) return match[1]
    }
  }
  return undefined
}

/**
 * The one shell call that writes and commits a department's proposals.
 * @param key - the department key, which names the file.
 * @param body - the scripted file's contents.
 * @returns the `bash` call's arguments.
 */
function commitCall(key: string, body: string): object {
  return {
    command: `mkdir -p .intake && cat > .intake/${key}.json <<'EOF'\n${body.trimEnd()}\nEOF\ngit add .intake && git commit -q -m '${key}: proposed tickets'`,
    description: 'Write the proposed tickets and commit them.',
  }
}

class IntakeAdapter extends LlmAdapter {
  private readonly script = readScript()

  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: model }
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const key = keyOf(options)
    const calls = process.env['DSH_TEST_INTAKE_CALLS']
    if (calls !== undefined) appendFileSync(calls, `${key ?? '(none)'}\n`)
    const part = key === undefined ? undefined : this.script.get(key)
    if (key === undefined || part === undefined) {
      yield * reply('NO SCRIPTED DEPARTMENT IN THIS SESSION')
      return
    }
    if ('limit' in part) {
      // The route's own classification of the product's notice, which is what
      // the program's department sees on the Claude Code route.
      const code = isQuotaExceededError(part.limit) ? QUOTA_EXCEEDED_CODE : 'TRANSPORT'
      throw new LlmError(`llm-claude-code: the query failed: success api_error stop_sequence ${part.limit}`, code, quotaRetryAfter(part.limit, Date.now()))
    }
    const { text, results } = position(options)
    if (RETRY_MARKERS.some(marker => text.includes(marker))) {
      yield * reply('THE SCRIPTED COORDINATOR HAS NOTHING ELSE TO PROPOSE')
      return
    }
    if (results === 0) {
      const body = readFileSync(new URL(`scripted/${part.proposals}`, import.meta.url), 'utf8')
      yield * call('commit-proposals', 'bash', commitCall(key, body))
      return
    }
    yield * reply(DONE)
  }
}

/**
 * One tool call as the canonical block sequence of a step that stops on tool calls.
 * @param id - the call's id.
 * @param toolName - the tool to call.
 * @param args - the call's arguments.
 * @yields the block sequence of one tool-calling step.
 */
function * call(id: string, toolName: string, args: object): Generator<StreamChunk> {
  const serialized = JSON.stringify(args)
  yield { type: 'block-start', index: 0, blockType: 'tool-call' }
  yield { type: 'tool-call-delta', index: 0, id: CallId(id), name: toolName, argumentsDelta: serialized }
  yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: CallId(id), name: toolName, arguments: serialized } }
  yield { type: 'usage', usage: { inputTokens: 31, outputTokens: 11 } }
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

export const name = 'intake-llm'

export const inject = ['llm']

/**
 * Register the keyless `cli-mock` adapter this composition's departments run on.
 * @param ctx - the plugin context carrying the LLM runtime.
 */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['cli-mock'], new IntakeAdapter())
}
