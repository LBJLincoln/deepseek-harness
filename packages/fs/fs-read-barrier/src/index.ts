/**
 * Event-only filesystem read policy; it registers no service and declares no
 * config, because every deployment-varying value belongs to `ctx.readBarrier`.
 * It is the read counterpart of the write and edit policy
 * `@deepseek-ai/dsh-fs-observation-policy` contributes through the same `fs/*`
 * event gate: it decides `fs/read-intent`, refusing a target the barrier denies
 * to the calling session's role and delegating every other read. See the
 * package README for composition rules.
 * @module @deepseek-ai/dsh-fs-read-barrier
 */

import type { Context } from '@deepseek-ai/cordis'
import type { FsReadDenial, FsTarget } from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-read-barrier'
import type { Session } from '@deepseek-ai/dsh-session'
import type { FsReadBarrierActor } from './types.ts'

export type * from './types.ts'

/**
 * The complete model-facing account of one refused read. No recovery
 * instruction follows it: no retry of the same call succeeds.
 * @param displayPath - the model-facing path of the refused target.
 * @returns the exact denial message.
 */
export function readBarrierDenialMessage(displayPath: string): string {
  return `read denied: "${displayPath}" is validator-owned — it is not part of this task; continue without it`
}

/**
 * Find the session a read runs for by narrowing the opaque event actor.
 * @param actor - the tool-execution context the read executor dispatched with.
 * @returns the calling session, or `undefined` for a call with no agent.
 */
function sessionOf(actor: object | undefined): Session | undefined {
  // tsgolint treats object as assignable to weak FsReadBarrierActor, while tsc still requires the structural cast for property access.
  // See the analyzer-divergence consequence in .agents/notes/implemented/process/2026-07-29-oxlint-linter.md.
  // oxlint-disable-next-line typescript/no-unnecessary-type-assertion -- The analyzers disagree on this weak type.
  return (actor as FsReadBarrierActor | undefined)?.agent?.session
}

/** Cordis plugin name used by loader diagnostics. */
export const name = 'fs-read-barrier'

/** The barrier owns every deployment-varying value this plugin decides from. */
export const inject = ['readBarrier']

/**
 * Decide one dispatched read.
 * @param ctx - the plugin context carrying the barrier service.
 * @param target - the resolved target the executor is about to read.
 * @param actor - the opaque tool-execution context.
 * @returns the refusal, or `undefined` to delegate to the next read policy.
 */
async function decide(ctx: Context, target: FsTarget, actor: object | undefined): Promise<FsReadDenial | undefined> {
  const session = sessionOf(actor)
  if (session === undefined) return undefined
  const policy = ctx.readBarrier.resolve({ session })
  if (!await ctx.readBarrier.denies(policy, target)) return undefined
  const denial = ctx.readBarrier.recordDenial(session, policy, 'fs', target)
  return { code: 'FS_READ_BARRIER_DENIED', message: readBarrierDenialMessage(denial.displayPath) }
}

/**
 * Register the `fs/read-intent` listener.
 * @param ctx - the plugin context; the registration is an effect scoped to it.
 */
export function apply(ctx: Context): void {
  // Delegating, not single-slot: a barrier that owned the slot would stop every
  // later read policy from deciding. The waterfall is unbound (the executor
  // dispatches it with no `this`), so the listener takes the raw arguments.
  ctx.on('fs/read-intent', async (target, actor, next) => await decide(ctx, target, actor) ?? await next())
  // What makes the scope census report `fs` as `denied-at-executor`: the
  // registration lives exactly as long as the listener above.
  ctx.readBarrier.enforce('fs')
}
