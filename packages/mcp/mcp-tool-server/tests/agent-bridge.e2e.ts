/**
 * The served tool surface through a real cordis.yml and headless process: an
 * official MCP client outside the agent loop lists one agent's tools, calls
 * one, and the call lands in that agent's durable log as the ordinary
 * `tool/call`/`tool/result` pair inside the run's own turn.
 */

import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const binScript = fileURLToPath(new URL('../../../../examples/headless-agent/tests/fixtures/agent-bridge/driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('../../../../examples/headless-agent/tests/fixtures/agent-bridge/cordis.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

interface DriverResult {
  type: string
  serverName: string
  served: string[]
  listed: string[]
  readSchema: { type: string; properties: Record<string, unknown> }
  call: { isError: boolean; content: { type: string; text?: string }[] }
  absent: string
  log: string[]
  toolCall: { turn: number; step: number; name: string; arguments: string }[]
  toolResultIsError: boolean[]
}

describe('the MCP tool server through a real cordis.yml and headless process', () => {
  it('executes a served call through the harness executor and records the durable pair', async () => {
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'agent-bridge',
      tempDirPrefix: 'agent-bridge-e2e-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [configPath],
      tsconfigPath: repoTsconfig,
    })
    expect(stderr).toBe('')
    const result = JSON.parse(stdout.trimEnd().split('\n').at(-1) ?? '') as DriverResult
    expect(result.type).toBe('result')

    // The served list IS the agent's registry view, with the harness schemas.
    expect(result.serverName).toBe('dsh')
    expect(result.listed).toEqual(result.served)
    expect(result.listed).toContain('read')
    expect(result.readSchema.type).toBe('object')
    expect(Object.keys(result.readSchema.properties)).toContain('file_path')

    // The call ran the real tool, so its content is what the model would see.
    expect(result.call.isError).toBe(false)
    expect(JSON.stringify(result.call.content)).toContain('served through the harness executor')

    // A name outside the agent's registry view is refused.
    expect(result.absent).toContain('not a tool of this agent')

    // The whole run is one turn of the served session, and the call is the
    // ordinary durable pair inside its step.
    expect(result.log).toEqual(['turn/start', 'step/start', 'tool/call', 'tool/result', 'step/end', 'turn/end'])
    expect(result.toolCall).toEqual([
      expect.objectContaining({ turn: 1, step: 1, name: 'read' }),
    ])
    expect(result.toolResultIsError).toEqual([false])
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
