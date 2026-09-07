/**
 * The adapter that serves this route: every `stream()` is one stateless query
 * to the operator's Claude Code installation through the official Agent SDK.
 *
 * The product executes no tool and reads no workspace — built-in tools, MCP
 * servers, and filesystem settings are all switched off — so every tool call
 * comes back to the harness agent loop, which runs it exactly as it does for
 * any other route.
 *
 * @module @deepseek-ai/dsh-llm-claude-code/adapter
 */

import {
  query as officialQuery,
  type Options,
  type Query,
  type SDKResultMessage,
  type SpawnOptions,
} from '@anthropic-ai/claude-agent-sdk'
import { errorChain, LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm'
import type {
  GenerateOptions,
  LlmModelInfo,
  LlmProviderInfo,
  LlmResolvedModelInfo,
  ResolvedRetryPolicy,
  StreamChunk,
} from '@deepseek-ai/dsh-llm'
import {
  scrubbedParentEnv,
  type SubprocessHandle,
  type SubprocessSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import { idleWatchdog, timeoutOf } from '@deepseek-ai/dsh-timeout'
import { claudeSpawnSpec, ManagedClaudeCodeProcess } from './process.ts'
import { RESPONSE_SCHEMA, renderRequest } from './render.ts'
import { answerChunks, parseAnswer, resultFailure } from './response.ts'
import type { ClaudeCodeModel, RenderedRequest, ResolvedClaudeCodeOptions } from './types.ts'

/**
 * Turn bound for every query, where a turn is one assistant message.
 *
 * One `generate()` is one model response, and offering no tools is what
 * guarantees it: with `tools: []` the product can only speak and then deliver
 * its structured answer, never act between turns. This bound is two because
 * that delivery costs an assistant message of its own, so a reply that says
 * anything before it needs both; a one-turn bound refuses every such reply.
 * Fixed rather than configurable because it belongs to the product's
 * structured-output protocol, not to a deployment.
 */
export const MAX_TURNS = 2

/** Permission posture: never prompt, and deny anything not pre-approved. */
export const PERMISSION_MODE = 'dontAsk'

/** Timeout code carried by this route's idle watchdog. */
export const STREAM_IDLE_TIMEOUT_CODE = 'LLM_STREAM_IDLE_TIMEOUT'

/** Code for an installation whose CLI could not be resolved on this host. */
export const MISSING_EXECUTABLE_CODE = 'MISSING_EXECUTABLE'

/** Bare CLI name resolved through the subprocess seam's execution world. */
export const CLAUDE_CODE_COMMAND = 'claude'

/** Host services one adapter instance needs; supplied by the plugin. */
export interface ClaudeCodeAdapterDependencies {
  /** Resolve the installation's CLI in the subprocess seam's execution world. */
  resolveExecutable: (
    env: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ) => Promise<string>
  /** Start the CLI under the shared process-tree owner. */
  spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
  /** Directory the CLI process runs in; the query itself reads nothing from it. */
  cwd: () => string
}

/** Everything one query needs after the request has been resolved and rendered. */
export interface ClaudeCodeQuerySpec {
  /** Validated route facts for this request. */
  readonly options: ResolvedClaudeCodeOptions
  /** Catalog entry the request selected. */
  readonly model: ClaudeCodeModel
  /** The rendered system prompt and prompt text. */
  readonly rendered: RenderedRequest
  /** Exact CLI path resolved through the subprocess seam. */
  readonly executable: string
  /** Directory the CLI process runs in. */
  readonly cwd: string
  /** Cancellation owner handed to the SDK. */
  readonly controller: AbortController
  /** Start the CLI under the shared process-tree owner. */
  readonly spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
  /** Receives the managed child synchronously from the SDK's spawn hook. */
  readonly capture: (child: SubprocessHandle) => void
}

/**
 * Build the fixed SDK options for one query.
 *
 * `includePartialMessages` is what keeps the idle watchdog armed: the product
 * takes seconds to answer, and its partial assistant events are the only
 * evidence the installation is alive before the result arrives.
 * @param spec - resolved route facts, rendered prompt, and process ownership.
 * @returns options that give the product the harness prompt and nothing else.
 */
export function claudeQueryOptions(spec: ClaudeCodeQuerySpec): Options {
  return {
    abortController: spec.controller,
    cwd: spec.cwd,
    pathToClaudeCodeExecutable: spec.executable,
    env: { ...scrubbedParentEnv(), ...spec.options.env },
    // The harness prompt is the prompt: a custom string replaces the product's
    // own preset instead of appending to it.
    systemPrompt: spec.rendered.systemPrompt,
    outputFormat: { type: 'json_schema', schema: RESPONSE_SCHEMA },
    includePartialMessages: true,
    maxTurns: MAX_TURNS,
    permissionMode: PERMISSION_MODE,
    // No tools, no MCP, no filesystem settings, no persisted session: the
    // product answers one prompt and touches nothing else.
    tools: [],
    allowedTools: [],
    disallowedTools: ['AskUserQuestion'],
    mcpServers: {},
    strictMcpConfig: true,
    settingSources: [],
    persistSession: false,
    ...spec.model.productModel === undefined ? {} : { model: spec.model.productModel },
    ...spec.options.effort === undefined ? {} : { effort: spec.options.effort },
    ...spec.options.thinking === undefined ? {} : { thinking: spec.options.thinking },
    spawnClaudeCodeProcess: (options: SpawnOptions) => {
      const child = spec.spawn(claudeSpawnSpec(options, spec.options.disposeGraceMs))
      spec.capture(child)
      return new ManagedClaudeCodeProcess(child)
    },
  }
}

/* jscpd:ignore-start -- the subagent seam's Claude Code provider tears its own
 * run down the same way; each seam owns the process lifetime of the product it
 * drives, and neither package may depend on the other. */
function thrown(value: unknown): Error {
  /* v8 ignore next -- the SDK and subprocess seams reject with Error. */
  return value instanceof Error ? value : new Error(String(value))
}

/**
 * Close the query, terminate the managed process tree, and wait for the
 * subprocess owner to prove it is gone.
 * @param query - the published SDK query, when creation reached that point.
 * @param child - the shared handle owning the CLI process tree, when the SDK spawned one.
 */
export async function disposeQuery(
  query: Pick<Query, 'close'> | undefined,
  child: SubprocessHandle | undefined,
): Promise<void> {
  const failures: Error[] = []
  try {
    query?.close()
  } catch (error: unknown) {
    failures.push(thrown(error))
  }
  if (child !== undefined && child.pid > 0) {
    child.terminate()
    try {
      await child.waitForExit()
      await child.done
    } catch (error: unknown) {
      failures.push(thrown(error))
    }
  }
  const firstFailure = failures[0]
  if (failures.length === 1 && firstFailure !== undefined) throw firstFailure
  if (failures.length > 1) {
    throw new AggregateError(failures, 'llm-claude-code: query and process cleanup failed')
  }
}
/* jscpd:ignore-end */

/**
 * One `LlmAdapter` for the single route this plugin registers. Route facts are
 * resolved once at load, so every request uses the same validated catalog,
 * environment, and timeouts.
 */
export class ClaudeCodeAdapter extends LlmAdapter {
  constructor(
    private readonly options: ResolvedClaudeCodeOptions,
    private readonly deps: ClaudeCodeAdapterDependencies,
  ) {
    super()
  }

  /** Select the catalog entry a request named, or refuse the request. */
  private entry(model: string): ClaudeCodeModel {
    const found = this.options.models.find(candidate => candidate.id === model)
    if (found === undefined) {
      throw new LlmError(
        `llm-claude-code: provider route "${this.options.provider}" has no configured model "${model}"`,
        'UNKNOWN_MODEL',
      )
    }
    return found
  }

  /** Describe one catalog entry for a selector. */
  private info(provider: string, model: ClaudeCodeModel): LlmModelInfo {
    return {
      provider,
      id: model.id,
      name: model.name ?? model.id,
      ...model.description === undefined ? {} : { description: model.description },
      // The query carries one prompt string, so image input is a declared
      // negative capability rather than unknown metadata.
      inputModalities: ['text'],
    }
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: this.options.displayName }
  }

  override providerRetryPolicy(_provider: string): ResolvedRetryPolicy {
    return this.options.retryPolicy
  }

  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve(this.options.models.map(model => this.info(provider, model)))
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    // An undeclared model rejects rather than throwing synchronously, so a
    // caller that only awaits the returned promise still sees the refusal.
    return Promise.resolve().then(() => {
      const entry = this.entry(model)
      return {
        ...this.info(provider, entry),
        ...entry.contextWindow === undefined
          ? {}
          : { context: { contextWindow: entry.contextWindow } },
      }
    })
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield* await this.runQuery(options)
  }

  /**
   * Run one query to completion and map its result onto the seam. Cancellation,
   * idle expiry, and every product failure become a coded `LlmError`, which the
   * seam turns into the stream's terminal finish.
   */
  private async runQuery(options: GenerateOptions): Promise<StreamChunk[]> {
    const model = this.entry(options.model)
    const rendered = renderRequest(options)
    const executable = await this.resolveExecutable(options.signal)
    const consumer = new AbortController()
    const upstream = options.signal === undefined
      ? consumer.signal
      : AbortSignal.any([options.signal, consumer.signal])
    using watchdog = idleWatchdog(upstream, this.options.queryTimeoutMs, STREAM_IDLE_TIMEOUT_CODE)
    const controller = new AbortController()
    // One listener covers all three ways a query stops early: caller
    // cancellation and the idle timeout both abort the watchdog's fused
    // signal, and the consumer controller aborts it during teardown.
    const cancelQuery = (): void => { controller.abort(watchdog.signal.reason) }
    watchdog.signal.addEventListener('abort', cancelQuery, { once: true })

    let child: SubprocessHandle | undefined
    let query: Query | undefined
    let result: SDKResultMessage | undefined
    try {
      query = officialQuery({
        prompt: rendered.prompt,
        options: claudeQueryOptions({
          options: this.options,
          model,
          rendered,
          executable,
          cwd: this.deps.cwd(),
          controller,
          spawn: spec => this.deps.spawn(spec),
          capture: (captured) => { child = captured },
        }),
      })
      const iterator = query[Symbol.asyncIterator]()
      while (true) {
        const next = await watchdog.next(iterator)
        if (next.done) break
        if (next.value.type === 'result') result = next.value
      }
    } catch (error: unknown) {
      throw this.queryFailure(error, options.signal, watchdog.signal)
    } finally {
      watchdog.signal.removeEventListener('abort', cancelQuery)
      consumer.abort(new Error('llm-claude-code: query consumer stopped'))
      await disposeQuery(query, child)
    }

    if (result === undefined) {
      throw new LlmError('llm-claude-code: the query ended without a result', 'STREAM_CLOSED')
    }
    if (result.subtype !== 'success' || result.is_error) throw resultFailure(result)
    return answerChunks(parseAnswer(result.structured_output), result.usage, result.uuid)
  }

  /** Resolve the installation's CLI, naming the fix when the host has none. */
  private async resolveExecutable(signal?: AbortSignal): Promise<string> {
    try {
      return await this.deps.resolveExecutable(this.options.env, signal)
    } catch (error: unknown) {
      throw new LlmError(
        `llm-claude-code: no "${CLAUDE_CODE_COMMAND}" executable on this host; install Claude Code`
        + ' or put its directory on the launching PATH',
        MISSING_EXECUTABLE_CODE,
        { cause: error },
      )
    }
  }

  /** Classify one failure raised while the query was running. */
  private queryFailure(error: unknown, caller: AbortSignal | undefined, fused: AbortSignal): LlmError {
    if (timeoutOf(fused, STREAM_IDLE_TIMEOUT_CODE) !== undefined) {
      return new LlmError(
        `llm-claude-code: the query produced nothing for ${this.options.queryTimeoutMs}ms`,
        'TIMEOUT',
        { cause: error },
      )
    }
    if (caller?.aborted === true) {
      return new LlmError('llm-claude-code: the query was aborted by the caller', 'ABORTED', { cause: error })
    }
    // The SDK reports some refusals by throwing rather than by publishing a
    // result, so the rendered chain is the only record of what the product
    // said; the durable failure carries the message, not the live cause.
    return new LlmError(
      `llm-claude-code: the query failed: ${errorChain(error)}`,
      'TRANSPORT',
      { cause: error },
    )
  }
}
