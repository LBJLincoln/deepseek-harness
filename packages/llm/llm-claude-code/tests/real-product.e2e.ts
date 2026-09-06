/**
 * Drives the real Claude Code installation on the host's own authentication,
 * so it is opt-in rather than key-gated: set `DSH_E2E_CLAUDE_CODE=1` and run it
 * by hand on a host where `claude -p` already answers. The headless-agent
 * example composes this route, and the agent must reach the workspace through
 * the harness's own bash and editor tools, never through the product's.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

const binScript = fileURLToPath(new URL(
  '../../../../examples/headless-agent/tests/fixtures/headless-driver.ts',
  import.meta.url,
))
const configPath = fileURLToPath(new URL(
  '../../../../examples/headless-agent/tests/fixtures/llm/llm-claude-code/cordis.yml',
  import.meta.url,
))
const tsconfigPath = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))
const enabled = process.env['DSH_E2E_CLAUDE_CODE'] === '1'

describe.skipIf(!enabled)('headless-agent on the operator\'s Claude Code installation', () => {
  it('writes and reads a workspace file through the harness\'s own tools', async () => {
    let written = ''
    const { stdout } = await runLoaderSmoke({
      label: 'llm-claude-code real installation',
      tempDirPrefix: 'dsh-llm-claude-code-real-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [
        configPath,
        'Create hello.txt containing hello in the workspace, then print its contents.',
      ],
      tsconfigPath,
      processTimeoutMs: 600_000,
      inspect: async (cwd) => { written = await readFile(join(cwd, 'hello.txt'), 'utf8') },
    })

    expect(written.trim()).toBe('hello')
    const events = stdout.trimEnd().split('\n')
      .map(line => JSON.parse(line) as { event?: SessionEvent })
      .flatMap(line => line.event === undefined ? [] : [line.event])
    expect(events.some(event => event.type === 'tool/call')).toBe(true)
    expect(events.some(event => event.type === 'assistant/message')).toBe(true)
  }, 660_000)
})
