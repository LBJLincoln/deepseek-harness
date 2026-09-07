/**
 * Shared builders for this package's suites: product results, token usage, and
 * a fake managed child. Lives outside the `*.spec.ts` pattern so importing it
 * never re-registers another file's tests.
 */

import { PassThrough } from 'node:stream'
import { vi, type Mock } from 'vitest'
import type { NonNullableUsage, SDKMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk'
import { createAssistantMessage, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import type { SubprocessHandle, SubprocessOutcome } from '@deepseek-ai/dsh-subprocess'
import type { Config } from '../src/config.ts'

/** Route config every suite starts from; suites override one field at a time. */
export const BASE_CONFIG = {
  provider: 'claude-code',
  models: [{ id: 'default', name: 'Installation default', contextWindow: 200_000 }],
} satisfies Config

/**
 * The base route config with one or more fields replaced.
 * @param overrides - fields this case changes.
 * @returns a complete route config.
 */
export function routeConfig(overrides: Partial<Config> = {}): Config {
  return { ...BASE_CONFIG, ...overrides }
}

/** Token accounting with every counter present. */
export function usage(overrides: Partial<NonNullableUsage> = {}): NonNullableUsage {
  return {
    input_tokens: 11,
    output_tokens: 7,
    cache_read_input_tokens: 3,
    cache_creation_input_tokens: 2,
    ...overrides,
  } as NonNullableUsage
}

/** A successful product result carrying one structured answer. */
export function successResult(
  structured: unknown,
  overrides: Partial<SDKResultMessage> = {},
): SDKResultMessage {
  return {
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'ignored',
    stop_reason: 'end_turn',
    uuid: 'r1',
    session_id: 's1',
    usage: usage(),
    structured_output: structured,
    ...overrides,
  } as SDKResultMessage
}

/** A failed product result of one error subtype. */
export function errorResult(
  subtype: Exclude<SDKResultMessage['subtype'], 'success'>,
  errors: string[] = ['fixture failure'],
  overrides: Partial<SDKResultMessage> = {},
): SDKResultMessage {
  return {
    type: 'result',
    subtype,
    is_error: true,
    errors,
    stop_reason: null,
    uuid: 'r1',
    session_id: 's1',
    usage: usage(),
    ...overrides,
  } as SDKResultMessage
}

/** One partial assistant event, which is what keeps a long query's watchdog armed. */
export function partialMessage(): SDKMessage {
  return {
    type: 'stream_event',
    event: { type: 'ping' },
    parent_tool_use_id: null,
    uuid: 'p1',
    session_id: 's1',
  } as unknown as SDKMessage
}

/** Assemble a request over the default route. */
export function request(overrides: Partial<GenerateOptions> = {}): GenerateOptions {
  return {
    provider: 'claude-code',
    model: 'default',
    system: 'You are the harness.',
    messages: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] })],
    ...overrides,
  }
}

/** A three-message history: user turn, assistant tool call, tool result. */
export function toolConversation(): Message[] {
  const callId = CallId('call-1')
  return [
    createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'list the files' }] }),
    createAssistantMessage({
      source: { provider: 'claude-code', model: 'default' },
      content: [
        { type: 'text', text: 'Running it.' },
        { type: 'tool-call', id: callId, name: 'bash', arguments: '{"command":"ls"}' },
      ],
    }),
    createToolResultMessage({
      callId,
      isError: false,
      content: [{ type: 'text', text: 'a.txt\n' }],
    }),
  ]
}

/** Options for {@link fakeChild}. */
export interface FakeChildOptions {
  readonly pid?: number
  readonly waitForExitError?: Error
  readonly closeError?: Error
}

/** A managed child under test control. */
export interface FakeChild {
  readonly handle: SubprocessHandle
  readonly stdin: PassThrough
  readonly stdout: PassThrough
  readonly settle: (outcome?: SubprocessOutcome) => void
  readonly fail: (error: Error) => void
  readonly terminate: Mock<SubprocessHandle['terminate']>
}

/** Build a subprocess handle whose lifecycle a test drives directly. */
export function fakeChild(options: FakeChildOptions = {}): FakeChild {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  let exited = false
  let resolveDone!: (outcome: SubprocessOutcome) => void
  let rejectDone!: (error: Error) => void
  const done = new Promise<SubprocessOutcome>((resolve, reject) => {
    resolveDone = resolve
    rejectDone = reject
  })
  // Suites deliberately exercise rejected handles.
  void done.catch(() => {})
  const settle = (outcome: SubprocessOutcome = { exitCode: 0, signal: null }): void => {
    if (exited) return
    exited = true
    resolveDone(outcome)
  }
  const fail = (error: Error): void => {
    if (exited) return
    exited = true
    rejectDone(error)
  }
  const terminate = vi.fn<SubprocessHandle['terminate']>(() => { settle() })
  const handle: SubprocessHandle = {
    pid: options.pid ?? 4321,
    stdin,
    stdout,
    stderr: undefined,
    collected: {},
    done,
    terminate,
    waitForExit: vi.fn<SubprocessHandle['waitForExit']>(async () => {
      if (options.waitForExitError !== undefined) throw options.waitForExitError
      await done.catch(() => {})
      return true
    }),
  }
  return { handle, stdin, stdout, settle, fail, terminate }
}
