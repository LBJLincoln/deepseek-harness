/**
 * The route and model every reviewer session of an enterprise shift is
 * created with, composed apart from `agent-default-model`, which the
 * departments run on, so a shift can review on another model than it
 * implements with. The keyless composition names the scripted route's
 * reviewer model; the Claude Code overlay reads `DSH_ENTERPRISE_REVIEW_MODEL`.
 * An empty route or model fails the load; the driver then resolves the pair
 * through the LLM registry before any department runs, so a model the route
 * does not declare fails every ticket of the shift with the registry's reason.
 */

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The reviewer sessions' route and model. */
    enterpriseReviewModel: EnterpriseReviewModel
  }
}

/** Plugin config: the reviewer's route and model, both required. */
export interface Config {
  /** Registered provider route, such as `claude-code`. */
  provider: string
  /** Provider-owned model id, such as `sonnet`. */
  model: string
}

/** Holds the reviewer's selection the composition configured. */
export class EnterpriseReviewModel extends Service {
  static Config: z<Config> = z.object({
    provider: z.string().required(),
    model: z.string().required(),
  })

  /** The configured selection, detached from the config object. */
  readonly selection: Readonly<Config>

  constructor(ctx: Context, config: Config) {
    super(ctx, 'enterpriseReviewModel')
    for (const key of ['provider', 'model'] as const) {
      if (config[key].trim() === '') throw new Error(`enterprise-review-model: ${key} must name a ${key === 'provider' ? 'route' : 'model'}, got an empty string`)
    }
    this.selection = { provider: config.provider, model: config.model }
  }
}

export default EnterpriseReviewModel
