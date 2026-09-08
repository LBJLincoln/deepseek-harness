/**
 * Service tests over the real local filesystem provider: root creation, run
 * reservations and the role they confer, registered denied directories both
 * global and per session, the granted workspace, the containment decision and
 * the precedence a denied ancestor of that workspace has, and the durable
 * refusal record.
 */

import { mkdtempSync, realpathSync, rmSync, statSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { FileSystem, FsError, FsTargetKey, FsVersion } from '@deepseek-ai/dsh-fs'
import type { FsDirEntry, FsEditOutcome, FsInfo, FsPathInfo, FsTarget, FsWriteOutcome } from '@deepseek-ai/dsh-fs'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { Session, SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import ReadBarrierService, { grantedReadRoot, READ_BARRIER_DENIED_VERSION, RUNS_DIR } from '../src/index.ts'
import type { Config } from '../src/index.ts'

const roots: string[] = []

function tempRoot(prefix: string): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  roots.push(root)
  return root
}

/** A provider whose `resolve` always fails, so containment cannot be decided. */
class UnresolvableFs extends FileSystem {
  override async resolve(path: string): Promise<FsTarget> {
    throw new FsError(`cannot resolve ${path}`, 'FS_IO_ERROR')
  }
  override processPath(target: FsTarget): string { return String(target.targetKey) }
  override fileUrl(target: FsTarget): string { return `file://${target.targetKey}` }
  override contains(): boolean { return false }
  override async stat(): Promise<FsInfo | undefined> { return undefined }
  override async lstat(): Promise<FsPathInfo | undefined> { return undefined }
  override async readText(): Promise<string> { return '' }
  override async streamText(): Promise<AsyncIterable<string>> { return (async function* () {})() }
  override async readBytes(): Promise<Uint8Array> { return new Uint8Array() }
  override async listDir(): Promise<FsDirEntry[]> { return [] }
  override async writeText(): Promise<FsWriteOutcome> {
    return { operation: 'create', version: FsVersion('v1'), before: null, after: '' }
  }
  override async editText(): Promise<FsEditOutcome> {
    return { version: FsVersion('v1'), before: '', after: '' }
  }
}

async function setup(config: Config, provider: typeof LocalFileSystem | typeof UnresolvableFs = LocalFileSystem, cwd = tmpdir()) {
  const ctx = new Context()
  await ctx.plugin(provider as typeof LocalFileSystem, { cwd })
  await ctx.plugin(ReadBarrierService, config)
  return ctx
}

function agentWithSession(id: string, cwd?: string): Agent & { session: Session } {
  const sessionId = SessionId(id)
  const header: SessionHeader = {
    version: SESSION_FORMAT_VERSION,
    id: sessionId,
    createdAt: 0,
    ...cwd === undefined ? {} : { cwd },
  }
  const session = Session.create(sessionId, undefined, header)
  return { id: sessionId, session } as unknown as Agent & { session: Session }
}

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  roots.length = 0
})

describe('barrier root', () => {
  it('creates the configured root owner-only', async () => {
    const root = join(tempRoot('dsh-read-barrier-root-'), 'verification')
    const ctx = await setup({ root })
    expect(ctx.readBarrier.root).toBe(root)
    expect(statSync(root).isDirectory()).toBe(true)
    if (process.platform !== 'win32') expect(statSync(root).mode & 0o077).toBe(0)
  })

  it('expands a "~"-prefixed root against the harness home', async () => {
    const home = tempRoot('dsh-read-barrier-home-')
    const previous = process.env['DSH_HOME']
    process.env['DSH_HOME'] = home
    try {
      const ctx = await setup({})
      expect(ctx.readBarrier.root).toBe(join(home, 'verification'))
    } finally {
      if (previous === undefined) delete process.env['DSH_HOME']
      else process.env['DSH_HOME'] = previous
    }
  })

  it('refuses a relative root and a relative denied directory', async () => {
    await expect(setup({ root: 'verification' })).rejects.toThrow(
      'read-barrier: root "verification" must be an absolute or "~"-prefixed directory',
    )
    await expect(setup({ root: tempRoot('dsh-read-barrier-relative-'), denyRoots: ['sessions'] })).rejects.toThrow(
      'read-barrier: denyRoots entry "sessions" must be an absolute or "~"-prefixed directory',
    )
  })
})

describe('reservations and roles', () => {
  it('mints one owner-only run directory per session and reuses it', async () => {
    const root = tempRoot('dsh-read-barrier-reserve-')
    const ctx = await setup({ root })
    const agent = agentWithSession('run-1')
    const directory = ctx.readBarrier.reserve(agent)
    expect(directory).toBe(join(root, RUNS_DIR, 'run-1'))
    expect(ctx.readBarrier.reserve(agent)).toBe(directory)
    if (process.platform !== 'win32') expect(statSync(directory).mode & 0o077).toBe(0)
  })

  it('reads back a held reservation without minting one', async () => {
    const root = tempRoot('dsh-read-barrier-read-')
    const ctx = await setup({ root })
    const holder = agentWithSession('holder')
    const other = agentWithSession('reader')

    expect(ctx.readBarrier.reservation(holder)).toBeUndefined()
    const directory = ctx.readBarrier.reserve(holder)
    expect(ctx.readBarrier.reservation(holder)).toBe(directory)
    // Reading for a session that holds none neither mints one nor demotes it.
    expect(ctx.readBarrier.reservation(other)).toBeUndefined()
    expect(ctx.readBarrier.resolve({ session: other.session }).role).toBe('unrestricted')
  })

  it('makes a reserved session the implementer and leaves every other session unrestricted', async () => {
    const root = tempRoot('dsh-read-barrier-role-')
    const ctx = await setup({ root })
    const reserved = agentWithSession('reserved')
    const other = agentWithSession('other')
    ctx.readBarrier.reserve(reserved)
    expect(ctx.readBarrier.resolve({ session: reserved.session }).role).toBe('implementer')
    expect(ctx.readBarrier.resolve({ session: other.session }).role).toBe('unrestricted')
    expect(ctx.readBarrier.resolve().role).toBe('unrestricted')
  })

  it('drops the reservation when the agent is disposed', async () => {
    const root = tempRoot('dsh-read-barrier-dispose-')
    const ctx = await setup({ root })
    const agent = agentWithSession('disposed')
    ctx.readBarrier.reserve(agent)
    expect(ctx.readBarrier.resolve({ session: agent.session }).role).toBe('implementer')
    ctx.emit('agent/disposed', { agent })
    expect(ctx.readBarrier.resolve({ session: agent.session }).role).toBe('unrestricted')
  })
})

describe('denied directories', () => {
  it('lists the root, the configured extras, and each registration once', async () => {
    const root = tempRoot('dsh-read-barrier-denied-')
    const extra = tempRoot('dsh-read-barrier-extra-')
    const store = tempRoot('dsh-read-barrier-store-')
    const ctx = await setup({ root, denyRoots: [extra] })
    expect(ctx.readBarrier.resolve().denied).toEqual([root, extra])
    const first = ctx.readBarrier.protect(store)
    const second = ctx.readBarrier.protect(store)
    expect(ctx.readBarrier.resolve().denied).toEqual([root, extra, store])
    first()
    expect(ctx.readBarrier.resolve().denied).toEqual([root, extra, store])
    second()
    expect(ctx.readBarrier.resolve().denied).toEqual([root, extra])
  })

  it('refuses a relative protected directory', async () => {
    const ctx = await setup({ root: tempRoot('dsh-read-barrier-protect-') })
    expect(() => ctx.readBarrier.protect('sessions')).toThrow(
      'read-barrier: protect path "sessions" must be an absolute or "~"-prefixed directory',
    )
  })

  it('denies a registered directory to one session and leaves every other session reading it', async () => {
    const root = tempRoot('dsh-read-barrier-session-deny-')
    const run = tempRoot('dsh-read-barrier-run-')
    const ctx = await setup({ root })
    const cell = agentWithSession('cell', join(run, 'cell-a'))
    const sibling = agentWithSession('sibling', join(run, 'cell-b'))

    const first = ctx.readBarrier.denyFor(cell.session, run)
    const second = ctx.readBarrier.denyFor(cell.session, run)
    expect(ctx.readBarrier.resolve({ session: cell.session }).denied).toEqual([root, run])
    expect(ctx.readBarrier.resolve({ session: sibling.session }).denied).toEqual([root])
    expect(ctx.readBarrier.resolve().denied).toEqual([root])
    first()
    expect(ctx.readBarrier.resolve({ session: cell.session }).denied).toEqual([root, run])
    second()
    expect(ctx.readBarrier.resolve({ session: cell.session }).denied).toEqual([root])
  })

  it('refuses a relative session-scoped directory', async () => {
    const ctx = await setup({ root: tempRoot('dsh-read-barrier-deny-for-') })
    const agent = agentWithSession('relative')
    expect(() => ctx.readBarrier.denyFor(agent.session, 'runs')).toThrow(
      'read-barrier: denyFor path "runs" must be an absolute or "~"-prefixed directory',
    )
  })
})

describe('the granted workspace', () => {
  it('grants a denied role its session cwd and every other role nothing', async () => {
    const root = tempRoot('dsh-read-barrier-grant-')
    const workspace = tempRoot('dsh-read-barrier-grant-ws-')
    const ctx = await setup({ root })
    const agent = agentWithSession('granted', workspace)

    expect(ctx.readBarrier.resolve({ session: agent.session }).granted).toBe(workspace)
    expect(grantedReadRoot(ctx.readBarrier.resolve({ session: agent.session }))).toBeUndefined()
    ctx.readBarrier.reserve(agent)
    expect(grantedReadRoot(ctx.readBarrier.resolve({ session: agent.session }))).toBe(workspace)
  })

  it('grants nothing to a session without a cwd and to an agentless call', async () => {
    const root = tempRoot('dsh-read-barrier-no-grant-')
    const ctx = await setup({ root })
    const agent = agentWithSession('cwdless')
    ctx.readBarrier.reserve(agent)
    expect(ctx.readBarrier.resolve({ session: agent.session }).granted).toBeUndefined()
    expect(ctx.readBarrier.resolve().granted).toBeUndefined()
  })
})

describe('the deny decision', () => {
  it('denies an implementer every denied tree and nothing else', async () => {
    const root = tempRoot('dsh-read-barrier-decide-')
    const workspace = tempRoot('dsh-read-barrier-workspace-')
    const ctx = await setup({ root })
    await mkdir(join(root, 'runs', 'r1'), { recursive: true })
    await writeFile(join(root, 'runs', 'r1', 'check'), 'true\n')
    await writeFile(join(workspace, 'src.txt'), 'work\n')
    const inside = await ctx.fs.resolve(join(root, 'runs', 'r1', 'check'))
    const outside = await ctx.fs.resolve(join(workspace, 'src.txt'))
    const implementer = { role: 'implementer' as const, root, denied: [root] }
    expect(await ctx.readBarrier.denies(implementer, inside)).toBe(true)
    expect(await ctx.readBarrier.denies(implementer, outside)).toBe(false)
  })

  it('denies the barrier root itself, not only its descendants', async () => {
    const root = tempRoot('dsh-read-barrier-self-')
    const ctx = await setup({ root })
    const target = await ctx.fs.resolve(root)
    expect(await ctx.readBarrier.denies({ role: 'implementer', root, denied: [root] }, target)).toBe(true)
  })

  it.each(['validator', 'unrestricted'] as const)('denies a %s session nothing', async (role) => {
    const root = tempRoot('dsh-read-barrier-open-')
    const ctx = await setup({ root })
    const target = await ctx.fs.resolve(root)
    expect(await ctx.readBarrier.denies({ role, root, denied: [root] }, target)).toBe(false)
  })

  it('denies a target whose containment cannot be decided', async () => {
    const root = tempRoot('dsh-read-barrier-undecidable-')
    const ctx = await setup({ root }, UnresolvableFs)
    const target = { targetKey: FsTargetKey('unrelated'), displayPath: '/unrelated' }
    expect(await ctx.readBarrier.denies({ role: 'implementer', root, denied: [root] }, target)).toBe(true)
  })
})

describe('a denied ancestor of the granted workspace', () => {
  /**
   * One run directory holding two cell workspaces, a file in each, and one
   * directory inside the granted cell that the run also denies.
   */
  async function runTree() {
    const root = tempRoot('dsh-read-barrier-seal-root-')
    const run = tempRoot('dsh-read-barrier-seal-run-')
    const ctx = await setup({ root })
    const workspace = join(run, 'nested', 'cell-a')
    const sibling = join(run, 'nested', 'cell-b')
    const secret = join(workspace, 'held-out')
    await mkdir(secret, { recursive: true })
    await mkdir(sibling, { recursive: true })
    await writeFile(join(run, 'plan.json'), '{}\n')
    await writeFile(join(workspace, 'src.txt'), 'work\n')
    await writeFile(join(sibling, 'src.txt'), 'theirs\n')
    await writeFile(join(secret, 'cases.jsonl'), '{}\n')
    return { ctx, root, run, workspace, sibling, secret }
  }

  it('leaves the workspace whole when its parent is denied', async () => {
    const { ctx, root, run, workspace, sibling } = await runTree()
    const policy = { role: 'implementer' as const, root, denied: [root, dirname(workspace)], granted: workspace }
    expect(await ctx.readBarrier.denies(policy, await ctx.fs.resolve(join(workspace, 'src.txt')))).toBe(false)
    expect(await ctx.readBarrier.denies(policy, await ctx.fs.resolve(workspace))).toBe(false)
    expect(await ctx.readBarrier.denies(policy, await ctx.fs.resolve(join(sibling, 'src.txt')))).toBe(true)
    expect(await ctx.readBarrier.denies(policy, await ctx.fs.resolve(dirname(workspace)))).toBe(true)
    expect(await ctx.readBarrier.denies(policy, await ctx.fs.resolve(join(run, 'plan.json')))).toBe(false)
  })

  it('leaves the workspace whole when a grandparent is denied', async () => {
    const { ctx, root, run, workspace, sibling } = await runTree()
    const policy = { role: 'implementer' as const, root, denied: [root, run], granted: workspace }
    expect(await ctx.readBarrier.denies(policy, await ctx.fs.resolve(join(workspace, 'src.txt')))).toBe(false)
    expect(await ctx.readBarrier.denies(policy, await ctx.fs.resolve(join(run, 'plan.json')))).toBe(true)
    expect(await ctx.readBarrier.denies(policy, await ctx.fs.resolve(join(sibling, 'src.txt')))).toBe(true)
    expect(await ctx.readBarrier.denies(policy, await ctx.fs.resolve(run))).toBe(true)
  })

  it('grants nothing when the workspace itself is the denied directory', async () => {
    const { ctx, root, workspace } = await runTree()
    const policy = { role: 'implementer' as const, root, denied: [root, workspace], granted: workspace }
    expect(await ctx.readBarrier.denies(policy, await ctx.fs.resolve(workspace))).toBe(true)
    expect(await ctx.readBarrier.denies(policy, await ctx.fs.resolve(join(workspace, 'src.txt')))).toBe(true)
  })

  it('keeps denying a directory inside the granted workspace', async () => {
    const { ctx, root, run, workspace, secret } = await runTree()
    const policy = { role: 'implementer' as const, root, denied: [root, run, secret], granted: workspace }
    expect(await ctx.readBarrier.denies(policy, await ctx.fs.resolve(join(secret, 'cases.jsonl')))).toBe(true)
    expect(await ctx.readBarrier.denies(policy, await ctx.fs.resolve(join(workspace, 'src.txt')))).toBe(false)
  })

  it('carves nothing when the grant cannot be resolved, so the denial holds', async () => {
    const root = tempRoot('dsh-read-barrier-grant-undecidable-')
    const ctx = await setup({ root }, UnresolvableFs)
    const target = { targetKey: FsTargetKey('workspace/src.txt'), displayPath: '/run/cell-a/src.txt' }
    const policy = { role: 'implementer' as const, root, denied: [root, '/run'], granted: '/run/cell-a' }
    expect(await ctx.readBarrier.denies(policy, target)).toBe(true)
  })
})

describe('the durable refusal record', () => {
  it('appends the refusal and returns the payload it appended', async () => {
    const root = tempRoot('dsh-read-barrier-record-')
    const ctx = await setup({ root })
    const agent = agentWithSession('recorded')
    ctx.readBarrier.reserve(agent)
    const policy = ctx.readBarrier.resolve({ session: agent.session })
    const target = await ctx.fs.resolve(join(root, RUNS_DIR, 'recorded'))
    const denial = ctx.readBarrier.recordDenial(agent.session, policy, 'fs', target)
    expect(denial).toEqual({
      version: READ_BARRIER_DENIED_VERSION,
      role: 'implementer',
      capability: 'fs',
      displayPath: target.displayPath,
      root,
    })
    expect(agent.session.events.map(event => event.type)).toEqual(['read-barrier/denied'])
    expect(agent.session.events[0]?.data).toEqual(denial)
  })
})
