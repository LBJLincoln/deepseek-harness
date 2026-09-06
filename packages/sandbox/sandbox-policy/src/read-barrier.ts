/**
 * The registration every sandbox-consuming executor makes with the read
 * barrier. A capability may claim `denied-at-executor` only when its own
 * confinement really would deny the barrier's directories on this host, so the
 * registration probes the SAME wrap the executor performs for a real call and
 * records why it cannot whenever that wrap refuses.
 *
 * It lives beside the policy the executors already resolve here because the
 * decision needs both halves — the deployment's sandbox mode and the barrier's
 * denied set — and duplicating it per executor would let one of them claim an
 * enforcement its own backend never applies.
 *
 * @module @deepseek-ai/dsh-sandbox-policy/read-barrier
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import type { ReadBarrierEnforcedCapability } from '@deepseek-ai/dsh-read-barrier'

/** Why an executor running under the unconfining mode denies nothing. */
const FULL_ACCESS = 'the deployment sandbox mode is danger-full-access, which runs commands unconfined'

/**
 * Register `capability`'s read-barrier enforcement once the barrier is
 * composed, deciding between `denied-at-executor` and a reasoned `unenforced`
 * by probing this host's confinement.
 *
 * The probe carries the barrier's own root as the denied directory: it always
 * exists and is always denied to an implementer, so a backend that can express
 * it can express every other directory the barrier collects.
 *
 * The registration waits for all three of `readBarrier`, `sandboxPolicy`, and
 * `sandbox`, and unwinds with any of them: Loader siblings mount concurrently,
 * so probing before the provider exists would record a claim about a
 * confinement that was merely late. A composition missing one of the three
 * registers nothing, which the census already reports as `unenforced`.
 *
 * @param ctx - the executor's plugin context.
 * @param capability - the path-opening capability this executor provides.
 * @param wrap - performs one representative confinement under the probe policy,
 *   through the injected scope so the provider resolves without a second
 *   declaration; it must throw exactly when this host cannot confine that
 *   policy, which is what the executor's own calls would do.
 */
export function enforceReadBarrier(
  ctx: Context,
  capability: ReadBarrierEnforcedCapability,
  wrap: (policy: SandboxPolicy, scope: Context) => void,
): void {
  ctx.inject(['readBarrier', 'sandboxPolicy', 'sandbox'], (scope: Context) => {
    const barrier = scope.readBarrier
    const policy = scope.sandboxPolicy.resolve()
    if (policy.mode === 'danger-full-access') {
      barrier.cannotEnforce(capability, FULL_ACCESS)
      return
    }
    try {
      wrap({ ...policy, mode: policy.mode, deniedReadRoots: [barrier.root] }, scope)
    } catch (error: unknown) {
      barrier.cannotEnforce(capability, error instanceof Error ? error.message : String(error))
      return
    }
    barrier.enforce(capability)
  })
}
