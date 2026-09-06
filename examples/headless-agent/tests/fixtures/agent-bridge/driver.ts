#!/usr/bin/env node
/**
 * Test driver: boot the tool-server composition, serve one agent's registry
 * over an in-memory MCP transport, and drive it with the official MCP client —
 * listing the served tools, calling one, and naming one the agent does not
 * have. It reports the client's answers plus the agent's durable log so the
 * e2e can prove the call reached the harness executor.
 */

import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('agent-bridge driver requires a config path')

const ctx = await boot('agent-bridge-e2e', resolveConfigPath(configPath, undefined))
try {
  // Loader siblings mount concurrently; the driver serves only the settled application.
  await ctx.get('loader')?.await()
  const toolServer = ctx.get('mcpToolServer')
  if (toolServer === undefined) throw new Error('agent-bridge driver requires the mcpToolServer service')

  const workspaceFile = join(process.cwd(), 'served.txt')
  await writeFile(workspaceFile, 'served through the harness executor\n')

  const created = await ctx.agents.create({
    sessionId: SessionId('agent-bridge-child'),
    meta: { cwd: process.cwd() },
    agentOptions: { provider: 'cli-mock', model: 'cli-mock' },
  })
  const served = toolServer.instance(created.agent)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'agent-bridge-e2e', version: '1' })
  try {
    await Promise.all([
      served.config.instance.connect(serverTransport),
      client.connect(clientTransport),
    ])
    const listed = await client.listTools()
    const call = await client.callTool({ name: 'read', arguments: { file_path: workspaceFile } })
    const absent = await client.callTool({ name: 'not_a_tool', arguments: {} })
      .then(() => 'no refusal', (error: unknown) => String(error))

    // Disposal closes the run's turn, so the report sees the whole log.
    await client.close()
    await served.dispose()

    process.stdout.write(`${JSON.stringify({
      type: 'result',
      serverName: served.serverName,
      served: served.toolNames,
      listed: listed.tools.map(tool => tool.name),
      readSchema: listed.tools.find(tool => tool.name === 'read')?.inputSchema,
      call: { isError: call.isError === true, content: call.content },
      absent,
      log: created.agent.session.events.map((event: SessionEvent) => event.type),
      toolCall: created.agent.session.events
        .filter((event: SessionEvent) => event.type === 'tool/call')
        .map((event: SessionEvent) => event.data),
      toolResultIsError: created.agent.session.events
        .filter((event: SessionEvent) => event.type === 'tool/result')
        .map((event: SessionEvent) => (event.type === 'tool/result' ? event.data.message.content[0].isError === true : true)),
    })}\n`)
  } finally {
    // Both are idempotent, so the ordinary path's earlier close still leaves
    // a failing run releasing everything it took.
    await client.close()
    await served.dispose()
    await created.dispose()
  }
} finally {
  await ctx.fiber.dispose()
}
