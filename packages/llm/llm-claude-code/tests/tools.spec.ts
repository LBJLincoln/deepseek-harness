/**
 * The offer a request's tools become: the MCP surface a real client sees over
 * an in-memory transport, the harness JSON Schema served verbatim, and a call
 * that executes nothing.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it } from 'vitest'
import {
  harnessToolName,
  MCP_SERVER_NAME,
  MCP_TOOL_PREFIX,
  OFFER_SERVER_VERSION,
  QUEUED_CALL_TEXT,
  toolOffer,
} from '../src/tools.ts'
import type { ToolOffer } from '../src/types.ts'
import { BASH_TOOL } from './fixture.ts'

/** Connect a real MCP client to the offered server. */
async function connect(offer: ToolOffer): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'spec', version: '1' })
  await Promise.all([
    offer.server.instance.connect(serverTransport),
    client.connect(clientTransport),
  ])
  return client
}

describe('toolOffer', () => {
  it('offers nothing for a request that carries no tools', () => {
    expect(toolOffer([])).toBeUndefined()
  })

  it('names the server and the tools the query allows', () => {
    const offer = toolOffer([BASH_TOOL])
    expect(offer?.server).toMatchObject({ type: 'sdk', name: MCP_SERVER_NAME })
    expect(offer?.allowedTools).toEqual([`${MCP_TOOL_PREFIX}bash`])
    expect(offer?.names.has('bash')).toBe(true)
  })

  it('serves the harness description and JSON Schema verbatim', async () => {
    const offer = toolOffer([BASH_TOOL])!
    const client = await connect(offer)

    expect(client.getServerVersion())
      .toMatchObject({ name: MCP_SERVER_NAME, version: OFFER_SERVER_VERSION })
    expect(await client.listTools()).toMatchObject({
      tools: [{
        name: 'bash',
        description: 'Run a shell command.',
        inputSchema: { type: 'object', properties: { command: { type: 'string' } } },
      }],
    })

    await client.close()
    await offer.close()
  })

  it('answers a call without running anything', async () => {
    const offer = toolOffer([BASH_TOOL])!
    const client = await connect(offer)

    expect(await client.callTool({ name: 'bash', arguments: { command: 'rm -rf /' } }))
      .toMatchObject({ content: [{ type: 'text', text: QUEUED_CALL_TEXT }] })

    await client.close()
    await offer.close()
  })
})

describe('harnessToolName', () => {
  it('strips the product\'s qualification and keeps a bare harness name', () => {
    expect(harnessToolName(`${MCP_TOOL_PREFIX}bash`)).toBe('bash')
    expect(harnessToolName('bash')).toBe('bash')
  })
})
