/**
 * What the search tools do about the read barrier: the ripgrep spawn is
 * confined through `ctx.sandbox` exactly when the calling session's resolved
 * policy denies something, and the plugin registers what that confinement
 * enforces so the scope census can report `subprocess`.
 *
 * The subprocess service is a recording fake — this suite is about which argv
 * reaches the spawn, not about ripgrep's own behavior.
 */

import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { CallId } from '@deepseek-ai/dsh-llm'
import ReadBarrierService from '@deepseek-ai/dsh-read-barrier'
import { SandboxProvider } from '@deepseek-ai/dsh-sandbox'
import type { ConfinedArgv, SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import SandboxPolicyService from '@deepseek-ai/dsh-sandbox-policy'
import { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type { SubprocessCollectedOutputs, SubprocessHandle, SubprocessOutcome, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as ToolFsSearch from '@deepseek-ai/dsh-tool-fs-search'

const signal = new AbortController().signal
const roots: string[] = []

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  roots.length = 0
})

/** A fresh owner-only directory for one barrier under test. */
function barrierRoot(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-search-barrier-')))
  roots.push(root)
  return root
}

/** A subprocess service that records every spawn and answers a zero-result run. */
class RecordingSubprocess extends SubprocessRuntime {
  spawns: SubprocessSpawnSpec[] = []
  override async resolveExecutable(command: string): Promise<string> { return command }
  override spawnTerminal(): Promise<never> { throw new Error('the search tools spawn pipes, never terminals') }

  override spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    this.spawns.push(spec)
    const read = { text: '', nextOffset: 0, lossy: false }
    const collected: SubprocessCollectedOutputs = {
      stdout: { readFrom: () => read },
      stderr: { readFrom: () => read },
    }
    return {
      pid: 1, stdin: undefined, stdout: undefined, stderr: undefined, collected,
      // Exit 1 is ripgrep's "no matches", which the tools read as an ordinary
      // empty result rather than a failure.
      done: Promise.resolve<SubprocessOutcome>({ exitCode: 1, signal: null }),
      terminate: () => {},
      waitForExit: () => Promise.resolve(true),
    }
  }
}

/** A sandbox provider that records the policies it wraps and prefixes a marker runner. */
class RecordingSandbox extends SandboxProvider {
  policies: SandboxPolicy[] = []

  confine(argv: readonly string[], policy: SandboxPolicy): ConfinedArgv {
    this.policies.push(policy)
    return { argv: ['/confine', '--', ...argv], enforcement: 'full', denialSignatures: [], runnerFailureRules: [] }
  }
}

interface Composition {
  ctx: Context
  subprocess: RecordingSubprocess
  sandbox: RecordingSandbox | undefined
  /** Policies the plugin's enforcement probe wrapped at mount, before any search. */
  probes: SandboxPolicy[]
  root: string
}

/** Compose the search tools over a barrier, optionally with a sandbox provider and a chosen mode. */
async function compose(options: { sandbox?: boolean; mode?: 'read-only' | 'danger-full-access' } = {}): Promise<Composition> {
  const root = barrierRoot()
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(LocalFileSystem, { cwd: tmpdir() })
  await ctx.plugin(ReadBarrierService, { root })
  await ctx.plugin(SandboxPolicyService, { mode: options.mode ?? 'read-only', workspaceRoot: tmpdir() })
  await ctx.plugin(RecordingSubprocess)
  if (options.sandbox !== false) await ctx.plugin(RecordingSandbox)
  await ctx.plugin(ToolFsSearch, { sampleOverCapGlobResults: false })
  // The enforcement registration is an injected child fiber; settle it before
  // reading the census or separating its probe wrap from the searches'.
  await ctx.fiber.await()
  const sandbox = ctx.get('sandbox') as RecordingSandbox | undefined
  // The plugin's own enforcement probe wraps once at mount; clearing it leaves
  // each test looking only at what its searches wrapped.
  const probes = sandbox?.policies.splice(0) ?? []
  return { ctx, subprocess: ctx.subprocess as RecordingSubprocess, sandbox, probes, root }
}

/** One agent whose session the barrier can reserve. */
function agentFor(id: string): Agent {
  const sessionId = SessionId(id)
  const session = Session.create(sessionId, undefined, { version: 0, id: sessionId, createdAt: 0, cwd: tmpdir() })
  return { id: sessionId, session } as unknown as Agent
}

let calls = 0
function search(ctx: Context, agent?: Agent) {
  return ctx.tools.execute({
    signal,
    callId: CallId(`search-${++calls}`),
    name: 'grep',
    arguments: { pattern: 'alpha' },
    ...agent === undefined ? {} : { agent },
  })
}

describe('the search spawn under a read barrier', () => {
  it('spawns ripgrep unwrapped for a session the barrier denies nothing', async () => {
    const { ctx, subprocess, sandbox, probes, root } = await compose()
    // The mount-time probe wrapped the barrier root: the claim rests on the
    // same confinement the searches would use.
    expect(probes.map(policy => policy.deniedReadRoots)).toEqual([[root]])
    const result = await search(ctx, agentFor('open'))
    expect(result.isError).toBe(false)
    expect(subprocess.spawns[0]?.argv[0]).not.toBe('/confine')
    expect(sandbox?.policies).toEqual([])
  })

  it('spawns ripgrep unwrapped for an agentless call', async () => {
    const { ctx, subprocess } = await compose()
    await search(ctx)
    expect(subprocess.spawns[0]?.argv[0]).not.toBe('/confine')
  })

  it('confines the spawn under the resolved policy once the session holds a reservation', async () => {
    const { ctx, subprocess, sandbox, root } = await compose()
    const agent = agentFor('implementer')
    ctx.readBarrier.reserve(agent)

    const result = await search(ctx, agent)

    expect(result.isError).toBe(false)
    expect(subprocess.spawns[0]?.argv.slice(0, 2)).toEqual(['/confine', '--'])
    expect(subprocess.spawns[0]?.argv[2]).toContain('rg')
    // The session's own workspace rides the policy beside the denied root, so a
    // backend that denies an ancestor of it still leaves the workspace whole.
    expect(sandbox?.policies).toEqual([{
      mode: 'read-only',
      workspaceRoot: realpathSync(tmpdir()),
      deniedReadRoots: [root],
      grantedReadRoot: realpathSync(tmpdir()),
      sessionId: 'implementer',
    }])
  })

  it('confines under the widest confining mode when the deployment runs unconfined', async () => {
    // A search writes nothing, so the barrier's read denial is expressed at
    // workspace-write without removing anything the search needs.
    const { ctx, sandbox } = await compose({ mode: 'danger-full-access' })
    const agent = agentFor('full-access')
    ctx.readBarrier.reserve(agent)
    await search(ctx, agent)
    expect(sandbox?.policies[0]?.mode).toBe('workspace-write')
  })

  it('fails the search rather than searching a denied root with no sandbox provider', async () => {
    const { ctx, subprocess } = await compose({ sandbox: false })
    const agent = agentFor('unconfinable')
    ctx.readBarrier.reserve(agent)

    const result = await search(ctx, agent)

    expect(result.isError).toBe(true)
    expect(result.content.map(block => (block.type === 'text' ? block.text : '')).join('')).toContain(
      'grep cannot run: this session denies reads under 1 directory(ies) and no ctx.sandbox provider is composed to confine the search',
    )
    expect(subprocess.spawns).toEqual([])
  })
})

describe('what the search tools register with the barrier', () => {
  const entryOf = (ctx: Context) =>
    ctx.readBarrier.enforcementCensus().find(entry => entry.capability === 'subprocess')

  it('claims denied-at-executor when a sandbox provider can confine the spawn', async () => {
    const { ctx } = await compose()
    expect(entryOf(ctx)).toEqual({ capability: 'subprocess', state: 'denied-at-executor' })
  })

  it('claims nothing while no sandbox provider is composed to confine the spawn', async () => {
    const { ctx } = await compose({ sandbox: false })
    expect(entryOf(ctx)).toEqual({ capability: 'subprocess', state: 'unenforced' })
  })
})
