/**
 * Tests for the sandbox-policy home: the deployment default (mode +
 * workspaceRoot) the service exposes, the read barrier's denied directories and
 * granted workspace the resolved policy carries, the enforcement each sandbox-consuming executor
 * registers, and the per-session `sandbox/mode` override kit (fold + write path)
 * every enforcing capability reads.
 */

import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import ReadBarrierService from '@deepseek-ai/dsh-read-barrier'
import { SandboxProvider } from '@deepseek-ai/dsh-sandbox'
import type { ConfinedArgv, SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SandboxPolicyService, { SANDBOX_MODES, effectiveSandboxMode, enforceReadBarrier, setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import SystemPrompt, { renderContextSnapshot, renderPrompt } from '@deepseek-ai/dsh-system-prompt'

const barrierRoots: string[] = []

/** A fresh owner-only directory for one barrier under test, removed after it. */
function barrierRoot(prefix: string): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  barrierRoots.push(root)
  return root
}

afterEach(() => {
  for (const root of barrierRoots) rmSync(root, { recursive: true, force: true })
  barrierRoots.length = 0
})

async function mounted(config: { mode?: 'read-only' | 'workspace-write' | 'danger-full-access'; workspaceRoot?: string } = {}) {
  const ctx = new Context()
  await ctx.plugin(SandboxPolicyService, config)
  return ctx
}

function session(id: string, cwd?: string): Session {
  const sessionId = SessionId(id)
  return Session.create(sessionId, undefined, {
    version: 0,
    id: sessionId,
    createdAt: 0,
    ...cwd === undefined ? {} : { cwd },
  })
}

function agentFor(activeSession: Session): Agent {
  return { id: activeSession.id, session: activeSession } as unknown as Agent
}

async function policyContext(ctx: Context, activeSession: Session): Promise<string | undefined> {
  return (await ctx.systemPrompt.assemble({ agent: agentFor(activeSession) }))
    .contexts.find(context => context.name === 'sandbox:policy')?.text
}

describe('SandboxPolicyService', () => {
  it('defaults to read-only under the process cwd', async () => {
    const ctx = await mounted()
    expect(ctx.sandboxPolicy.defaultMode).toBe('read-only')
    expect(ctx.sandboxPolicy.workspaceRoot).toBe(resolve(process.cwd()))
  })

  it('carries a configured mode and resolves the workspace root absolute', async () => {
    const ctx = await mounted({ mode: 'workspace-write', workspaceRoot: '/ws/../ws/./sub' })
    expect(ctx.sandboxPolicy.defaultMode).toBe('workspace-write')
    expect(ctx.sandboxPolicy.workspaceRoot).toBe(resolve('/ws/../ws/./sub'))
  })

  it('resolves the deployment policy for an agentless call', async () => {
    const ctx = await mounted({ mode: 'workspace-write', workspaceRoot: '/fallback' })
    expect(ctx.sandboxPolicy.resolve()).toEqual({
      mode: 'workspace-write',
      workspaceRoot: resolve('/fallback'),
      deniedReadRoots: [],
    })
  })

  it('resolves each session mode and cwd together without changing the fallback', async () => {
    const ctx = await mounted({ mode: 'workspace-write', workspaceRoot: '/fallback' })
    const first = session('sess-first', '/projects/first')
    const second = session('sess-second', '/projects/second')
    setSandboxMode(second, 'read-only')

    expect(ctx.sandboxPolicy.resolve({ session: first })).toEqual({
      mode: 'workspace-write',
      workspaceRoot: resolve('/projects/first'),
      deniedReadRoots: [],
      sessionId: 'sess-first',
    })
    expect(ctx.sandboxPolicy.resolve({ session: second })).toEqual({
      mode: 'read-only',
      workspaceRoot: resolve('/projects/second'),
      deniedReadRoots: [],
      sessionId: 'sess-second',
    })
    expect(ctx.sandboxPolicy.overrideOf(first)).toBeUndefined()
    expect(ctx.sandboxPolicy.overrideOf(second)).toBe('read-only')
    expect(ctx.sandboxPolicy.resolve()).toEqual({
      mode: 'workspace-write',
      workspaceRoot: resolve('/fallback'),
      deniedReadRoots: [],
    })
  })

  it.skipIf(process.platform === 'win32')('resolves a symlink-sensitive session cwd with POSIX component semantics', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-policy-cwd-'))
    try {
      const lexical = join(root, 'lexical')
      const physical = join(root, 'physical')
      const child = join(physical, 'child')
      mkdirSync(lexical)
      mkdirSync(child, { recursive: true })
      const link = join(lexical, 'link')
      symlinkSync(child, link, 'dir')
      const cwd = `${link}${sep}..`
      const ctx = await mounted({ mode: 'workspace-write', workspaceRoot: '/fallback' })

      expect(ctx.sandboxPolicy.resolve({ session: session('sess-symlink-parent', cwd) })).toEqual({
        mode: 'workspace-write',
        workspaceRoot: realpathSync.native(physical),
        deniedReadRoots: [],
        sessionId: 'sess-symlink-parent',
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('lets an approved mode outrank the session mode while retaining its root', async () => {
    const ctx = await mounted({ workspaceRoot: '/fallback' })
    const active = session('sess-approved', '/projects/approved')
    setSandboxMode(active, 'read-only')
    expect(ctx.sandboxPolicy.resolve({ session: active, mode: 'danger-full-access' })).toEqual({
      mode: 'danger-full-access',
      workspaceRoot: resolve('/projects/approved'),
      deniedReadRoots: [],
      sessionId: 'sess-approved',
    })
  })

  it('uses the configured root when a session has no cwd', async () => {
    const ctx = await mounted({ workspaceRoot: '/fallback' })
    expect(ctx.sandboxPolicy.resolve({ session: session('sess-no-cwd') }).workspaceRoot).toBe(resolve('/fallback'))
  })

  it('rejects a mode outside the closed vocabulary at load', async () => {
    const ctx = new Context()
    // schemastery rejects the union violation when the plugin loads.
    await expect(ctx.plugin(SandboxPolicyService, { mode: 'yolo' as never })).rejects.toThrow()
  })

  it('disposes the service and context contribution from a child fiber (HMR safety)', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    const fiber = await ctx.plugin(SandboxPolicyService, {})
    expect(ctx.sandboxPolicy).toBeDefined()
    expect(await policyContext(ctx, session('sess-hmr'))).toContain('read-only')
    await fiber.dispose()
    expect(ctx.get('sandboxPolicy')).toBeUndefined()
    expect((await ctx.systemPrompt.assemble()).contexts.find(context => context.name === 'sandbox:policy')).toBeUndefined()
  })
})

describe('sandbox:policy request context', () => {
  async function promptMounted(config: { mode?: 'read-only' | 'workspace-write' | 'danger-full-access'; workspaceRoot?: string } = {}): Promise<Context> {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(SandboxPolicyService, config)
    return ctx
  }

  it.each(['read-only', 'workspace-write', 'danger-full-access'] as const)('renders the exact %s policy without a capability inventory', async (mode) => {
    const ctx = await promptMounted({ mode, workspaceRoot: '/fallback' })
    const workspaceRoot = resolve('/projects/current')
    const expected = {
      'read-only': 'Current DSH file policy: read-only. Any available operation enforced by the DSH file sandbox cannot modify files in the standing mode. Do not refuse a required modification from this policy alone: try an available tool normally and follow any denial and escalation guidance it returns.',
      'workspace-write': `Current DSH file policy: workspace-write. Any available operation enforced by the DSH file sandbox may modify files under the session workspace: ${JSON.stringify(workspaceRoot)}. Some platform temporary areas may also be writable.`,
      'danger-full-access': 'Current DSH file policy: danger-full-access. The DSH file sandbox does not restrict file modifications by available operations.',
    } as const

    expect(await policyContext(ctx, session(`sess-${mode}`, '/projects/../projects/current'))).toBe(expected[mode])
  })

  it('keeps the complete rendered prompt byte-stable across TMPDIR changes', async () => {
    const ctx = await promptMounted({ mode: 'workspace-write' })
    const active = session('sess-tmpdir-stability', '/projects/current')
    const previous = process.env.TMPDIR
    try {
      process.env.TMPDIR = '/tmp/first-host-temp'
      const firstAssembly = await ctx.systemPrompt.assemble({ agent: agentFor(active) })
      const firstPrompt = renderPrompt(firstAssembly)
      const firstContext = renderContextSnapshot(firstAssembly)
      process.env.TMPDIR = '/tmp/second-host-temp'
      const secondAssembly = await ctx.systemPrompt.assemble({ agent: agentFor(active) })
      expect(renderPrompt(secondAssembly)).toBe(firstPrompt)
      expect(renderContextSnapshot(secondAssembly)).toBe(firstContext)
      expect(firstContext).not.toContain('host-temp')
    } finally {
      if (previous === undefined) delete process.env.TMPDIR
      else process.env.TMPDIR = previous
    }
  })

  it('reflects the latest durable switch on the next assembly and stays byte-stable otherwise', async () => {
    const ctx = await promptMounted()
    const active = session('sess-switch', '/projects/current')
    const first = await policyContext(ctx, active)
    expect(await policyContext(ctx, active)).toBe(first)

    setSandboxMode(active, 'danger-full-access')
    const danger = await policyContext(ctx, active)
    expect(danger).toBe('Current DSH file policy: danger-full-access. The DSH file sandbox does not restrict file modifications by available operations.')
    expect(await policyContext(ctx, active)).toBe(danger)

    setSandboxMode(active, 'workspace-write')
    expect(await policyContext(ctx, active)).toBe(`Current DSH file policy: workspace-write. Any available operation enforced by the DSH file sandbox may modify files under the session workspace: ${JSON.stringify(resolve('/projects/current'))}. Some platform temporary areas may also be writable.`)
  })

  it('reconstructs resumed policy from the session log and omits diagnostics without an agent', async () => {
    const active = session('sess-resume', '/projects/current')
    setSandboxMode(active, 'workspace-write')
    const resumed = Session.create(active.id, active.events, active.header)
    const ctx = await promptMounted({ mode: 'read-only' })

    expect(await policyContext(ctx, resumed)).toContain('workspace-write')
    expect((await ctx.systemPrompt.assemble()).contexts.find(context => context.name === 'sandbox:policy')?.text).toBe('')
  })
})

describe('the sandbox/mode session kit', () => {
  it('SANDBOX_MODES lists every mode for advertisement and validation', () => {
    expect(SANDBOX_MODES).toEqual(['read-only', 'workspace-write', 'danger-full-access'])
  })

  it('effectiveSandboxMode folds to the last switch, or undefined without one', () => {
    const session = Session.create(SessionId('sess-fold'))
    expect(effectiveSandboxMode(session.events)).toBeUndefined()
    setSandboxMode(session, 'workspace-write')
    setSandboxMode(session, 'read-only')
    expect(effectiveSandboxMode(session.events)).toBe('read-only')
  })

  it('setSandboxMode appends exactly one sandbox/mode event per switch', () => {
    const session = Session.create(SessionId('sess-write'))
    setSandboxMode(session, 'danger-full-access')
    const modeEvents = session.events.filter(e => e.type === 'sandbox/mode')
    expect(modeEvents).toHaveLength(1)
    expect(modeEvents[0]?.data).toEqual({ mode: 'danger-full-access' })
  })
})

describe('the read barrier the policy carries', () => {
  /** Mount the policy service over a real barrier whose root is a fresh temp directory. */
  async function withBarrier() {
    const root = barrierRoot('dsh-policy-barrier-')
    const ctx = new Context()
    await ctx.plugin(LocalFileSystem, { cwd: tmpdir() })
    await ctx.plugin(ReadBarrierService, { root })
    await ctx.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: '/fallback' })
    return { ctx, root }
  }

  it('denies nothing while the session holds no implementer role', async () => {
    const { ctx } = await withBarrier()
    const active = session('sess-open', '/projects/open')
    expect(ctx.sandboxPolicy.resolve({ session: active }).deniedReadRoots).toEqual([])
    expect(ctx.sandboxPolicy.resolve().deniedReadRoots).toEqual([])
  })

  it('carries the barrier root once the session holds a reservation', async () => {
    const { ctx, root } = await withBarrier()
    const active = session('sess-implementer', '/projects/implementer')
    ctx.readBarrier.reserve(agentFor(active))
    expect(ctx.sandboxPolicy.resolve({ session: active }).deniedReadRoots).toEqual([root])
  })

  it('normalizes a registered directory absolute, canonical, and without duplicates', async () => {
    const { ctx, root } = await withBarrier()
    const extra = barrierRoot('dsh-policy-protected-')
    ctx.readBarrier.protect(extra)
    ctx.readBarrier.protect(`${extra}${sep}.`)
    const active = session('sess-normalized', '/projects/normalized')
    ctx.readBarrier.reserve(agentFor(active))
    expect(ctx.sandboxPolicy.resolve({ session: active }).deniedReadRoots).toEqual([root, extra])
  })

  it('carries the granted workspace beside the directory the run denies it', async () => {
    const { ctx, root } = await withBarrier()
    const run = barrierRoot('dsh-policy-run-')
    const workspace = join(run, 'cell-a')
    mkdirSync(workspace)
    const active = session('sess-cell', workspace)
    ctx.readBarrier.reserve(agentFor(active))
    ctx.readBarrier.denyFor(active, run)
    const policy = ctx.sandboxPolicy.resolve({ session: active })
    expect(policy.deniedReadRoots).toEqual([root, run])
    expect(policy.grantedReadRoot).toBe(workspace)
  })

  it('grants nothing to a session the barrier denies nothing, and nothing without a barrier', async () => {
    const { ctx } = await withBarrier()
    const run = barrierRoot('dsh-policy-open-')
    // A session with a cwd but no denied role: the grant exists only to carve a denial.
    expect(ctx.sandboxPolicy.resolve({ session: session('sess-open-cell', run) }).grantedReadRoot).toBeUndefined()
    const bare = await mounted({ mode: 'workspace-write' })
    expect(bare.sandboxPolicy.resolve({ session: session('sess-bare', run) }).grantedReadRoot).toBeUndefined()
  })
})

describe('enforceReadBarrier', () => {
  /** A provider that wraps nothing itself; the probe's own callback decides the verdict. */
  class InertSandbox extends SandboxProvider {
    confine(argv: readonly string[]): ConfinedArgv {
      return { argv: [...argv], enforcement: 'full', denialSignatures: [], runnerFailureRules: [] }
    }
  }

  /** Mount a barrier plus the policy service, then register one capability through the helper. */
  async function registered(
    wrap: (policy: SandboxPolicy) => void,
    options: { mode?: 'read-only' | 'danger-full-access'; withSandbox?: boolean } = {},
  ) {
    const root = barrierRoot('dsh-policy-enforce-')
    const ctx = new Context()
    await ctx.plugin(LocalFileSystem, { cwd: tmpdir() })
    await ctx.plugin(ReadBarrierService, { root })
    await ctx.plugin(SandboxPolicyService, { mode: options.mode ?? 'read-only', workspaceRoot: '/fallback' })
    if (options.withSandbox !== false) await ctx.plugin(InertSandbox)
    // `fs` rather than `shell`: the harness composes a filesystem, so an
    // unregistered capability reads as `unenforced` rather than `not-composed`.
    await ctx.plugin((inner: Context) => { enforceReadBarrier(inner, 'fs', wrap) })
    // The registration is an injected child fiber; settle it before reading the census.
    await ctx.fiber.await()
    return { ctx, root }
  }

  const entryOf = (ctx: Context) => ctx.readBarrier.enforcementCensus().find(entry => entry.capability === 'fs')

  it('claims denied-at-executor when the probe wrap succeeds, carrying the barrier root', async () => {
    const wraps: SandboxPolicy[] = []
    const { ctx, root } = await registered((policy) => { wraps.push(policy) })
    expect(wraps.map(policy => policy.deniedReadRoots)).toEqual([[root]])
    expect(wraps[0]?.mode).toBe('read-only')
    expect(entryOf(ctx)).toEqual({ capability: 'fs', state: 'denied-at-executor' })
  })

  it('records the backend reason when the probe wrap refuses', async () => {
    const { ctx } = await registered(() => { throw new Error('sandbox backend "windows-acl" cannot deny reads under "/srv"') })
    expect(entryOf(ctx)).toEqual({
      capability: 'fs',
      state: 'unenforced',
      reason: 'sandbox backend "windows-acl" cannot deny reads under "/srv"',
    })
  })

  it('stringifies a non-Error refusal rather than losing the reason', async () => {
    // A thrown non-Error is exactly what this arm records.
    const { ctx } = await registered(() => { throw 'backend exploded' })
    expect(entryOf(ctx)?.reason).toBe('backend exploded')
  })

  it('records that an unconfining deployment mode enforces nothing, without probing', async () => {
    let probed = false
    const { ctx } = await registered(() => { probed = true }, { mode: 'danger-full-access' })
    expect(probed).toBe(false)
    expect(entryOf(ctx)).toEqual({
      capability: 'fs',
      state: 'unenforced',
      reason: 'the deployment sandbox mode is danger-full-access, which runs commands unconfined',
    })
  })

  it('probes nothing and claims nothing while no sandbox provider is composed', async () => {
    let probed = false
    const { ctx } = await registered(() => { probed = true }, { withSandbox: false })
    expect(probed).toBe(false)
    expect(entryOf(ctx)).toEqual({ capability: 'fs', state: 'unenforced' })
  })

  it('probes once the provider arrives after this executor, and unwinds with it', async () => {
    let probed = false
    const { ctx } = await registered(() => { probed = true }, { withSandbox: false })
    const sandboxFiber = await ctx.plugin(InertSandbox)
    expect(probed).toBe(true)
    expect(entryOf(ctx)).toEqual({ capability: 'fs', state: 'denied-at-executor' })
    await sandboxFiber.dispose()
    expect(entryOf(ctx)).toEqual({ capability: 'fs', state: 'unenforced' })
  })

  it('registers nothing at all when no barrier is composed', async () => {
    let probed = false
    const ctx = new Context()
    await ctx.plugin(SandboxPolicyService, { workspaceRoot: '/fallback' })
    await ctx.plugin(InertSandbox)
    await ctx.plugin((inner: Context) => { enforceReadBarrier(inner, 'shell', () => { probed = true }) })
    expect(ctx.get('readBarrier')).toBeUndefined()
    expect(probed).toBe(false)
  })
})
