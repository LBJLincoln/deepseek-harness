/**
 * Mirrors every skill body this composition has loaded into the component
 * registry as a `skill` component, and re-addresses those skills whenever the
 * skill registry reports a catalog change.
 *
 * A skill is in play once its body is loaded, not once it is listed: a catalog
 * entry carries a summary, and only the loaded definition holds the knowledge a
 * generation is addressed by, so a skill that stayed reachable and unloaded is
 * absent from the inventory.
 * @module @deepseek-ai/dsh-components-skills
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: resolves ctx.agents, the viewing scope a session's skills resolve through.
import type {} from '@deepseek-ai/dsh-agent'
import { ComponentId } from '@deepseek-ai/dsh-components'
import type {
  ComponentDescriptor,
  ComponentDigest,
  ComponentId as ComponentIdType,
} from '@deepseek-ai/dsh-components/types'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
// Value and type import: `skillDigest` re-addresses a reloaded body, and the
// module resolves ctx.skills plus the registry's `skills/change` notification.
import { skillDigest } from '@deepseek-ai/dsh-skill'
import type { SkillViewOptions } from '@deepseek-ai/dsh-skill'
// Type-only: resolves ctx.tools and the registry's `tools/result` notification.
import type {} from '@deepseek-ai/dsh-tools'
import type { ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'

export const name = 'components-skills'
export const inject = ['agents', 'components', 'skills', 'tools']

/** Model-facing tool whose settled result records one loaded skill generation. */
const SKILL_TOOL = 'skill'

/** A full lowercase SHA-256 hex, the only digest a generation comparison keys on. */
const DIGEST = /^[0-9a-f]{64}$/

/** Kind-specific detail of a `skill` component. */
export interface SkillComponentDetail {
  /** Kebab-case skill name, the value the `skill` tool takes. */
  readonly skillName: string
}

declare module '@deepseek-ai/dsh-components/types' {
  interface ComponentKindMap {
    /**
     * One skill body this composition loaded, addressed by the knowledge and
     * routing metadata inside it rather than by the catalog entry that
     * advertised it.
     */
    'skill': SkillComponentDetail
  }
}

const OWNER = '@deepseek-ai/dsh-components-skills'

/**
 * Component id of one skill.
 * @param skillName - kebab-case skill name.
 * @returns the stable id `skill:<name>`.
 */
export function skillComponentId(skillName: string): ComponentIdType {
  return ComponentId(`skill:${skillName}`)
}

/**
 * Describe one loaded generation as a component. Every field except the digest
 * is a function of the name alone, so the two load paths produce one identical
 * descriptor for one generation.
 */
function describeSkill(skillName: string, digest: ComponentDigest): ComponentDescriptor {
  return {
    id: skillComponentId(skillName),
    kind: 'skill',
    digest,
    digestBasis: 'content',
    name: skillName,
    description: `Skill "${skillName}", whose loaded instructions this session has in play.`,
    owner: OWNER,
    provenance: 'curated',
    invoke: { tool: SKILL_TOOL, arguments: { name: skillName } },
    detail: { skillName },
  }
}

/** One mirrored skill: the generation in play, how to reload it, and its disposer. */
interface MirroredSkill {
  readonly digest: ComponentDigest
  /** Lookup that produced this generation, replayed to re-address the skill after a catalog change. */
  readonly lookup: SkillViewOptions
  readonly dispose: () => void
}

/** One load record, as the durable event or the settled tool value carries it. */
interface LoadRecord {
  readonly skillName: string
  readonly digest: ComponentDigest
}

/**
 * Read one load record from a value that crossed the model/tool JSON boundary
 * or was seeded into a durable log.
 * @param record - the candidate `{ name, digest }` carrier.
 * @returns the record, or `undefined` when it names no addressable generation.
 */
function readLoadRecord(record: unknown): LoadRecord | undefined {
  const { name: skillName, digest } = record as { name?: unknown; digest?: unknown }
  if (typeof skillName !== 'string' || skillName === '') return undefined
  if (typeof digest !== 'string' || !DIGEST.test(digest)) return undefined
  return { skillName, digest: digest as ComponentDigest }
}

/**
 * Mirror every loaded skill body and re-address the set on every catalog change.
 *
 * A generation enters the inventory from the record of the load that put it in
 * play: the settled `tools/result` of the `skill` tool for a model-driven load,
 * and the `skill-invocation` message source for a user-explicit `/name` load.
 * `skills/change` is an unfiltered invalidation carrying no diff, so the
 * adapter replays each in-play skill's own lookup: a body edited in place is
 * re-registered under the same id at its new address, and a skill the registry
 * no longer resolves leaves the inventory.
 * @param ctx - Cordis context carrying the component registry, the skill registry, and the tool registry.
 */
export function apply(ctx: Context): void {
  const mirrored = new Map<string, MirroredSkill>()
  let live = true

  const mirror = (record: LoadRecord, lookup: SkillViewOptions): void => {
    const current = mirrored.get(record.skillName)
    if (current?.digest === record.digest) return
    current?.dispose()
    mirrored.set(record.skillName, {
      digest: record.digest,
      lookup,
      dispose: ctx.components.register(describeSkill(record.skillName, record.digest)),
    })
  }

  const drop = (skillName: string): void => {
    const entry = mirrored.get(skillName)
    /* v8 ignore next -- `drop` runs only for a name `readdress` read out of the live map. */
    if (entry === undefined) return
    mirrored.delete(skillName)
    entry.dispose()
  }

  /** Replay one in-play skill's own lookup and re-address or drop it. */
  const readdress = async (skillName: string, lookup: SkillViewOptions): Promise<void> => {
    const skill = await ctx.skills.get(skillName, lookup)
    // A reload settling after the adapter's teardown, or after another load
    // replaced this registration, must not resurrect or overwrite it.
    if (!live || mirrored.get(skillName)?.lookup !== lookup) return
    if (skill === undefined) {
      drop(skillName)
      return
    }
    mirror({ skillName, digest: skillDigest(skill) }, lookup)
  }

  ctx.on('tools/result', (exec: ToolExecution, result: ToolExecutionResult) => {
    if (exec.name !== SKILL_TOOL || result.isError) return
    const record = readLoadRecord(result.value)
    if (record === undefined) return
    mirror(record, { cwd: exec.agent?.session.header.cwd, scope: exec.agent })
  })

  ctx.on('session/event', (session: Session, event: SessionEvent) => {
    if (event.type !== 'user/message' || event.data.source.kind !== 'skill-invocation') return
    const record = readLoadRecord(event.data.source)
    if (record === undefined) return
    mirror(record, { cwd: session.header.cwd, scope: ctx.agents.get(session.id) })
  })

  ctx.on('skills/change', () => {
    // The registry contains a listener failure and never awaits one, so each
    // replay settles on its own and reports through this context's logger.
    for (const [skillName, entry] of [...mirrored]) {
      void readdress(skillName, entry.lookup).catch((error: unknown) => {
        ctx.logger.warn(`components-skills could not re-address skill "${skillName}": ${String(error)}`)
      })
    }
  })

  ctx.effect(() => () => {
    live = false
    for (const entry of mirrored.values()) entry.dispose()
    mirrored.clear()
  }, 'components-skills teardown')
}
