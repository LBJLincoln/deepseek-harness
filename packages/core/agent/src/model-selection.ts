/**
 * Agent-scoped model selection shared by runtime entry points.
 * @module @deepseek-ai/dsh-agent/model-selection
 */

import type { Context } from '@deepseek-ai/cordis'
import type { LlmCallConfig, ReasoningEffortId } from '@deepseek-ai/dsh-llm'

/** Complete provider, model, and optional reasoning effort selected for one live Agent. */
export interface ModelSelection {
  /** Registered provider route. */
  provider: string
  /** Provider-owned model id. */
  model: string
  /** Adapter-owned reasoning effort, or provider/default behavior when absent. */
  reasoningEffort?: ReasoningEffortId
}

/**
 * Sampling scalars an entry point pins for every request of one Agent. They
 * are deliberately not part of {@link ModelSelection}: a person picking a model
 * picks a route and an effort, while these are chosen by whatever composed the
 * Agent — an evaluation cell that must sample identically on every request, for
 * instance.
 */
export interface AgentSampling {
  /**
   * Sampling seed, a safe non-negative integer. A provider that honours it
   * samples reproducibly for one identical request; it promises nothing across
   * model or infrastructure versions.
   */
  readonly seed?: number
  /** Nucleus-sampling mass between 0 and 1. */
  readonly topP?: number
}

/** Mutable model selection plus the value captured for the current step. */
export interface ModelSelectionRef {
  /** Model selected for the next step that enters prompt assembly. */
  current: ModelSelection | undefined
  /** Selection captured when the current step entered prompt assembly. */
  assembled: ModelSelection | undefined
  /**
   * Sampling scalars every request of this Agent carries, absent to leave the
   * proposed configuration's own sampling in place. Unlike {@link current} it
   * is read as each request is built rather than at prompt assembly, because
   * nothing about it varies per step.
   */
  sampling?: AgentSampling
}

/** Overlay the pinned sampling scalars, leaving a configuration alone when none are pinned. */
function withSampling(config: LlmCallConfig, sampling: AgentSampling | undefined): LlmCallConfig {
  if (sampling === undefined) return config
  return {
    ...config,
    ...sampling.seed === undefined ? {} : { seed: sampling.seed },
    ...sampling.topP === undefined ? {} : { topP: sampling.topP },
  }
}

/**
 * Couple one mutable selection to Agent-scoped prompt assembly and request routing.
 * Prompt assembly snapshots the selected model before delegating, then applies
 * its provider/model pair and effort to request config so a
 * concurrent switch takes effect on a later step instead of splitting the two
 * surfaces. An absent selected effort clears any inherited effort, restoring
 * the selected model's provider/default behavior. Pinned
 * {@link ModelSelectionRef.sampling} is applied to every request, whether or
 * not a model is selected.
 *
 * @param agentCtx - The selected Agent's scoped context.
 * @param selection - Mutable selection and pinned sampling owned by the calling entry point.
 * @returns Disposer for both scoped waterfall listeners.
 */
export function installModelSelection(agentCtx: Context, selection: ModelSelectionRef): () => void {
  const disposeAssembly = agentCtx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const selected = selection.current
    const assembled = await next()
    selection.assembled = selected
    if (selected === undefined) return assembled
    return {
      ...assembled,
      variables: {
        ...assembled.variables,
        provider: selected.provider,
        model: selected.model,
      },
    }
  })
  const disposeRequest = agentCtx.on(
    'agent/request',
    async (_payload, next): Promise<LlmCallConfig> => {
      const sampled = withSampling(await next(), selection.sampling)
      const selected = selection.assembled
      if (selected === undefined) return sampled
      const { reasoningEffort: _inheritedEffort, ...withoutInheritedEffort } = sampled
      return {
        ...withoutInheritedEffort,
        provider: selected.provider,
        model: selected.model,
        ...selected.reasoningEffort === undefined
          ? {}
          : { reasoningEffort: selected.reasoningEffort },
      }
    },
  )
  return () => {
    disposeAssembly()
    disposeRequest()
  }
}
