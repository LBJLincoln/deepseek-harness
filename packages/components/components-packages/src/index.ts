/**
 * Mirrors the packages a composition runs into the component registry: one
 * `plugin` component per composed Loader entry, and one `dynamic-package`
 * component per live activation of a package an agent wrote at runtime.
 *
 * The two kinds are the two ways code enters this process. A Loader entry is
 * curated composition an operator authored; a dynamic package is synthesized
 * code the session mounted itself, which is what makes a manifest naming one
 * distinguishable from a curated composition.
 * @module @deepseek-ai/dsh-components-packages
 */

import type { Context, Fiber } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ComponentId, componentDigest } from '@deepseek-ai/dsh-components'
import type {
  ComponentCanonical,
  ComponentDescriptor,
  ComponentDigest,
  ComponentId as ComponentIdType,
} from '@deepseek-ai/dsh-components/types'
// Type-only: resolves ctx.loader, its entry tree, and the entry lifecycle events.
import type {} from '@deepseek-ai/cordis-plugin-loader'
// Type-only: resolves ctx.dynamicCordisRunner and its `cordis/dynamic-changed` notification.
import type {} from '@deepseek-ai/dsh-cordis-host-runner'
import type { CordisDynamicPluginId } from '@deepseek-ai/dsh-cordis-host-runner/types'
import { snapshotJsonValue } from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session'

export const name = 'components-packages'
export const inject = ['components', 'loader']

/** Kind-specific detail of a `plugin` component. */
export interface PluginComponentDetail {
  /** Module specifier the entry composes, exactly as the config file authored it. */
  readonly specifier: string
}

/** Kind-specific detail of a `dynamic-package` component. */
export interface DynamicPackageComponentDetail {
  /** Stable dynamic plugin identity minted by the runner. */
  readonly pluginId: string
  /** Immutable package version this activation runs. */
  readonly packageId: string
  /** Package label the defining agent supplied. */
  readonly packageName: string
}

declare module '@deepseek-ai/dsh-components/types' {
  interface ComponentKindMap {
    /**
     * One composed Loader entry: a package or module the deployment's
     * configuration mounts, addressed by the row the Loader holds.
     */
    'plugin': PluginComponentDetail
    /**
     * One live activation of a package an agent defined at runtime, addressed
     * by the source halves the runner stores for that immutable version.
     */
    'dynamic-package': DynamicPackageComponentDetail
  }
}

const OWNER = '@deepseek-ai/dsh-components-packages'

/**
 * Component id of one composed Loader entry.
 * @param entryId - the entry's id inside its tree, nested ids included.
 * @returns the stable id `plugin:<entryId>`.
 */
export function pluginComponentId(entryId: string): ComponentIdType {
  return ComponentId(`plugin:${entryId}`)
}

/**
 * Component id of one dynamic plugin's live activation.
 * @param pluginId - stable dynamic plugin identity minted by the runner.
 * @returns the stable id `dynamic-package:<pluginId>`.
 */
export function dynamicPackageComponentId(pluginId: CordisDynamicPluginId): ComponentIdType {
  return ComponentId(`dynamic-package:${pluginId}`)
}

/**
 * Content address of one `plugin` component. The canonical value is
 * `[specifier, config]` — the mounted row as the Loader holds it. A config file
 * states `name` literally, so the specifier is identical on every host that
 * composed the same configuration; a config that does not survive the
 * lossless-JSON boundary contributes `null`, exactly as an absent one does.
 *
 * The basis is `registration`: the row names which package is mounted and with
 * what configuration, never the bytes the package ships, so a source edit under
 * the same specifier keeps this address. Harness source is addressed by its base
 * commit and patch set instead.
 * @param specifier - the entry's module specifier.
 * @param config - the config the entry passes to the plugin.
 * @returns the digest over this kind and that canonical value.
 */
export function pluginDigest(specifier: string, config: unknown): ComponentDigest {
  return componentDigest('plugin', [
    specifier,
    snapshotJsonValue(config as ComponentCanonical | undefined) ?? null,
  ])
}

/**
 * Content address of one `dynamic-package` component. The canonical value is
 * `[pluginId, packageId, hostSource, clientSource]` from the runner's own
 * package inspection, so the address covers the exact source halves this
 * activation runs and a corrected package defined on the same plugin addresses
 * differently.
 * @param pluginId - stable dynamic plugin identity.
 * @param packageId - immutable package version being run.
 * @param hostSource - Host half source, or `null` for a Client-only package.
 * @param clientSource - Client half source, or `null` for a Host-only package.
 * @returns the digest over this kind and that canonical value.
 */
export function dynamicPackageDigest(
  pluginId: string,
  packageId: string,
  hostSource: string | null,
  clientSource: string | null,
): ComponentDigest {
  return componentDigest('dynamic-package', [pluginId, packageId, hostSource, clientSource])
}

/** One mirrored component: the digest that produced it and the disposer that removes it. */
interface Mirrored {
  readonly digest: ComponentDigest
  readonly dispose: () => void
}

/** One mirrored activation, plus the Session whose reconcile owns it. */
interface MirroredDynamic extends Mirrored {
  readonly owner: SessionId
}

/** Describe one mounted Loader entry as a component. */
function describeEntry(entryId: string, specifier: string, digest: ComponentDigest): ComponentDescriptor {
  return {
    id: pluginComponentId(entryId),
    kind: 'plugin',
    digest,
    digestBasis: 'registration',
    name: entryId,
    description: `Loader entry "${entryId}" composing ${specifier}.`,
    owner: OWNER,
    provenance: 'curated',
    detail: { specifier },
  }
}

/** Describe one live dynamic activation as a component. */
function describeDynamic(
  pluginId: CordisDynamicPluginId,
  packageId: string,
  packageName: string,
  digest: ComponentDigest,
): ComponentDescriptor {
  return {
    id: dynamicPackageComponentId(pluginId),
    kind: 'dynamic-package',
    digest,
    digestBasis: 'content',
    name: packageName,
    description: `Dynamic package "${packageName}" (${pluginId}/${packageId}), written and mounted by this session at runtime.`,
    owner: OWNER,
    // The defining agent authored the source; nothing about it was curated.
    provenance: 'synthesized',
    detail: { pluginId, packageId, packageName },
  }
}

/**
 * Mirror the composed Loader entries and every live dynamic activation.
 *
 * Loader entries are reconciled from the tree itself rather than tracked
 * incrementally: siblings mount concurrently, an entry's options settle after
 * its node exists, and a config patch replaces options without replacing the
 * fiber, so the adapter recomputes on every entry-owning fiber transition and
 * on every settled entry update. Dynamic activations are reconciled per Session
 * on `cordis/dynamic-changed` and registered through the owning agent's own
 * context, so synthesized code is named in that session's manifest alone.
 * @param ctx - Cordis context carrying the component registry and the Loader.
 */
export function apply(ctx: Context): void {
  const entries = new Map<string, Mirrored>()
  const dynamic = new Map<string, MirroredDynamic>()

  const syncEntries = (): void => {
    const present = new Set<string>()
    for (const entry of ctx.loader.entries()) {
      // A live fiber is what "in play" means for a row: a disabled entry, a
      // failed one, and a node whose options have not settled all have none.
      // A group entry carries other rows rather than composing a package.
      if (entry.fiber === undefined || entry.options.group === true) continue
      const entryId = entry.id
      present.add(entryId)
      const digest = pluginDigest(entry.options.name, entry.options.config)
      const current = entries.get(entryId)
      if (current?.digest === digest) continue
      current?.dispose()
      entries.set(entryId, {
        digest,
        dispose: ctx.components.register(describeEntry(entryId, entry.options.name, digest)),
      })
    }
    for (const [entryId, mirrored] of [...entries]) {
      if (present.has(entryId)) continue
      entries.delete(entryId)
      mirrored.dispose()
    }
  }

  const syncDynamic = (agent: Agent): void => {
    const runner = ctx.get('dynamicCordisRunner')
    /* v8 ignore next -- the notification is emitted by the runner, so it is composed whenever this runs. */
    if (runner === undefined) return
    // The registry is read through the agent's own context, so the descriptor
    // is filed in that agent's layer. An agent whose service isolate does not
    // reach the registry can hold no record of the code it mounted, which is a
    // composition its manifest cannot describe.
    const registry = agent.ctx.get('components')
    if (registry === undefined) {
      ctx.logger.warn(`components-packages cannot name the dynamic packages of session ${agent.id}: its service isolate does not reach the component registry`)
      return
    }
    const present = new Set<string>()
    for (const plugin of runner.listPlugins(agent)) {
      const activeRun = plugin.activeRun
      // Only a live activation is code in play; a defined-but-unstarted
      // package is source the session wrote and has not mounted.
      if (activeRun === undefined) continue
      const inspection = runner.inspectPackage(agent, plugin.pluginId, activeRun.packageId)
      present.add(plugin.pluginId)
      const digest = dynamicPackageDigest(
        plugin.pluginId,
        activeRun.packageId,
        inspection.code.host ?? null,
        inspection.code.client ?? null,
      )
      const current = dynamic.get(plugin.pluginId)
      if (current?.digest === digest) continue
      current?.dispose()
      dynamic.set(plugin.pluginId, {
        digest,
        owner: agent.id,
        dispose: registry.register(
          describeDynamic(plugin.pluginId, activeRun.packageId, inspection.name, digest),
        ),
      })
    }
    // The reading covers this Session alone, so it prunes this Session's rows
    // alone: another Session's activations are answered by its own notification.
    for (const [pluginId, mirrored] of [...dynamic]) {
      if (mirrored.owner !== agent.id || present.has(pluginId)) continue
      dynamic.delete(pluginId)
      mirrored.dispose()
    }
  }

  syncEntries()
  ctx.on('internal/status', (fiber: Fiber) => {
    if (fiber.entry === undefined) return
    syncEntries()
  })
  ctx.on('loader/partial-dispose', syncEntries)
  ctx.on('cordis/dynamic-changed', syncDynamic)
  ctx.effect(() => () => {
    for (const mirrored of [...entries.values(), ...dynamic.values()]) mirrored.dispose()
    entries.clear()
    dynamic.clear()
  }, 'components-packages teardown')
}
