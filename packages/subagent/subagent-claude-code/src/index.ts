/**
 * Fixed Claude Code one-shot subagent provider. Every accepted run invokes
 * the official Agent SDK in the delegating Session's workspace and places
 * the SDK-spawned real CLI under the shared subprocess owner.
 *
 * @module @deepseek-ai/dsh-subagent-claude-code
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import {
  assertOutOfProcessAllowed,
  assertPositiveFinite,
  enforceOutOfProcessRefusal,
  NO_START_CAPABILITIES,
  resolveChildCwd,
  type ResolvedSubagentStartRequest,
  type SubagentCapabilities,
  type SubagentProvider,
} from '@deepseek-ai/dsh-subagent'
import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk'
import {
  DEFAULT_DISPOSE_GRACE_MS,
  PERMISSION_MODES,
  startClaudeCodeRun,
  type ClaudeCodeRunSpec,
} from './run.ts'
import { openBridgedRun } from './bridge.ts'
// Side-effect type import: declares the three `bridge/*` session events and the
// `AgentOptions.maxTurns` ceiling this provider reads.
import type {} from './types.ts'

export type { BridgeAssistantData, BridgeEndData, BridgeStartData } from './types.ts'
export {
  BRIDGE_SERVER_NAME,
  BRIDGE_TOOL_DENIAL,
  BRIDGE_TOOL_PREFIX,
  SUBAGENT_BRIDGE_UNAVAILABLE,
} from './bridge.ts'

export const name = 'subagent-claude-code'
export const inject = ['subagents', 'subprocess']

/* jscpd:ignore-start -- sibling product providers intentionally expose the
 * same two deployment-owned fields without adding a shared config owner. */
/** Deployment-owned environment, process-release bound, and product permission policy. */
export interface Config {
  /**
   * Explicit environment entries layered over the subprocess seam's
   * credential-scrubbed parent environment.
   */
  env?: Record<string, string>
  /** Grace in milliseconds for Claude Code process-tree termination. */
  disposeGraceMs?: number
  /**
   * Permission mode the product runs its own tools under, in both modes.
   * Omitted leaves the product's own default, which prompts for operations
   * like a file write and therefore fails an unattended run. `bypassPermissions`
   * additionally sets the SDK's `allowDangerouslySkipPermissions`, because the
   * deployment naming it here IS the intentional bypass that flag guards.
   */
  permissionMode?: PermissionMode
  /**
   * Tool names the product auto-approves without a permission prompt, in the
   * BLACK-BOX mode only: bridge mode serves the harness registry and keeps its
   * own fixed allowlist and denial callback. Empty leaves the product's default.
   */
  allowedTools?: string[]
}

export const Config: z<Config> = z.object({
  env: z.dict(z.string()).default({}),
  disposeGraceMs: z.number().default(DEFAULT_DISPOSE_GRACE_MS),
  permissionMode: z.union(PERMISSION_MODES),
  allowedTools: z.array(z.string()).default([]),
})

type ResolvedConfig = Omit<Required<Config>, 'permissionMode'> & Pick<Config, 'permissionMode'>
/* jscpd:ignore-end */

/* jscpd:ignore-start -- Cordis registration and shared-seam plumbing mirror
 * the Codex sibling; each product's lifecycle remains package-private. */
class ClaudeCodeProvider implements SubagentProvider {
  readonly name = 'claude-code'
  /**
   * `harnessTools` is enforced in this process — the harness composes the child
   * agent whose tools it serves, rather than promising the product anything —
   * and `model` is carried to the product's own `--model`, which refuses an
   * identifier it does not accept instead of running another one.
   */
  readonly capabilities: SubagentCapabilities = {
    ...NO_START_CAPABILITIES,
    harnessTools: true,
    model: true,
  }
  readonly inheritsParentContext = false

  constructor(
    private readonly ctx: Context,
    private readonly config: ResolvedConfig,
  ) {}

  async start(request: ResolvedSubagentStartRequest) {
    assertOutOfProcessAllowed(this.ctx, request.parent)
    const parentCwd = request.parent.session.header.cwd
    if (parentCwd === undefined) {
      throw new Error(
        'subagent-claude-code: no working directory for the child — delegate from a parent session that has one',
      )
    }
    const executable = await this.ctx.subprocess.resolveExecutable(
      'claude',
      this.config.env,
      request.signal,
    )
    const bridge = request.harnessTools === undefined
      ? undefined
      : await openBridgedRun({ ctx: this.ctx, request, provider: this.name })
    const spec: ClaudeCodeRunSpec = {
      cwd: resolveChildCwd(
        'subagent-claude-code',
        undefined,
        parentCwd,
      ),
      executable,
      env: this.config.env,
      disposeGraceMs: this.config.disposeGraceMs,
      spawn: spawnSpec => this.ctx.subprocess.spawn(spawnSpec),
      onError: (error, stopReason) => {
        this.ctx.logger.warn(
          `subagent-claude-code: child run failed (${stopReason}): ${error.message}`,
        )
      },
      ...this.config.permissionMode === undefined ? {} : { permissionMode: this.config.permissionMode },
      ...request.model === undefined ? {} : { model: request.model },
      // Black-box only: bridge mode serves the harness registry and owns its
      // own allowlist, which a deployment list must not widen.
      ...bridge === undefined ? { allowedTools: this.config.allowedTools } : { bridge },
    }
    try {
      return await startClaudeCodeRun(request, spec)
    } catch (error: unknown) {
      // Startup failed after the child agent was published: release it here,
      // because no run was returned for the caller to dispose.
      await bridge?.release()
      throw error
    }
  }
}

/**
 * Register the fixed `claude-code` provider.
 * @param ctx - context carrying shared subagent and subprocess services.
 * @param config - explicit child environment and disposal grace.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = config as ResolvedConfig
  assertPositiveFinite(
    'subagent-claude-code',
    'disposeGraceMs',
    resolved.disposeGraceMs,
  )
  if (resolved.disposeGraceMs > MAX_TIMER_DELAY_MS) {
    throw new Error(
      `subagent-claude-code: disposeGraceMs must be no greater than ${MAX_TIMER_DELAY_MS}`,
    )
  }
  ctx.subagents.registerProvider(new ClaudeCodeProvider(ctx, resolved))
  enforceOutOfProcessRefusal(ctx)
}
/* jscpd:ignore-end */
