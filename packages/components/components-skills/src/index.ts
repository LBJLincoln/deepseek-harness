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
// Value and type import: `skillDigest` addresses every body this adapter reads
// back, and the module resolves ctx.skills plus its `skills/change` notification.
import { skillDigest } from '@deepseek-ai/dsh-skill'
import type { SkillViewOptions } from '@deepseek-ai/dsh-skill'
// Type-only: resolves ctx.tools and the registry's `tools/result` notification.
import type {} from '@deepseek-ai/dsh-tools'
import type { ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'

export const name = 'components-skills'
export const inject = ['agents', 'components', 'skills', 'tools']

/** Model-facing tool whose settled result names the skill a step put in play. */
const SKILL_TOOL = 'skill'

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

/**
 * Read the loaded skill's name from a value that crossed the model/tool JSON
 * boundary or was seeded into a durable log.
 * @param record - the candidate `{ name }` carrier.
 * @returns the name, or `undefined` when the value names no skill.
 */
function readLoadedName(record: unknown): string | undefined {
  const { name: skillName } = record as { name?: unknown }
  return typeof skillName === 'string' && skillName !== '' ? skillName : undefined
}

/**
 * Mirror every loaded skill body and re-address the set on every catalog change.
 *
 * A generation enters the inventory from the record of the load that put it in
 * play: the settled `tools/result` of the `skill` tool for a model-driven load,
 * and the `skill-invocation` message source for a user-explicit `/name` load.
 * Each record names the skill only; the address comes from the registry, whose
 * loaded definition `skillDigest()` covers, so no digest has to travel on the
 * model-visible tool result to reach the manifest.
 *
 * `skills/change` is an unfiltered invalidation carrying no diff, so the
 * adapter replays each in-play skill's own lookup: a body edited in place is
 * re-registered under the same id at its new address, and a skill the registry
 * no longer resolves leaves the inventory.
 * @param ctx - Cordis context carrying the component registry, the skill registry, and the tool registry.
 */
export function apply(ctx: Context): void {
  const mirrored = new Map<string, MirroredSkill>()
  /** The lookup whose settled read may still write each name; a later one supersedes it. */
  const resolving = new Map<string, SkillViewOptions>()
  let live = true

  /** Read one skill through the registry and address, re-address, or drop it. */
  const address = async (skillName: string, lookup: SkillViewOptions): Promise<void> => {
    resolving.set(skillName, lookup)
    const skill = await ctx.skills.get(skillName, lookup)
    // A read settling after the adapter's teardown, or after a later load or
    // replay superseded it, must not resurrect or overwrite the registration.
    if (!live || resolving.get(skillName) !== lookup) return
    resolving.delete(skillName)
    const digest = skill === undefined ? undefined : skillDigest(skill)
    const current = mirrored.get(skillName)
    if (current?.digest === digest) return
    current?.dispose()
    if (digest === undefined) {
      mirrored.delete(skillName)
      return
    }
    mirrored.set(skillName, {
      digest,
      lookup,
      dispose: ctx.components.register(describeSkill(skillName, digest)),
    })
  }

  /** Start one read, reporting a provider failure through this context's logger. */
  const track = (skillName: string, lookup: SkillViewOptions): void => {
    // Every notification below contains a listener failure and awaits none, so
    // each read settles on its own.
    void address(skillName, lookup).catch((error: unknown) => {
      ctx.logger.warn(`components-skills could not address skill "${skillName}": ${String(error)}`)
    })
  }

  ctx.on('tools/result', (exec: ToolExecution, result: ToolExecutionResult) => {
    if (exec.name !== SKILL_TOOL || result.isError) return
    const skillName = readLoadedName(result.value)
    if (skillName === undefined) return
    track(skillName, { cwd: exec.agent?.session.header.cwd, scope: exec.agent })
  })

  ctx.on('session/event', (session: Session, event: SessionEvent) => {
    if (event.type !== 'user/message' || event.data.source.kind !== 'skill-invocation') return
    const skillName = readLoadedName(event.data.source)
    if (skillName === undefined) return
    track(skillName, { cwd: session.header.cwd, scope: ctx.agents.get(session.id) })
  })

  ctx.on('skills/change', () => {
    for (const [skillName, entry] of [...mirrored]) track(skillName, entry.lookup)
  })

  ctx.effect(() => () => {
    live = false
    for (const entry of mirrored.values()) entry.dispose()
    mirrored.clear()
    resolving.clear()
  }, 'components-skills teardown')
}
