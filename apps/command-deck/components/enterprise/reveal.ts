/**
 * How the cold open lights the enterprise, division by division.
 *
 * The whole sequence is one number, `reveal`, which the presentation layer
 * writes onto the store's frame state. Every layer here turns that number into
 * per-division progress through the same curve — the node layers on the CPU,
 * the edge layer in its vertex shader — so the nodes of a division, its nebula
 * and the relationships leaving it are always on the same beat.
 *
 * At rest `reveal` is 1: every division reads as whole and every flare as
 * nothing, so the frame loop runs the same arithmetic whether a sequence is
 * playing or not and no layer needs a second code path.
 */

import { AdditiveBlending, LineBasicMaterial } from 'three'
import type { Roster } from '@/deck/contract'
import type { GraphLayout } from '@/deck/layout-enterprise'

/** How much of the sequence one division's own ignition takes. */
const DIVISION_WINDOW = 0.28

/** How far into a division's window its edges start to thread out from their source. */
const EDGE_LAG = 0.45

/** How far into a division's window its nodes have finished arriving. */
const NODE_RISE = 0.42

/** Where a division's flare peaks, as a share of its window. */
const FLARE_PEAK = 0.26

/** The per-division clock the enterprise layers read each frame. */
export interface Ignition {
  /** Where each division starts to light, in reveal units, in roster order. */
  starts: Float32Array
  /** Each node's division ordinal, indexed as the layout's nodes. */
  nodes: Int32Array
  /** How far each division's nodes have arrived this frame. */
  lit: Float32Array
  /** The flare each division carries this frame. */
  flare: Float32Array
}

/**
 * Prepare one roster's ignition.
 *
 * Divisions light in roster order and the last one completes exactly as the
 * reveal does, so the sequence ends with the graph whole rather than with a
 * division still arriving.
 * @param roster - The roster whose division order the ignition follows.
 * @param layout - The computed layout, whose nodes carry their division.
 * @returns The clock, reusable for the life of the layout.
 */
export function buildIgnition(roster: Roster, layout: GraphLayout): Ignition {
  const count = Math.max(1, roster.divisions.length)
  const starts = new Float32Array(count)
  const span = 1 - DIVISION_WINDOW
  for (let index = 0; index < count; index++) starts[index] = count < 2 ? 0 : (span * index) / (count - 1)

  const order = new Map(roster.divisions.map((division, index) => [division.id, index]))
  const nodes = new Int32Array(layout.nodes.length)
  for (const [index, node] of layout.nodes.entries()) nodes[index] = order.get(node.division) ?? 0

  return { starts, nodes, lit: new Float32Array(count), flare: new Float32Array(count) }
}

/**
 * Take the ignition to one point in the sequence.
 *
 * Ten divisions of arithmetic, written into arrays the clock already owns, so a
 * frame reads the ignition without allocating.
 * @param ignition - The clock to advance, written in place.
 * @param reveal - The sequence's progress, `0` dark to `1` whole.
 */
export function readIgnition(ignition: Ignition, reveal: number): void {
  for (let index = 0; index < ignition.starts.length; index++) {
    const start = ignition.starts[index] ?? 0
    const progress = Math.min(1, Math.max(0, (reveal - start) / DIVISION_WINDOW))
    const rise = Math.min(1, progress / NODE_RISE)
    ignition.lit[index] = rise * rise * (3 - (2 * rise))
    ignition.flare[index] = Math.max(0, 1 - (Math.abs(progress - FLARE_PEAK) / FLARE_PEAK))
  }
}

/**
 * Where one relationship starts to thread in.
 *
 * An edge waits for the later of its two divisions, so a relationship is never
 * drawn reaching into a part of the enterprise that is not there yet.
 * @param ignition - The clock carrying the division starts.
 * @param from - Node index of the relationship's source.
 * @param to - Node index of its target.
 * @returns The reveal value at which the edge begins, for the `aLightsAt` attribute.
 */
export function edgeLightsAt(ignition: Ignition, from: number, to: number): number {
  const a = ignition.starts[ignition.nodes[from] ?? 0] ?? 0
  const b = ignition.starts[ignition.nodes[to] ?? 0] ?? 0
  return Math.max(a, b)
}

/**
 * The edge layer's material: the deck's additive line material with the cold
 * open's threading cut into it.
 *
 * Patched rather than written from scratch, because the stock material carries
 * the scene's fog, and fog on the far strands is what keeps the graph reading
 * as a body rather than a flat wire ball. The threading is two attributes and
 * one uniform: each vertex knows when its division lights and where it sits
 * along its arc, so the whole reveal costs one uniform write per frame.
 * @param reveal - The uniform the frame loop writes the sequence's progress into.
 * @returns A new material; the layer owns it and disposes it.
 */
export function createEdgeMaterial(reveal: { value: number }): LineBasicMaterial {
  const material = new LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  })

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uReveal = reveal
    shader.vertexShader = `
      attribute float aLightsAt;
      attribute float aT;
      uniform float uReveal;
      varying float vThread;
    ${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
        float lit = clamp((uReveal - aLightsAt) / ${DIVISION_WINDOW.toFixed(4)}, 0.0, 1.0);
        // The head runs past the target so the last stretch of an arc is lit
        // before its division's window closes.
        float head = clamp((lit - ${EDGE_LAG.toFixed(4)}) / ${(1 - EDGE_LAG).toFixed(4)}, 0.0, 1.0) * 1.25;
        vThread = clamp((head - aT) * 5.0, 0.0, 1.0);`,
    )
    shader.fragmentShader = `
      varying float vThread;
    ${shader.fragmentShader}`.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
        diffuseColor.a *= vThread;`,
    )
  }
  material.customProgramCacheKey = () => 'dsh-edge-reveal'

  return material
}
