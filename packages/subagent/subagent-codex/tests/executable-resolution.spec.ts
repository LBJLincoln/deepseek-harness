import { posix, win32 } from 'node:path'
import { PassThrough } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import * as codex from '../src/index.ts'
import { codexAppServerArgv } from '../src/run.ts'

const WIN_CMD = 'C:\\Windows\\System32\\cmd.exe'
const WIN_CODEX = 'C:\\Users\\dev\\AppData\\Roaming\\npm\\codex.cmd'
const POSIX_CODEX = '/usr/local/bin/codex'

const parent = {
  id: 'parent',
  session: { header: { cwd: process.cwd() } },
} as unknown as Agent

const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { ...realPlatform, value: platform })
}

afterEach(() => {
  Object.defineProperty(process, 'platform', realPlatform)
})

/** A child that exits at once, so `start` rejects after the spawn under test. */
function exitedChild(): SubprocessHandle {
  return {
    pid: 0,
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    done: Promise.resolve({ exitCode: 1, signal: null }),
    terminate: () => {},
    waitForExit: () => Promise.resolve(true),
  } as unknown as SubprocessHandle
}

describe('codexAppServerArgv executable paths', () => {
  it('uses the absolute cmd.exe and codex paths on win32', () => {
    const argv = codexAppServerArgv({ cmd: WIN_CMD, codex: WIN_CODEX }, 'win32')
    expect(argv[0]).toBe(WIN_CMD)
    expect(argv[argv.indexOf(WIN_CODEX)]).toBe(WIN_CODEX)
    expect(argv).toEqual([WIN_CMD, '/d', '/s', '/c', WIN_CODEX, 'app-server', '--stdio'])
    expect(win32.isAbsolute(argv[0]!)).toBe(true)
    expect(argv).not.toContain('codex')
    expect(argv).not.toContain('cmd.exe')
  })

  it('uses the absolute codex path as the first element on POSIX', () => {
    const argv = codexAppServerArgv({ codex: POSIX_CODEX }, 'linux')
    expect(argv[0]).toBe(POSIX_CODEX)
    expect(posix.isAbsolute(argv[0]!)).toBe(true)
    expect(argv).toEqual([POSIX_CODEX, 'app-server', '--stdio'])
  })
})

describe('provider start resolves executables before spawning', () => {
  async function harness() {
    const ctx = new Context()
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(LocalSubprocessRuntime)
    const calls: Array<{ readonly op: string; readonly detail: unknown }> = []
    const resolve = vi.spyOn(ctx.subprocess, 'resolveExecutable').mockImplementation(
      async (command, env) => {
        calls.push({ op: 'resolve', detail: { command, env } })
        return command === 'cmd.exe' ? WIN_CMD : WIN_CODEX
      },
    )
    vi.spyOn(ctx.subprocess, 'spawn').mockImplementation((spec) => {
      calls.push({ op: 'spawn', detail: spec.argv })
      return exitedChild()
    })
    await ctx.plugin(codex, { env: { CODEX_HOME: '/tmp/home' } })
    return { ctx, calls, resolve }
  }

  const start = (ctx: Context) => ctx.subagents.start('codex', {
    prompt: [{ type: 'text', text: 'task' }],
    parent,
    signal: new AbortController().signal,
  })

  it('resolves codex first and spawns the absolute path on POSIX', async () => {
    setPlatform('linux')
    const { ctx, calls, resolve } = await harness()
    resolve.mockImplementation(async (command, env) => {
      calls.push({ op: 'resolve', detail: { command, env } })
      return POSIX_CODEX
    })
    await expect(start(ctx)).rejects.toThrow('exited before the run settled')
    expect(calls).toEqual([
      { op: 'resolve', detail: { command: 'codex', env: { CODEX_HOME: '/tmp/home' } } },
      { op: 'spawn', detail: [POSIX_CODEX, 'app-server', '--stdio'] },
    ])
    await ctx.fiber.dispose()
  })

  it('resolves codex and cmd.exe before spawning on win32', async () => {
    setPlatform('win32')
    const { ctx, calls } = await harness()
    await expect(start(ctx)).rejects.toThrow('exited before the run settled')
    expect(calls.map(call => call.op)).toEqual(['resolve', 'resolve', 'spawn'])
    expect(calls.slice(0, 2).map(call => (call.detail as { command: string }).command).sort())
      .toEqual(['cmd.exe', 'codex'])
    expect(calls[2]!.detail)
      .toEqual([WIN_CMD, '/d', '/s', '/c', WIN_CODEX, 'app-server', '--stdio'])
    await ctx.fiber.dispose()
  })

  it('spawns nothing when resolution fails', async () => {
    setPlatform('linux')
    const { ctx, calls, resolve } = await harness()
    resolve.mockRejectedValueOnce(new Error('codex missing from PATH'))
    await expect(start(ctx)).rejects.toThrow('codex missing from PATH')
    expect(calls.some(call => call.op === 'spawn')).toBe(false)
    await ctx.fiber.dispose()
  })
})
