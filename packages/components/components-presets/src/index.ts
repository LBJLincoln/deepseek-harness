/**
 * Mirrors every standing agent-preset mount into the component registry as
 * `preset` components, reconciled against the roster's own live-mount reading
 * whenever an agent joins a composition or a session commits a different one.
 * @module @deepseek-ai/dsh-components-presets
 */

import { dirname, isAbsolute, relative, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: resolves the `agent/created` lifecycle notification.
import type {} from '@deepseek-ai/dsh-agent'
import { livePresetMounts } from '@deepseek-ai/dsh-agent-presets'
import type { PresetMount, PresetTrust } from '@deepseek-ai/dsh-agent-presets'
// Type-only: resolves the roster's `agent-preset/selected` notification.
import type {} from '@deepseek-ai/dsh-agent-presets/types'
import { ComponentId, componentDigest } from '@deepseek-ai/dsh-components'
import type {
  ComponentCanonical,
  ComponentDescriptor,
  ComponentDigest,
  ComponentId as ComponentIdType,
} from '@deepseek-ai/dsh-components/types'
import { snapshotJsonValue } from '@deepseek-ai/dsh-session'

export const name = 'components-presets'
// `agentPresets` is the seam this adapter mirrors even though the mount reading
// is a module function of the same package: without the roster composed there is
// nothing to mirror, and the injection is what holds the adapter until there is.
export const inject = ['components', 'agentPresets']

/** Kind-specific detail of a `preset` component. */
export interface PresetComponentDetail {
  /** Trust recorded on the root the preset was discovered under. */
  readonly trust: PresetTrust
  /** Rows the mounted composition holds after `include` resolution. */
  readonly rows: number
}

declare module '@deepseek-ai/dsh-components/types' {
  interface ComponentKindMap {
    /**
     * One standing preset composition currently mounted. A preset is in play
     * once its subtree is installed, which is what an agent joins; the roster
     * mounts one standing composition per preset, so two agents on the same
     * preset share one component.
     */
    'preset': PresetComponentDetail
  }
}

const OWNER = '@deepseek-ai/dsh-components-presets'

/**
 * Component id of one preset.
 * @param presetId - the preset's directory name.
 * @returns the stable id `preset:<id>`.
 */
export function presetComponentId(presetId: string): ComponentIdType {
  return ComponentId(`preset:${presetId}`)
}

/**
 * One row's module specifier with a host path rewritten relative to the preset
 * directory, so two hosts that mounted the same composition under different
 * roots address identically. A package name or a specifier already relative to
 * the composition is canonical as authored.
 */
function portableName(rowName: string, presetDirectory: string): string {
  if (!isAbsolute(rowName)) return rowName
  return relative(presetDirectory, rowName).split(sep).join('/')
}

/**
 * The composition rows of one mount, each `[id, name, config, disabled]`.
 *
 * A row's `config` is whatever the composition file supplied — a `!!js`
 * expression can evaluate to a value no JSON encoding preserves — so a config
 * that does not survive the lossless-JSON boundary contributes `null`, exactly
 * as an absent one does.
 */
function canonicalRows(mount: PresetMount): readonly ComponentCanonical[] {
  const directory = dirname(mount.path)
  return [...mount.tree.entries()].map(entry => [
    entry.options.id,
    portableName(entry.options.name, directory),
    snapshotJsonValue(entry.options.config as ComponentCanonical) ?? null,
    entry.options.disabled === true,
  ])
}

/**
 * Content address of one `preset` component. The canonical value is
 * `[id, trust, rows]` over the composition after `include` resolution, so a
 * changed row moves the digest while the absolute root the preset was
 * discovered under stays outside it.
 * @param mount - the standing mount, whose tree holds the resolved rows.
 * @returns the digest over this kind and that canonical value.
 */
export function presetDigest(mount: PresetMount): ComponentDigest {
  return componentDigest('preset', [mount.presetId, mount.trust, canonicalRows(mount)])
}

/** Describe one standing mount as a component. */
function describePreset(mount: PresetMount, digest: ComponentDigest, rows: number): ComponentDescriptor {
  return {
    id: presetComponentId(mount.presetId),
    kind: 'preset',
    digest,
    digestBasis: 'content',
    name: mount.presetId,
    description: `Agent preset "${mount.presetId}" of ${mount.trust} trust, composing ${String(rows)} row(s) that every agent joined to it runs on.`,
    owner: OWNER,
    // A `user` preset was authored locally, by a person or by an agent, and the
    // roster records no author; the honest reading of that trust is synthesized.
    provenance: mount.trust === 'user' ? 'synthesized' : 'curated',
    detail: { trust: mount.trust, rows },
  }
}

/** One mirrored preset: the digest that produced it and the disposer that removes it. */
interface MirroredPreset {
  readonly digest: ComponentDigest
  readonly dispose: () => void
}

/**
 * Mirror every standing preset mount and reconcile at each join.
 *
 * The roster publishes no mount notification, and its authoritative reading —
 * `livePresetMounts()` — prunes the record of every subtree whose fiber is
 * gone. The adapter therefore reconciles against that reading at the two edges
 * a session's composition changes at: an agent joining a standing mount
 * (`agent/created`, emitted after the factory's setup installed it) and a blank
 * session committing a different preset (`agent-preset/selected`). A mount torn
 * down with no later join stays listed until the next reconcile, which is
 * bounded by standing mounts living until whole-tree teardown.
 * @param ctx - Cordis context carrying the component registry and the preset roster.
 */
export function apply(ctx: Context): void {
  const mirrored = new Map<string, MirroredPreset>()
  const sync = (): void => {
    const present = new Set<string>()
    for (const mount of livePresetMounts()) {
      present.add(mount.presetId)
      const digest = presetDigest(mount)
      const current = mirrored.get(mount.presetId)
      if (current?.digest === digest) continue
      current?.dispose()
      mirrored.set(mount.presetId, {
        digest,
        dispose: ctx.components.register(describePreset(mount, digest, canonicalRows(mount).length)),
      })
    }
    for (const [presetId, entry] of [...mirrored]) {
      if (present.has(presetId)) continue
      mirrored.delete(presetId)
      entry.dispose()
    }
  }
  sync()
  ctx.on('agent/created', sync)
  ctx.on('agent-preset/selected', sync)
  ctx.effect(() => () => {
    for (const entry of mirrored.values()) entry.dispose()
    mirrored.clear()
  }, 'components-presets teardown')
}
