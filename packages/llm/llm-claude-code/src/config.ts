/**
 * Plugin configuration and the one explicit resolve step from raw config to
 * validated route facts.
 *
 * @module @deepseek-ai/dsh-llm-claude-code/config
 */

import z from '@deepseek-ai/schemastery'
import { resolveRetryPolicy, RetryPolicySchema } from '@deepseek-ai/dsh-llm'
import type { RetryPolicyConfig } from '@deepseek-ai/dsh-llm'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import type {
  ClaudeCodeEffort,
  ClaudeCodeModel,
  ClaudeCodeThinking,
  ResolvedClaudeCodeOptions,
  SessionContinuity,
} from './types.ts'

/**
 * Idle interval between messages of one query. The product streams partial
 * assistant events while it works, so this bounds a silent installation rather
 * than the answer's own duration.
 */
export const DEFAULT_QUERY_TIMEOUT_MS = 300_000

/** Grace between process-tree termination tiers for the installation's CLI. */
export const DEFAULT_DISPOSE_GRACE_MS = 3_000

/** Selectable response efforts, in the product's own order. */
export const CLAUDE_CODE_EFFORTS: readonly ClaudeCodeEffort[] = Object.freeze([
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
])

/** Selectable relationships between a harness session and the product's own. */
export const SESSION_CONTINUITIES: readonly SessionContinuity[] = Object.freeze(['per-query', 'per-session'])

/**
 * Default continuity. Resuming reads the conversation prefix from the
 * installation's prompt cache instead of rewriting it every step, which a
 * ten-step probe measured as an 83 percent cache-read share against zero for a
 * fresh query per step.
 */
export const DEFAULT_SESSION_CONTINUITY: SessionContinuity = 'per-session'

/**
 * Product sessions kept resumable at once by default.
 *
 * One entry per harness session that is between steps, and each entry owns a
 * transcript on disk until it is evicted. The widest fan-out a current consumer
 * runs is the Proving Ground bench's 18 concurrent cells, so this leaves room
 * for several such runs sharing one harness process.
 */
export const DEFAULT_RESUMABLE_SESSION_LIMIT = 64

/**
 * Deployment-owned route facts. The model catalog is configuration with no
 * default: only the operator knows which models their installation may run,
 * and this plugin names none.
 */
export interface Config {
  /** Provider route this plugin registers on `ctx.llm`. */
  provider: string
  /** Route name shown by provider selectors; the route name when absent. */
  displayName?: string
  /** Models this route accepts; a request naming any other fails with `UNKNOWN_MODEL`. */
  models: ClaudeCodeModel[]
  /**
   * Explicit environment entries layered over the subprocess seam's
   * credential-scrubbed parent environment.
   */
  env?: Record<string, string>
  /** Response effort for every query; absent keeps the installation's own. */
  effort?: ClaudeCodeEffort
  /** Thinking policy for every query; absent keeps the installation's own. */
  thinking?: ClaudeCodeThinking
  /** Maximum idle interval between messages of one query (default five minutes). */
  queryTimeoutMs?: number
  /** Grace in milliseconds for CLI process-tree termination (default 3000). */
  disposeGraceMs?: number
  /**
   * Whether a harness session's steps share one product session
   * (default `per-session`), or each step is its own query (`per-query`).
   */
  sessionContinuity?: SessionContinuity
  /**
   * Product sessions kept resumable at once under `per-session` (default 64).
   * Evicting one releases its transcript from the installation's store.
   */
  resumableSessionLimit?: number
  /** Provider-owned model-request retry policy; omission uses normal defaults. */
  retryPolicy?: RetryPolicyConfig
}

const modelSchema: z<ClaudeCodeModel> = z.object({
  id: z.string().required(),
  productModel: z.string(),
  name: z.string(),
  description: z.string(),
  contextWindow: z.number().step(1).min(1),
})

const thinkingSchema: z<ClaudeCodeThinking> = z.union([
  z.object({ type: z.const('adaptive').required() }),
  z.object({
    type: z.const('enabled').required(),
    budgetTokens: z.number().step(1).min(1).required(),
  }),
  z.object({ type: z.const('disabled').required() }),
])

export const Config: z<Config> = z.object({
  provider: z.string().required(),
  displayName: z.string(),
  models: z.array(modelSchema).required(),
  env: z.dict(z.string()).default({}),
  effort: z.union([...CLAUDE_CODE_EFFORTS]),
  thinking: thinkingSchema,
  queryTimeoutMs: z.number().min(Number.MIN_VALUE).max(MAX_TIMER_DELAY_MS).default(DEFAULT_QUERY_TIMEOUT_MS),
  disposeGraceMs: z.number().min(Number.MIN_VALUE).max(MAX_TIMER_DELAY_MS).default(DEFAULT_DISPOSE_GRACE_MS),
  sessionContinuity: z.union([...SESSION_CONTINUITIES]).default(DEFAULT_SESSION_CONTINUITY),
  resumableSessionLimit: z.number().step(1).min(1).default(DEFAULT_RESUMABLE_SESSION_LIMIT),
  retryPolicy: RetryPolicySchema,
})

function assertTimer(value: number, field: string): void {
  if (!Number.isFinite(value) || value <= 0 || value > MAX_TIMER_DELAY_MS) {
    throw new Error(
      `llm-claude-code: ${field} must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`,
    )
  }
}

function assertPositiveInteger(value: number | undefined, field: string): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
    throw new Error(`llm-claude-code: ${field} must be a positive safe integer`)
  }
}

/** Validate, deduplicate, and detach the operator-declared model catalog. */
function resolveModels(models: readonly ClaudeCodeModel[]): ClaudeCodeModel[] {
  if (models.length === 0) {
    throw new Error('llm-claude-code: models must declare at least one model this installation may run')
  }
  const seen = new Set<string>()
  return models.map((model) => {
    if (model.id.length === 0) throw new Error('llm-claude-code: model ids must be non-empty')
    if (seen.has(model.id)) throw new Error(`llm-claude-code: duplicate model "${model.id}"`)
    seen.add(model.id)
    if (model.productModel !== undefined && model.productModel.length === 0) {
      throw new Error(`llm-claude-code: model "${model.id}" productModel must be non-empty when present`)
    }
    if (model.name !== undefined && model.name.length === 0) {
      throw new Error(`llm-claude-code: model "${model.id}" has an empty name`)
    }
    assertPositiveInteger(model.contextWindow, `model "${model.id}" contextWindow`)
    return {
      id: model.id,
      ...model.productModel === undefined ? {} : { productModel: model.productModel },
      ...model.name === undefined ? {} : { name: model.name },
      ...model.description === undefined ? {} : { description: model.description },
      ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
    }
  })
}

/** Validate and detach the thinking policy handed to the product unchanged. */
function resolveThinking(thinking: ClaudeCodeThinking | undefined): ClaudeCodeThinking | undefined {
  if (thinking === undefined) return undefined
  switch (thinking.type) {
    case 'adaptive':
    case 'disabled':
      return { type: thinking.type }
    case 'enabled':
      if (!Number.isSafeInteger(thinking.budgetTokens) || thinking.budgetTokens <= 0) {
        throw new Error('llm-claude-code: thinking.budgetTokens must be a positive safe integer')
      }
      return { type: 'enabled', budgetTokens: thinking.budgetTokens }
    default:
      throw new Error('llm-claude-code: thinking.type must be "adaptive", "enabled", or "disabled"')
  }
}

/**
 * Resolve raw plugin config into the immutable facts every request uses.
 * Programmatic construction may bypass Schemastery normalization, so every
 * default and bound is re-judged here and a bad composition fails at load.
 * @param config - raw plugin config from `cordis.yml` or a direct mount.
 * @returns validated, detached route facts.
 */
export function resolveAdapterOptions(config: Config): ResolvedClaudeCodeOptions {
  if (typeof config.provider !== 'string' || config.provider.length === 0) {
    throw new Error('llm-claude-code: provider must name the route this plugin registers')
  }
  if (config.displayName !== undefined && config.displayName.length === 0) {
    throw new Error('llm-claude-code: displayName must be non-empty when present')
  }
  if (config.effort !== undefined && !CLAUDE_CODE_EFFORTS.includes(config.effort)) {
    throw new Error(`llm-claude-code: effort must be one of ${CLAUDE_CODE_EFFORTS.join(', ')}`)
  }
  const queryTimeoutMs = config.queryTimeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS
  const disposeGraceMs = config.disposeGraceMs ?? DEFAULT_DISPOSE_GRACE_MS
  assertTimer(queryTimeoutMs, 'queryTimeoutMs')
  assertTimer(disposeGraceMs, 'disposeGraceMs')
  const sessionContinuity = config.sessionContinuity ?? DEFAULT_SESSION_CONTINUITY
  if (!SESSION_CONTINUITIES.includes(sessionContinuity)) {
    throw new Error(`llm-claude-code: sessionContinuity must be one of ${SESSION_CONTINUITIES.join(', ')}`)
  }
  const resumableSessionLimit = config.resumableSessionLimit ?? DEFAULT_RESUMABLE_SESSION_LIMIT
  assertPositiveInteger(resumableSessionLimit, 'resumableSessionLimit')
  const thinking = resolveThinking(config.thinking)
  return Object.freeze({
    provider: config.provider,
    displayName: config.displayName ?? config.provider,
    models: Object.freeze(resolveModels(config.models)),
    env: Object.freeze({ ...config.env }),
    ...config.effort === undefined ? {} : { effort: config.effort },
    ...thinking === undefined ? {} : { thinking },
    queryTimeoutMs,
    disposeGraceMs,
    sessionContinuity,
    resumableSessionLimit,
    retryPolicy: resolveRetryPolicy(config.retryPolicy, 'llm-claude-code: retryPolicy'),
  })
}
