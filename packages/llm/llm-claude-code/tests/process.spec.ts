/**
 * The projection that puts the installation's CLI under `dsh-subprocess`: the
 * spawn request the SDK asks for, and the process view it reads back.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SpawnOptions } from '@anthropic-ai/claude-agent-sdk'
import {
  claudeSpawnSpec,
  ManagedClaudeCodeProcess,
  sdkEnvironmentOverlay,
} from '../src/process.ts'
import { fakeChild } from './fixture.ts'

function spawnOptions(overrides: Partial<SpawnOptions> = {}): SpawnOptions {
  return {
    command: '/usr/local/bin/claude',
    args: ['--print'],
    cwd: '/workspace',
    env: { PATH: '/usr/bin' },
    signal: undefined,
    ...overrides,
  } as SpawnOptions
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('claudeSpawnSpec', () => {
  it('hands the SDK command straight to the shared process owner', () => {
    expect(claudeSpawnSpec(spawnOptions(), 500, 'linux')).toMatchObject({
      argv: ['/usr/local/bin/claude', '--print'],
      cwd: '/workspace',
      graceMs: 500,
      stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'inherit' },
    })
  })

  it('routes a Windows batch shim through cmd with only the executable quoted', () => {
    const spec = claudeSpawnSpec(
      spawnOptions({ command: 'C:\\bin\\claude.cmd' }),
      500,
      'win32',
    )
    expect(spec.argv).toEqual([
      'cmd.exe', '/d', '/v:off', '/s', '/c', '%DSH_CLAUDE_CODE_EXECUTABLE%', '--print',
    ])
    expect(spec.env?.['DSH_CLAUDE_CODE_EXECUTABLE']).toBe('"C:\\bin\\claude.cmd"')
    expect(claudeSpawnSpec(spawnOptions({ command: 'C:\\bin\\claude.bat' }), 500, 'win32').argv[0])
      .toBe('cmd.exe')
    expect(claudeSpawnSpec(spawnOptions({ command: 'C:\\bin\\claude.exe' }), 500, 'win32').argv[0])
      .toBe('C:\\bin\\claude.exe')
  })

  it('refuses a spawn request without a workspace', () => {
    const workspaceless = { command: '/usr/local/bin/claude', args: [], env: {} } as unknown as SpawnOptions
    expect(() => claudeSpawnSpec(workspaceless, 500, 'linux')).toThrow(/omitted its workspace/)
  })
})

describe('sdkEnvironmentOverlay', () => {
  it('tombstones ambient names the SDK removed from the child environment', () => {
    vi.stubEnv('DSH_CLAUDE_CODE_FIXTURE_AMBIENT', 'present')
    const overlay = sdkEnvironmentOverlay({ PATH: '/usr/bin' })
    expect(overlay['PATH']).toBe('/usr/bin')
    expect('DSH_CLAUDE_CODE_FIXTURE_AMBIENT' in overlay).toBe(false)
    vi.stubEnv('DSH_FIXTURE_KEEP', 'present')
    expect(sdkEnvironmentOverlay({ PATH: '/usr/bin', DSH_FIXTURE_KEEP: 'present' })['DSH_FIXTURE_KEEP'])
      .toBe('present')
  })

  it('tombstones a surviving ambient name the SDK dropped', () => {
    vi.stubEnv('CLAUDE_CODE_FIXTURE_PLAIN', 'present')
    const overlay = sdkEnvironmentOverlay({ PATH: '/usr/bin' })
    expect('CLAUDE_CODE_FIXTURE_PLAIN' in overlay).toBe(true)
    expect(overlay['CLAUDE_CODE_FIXTURE_PLAIN']).toBeUndefined()
  })
})

describe('ManagedClaudeCodeProcess', () => {
  it('publishes the child streams and its exit facts', async () => {
    const child = fakeChild()
    const managed = new ManagedClaudeCodeProcess(child.handle)
    expect(managed.stdin).toBe(child.stdin)
    expect(managed.stdout).toBe(child.stdout)
    expect(managed.exitCode).toBeNull()
    expect(managed.signalCode).toBeNull()
    expect(managed.killed).toBe(false)

    const exited = new Promise<[number | null, NodeJS.Signals | null]>((resolve) => {
      managed.once('exit', (code, signal) => { resolve([code, signal]) })
    })
    child.settle({ exitCode: 3, signal: null })
    expect(await exited).toEqual([3, null])
    expect(managed.exitCode).toBe(3)
    expect(managed.signalCode).toBeNull()
  })

  it('routes the SDK kill to the tree owner exactly once', () => {
    const child = fakeChild()
    const managed = new ManagedClaudeCodeProcess(child.handle)
    expect(managed.kill('SIGTERM')).toBe(true)
    expect(managed.killed).toBe(true)
    expect(child.terminate).toHaveBeenCalledTimes(1)
    expect(managed.kill('SIGTERM')).toBe(false)
  })

  it('refuses to kill a process that already exited', async () => {
    const child = fakeChild()
    const managed = new ManagedClaudeCodeProcess(child.handle)
    const exited = new Promise<void>((resolve) => { managed.once('exit', () => { resolve() }) })
    child.settle({ exitCode: null, signal: 'SIGKILL' })
    await exited
    expect(managed.signalCode).toBe('SIGKILL')
    expect(managed.kill('SIGTERM')).toBe(false)
  })

  it('publishes a spawn rejection as an error event and removes listeners on request', async () => {
    const child = fakeChild()
    const managed = new ManagedClaudeCodeProcess(child.handle)
    const ignored = vi.fn()
    managed.on('error', ignored)
    managed.off('error', ignored)
    const failed = new Promise<Error>((resolve) => { managed.on('error', resolve) })
    child.fail(new Error('spawn refused'))
    expect((await failed).message).toBe('spawn refused')
    expect(ignored).not.toHaveBeenCalled()
  })
})
