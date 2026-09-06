/**
 * What every OUT-OF-PROCESS subagent provider does about the read barrier. Such
 * a child launches a foreign agent with its own tool stack and no harness
 * policy, so no fence this process installs reaches its reads: the only denial
 * available to it is not starting.
 *
 * In-process drivers need none of this. A child that joins its parent's standing
 * composition through `composeFrom()` inherits the same census, the same scope
 * layer, and the same role, so the parent's own executors already deny it.
 *
 * @module @deepseek-ai/dsh-subagent/read-barrier
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-read-barrier'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SubagentError } from './error.ts'

/** Code carried by the refusal, so a caller routes it without parsing the message. */
export const SUBAGENT_READ_BARRIER_REFUSED = 'READ_BARRIER_REFUSED'

/**
 * Record that this provider enforces the read barrier by refusing to start.
 * Loader siblings mount concurrently, so the registration waits for the barrier
 * and unwinds with it; a composition with no barrier registers nothing.
 * @param ctx - the provider's plugin context.
 */
export function enforceOutOfProcessRefusal(ctx: Context): void {
  ctx.inject(['readBarrier'], (scope: Context) => { scope.readBarrier.enforceByRefusal('subagent') })
}

/**
 * Refuse one out-of-process child the read barrier will not allow, in the
 * operation that would launch it.
 * @param ctx - the provider's plugin context; the barrier is optional.
 * @param parent - the delegating parent agent, whose session holds the role.
 * @throws {@link SubagentError} with {@link SUBAGENT_READ_BARRIER_REFUSED} when
 *   the barrier refuses this session's out-of-process children.
 */
export function assertOutOfProcessAllowed(ctx: Context, parent: Agent): void {
  const refusal = ctx.get('readBarrier')?.startRefusal('subagent', parent.session)
  if (refusal !== undefined) throw new SubagentError(refusal, SUBAGENT_READ_BARRIER_REFUSED)
}
