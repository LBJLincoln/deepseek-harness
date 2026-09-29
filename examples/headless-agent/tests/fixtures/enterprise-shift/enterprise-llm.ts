/**
 * Keyless adapter that plays every session of one enterprise shift over the
 * seeded repository: each department writes the file its ticket asks for and
 * commits, and the reviewer answers with a verdict. What each ticket's
 * department does is fixed by the ticket id, so one seed exercises the shift's
 * paths — a ticket that ships, one whose checks fail, one the reviewer rejects,
 * one that changes a path outside its scope, and one whose department moves
 * the remote tip before the shift pushes. The route declares two models, the
 * departments' `cli-mock` and the reviewer's `cli-mock-reviewer`, and refuses
 * any other as the product route does. `DSH_TEST_ENTERPRISE_LIMIT=1` makes
 * every department turn fail with the seam's `QUOTA` code and a stated reset,
 * which is the route's own usage-limit notice as the seam classifies it.
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  CallId,
  LlmAdapter,
  LlmError,
  QUOTA_EXCEEDED_CODE,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { REVIEW_MARKER } from './shift.ts'

/** The turn text the program delivers when a worktree carries uncommitted work. */
const UNCOMMITTED_MARKER = '<uncommitted_work>'

/** The turn text the program delivers when a standard did not pass. */
const CHECKS_FAILED_MARKER = '<checks_failed>'

/** The heading of every department objective, followed by the ticket id. */
const TICKET_HEADING = /^Ticket (T-\d{4}):/m

/** The answer that ends a department's turn. */
const DONE = 'TURN COMPLETE'

/** The delay the scripted limit states until its reset: one hour. */
const LIMIT_RESET_MS = 3_600_000

/** One tool call a scripted department makes. */
interface Step {
  readonly id: string
  readonly name: string
  readonly args: object
}

/** A `write` of one file. */
function write(path: string, content: string): Step {
  return { id: `write-${path.replaceAll('/', '-')}`, name: 'write', args: { file_path: path, content } }
}

/** A `bash` command. */
function bash(id: string, command: string, description: string): Step {
  return { id, name: 'bash', args: { command, description } }
}

/** The address every scripted commit credits, which the shift's record must mask. */
export const SCRIPTED_REPORTER = 'owner@example.test'

/** The commit that delivers a department's files, naming its ticket and crediting a reporter by e-mail. */
function commit(ticket: string): Step {
  return bash('commit', `git add -A && git commit -q -m '${ticket}: the scripted department delivers' -m 'Reported-by: ${SCRIPTED_REPORTER}'`, `Commit the work of ${ticket}.`)
}

/**
 * Move the remote branch tip by one commit that carries the tip's own tree, so
 * the shift finds the tip moved when it pushes and rebases onto it cleanly. It
 * stands in for another writer of the branch: a department's worktree cannot
 * push, so the commit is written into the seeded bare remote directly.
 */
const MOVE_TIP = [
  'r="$(git config remote.origin.url)"',
  't="$(git --git-dir="$r" rev-parse \'main^{tree}\')"',
  'c="$(git --git-dir="$r" -c user.name=writer -c user.email=writer@example.test commit-tree -p main -m \'the tip moved during the shift\' "$t")"',
  'git --git-dir="$r" update-ref refs/heads/main "$c"',
].join(' && ')

/** A department's attempts to push its branch: through `origin`, and by the remote's own URL. Both must be refused. */
const PUSH_ATTEMPTS = 'git push -q origin HEAD:refs/heads/department-push; git push -q "$(git config remote.origin.url)" HEAD:refs/heads/department-push; true'

/** What each seeded ticket's department does, in order, before it answers. */
const SCRIPTS: Readonly<Record<string, readonly Step[]>> = {
  'T-0001': [write('tools/greet.mjs', "console.log('hello')\n"), commit('T-0001')],
  'T-0002': [write('tools/answer.mjs', 'debugger\nconsole.log(41)\n'), commit('T-0002')],
  'T-0003': [write('tools/bye.mjs', "console.log('bye')\n"), commit('T-0003')],
  'T-0004': [
    write('tools/count.mjs', 'console.log(3)\n'),
    write('NOTES.md', 'a note outside the scope\n'),
    commit('T-0004'),
    bash('push-attempts', PUSH_ATTEMPTS, 'Try to push the branch.'),
  ],
  'T-0005': [write('tools/echo.mjs', "console.log('echo')\n"), bash('move-tip', MOVE_TIP, 'Move the remote tip.'), commit('T-0005')],
}

/** The ticket the reviewer rejects; every other review approves. */
const REJECTED_TICKET = 'T-0003'

/** The models the scripted route declares: the departments' and the reviewer's. Any other is refused as the product route refuses one. */
const MODELS: ReadonlySet<string> = new Set(['cli-mock', 'cli-mock-reviewer'])

/** Where in one session's turn the adapter is: the turn's text and the tool results it already has. */
interface Position {
  readonly text: string
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

/** Every user text block of the request's history, joined. */
function history(options: GenerateOptions): string {
  return options.messages
    .flatMap(message => message.content ?? [])
    .flatMap(block => (block.type === 'text' ? [block.text] : []))
    .join('\n')
}

class EnterpriseAdapter extends LlmAdapter {
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    if (!MODELS.has(model)) throw new LlmError(`enterprise-llm: provider route "${provider}" has no configured model "${model}"`, 'UNKNOWN_MODEL')
    return { provider, id: model, name: model }
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const text = history(options)
    if (text.includes(REVIEW_MARKER)) {
      const ticket = /<ticket id="(T-\d{4})"/.exec(text)?.[1] ?? 'none'
      yield * reply(ticket === REJECTED_TICKET
        ? `verdict: reject\nThe scripted reviewer rejects ${ticket}: the change is not what the ticket asks for.`
        : `verdict: approve\nThe diff does what ${ticket} asks, stays inside its scope, and every check passed.`)
      return
    }
    const ticket = TICKET_HEADING.exec(text)?.[1]
    if (ticket === undefined) {
      // The integration session and anything else this route is asked for.
      yield * reply(`NO DEPARTMENT IN THIS SESSION${text.includes(CHECKS_FAILED_MARKER) ? ': the merged head did not pass' : ''}`)
      return
    }
    if (process.env['DSH_TEST_ENTERPRISE_LIMIT'] === '1') {
      throw new LlmError("You've hit your session limit · resets 8:20pm (UTC)", QUOTA_EXCEEDED_CODE, { providerRetryAfterMs: LIMIT_RESET_MS })
    }
    const { text: turn, results } = position(options)
    if (turn.includes(UNCOMMITTED_MARKER) || turn.includes(CHECKS_FAILED_MARKER)) {
      yield * reply(`SCRIPTED DEPARTMENT CANNOT ANSWER ${turn.includes(UNCOMMITTED_MARKER) ? UNCOMMITTED_MARKER : CHECKS_FAILED_MARKER}`)
      return
    }
    const step = SCRIPTS[ticket]?.[results]
    if (step !== undefined) {
      yield * call(step.id, step.name, step.args)
      return
    }
    yield * reply(DONE)
  }
}

/**
 * One tool call as the canonical block sequence of a step that stops on tool calls.
 * @param id - the call's id.
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

export const name = 'enterprise-llm'

export const inject = ['llm']

/**
 * Register the keyless `cli-mock` adapter this composition's sessions run on.
 * @param ctx - the plugin context carrying the LLM runtime.
 */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['cli-mock'], new EnterpriseAdapter())
}
