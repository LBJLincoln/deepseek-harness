/**
 * The package companion's owned relation: consecutive manifests in one session
 * state different `compositionSha256` values, and every listed entry carries an
 * address a generation comparison can key on. Seeded sessions exercise the
 * startup scan; live appends exercise the pre-publication check.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ComponentId, componentDigest } from '@deepseek-ai/dsh-components'
import type { ComponentDigest, ComponentView } from '@deepseek-ai/dsh-components/types'
import InvariantRegistry, { InvariantError } from '@deepseek-ai/dsh-invariants'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { buildCompositionManifest } from '@deepseek-ai/dsh-components-manifest'
import type { CompositionManifest } from '@deepseek-ai/dsh-components-manifest'
import * as ManifestInvariantCompanion from '@deepseek-ai/dsh-components-manifest/invariant'

declare module '@deepseek-ai/dsh-components/types' {
  interface ComponentKindMap {
    /** Test-only kind: the companion never switches on a kind, so one stands in for every producer. */
    'fixture': undefined
  }
}

/** One component as a scope-aware registry read returns it. */
function view(id: string, body: string): ComponentView {
  return {
    id: ComponentId(id),
    kind: 'fixture',
    digest: componentDigest('fixture', [body]),
    digestBasis: 'content',
    name: id,
    description: `fixture component ${id}`,
    owner: '@deepseek-ai/dsh-components-manifest',
    provenance: 'curated',
    detail: undefined,
    layer: 'global',
  }
}

/** Mount the store plus the companion, optionally over an already-seeded session. */
async function setup(seed?: readonly SessionEvent[]): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  if (seed !== undefined) ctx.sessions.create(SessionId('manifest-invariant-seeded'), { seed })
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(ManifestInvariantCompanion)
  return ctx
}

/** Two manifests seeded in log order. */
function seedManifests(first: CompositionManifest, second: CompositionManifest): readonly SessionEvent[] {
  return [
    { type: 'composition/manifest', seq: 0, time: 1_000, data: first },
    { type: 'composition/manifest', seq: 1, time: 2_000, data: second },
  ]
}

const ONE = buildCompositionManifest([view('fixture:one', 'one')])
const TWO = buildCompositionManifest([view('fixture:one', 'one'), view('fixture:two', 'two')])

describe('composition manifest invariants', () => {
  it('accepts consecutive seeded manifests that state different compositions', async () => {
    await expect(setup(seedManifests(ONE, TWO))).resolves.toBeDefined()
  })

  it('rejects a seeded manifest repeating the composition its predecessor recorded', async () => {
    await expect(setup(seedManifests(ONE, ONE)))
      .rejects.toThrow(`composition/manifest repeats compositionSha256 ${ONE.compositionSha256}`)
  })

  it('rejects a live manifest repeating the last recorded composition', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('manifest-invariant-live'))
    session.append('composition/manifest', ONE)
    expect(() => {
      session.append('composition/manifest', ONE)
    }).toThrow(expect.objectContaining<Partial<InvariantError>>({
      code: 'INVARIANT',
      packageName: '@deepseek-ai/dsh-components-manifest',
    }))
    expect(session.seq).toBe(1)
  })

  it('accepts a manifest that restates a composition an intervening one replaced', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('manifest-invariant-restated'))
    expect(() => {
      session.append('composition/manifest', ONE)
      session.append('composition/manifest', TWO)
      session.append('composition/manifest', ONE)
    }).not.toThrow()
    expect(session.seq).toBe(3)
  })

  it('rejects an entry whose digest no generation comparison can key on', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('manifest-invariant-address'))
    const truncated: CompositionManifest = {
      ...ONE,
      components: ONE.components.map(entry => ({
        ...entry,
        digest: entry.digest.slice(0, 16) as ComponentDigest,
      })),
    }
    expect(() => {
      session.append('composition/manifest', truncated)
    }).toThrow('composition/manifest lists component address "fixture:one@')
    expect(session.seq).toBe(0)
  })

  it('leaves every other durable event to its own owner', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('manifest-invariant-other'))
    expect(() => {
      session.append('turn/start', { turn: 1 })
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    }).not.toThrow()
    expect(session.seq).toBe(2)
  })
})
