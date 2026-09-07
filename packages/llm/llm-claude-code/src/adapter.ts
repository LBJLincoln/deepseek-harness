/**
 * The adapter that serves this route: every `stream()` is one stateless query
 * to the operator's Claude Code installation through the official Agent SDK.
 *
 * The product executes no harness tool and reads no workspace — its built-in
 * tools and filesystem settings are switched off, and the only tools it is
 * offered are this route's own MCP declarations, which run nothing. Every tool
 * call comes back to the harness agent loop, which runs it exactly as it does
 * for any other route.
 *
 * @module @deepseek-ai/dsh-llm-claude-code/adapter
 */

import {
  query as officialQuery,
  type Options,
  type Query,
  type SDKAssistantMessage,
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
import { renderRequest } from './render.ts'
import { answerChunks, deliversAnswer, parseAnswer, resultFailure, TRANSPORT_CODE } from './response.ts'
import { MCP_SERVER_NAME, toolOffer } from './tools.ts'
import type {
  ClaudeCodeModel,
  RenderedRequest,
  ResolvedClaudeCodeOptions,
  ToolOffer,
} from './types.ts'

/**
 * Turn bound for every query, where a turn is one assistant message.
 *
 * One `generate()` is one model response, and this bound is what guarantees
 * it: the product answers once and the query ends. A reply that calls tools
 * reaches the bound after the product ran the offered call — the route's
 * declarations execute nothing — and the SDK reports that as `error_max_turns`
 * carrying the reply, which is this route's normal terminal for a tool-calling
 * answer rather than a failure. Fixed rather than configurable because it is
 * what makes one query one model response.
 */
export const MAX_TURNS = 1

/** Names a request that offers no tools accepts in a reply: none. */
const NO_OFFERED_TOOLS: ReadonlySet<string> = new Set()

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
  /** The request's tools as an in-process MCP server, absent when it offers none. */
  readonly offer: ToolOffer | undefined
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
 * @param spec - resolved route facts, rendered prompt, tool offer, and process ownership.
 * @returns options that give the product the harness prompt, the harness tools, and nothing else.
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
    includePartialMessages: true,
    maxTurns: MAX_TURNS,
    permissionMode: PERMISSION_MODE,
    // The product's own tools stay off, and the only names it may call are the
    // harness tools this request offered. No filesystem settings and no
    // persisted session: the query reads nothing else and leaves nothing.
    tools: [],
    allowedTools: spec.offer === undefined ? [] : [...spec.offer.allowedTools],
    disallowedTools: ['AskUserQuestion'],
    mcpServers: spec.offer === undefined ? {} : { [MCP_SERVER_NAME]: spec.offer.server },
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
 * Close the query and the tool server it was offered, terminate the managed
 * process tree, and wait for the subprocess owner to prove it is gone.
 * @param query - the published SDK query, when creation reached that point.
 * @param child - the shared handle owning the CLI process tree, when the SDK spawned one.
 * @param offer - the request's tool offer, when it carried tools.
 */
export async function disposeQuery(
  query: Pick<Query, 'close'> | undefined,
  child: SubprocessHandle | undefined,
  offer?: Pick<ToolOffer, 'close'>,
): Promise<void> {
  const failures: Error[] = []
  try {
    query?.close()
  } catch (error: unknown) {
    failures.push(thrown(error))
  }
  if (offer !== undefined) {
    try {
      await offer.close()
    } catch (error: unknown) {
      failures.push(thrown(error))
    }
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
    const offer = toolOffer(options.tools ?? [])
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
    const assistants: SDKAssistantMessage[] = []
    try {
      query = officialQuery({
        prompt: rendered.prompt,
        options: claudeQueryOptions({
          options: this.options,
          model,
          rendered,
          offer,
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
        if (next.value.type === 'assistant') assistants.push(next.value)
      }
    } catch (error: unknown) {
      const failure = this.queryFailure(error, options.signal, watchdog.signal)
      // The SDK reports a failed result by publishing it and then throwing. A
      // throw that follows a result is a second account of the same query, and
      // the result is the better one. Cancellation and idle expiry are the
      // exception: the harness stopped this query, so its own reason outranks
      // whatever the product managed to publish.
      if (result === undefined || failure.code !== TRANSPORT_CODE) throw failure
    } finally {
      watchdog.signal.removeEventListener('abort', cancelQuery)
      consumer.abort(new Error('llm-claude-code: query consumer stopped'))
      await disposeQuery(query, child, offer)
    }

    if (result === undefined) {
      throw new LlmError('llm-claude-code: the query ended without a result', 'STREAM_CLOSED')
    }
    if (!deliversAnswer(result, assistants)) throw resultFailure(result)
    const answer = parseAnswer(assistants, offer?.names ?? NO_OFFERED_TOOLS)
    return answerChunks(answer, result.usage, result.uuid)
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
      TRANSPORT_CODE,
      { cause: error },
    )
  }
}
