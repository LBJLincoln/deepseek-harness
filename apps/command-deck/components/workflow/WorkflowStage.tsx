'use client'

import { Html, OrbitControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import {
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type ElementRef,
  type ReactNode,
} from 'react'
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  LineBasicMaterial,
  Matrix4,
  Object3D,
  Vector3,
  type InstancedMesh,
  type LineSegments,
  type Points,
} from 'three'
import { easeInOutCubic } from '@/deck/easing'
import type { WorkflowGraph, WorkflowNode } from '@/deck/layout-workflow'
import { usePrefersReducedMotion } from '@/deck/motion'
import { useDeck } from '@/deck/store'
import { decay, sinceLast } from '@/components/enterprise/activity'
import { createGlowMaterial } from '@/components/three/glow'
import { Stage as Canvas3D } from '@/components/three/Stage'
import styles from './workflow.module.css'

/** How long a node keeps its light after its seat's last event, in milliseconds. */
const LIVE_WINDOW_MS = 4_000

/** How long a node stays undimmed after its seat's last event, in milliseconds. */
const IDLE_MS = 30_000

/** How long an edge takes to grow from its parent to its child, in milliseconds. */
const GROW_MS = 800

/** How long a certificate's seal and the pulse it sends back take, in milliseconds. */
const SEAL_MS = 1_400

/** How long a refusal flashes before it settles to a rim, in milliseconds. */
const FLASH_MS = 900

/** How long a directive keeps its session lit, in milliseconds. */
const DIRECTIVE_MS = 1_200

/** Points one edge is drawn through; the bow needs more than its two ends. */
const EDGE_STEPS = 14

/** How far a spawn edge bows out of the graph plane, in scene units. */
const SPAWN_BOW = 7

/** How far a merge strand bows the other way, so it reads apart from the spawn edges. */
const MERGE_BOW = -13

/** How many pulses can travel at once. */
const PULSES = 48

/** Radius of a node's body. */
const NODE_RADIUS = 5.2

/** Radius a node's hit area reaches, which is wider than the body it selects. */
const HIT_RADIUS = 9

/** Length of a node's event meter at the busiest session in the run. */
const METER_LENGTH = 17

/** How far below its centre a node's meter sits. */
const METER_DROP = 8.4

/** The seal's green, the refusal's red and the merge's amber. */
const SEAL_TONE = new Color('#49e0a6')
const REFUSAL_TONE = new Color('#ff3f6b')
const MERGE_TONE = new Color('#ff8a6b')

/** The wide shot the graph opens on before it is framed. */
const ESTABLISH = new Vector3(96, 128, 270)

/** Vertical field of view the canvas is opened with, in degrees. */
const FOV = 42

/** How long the establishing move takes, in milliseconds. */
const ESTABLISH_MS = 2_400

/** How long the viewer keeps the camera after touching the controls. */
const HANDOVER_MS = 12_000

/** Clear space the framing keeps around the graph, as a share of its extent. */
const FRAME_PADDING = 1.28

/** Scratch objects the frame loops write through; nothing is allocated per frame. */
const PLACE = new Object3D()
const HIDDEN = new Matrix4().makeScale(0.001, 0.001, 0.001)
const POINT = new Vector3()
const GOAL = new Vector3()
const TINT = new Color()

/**
 * A point along one edge.
 * @param from - The parent node.
 * @param to - The child node.
 * @param bow - How far the edge leaves the graph plane at its middle.
 * @param t - Position along the edge, `0` at the parent and `1` at the child.
 * @param out - The vector the position is written into.
 * @returns The same vector, for chaining.
 */
function edgeAt(from: WorkflowNode, to: WorkflowNode, bow: number, t: number, out: Vector3): Vector3 {
  return out.set(
    from.x + ((to.x - from.x) * t),
    from.y + ((to.y - from.y) * t),
    Math.sin(Math.PI * t) * bow,
  )
}

/**
 * How long ago one session last produced, in whichever clock the timeline is on.
 *
 * At the head the deck is watching a stream, so the reading is the store's
 * per-agent activity clock — wall time since the frame arrived. Off the head the
 * run is being read at a point of its own history, where wall time says only how
 * long the page has been open; the reading is then the recorded gap between the
 * cursor and the session's newest admitted frame, so a session lights as its
 * work passes under the cursor and goes quiet when the run left it quiet.
 * @param node - The session to read.
 * @param activity - The store's last-event timestamp per agent id.
 * @param cursor - The timeline position, or `undefined` while following the head.
 * @param now - The current `performance.now()` reading.
 * @returns Milliseconds since that session last produced.
 */
function idleness(
  node: WorkflowNode,
  activity: ReadonlyMap<string, number>,
  cursor: number | undefined,
  now: number,
): number {
  if (cursor !== undefined) return Number.isNaN(node.lastMs) ? Infinity : cursor - node.lastMs
  return node.agentId === undefined ? Infinity : sinceLast(activity, node.agentId, now)
}

/** What one node's animation clocks hold; each is a `performance.now()` reading. */
interface NodeClock {
  /** When the node entered the graph. */
  born: number
  /** When a certificate sealed it; `-Infinity` while it is unsealed. */
  sealed: number
  /** When its last refusal flashed. */
  refused: number
  /** When its last directive lit it. */
  directed: number
}

/** What the graph carried at the previous cut, which a new event is noticed against. */
interface Counters {
  certificates: number
  refusals: number
  directives: number
}

/** One pulse travelling back up an edge. */
interface Pulse {
  edge: number
  started: number
}

/** Frame state the scene shares; it is mutated in place, never rendered through React. */
interface Clocks {
  nodes: Map<string, NodeClock>
  seen: Map<string, Counters>
  pulses: Pulse[]
  /** When the run's merge count last rose. */
  merged: number
  /** How many merges the previous cut carried. */
  merges: number
}

/**
 * A fresh, empty set of scene clocks.
 * @returns The clocks, ready to be mutated from the frame loop.
 */
function createClocks(): Clocks {
  return { nodes: new Map(), seen: new Map(), pulses: [], merged: -Infinity, merges: 0 }
}

/**
 * Notice what the graph has gained since the last cut of the timeline.
 *
 * Node identity is the session id, so a scrub backwards drops nodes and their
 * clocks with them and the same node re-entering later is born again, grows its
 * edge again and seals again. That is what makes the graph build itself under
 * playback rather than only under a live run.
 * @param clocks - The scene's frame state.
 * @param graph - The graph the timeline currently admits.
 * @param reduced - Whether the viewer asked for reduced motion.
 */
function noticeChanges(clocks: Clocks, graph: WorkflowGraph, reduced: boolean): void {
  const now = performance.now()
  const live = new Set(graph.nodes.map(node => node.id))
  for (const id of [...clocks.nodes.keys()]) {
    if (live.has(id)) continue
    clocks.nodes.delete(id)
    clocks.seen.delete(id)
  }

  for (const node of graph.nodes) {
    let clock = clocks.nodes.get(node.id)
    if (clock === undefined) {
      clock = { born: now, sealed: -Infinity, refused: -Infinity, directed: -Infinity }
      clocks.nodes.set(node.id, clock)
    }
    const before = clocks.seen.get(node.id) ?? { certificates: 0, refusals: 0, directives: 0 }
    if (node.certificates > before.certificates) {
      clock.sealed = now
      const edge = graph.edges.findIndex(entry => entry.kind === 'spawn' && entry.to === node.id)
      if (edge >= 0 && !reduced) clocks.pulses.push({ edge, started: now })
    }
    if (node.certificates === 0) clock.sealed = -Infinity
    if (node.refusals > before.refusals) clock.refused = now
    if (node.refusals === 0) clock.refused = -Infinity
    if (node.directives > before.directives) clock.directed = now
    clocks.seen.set(node.id, {
      certificates: node.certificates,
      refusals: node.refusals,
      directives: node.directives,
    })
  }

  if (graph.merges > clocks.merges) clocks.merged = now
  if (graph.merges === 0) clocks.merged = -Infinity
  clocks.merges = graph.merges
  if (clocks.pulses.length > PULSES) clocks.pulses.splice(0, clocks.pulses.length - PULSES)
}

/**
 * The edges: one line layer carrying every strand, drawn from the parent outwards.
 *
 * A spawn edge grows over {@link GROW_MS} from the moment its child enters the
 * graph, unless the parent logged the delegation itself — a stated relationship
 * exists before the child has produced anything, so its edge is drawn whole.
 * Brightness is baked into the vertex colours, so the whole set is one draw call
 * and one buffer write.
 * @param props - The graph and the scene's frame state.
 * @returns The edge layer.
 */
function Edges({ graph, clocks }: { graph: WorkflowGraph; clocks: Clocks }): ReactNode {
  const reduced = usePrefersReducedMotion()
  const lines = useRef<LineSegments>(null)
  const edges = graph.edges

  const geometry = useMemo(() => {
    const vertices = Math.max(1, edges.length) * (EDGE_STEPS - 1) * 2
    const built = new BufferGeometry()
    built.setAttribute('position', new BufferAttribute(new Float32Array(vertices * 3), 3))
    built.setAttribute('color', new BufferAttribute(new Float32Array(vertices * 3), 3))
    return built
  }, [edges.length])

  const material = useMemo(() => new LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  }), [])

  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])

  useFrame(() => {
    const layer = lines.current
    if (layer === null) return
    const now = performance.now()
    const position = layer.geometry.getAttribute('position')
    const colour = layer.geometry.getAttribute('color')

    for (const [index, edge] of edges.entries()) {
      const from = graph.byId.get(edge.from)
      const to = graph.byId.get(edge.to)
      const born = clocks.nodes.get(edge.to)?.born ?? now
      const reach = easeInOutCubic(reduced || edge.immediate ? 1 : Math.min(1, (now - born) / GROW_MS))
      const merged = edge.kind === 'merge'
      const lit = merged ? 0.55 + (0.75 * decay(now - clocks.merged, SEAL_MS)) : 0.42
      TINT.set(merged ? MERGE_TONE : (from?.color ?? '#ffffff'))
      const bow = merged ? MERGE_BOW : SPAWN_BOW

      for (let step = 0; step < EDGE_STEPS - 1; step++) {
        const pair = ((index * (EDGE_STEPS - 1)) + step) * 2
        if (from === undefined || to === undefined) {
          colour.setXYZ(pair, 0, 0, 0)
          colour.setXYZ(pair + 1, 0, 0, 0)
          continue
        }
        edgeAt(from, to, bow, (step / (EDGE_STEPS - 1)) * reach, POINT)
        position.setXYZ(pair, POINT.x, POINT.y, POINT.z)
        edgeAt(from, to, bow, ((step + 1) / (EDGE_STEPS - 1)) * reach, POINT)
        position.setXYZ(pair + 1, POINT.x, POINT.y, POINT.z)
        // The strand fades towards the child, so the direction of the edge reads
        // without an arrowhead the camera would have to be square on to see.
        const near = lit * (0.45 + (0.55 * (1 - (step / EDGE_STEPS))))
        const far = lit * (0.45 + (0.55 * (1 - ((step + 1) / EDGE_STEPS))))
        colour.setXYZ(pair, TINT.r * near, TINT.g * near, TINT.b * near)
        colour.setXYZ(pair + 1, TINT.r * far, TINT.g * far, TINT.b * far)
      }
    }

    position.needsUpdate = true
    colour.needsUpdate = true
  })

  return <lineSegments ref={lines} geometry={geometry} material={material} renderOrder={2} frustumCulled={false} />
}

/**
 * The pulse a certificate sends back along its edge to the session that started it.
 * @param props - The graph and the scene's frame state.
 * @returns The pulse layer.
 */
function Pulses({ graph, clocks }: { graph: WorkflowGraph; clocks: Clocks }): ReactNode {
  const points = useRef<Points>(null)

  const geometry = useMemo(() => {
    const built = new BufferGeometry()
    built.setAttribute('position', new BufferAttribute(new Float32Array(PULSES * 3), 3))
    built.setAttribute('aColor', new BufferAttribute(new Float32Array(PULSES * 3), 3))
    built.setAttribute('aSize', new BufferAttribute(new Float32Array(PULSES).fill(24), 1))
    built.setAttribute('aGain', new BufferAttribute(new Float32Array(PULSES), 1))
    return built
  }, [])

  const material = useMemo(createGlowMaterial, [])

  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])

  useFrame(() => {
    const layer = points.current
    if (layer === null) return
    const now = performance.now()
    clocks.pulses = clocks.pulses.filter(pulse => now - pulse.started < SEAL_MS)

    const position = layer.geometry.getAttribute('position')
    const colour = layer.geometry.getAttribute('aColor')
    const gain = layer.geometry.getAttribute('aGain')

    for (let slot = 0; slot < PULSES; slot++) {
      const pulse = clocks.pulses[slot]
      const edge = pulse === undefined ? undefined : graph.edges[pulse.edge]
      const from = edge === undefined ? undefined : graph.byId.get(edge.from)
      const to = edge === undefined ? undefined : graph.byId.get(edge.to)
      if (pulse === undefined || from === undefined || to === undefined) {
        gain.setX(slot, 0)
        continue
      }
      // The certificate travels back up the edge the work was delegated down.
      const t = 1 - ((now - pulse.started) / SEAL_MS)
      edgeAt(from, to, SPAWN_BOW, t, POINT)
      position.setXYZ(slot, POINT.x, POINT.y, POINT.z)
      colour.setXYZ(slot, SEAL_TONE.r, SEAL_TONE.g, SEAL_TONE.b)
      gain.setX(slot, Math.sin(Math.PI * (1 - t)) * 1.7)
    }

    position.needsUpdate = true
    colour.needsUpdate = true
    gain.needsUpdate = true
  })

  return <points ref={points} geometry={geometry} material={material} renderOrder={6} frustumCulled={false} />
}

/**
 * The nodes: a body per session, its glow, its seal and its event meter.
 *
 * The bodies, the rings, the meters and the hit areas are instanced meshes, so
 * the session count costs instances rather than draw calls and the pointer
 * picks a session out of the hit mesh by its instance id.
 * @param props - The graph, the scene's frame state, the selected session, and
 * the hover and selection callbacks.
 * @returns The node layers.
 */
function Nodes({
  graph,
  clocks,
  selected,
  onHover,
  onSelect,
}: {
  graph: WorkflowGraph
  clocks: Clocks
  selected: string | undefined
  onHover: (id: string | undefined) => void
  onSelect: (id: string | undefined) => void
}): ReactNode {
  const reduced = usePrefersReducedMotion()
  const activity = useDeck(state => state.activity)
  const cursor = useDeck(state => state.cursor)
  const bodies = useRef<InstancedMesh>(null)
  const rings = useRef<InstancedMesh>(null)
  const meters = useRef<InstancedMesh>(null)
  const hits = useRef<InstancedMesh>(null)
  const glow = useRef<Points>(null)
  const count = Math.max(1, graph.nodes.length)

  const glowGeometry = useMemo(() => {
    const built = new BufferGeometry()
    built.setAttribute('position', new BufferAttribute(new Float32Array(count * 3), 3))
    built.setAttribute('aColor', new BufferAttribute(new Float32Array(count * 3), 3))
    built.setAttribute('aSize', new BufferAttribute(new Float32Array(count).fill(36), 1))
    built.setAttribute('aGain', new BufferAttribute(new Float32Array(count), 1))
    return built
  }, [count])

  const glowMaterial = useMemo(createGlowMaterial, [])

  useEffect(() => () => glowGeometry.dispose(), [glowGeometry])
  useEffect(() => () => glowMaterial.dispose(), [glowMaterial])

  // Colour and the hit areas are properties of the graph, not of the frame, so
  // they are written when the graph changes rather than sixty times a second.
  useEffect(() => {
    const body = bodies.current
    const ring = rings.current
    const meter = meters.current
    const hit = hits.current
    if (body === null || ring === null || meter === null || hit === null) return
    for (const [index, node] of graph.nodes.entries()) {
      body.setColorAt(index, TINT.set(node.color))
      meter.setColorAt(index, TINT.set(node.color))
      ring.setColorAt(index * 2, TINT.copy(SEAL_TONE))
      ring.setColorAt((index * 2) + 1, TINT.copy(REFUSAL_TONE))
      PLACE.position.set(node.x, node.y, 0)
      PLACE.scale.setScalar(1)
      PLACE.rotation.set(0, 0, 0)
      PLACE.updateMatrix()
      hit.setMatrixAt(index, PLACE.matrix)
    }
    for (let index = graph.nodes.length; index < count; index++) hit.setMatrixAt(index, HIDDEN)
    hit.instanceMatrix.needsUpdate = true
    if (body.instanceColor !== null) body.instanceColor.needsUpdate = true
    if (meter.instanceColor !== null) meter.instanceColor.needsUpdate = true
    if (ring.instanceColor !== null) ring.instanceColor.needsUpdate = true
  }, [graph, count])

  useFrame((state) => {
    const body = bodies.current
    const ring = rings.current
    const meter = meters.current
    const layer = glow.current
    if (body === null || ring === null || meter === null || layer === null) return
    const now = performance.now()
    const beat = state.clock.elapsedTime
    const position = layer.geometry.getAttribute('position')
    const colour = layer.geometry.getAttribute('aColor')
    const gain = layer.geometry.getAttribute('aGain')
    // Under reduced motion every clock reads settled: a seal is already landed,
    // a merge is already lit and a new node is already at full size.
    const merged = reduced ? 0 : decay(now - clocks.merged, SEAL_MS)

    for (const [index, node] of graph.nodes.entries()) {
      const clock = clocks.nodes.get(node.id)
      const since = idleness(node, activity, cursor, now)
      const working = reduced ? 0 : decay(since, LIVE_WINDOW_MS)
      const directed = clock === undefined || reduced ? 0 : decay(now - clock.directed, DIRECTIVE_MS)
      const flash = clock === undefined || reduced ? 0 : decay(now - clock.refused, FLASH_MS)
      const lands = node.integration && clocks.merges > 0
      const chosen = node.id === selected
      const arrival = reduced ? 1 : easeInOutCubic(Math.min(1, (now - (clock?.born ?? now)) / GROW_MS))

      const breath = reduced ? 0 : Math.sin((beat * 2.4) + index) * 0.045
      const scale = arrival * (1 + breath + (working * 0.2) + (directed * 0.3) + (chosen ? 0.24 : 0))
      PLACE.position.set(node.x, node.y, 0)
      PLACE.scale.setScalar(Math.max(0.001, scale))
      PLACE.rotation.set(0, reduced ? 0 : beat * 0.12, 0)
      PLACE.updateMatrix()
      body.setMatrixAt(index, PLACE.matrix)

      const level = (node.implied ? 0.3 : 0.62) + (working * 0.7) + (directed * 0.8)
        + (lands ? 0.55 + (merged * 0.9) : 0) + (chosen ? 0.5 : 0)
      const dim = since > IDLE_MS && !chosen ? 0.34 : 1
      position.setXYZ(index, node.x, node.y, 0)
      if (flash > 0) TINT.copy(REFUSAL_TONE)
      else TINT.set(node.color)
      colour.setXYZ(index, TINT.r, TINT.g, TINT.b)
      gain.setX(index, arrival * dim * (level + (flash * 1.4)))

      PLACE.position.set(node.x, node.y, 0)
      PLACE.rotation.set(0, 0, 0)
      // The seal opens wide and settles onto the body it certifies.
      const landing = clock === undefined || reduced
        ? 1
        : easeInOutCubic(Math.min(1, (now - clock.sealed) / SEAL_MS))
      PLACE.scale.setScalar(node.certificates === 0 ? 0.001 : 1 + ((1 - landing) * 1.7))
      PLACE.updateMatrix()
      ring.setMatrixAt(index * 2, PLACE.matrix)
      PLACE.scale.setScalar(node.refusals === 0 ? 0.001 : 1.26)
      PLACE.updateMatrix()
      ring.setMatrixAt((index * 2) + 1, PLACE.matrix)

      const share = graph.busiest === 0 ? 0 : node.events / graph.busiest
      const length = Math.max(0.001, share * METER_LENGTH * arrival)
      PLACE.position.set(node.x - (METER_LENGTH / 2) + (length / 2), node.y - METER_DROP, 0)
      PLACE.scale.set(length, 1, 1)
      PLACE.updateMatrix()
      meter.setMatrixAt(index, PLACE.matrix)
    }

    for (let index = graph.nodes.length; index < count; index++) {
      gain.setX(index, 0)
      body.setMatrixAt(index, HIDDEN)
      meter.setMatrixAt(index, HIDDEN)
      ring.setMatrixAt(index * 2, HIDDEN)
      ring.setMatrixAt((index * 2) + 1, HIDDEN)
    }

    body.instanceMatrix.needsUpdate = true
    ring.instanceMatrix.needsUpdate = true
    meter.instanceMatrix.needsUpdate = true
    position.needsUpdate = true
    colour.needsUpdate = true
    gain.needsUpdate = true
  })

  const pick = (instanceId: number | undefined): string | undefined =>
    instanceId === undefined ? undefined : graph.nodes[instanceId]?.id

  return (
    <group>
      <points ref={glow} geometry={glowGeometry} material={glowMaterial} renderOrder={5} frustumCulled={false} />

      <instancedMesh ref={bodies} args={[undefined, undefined, count]} renderOrder={3} frustumCulled={false}>
        <octahedronGeometry args={[NODE_RADIUS, 1]} />
        <meshBasicMaterial transparent opacity={0.82} />
      </instancedMesh>

      <instancedMesh ref={rings} args={[undefined, undefined, count * 2]} renderOrder={4} frustumCulled={false}>
        <ringGeometry args={[NODE_RADIUS * 1.5, NODE_RADIUS * 1.74, 44]} />
        <meshBasicMaterial transparent opacity={0.85} depthWrite={false} blending={AdditiveBlending} />
      </instancedMesh>

      <instancedMesh ref={meters} args={[undefined, undefined, count]} renderOrder={4} frustumCulled={false}>
        <boxGeometry args={[1, 0.9, 0.9]} />
        <meshBasicMaterial transparent opacity={0.72} depthWrite={false} blending={AdditiveBlending} />
      </instancedMesh>

      {/*
        The hit area is its own invisible mesh: a node has to be easy to point
        at from the framing distance, and the body it selects is smaller than
        the reach a viewer aims with.
      */}
      <instancedMesh
        ref={hits}
        args={[undefined, undefined, count]}
        renderOrder={0}
        frustumCulled={false}
        onPointerMove={(event) => {
          event.stopPropagation()
          const id = pick(event.instanceId)
          onHover(id)
          document.body.style.cursor = id === undefined ? 'auto' : 'pointer'
        }}
        onPointerOut={() => {
          onHover(undefined)
          document.body.style.cursor = 'auto'
        }}
        onClick={(event) => {
          event.stopPropagation()
          const id = pick(event.instanceId)
          onSelect(id === selected ? undefined : id)
        }}
      >
        <sphereGeometry args={[HIT_RADIUS, 10, 8]} />
        <meshBasicMaterial visible={false} />
      </instancedMesh>
    </group>
  )
}

/**
 * One name per node, and the card the pointer opens on the node under it.
 *
 * The lit and idle states are written straight onto the elements from the frame
 * loop, so a session brightening never costs a React render.
 * @param props - The graph and the hovered session.
 * @returns The labels.
 */
function Labels({ graph, hovered }: { graph: WorkflowGraph; hovered: string | undefined }): ReactNode {
  const reduced = usePrefersReducedMotion()
  const activity = useDeck(state => state.activity)
  const cursor = useDeck(state => state.cursor)
  const elements = useRef<(HTMLDivElement | null)[]>([])

  useFrame(() => {
    const now = performance.now()
    for (const [index, node] of graph.nodes.entries()) {
      const element = elements.current[index]
      if (element === null || element === undefined) continue
      const since = idleness(node, activity, cursor, now)
      element.dataset.lit = String(!reduced && since < LIVE_WINDOW_MS)
      element.dataset.idle = String(since > IDLE_MS)
    }
  })

  const card = hovered === undefined ? undefined : graph.byId.get(hovered)

  return (
    <group>
      {graph.nodes.map((node, index) => (
        <Html
          key={node.id}
          center
          position={[node.x, node.y + NODE_RADIUS + 4.5, 0]}
          zIndexRange={[11, 4]}
          style={{ pointerEvents: 'none' }}
        >
          <div
            ref={(element) => { elements.current[index] = element }}
            className={styles.name}
            style={{ '--tone': node.color } as CSSProperties}
            data-lit="false"
            data-idle="false"
          >
            <i className={styles.nameDot} />
            {node.label}
            {/* Two sessions of one run can be worked by the same seat, so the
                one the run integrates in says which of them it is. */}
            {node.integration ? <span className={styles.nameRole}>integration</span> : null}
            <span className={styles.nameCount}>{node.events}</span>
          </div>
        </Html>
      ))}

      {card === undefined ? null : (
        <Html
          center
          position={[card.x, card.y - NODE_RADIUS - 15, 0]}
          zIndexRange={[24, 12]}
          style={{ pointerEvents: 'none' }}
        >
          <div className={styles.card} style={{ '--tone': card.color } as CSSProperties}>
            <div className={styles.cardName}>{card.label}</div>
            <div className={styles.cardId}>{card.id}</div>
            <div className={styles.cardFacts}>
              {card.events} events
              {card.certificates > 0 ? ' · certified' : ''}
              {card.refusals > 0 ? ' · refused' : ''}
              {card.lastLabel === undefined ? '' : ` · last: ${card.lastLabel}`}
            </div>
          </div>
        </Html>
      )}
    </group>
  )
}

/**
 * The camera over the graph.
 *
 * It opens on a wide establishing move and then holds the whole graph in frame,
 * re-framing as tiers and rows are added under it. Touching the controls hands
 * the camera to the viewer and it is taken back only once the viewer has let go
 * of it. Under reduced motion the camera cuts to the framing and never moves.
 * @param props - Half the graph's reach in x and y.
 * @returns The controls.
 */
function Director({ extent }: { extent: { x: number; y: number } }): ReactNode {
  const controls = useRef<ElementRef<typeof OrbitControls>>(null)
  const reduced = usePrefersReducedMotion()
  const { camera, size } = useThree()
  const opened = useRef(0)
  const touched = useRef(-Infinity)

  useEffect(() => {
    const control = controls.current
    if (control === null) return undefined
    // `start` is the viewer reaching for the camera; `change` also fires for
    // every move the director itself makes, so it cannot mean the same thing.
    const onStart = (): void => { touched.current = performance.now() }
    control.addEventListener('start', onStart)
    return () => control.removeEventListener('start', onStart)
  }, [])

  useFrame((_, delta) => {
    const control = controls.current
    if (control === null) return
    const now = performance.now()
    const aspect = size.height === 0 ? 1 : size.width / size.height
    // Whichever of the two reaches needs the camera further back at this aspect
    // is the one that decides the framing, so a wide graph stays in frame.
    const half = Math.max(extent.y, extent.x / aspect)
    GOAL.set(0, extent.y * 0.22, (half * FRAME_PADDING) / Math.tan((Math.PI * FOV) / 360))

    if (reduced) {
      camera.position.copy(GOAL)
      control.target.set(0, 0, 0)
      control.update()
      return
    }
    if (now - touched.current < HANDOVER_MS) {
      control.update()
      return
    }
    if (opened.current === 0) opened.current = now
    const opening = (now - opened.current) / ESTABLISH_MS
    if (opening < 1) camera.position.lerpVectors(ESTABLISH, GOAL, easeInOutCubic(Math.max(0, opening)))
    else camera.position.lerp(GOAL, Math.min(1, delta * 1.1))
    control.target.lerp(POINT.set(0, 0, 0), Math.min(1, delta * 1.6))
    control.update()
  })

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.07}
      rotateSpeed={0.4}
      zoomSpeed={0.7}
      minDistance={40}
      maxDistance={720}
      maxPolarAngle={Math.PI * 0.88}
    />
  )
}

/**
 * The workflow scene: the run's sessions as a directed graph that builds itself.
 *
 * Everything drawn here comes from the run's own frames. A node exists because
 * a session logged something, an edge because one session's id extends
 * another's, a ring because a certificate landed on that session, a red rim
 * because it refused, and the strands into integration because a merge landed.
 * @param props - The graph the timeline admits, the hovered and selected
 * sessions, and the hover and selection callbacks.
 * @returns The canvas and its contents.
 */
export function WorkflowStage({
  graph,
  selected,
  hovered,
  onHover,
  onSelect,
}: {
  graph: WorkflowGraph
  selected: string | undefined
  hovered: string | undefined
  onHover: (id: string | undefined) => void
  onSelect: (id: string | undefined) => void
}): ReactNode {
  const reduced = usePrefersReducedMotion()
  const clocks = useMemo(createClocks, [])

  useEffect(() => { noticeChanges(clocks, graph, reduced) }, [clocks, graph, reduced])
  useEffect(() => () => { document.body.style.cursor = 'auto' }, [])

  return (
    <Canvas3D camera={{ position: [ESTABLISH.x, ESTABLISH.y, ESTABLISH.z], fov: FOV }} fogNear={200} fogFar={700}>
      <gridHelper args={[640, 32, '#20344f', '#111d2e']} position={[0, -graph.extent.y - 34, 0]} />
      <Edges graph={graph} clocks={clocks} />
      <Pulses graph={graph} clocks={clocks} />
      <Nodes graph={graph} clocks={clocks} selected={selected} onHover={onHover} onSelect={onSelect} />
      <Labels graph={graph} hovered={hovered} />
      <Director extent={graph.extent} />
    </Canvas3D>
  )
}
