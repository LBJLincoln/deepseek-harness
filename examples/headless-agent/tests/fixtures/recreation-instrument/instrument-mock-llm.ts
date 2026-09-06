/**
 * Keyless adapter serving both routes of the recreation-instrument scenario.
 *
 * The validator route walks one scripted authoring session: three cases
 * recorded from the reference, one deliberately unstable case the instrument
 * refuses, one re-weighting, and the freeze. The implementer route writes a
 * program that answers two of those three cases, and reads for the reference
 * program under the barrier root before reporting. Each route's step is chosen
 * by how many assistant turns its own session already holds, so neither script
 * depends on the other's timing.
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  CallId,
  LlmAdapter,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'

/** Provider route the validator session authors the standard on. */
export const VALIDATOR_PROVIDER = 'validator-mock'

/** Environment variable the driver publishes the staged reference path through. */
export const REFERENCE_PATH_VARIABLE = 'DSH_RECREATION_REFERENCE'

/** Provider route the environment runner drives the implementer on. */
const IMPLEMENTER_PROVIDER = 'implementer-mock'

/** The check every recorded case belongs to. */
const CHECK_ID = 'tally-behaviour'

/** One scripted tool call: the tool name and its arguments as the model emits them. */
interface ScriptedCall {
  readonly id: string
  readonly name: string
  readonly arguments: unknown
}

/** The validator's authoring script, one entry per assistant turn. */
const VALIDATOR_SCRIPT: readonly (ScriptedCall | string)[] = [
  {
    id: 'record-echo-word',
    name: 'standard_author',
    arguments: {
      action: 'record_case',
      checkId: CHECK_ID,
      caseId: 'echo-word',
      weight: 5,
      argv: ['pepper'],
      channels: ['exit', 'stdout'],
    },
  },
  {
    id: 'record-count-chars',
    name: 'standard_author',
    arguments: {
      action: 'record_case',
      checkId: CHECK_ID,
      caseId: 'count-chars',
      weight: 2,
      argv: ['-c', 'pepper'],
      channels: ['exit', 'stdout'],
    },
  },
  {
    id: 'record-missing-argument',
    name: 'standard_author',
    arguments: {
      action: 'record_case',
      checkId: CHECK_ID,
      caseId: 'missing-argument',
      weight: 2,
      argv: [],
      channels: ['exit', 'stdout', 'stderr'],
    },
  },
  {
    id: 'record-run-token',
    name: 'standard_author',
    arguments: {
      action: 'record_case',
      checkId: CHECK_ID,
      caseId: 'run-token',
      weight: 1,
      argv: ['-t'],
      channels: ['exit', 'stdout'],
    },
  },
  {
    id: 'weigh-count-chars',
    name: 'standard_author',
    arguments: { action: 'weigh', checkId: CHECK_ID, caseId: 'count-chars', weight: 4 },
  },
  {
    id: 'freeze-standard',
    name: 'standard_author',
    arguments: {
      action: 'freeze',
      checks: [{
        id: CHECK_ID,
        outcome: './run prints its argument, counts characters with -c, and refuses an empty argument list',
      }],
    },
  },
  'STANDARD FROZEN',
]

/** The candidate program: right for a word and for `-c`, silent where the reference refuses. */
const WRITE_CANDIDATE = [
  "cat > run <<'SH'",
  'case "$1" in',
  '  -c) printf \'%s\\n\' "${#2}" ;;',
  '  *) printf \'%s\\n\' "$1" ;;',
  'esac',
  'SH',
].join('\n')

/** The implementer's script: write the candidate, look for the reference, then report. */
function implementerScript(): readonly (ScriptedCall | string)[] {
  return [
    {
      id: 'write-candidate',
      name: 'bash',
      arguments: { command: WRITE_CANDIDATE, description: 'Write the candidate program.' },
    },
    {
      id: 'peek-reference',
      name: 'read',
      arguments: { file_path: process.env[REFERENCE_PATH_VARIABLE] ?? '/nonexistent/reference/run' },
    },
    'TASK COMPLETE',
  ]
}

class RecreationMockAdapter extends LlmAdapter {
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: model }
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const turns = options.messages.filter(message => message.role === 'assistant').length
    const validator = options.provider === VALIDATOR_PROVIDER
    const script = validator ? VALIDATOR_SCRIPT : implementerScript()
    const step = script[turns]
    if (step === undefined || typeof step === 'string') {
      yield * reply(step ?? 'STOPPED')
      return
    }
    yield * call(step)
  }
}

/** One tool call as the canonical block sequence of a tool-calling step. */
function * call(scripted: ScriptedCall): Generator<StreamChunk> {
  const args = JSON.stringify(scripted.arguments)
  const id = CallId(scripted.id)
  yield { type: 'block-start', index: 0, blockType: 'tool-call' }
  yield { type: 'tool-call-delta', index: 0, id, name: scripted.name, argumentsDelta: args }
  yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: scripted.name, arguments: args } }
  yield { type: 'usage', usage: { inputTokens: 21, outputTokens: 11 } }
  yield { type: 'finish', reason: { kind: 'tool-calls' } }
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
 * Register the keyless validator and implementer adapters.
 * @param ctx - the plugin context carrying the LLM runtime.
 */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter([VALIDATOR_PROVIDER, IMPLEMENTER_PROVIDER], new RecreationMockAdapter())
}
