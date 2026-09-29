'use client'

import { Html, OrbitControls, QuadraticBezierLine } from '@react-three/drei'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Euler,
  LineBasicMaterial,
  LineLoop,
  Matrix4,
  Quaternion,
  QuadraticBezierCurve3,
  Vector3,
  type InstancedMesh,
  type Mesh,
  type Points,
} from 'three'
import type { OpsAgent, OpsSnapshot } from '@/deck/contract'
import { layoutOps, satellitePoint, type OpsLayout, type Point } from '@/deck/layout-ops'
import { usePrefersReducedMotion } from '@/deck/motion'
import { STATION_NAME, STATIONS, stationCounts, stationOf, type Station } from '@/deck/ops'
import { FLASH_MS, useOps } from '@/deck/ops-store'
import { divisionColor } from '@/deck/palette'
import { createGlowMaterial } from '@/components/three/glow'
import { Stage } from '@/components/three/Stage'
import { stageClamped } from '@/components/enterprise/labels'
import styles from './ops.module.css'

/** The pipeline's own colour: the deck's cyan, the colour of work moving. */
const PIPE_COLOR = '#4fd8ff'

/** The operator's agents' colour: the deck's violet, apart from every division. */
const OPERATOR_COLOR = '#9b7bff'

/** Seat brightness by what the roster records of it. */
const SEAT_GAIN = { defined: 0.22, occupied: 0.62, active: 1 }

/** How many comets can be in flight at once. */
const COMETS = 64

/** How long one comet takes from its seat to its station. */
const COMET_MS = 1_500

/** How long a completion ring takes to fade. */
const PULSE_MS = 2_400

/** How many completion rings can be drawn at once. */
const RINGS = 16

const SCRATCH_MATRIX = new Matrix4()
const SCRATCH_POSITION = new Vector3()
const SCRATCH_SCALE = new Vector3()
const SCRATCH_QUATERNION = new Quaternion()
const SCRATCH_EULER = new Euler()
const SCRATCH_COLOR = new Color()
const NO_ROTATION = new Quaternion()
const ZERO = new Vector3(0, 0, 0)

/**
 * How far a flash has faded.
 * @param at - `performance.now()` of the flash, or `undefined` for none.
 * @param now - `performance.now()`.
 * @param span - How long a flash lasts.
 * @returns 1 at the flash, falling to 0 at its end.
 */
function fade(at: number | undefined, now: number, span: number): number {
  if (at === undefined) return 0
  const t = (now - at) / span
  return t < 0 || t > 1 ? 0 : (1 - t) * (1 - t)
}

/** The arc a beam and a comet travel from a point on the floor to a station. */
function arcTo(from: Point, to: Point): QuadraticBezierCurve3 {
  const mid = new Vector3((from.x + to.x) / 2, Math.max(from.y, to.y) + 16, (from.z + to.z) / 2)
  return new QuadraticBezierCurve3(new Vector3(from.x, from.y, from.z), mid, new Vector3(to.x, to.y, to.z))
}

/** Where each working agent stands: its seat, or a satellite point when it holds none. */
function agentPoints(agents: readonly OpsAgent[], layout: OpsLayout): Map<string, Point> {
  const points = new Map<string, Point>()
  const operators = agents.filter(agent => agent.kind === 'operator-agent')
  for (const [ordinal, agent] of operators.entries()) points.set(agent.id, satellitePoint(ordinal, operators.length, undefined, layout))
  const byStation = new Map<Station, OpsAgent[]>()
  for (const agent of agents) {
    if (agent.kind === 'operator-agent') continue
    const seat = agent.seat === undefined ? undefined : layout.seats[layout.index.get(agent.seat) ?? -1]
    if (seat !== undefined) {
      points.set(agent.id, seat)
      continue
    }
    const station = stationOf(agent.kind, agent.label)
    if (station === undefined) continue
    byStation.set(station, [...byStation.get(station) ?? [], agent])
  }
  for (const [station, members] of byStation) {
    for (const [ordinal, agent] of members.entries()) points.set(agent.id, satellitePoint(ordinal, members.length, station, layout))
  }
  return points
}

/**
 * The Operations scene: the enterprise's seats on a ring, the pipeline's five
 * stations across its centre, a beam from every working agent to the station
 * it works at, a comet for every tool call or step the view plays, a ring at
 * a station for every certificate and merge, and the operator's own agents
 * circling above. Every mark stands for a record in the snapshot.
 * @param props - The snapshot to draw.
 * @returns The canvas.
 */
export function OpsStage({ snapshot, onLost }: { snapshot: OpsSnapshot; onLost: () => void }): ReactNode {
  const seats = snapshot.seats ?? []
  const divisions = snapshot.big.seats?.divisions ?? []
  // A seat keeps its place across snapshots: the layout is rebuilt only when the seats themselves change.
  const seatKey = seats.map(seat => seat.id).join(',')
  const cached = useRef<{ key: string; layout: OpsLayout } | undefined>(undefined)
  if (cached.current?.key !== seatKey) cached.current = { key: seatKey, layout: layoutOps(seats, divisions) }
  const layout = cached.current.layout
  const points = useMemo(() => agentPoints(snapshot.agents, layout), [snapshot.agents, layout])

  return (
    <Stage camera={{ position: [0, 58, 100], fov: 42 }} fogNear={150} fogFar={460}>
      <Floor layout={layout} />
      {layout.seats.length === 0 ? null : <SeatRing snapshot={snapshot} layout={layout} />}
      <Pipeline snapshot={snapshot} layout={layout} />
      <Beams agents={snapshot.agents} points={points} layout={layout} />
      <Operators agents={snapshot.agents} points={points} />
      <Comets points={points} layout={layout} />
      <Rings layout={layout} />
      <Rig />
      <ContextWatch onLost={onLost} />
    </Stage>
  )
}

/**
 * Reports a lost WebGL context: the browser takes it back under memory
 * pressure or a driver reset and the canvas goes blank without an error, so
 * the view swaps in the flat floor instead.
 */
function ContextWatch({ onLost }: { onLost: () => void }): ReactNode {
  const canvas = useThree(state => state.gl.domElement)
  useEffect(() => {
    canvas.addEventListener('webglcontextlost', onLost)
    return () => canvas.removeEventListener('webglcontextlost', onLost)
  }, [canvas, onLost])
  return null
}

/**
 * The camera: a slow orbit the viewer can take over, held still under reduced
 * motion, and pulled back on a canvas taller than it is wide so the whole ring stays in frame.
 */
function Rig(): ReactNode {
  const reduced = usePrefersReducedMotion()
  const { camera, size } = useThree()
  const narrow = size.width / Math.max(1, size.height) < 1.3
  useEffect(() => {
    camera.position.set(0, narrow ? 120 : 58, narrow ? 175 : 100)
  }, [camera, narrow])
  return (
    <OrbitControls
      makeDefault
      enablePan={false}
      enableDamping
      dampingFactor={0.08}
      autoRotate={!reduced}
      autoRotateSpeed={0.28}
      minDistance={60}
      maxDistance={220}
      minPolarAngle={0.35}
      maxPolarAngle={1.32}
      target={[0, 4, 0]}
    />
  )
}

/** The floor: a dark disc under the ring with four faint circles, so the ring reads as a place. */
function Floor({ layout }: { layout: OpsLayout }): ReactNode {
  const circles = useMemo(() => [18, 38, layout.radius, layout.radius + 16].map((radius, index) => {
    const geometry = new BufferGeometry()
    const positions = new Float32Array(128 * 3)
    for (let i = 0; i < 128; i++) {
      const angle = (i / 128) * Math.PI * 2
      positions[i * 3] = Math.cos(angle) * radius
      positions[(i * 3) + 2] = Math.sin(angle) * radius
    }
    geometry.setAttribute('position', new BufferAttribute(positions, 3))
    const material = new LineBasicMaterial({ color: '#2a3a5c', transparent: true, opacity: index === 2 ? 0.55 : 0.28, depthWrite: false })
    return new LineLoop(geometry, material)
  }), [layout.radius])
  useEffect(() => () => {
    for (const circle of circles) {
      circle.geometry.dispose()
      circle.material.dispose()
    }
  }, [circles])
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]}>
        <circleGeometry args={[layout.radius + 22, 96]} />
        <meshBasicMaterial color="#060a12" transparent opacity={0.78} depthWrite={false} />
      </mesh>
      {circles.map((circle, index) => <primitive key={index} object={circle} />)}
    </group>
  )
}

/**
 * The seats: one instanced core per seat in its division's colour, dim for a
 * seat nothing occupied, lit for an occupied one and full for one active in
 * the roster's day; a seat held by a working agent wears a turning ring, and a
 * played frame flares it. Division names stand outside their arcs.
 */
function SeatRing({ snapshot, layout }: { snapshot: OpsSnapshot; layout: OpsLayout }): ReactNode {
  const reduced = usePrefersReducedMotion()
  const cores = useRef<InstancedMesh>(null)
  const orbits = useRef<InstancedMesh>(null)
  const glow = useRef<Points>(null)
  const flashes = useOps(state => state.flashes)
  const [hovered, setHovered] = useState<number | undefined>(undefined)
  const seats = snapshot.seats ?? []
  const byId = useMemo(() => new Map(seats.map(seat => [seat.id, seat])), [seats])
  const working = useMemo(() => {
    const map = new Map<string, OpsAgent>()
    for (const agent of snapshot.agents) if (agent.seat !== undefined) map.set(agent.seat, agent)
    return map
  }, [snapshot.agents])
  const hues = useMemo(() => layout.seats.map(place => new Color(divisionColor(place.division))), [layout.seats])
  const base = useMemo(() => Float32Array.from(layout.seats, (place) => {
    const seat = byId.get(place.id)
    return seat?.activeToday === true ? SEAT_GAIN.active : seat?.occupied === true ? SEAT_GAIN.occupied : SEAT_GAIN.defined
  }), [layout.seats, byId])

  const glowGeometry = useMemo(() => {
    const geometry = new BufferGeometry()
    const count = layout.seats.length
    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)
    for (const [index, place] of layout.seats.entries()) {
      positions.set([place.x, place.y, place.z], index * 3)
      SCRATCH_COLOR.set(divisionColor(place.division))
      colors.set([SCRATCH_COLOR.r, SCRATCH_COLOR.g, SCRATCH_COLOR.b], index * 3)
    }
    geometry.setAttribute('position', new BufferAttribute(positions, 3))
    geometry.setAttribute('aColor', new BufferAttribute(colors, 3))
    geometry.setAttribute('aSize', new BufferAttribute(new Float32Array(count).fill(9), 1))
    geometry.setAttribute('aGain', new BufferAttribute(new Float32Array(count), 1))
    return geometry
  }, [layout.seats])
  const glowMaterial = useMemo(createGlowMaterial, [])
  useEffect(() => () => {
    glowGeometry.dispose()
    glowMaterial.dispose()
  }, [glowGeometry, glowMaterial])

  useLayoutEffect(() => {
    const orbit = orbits.current
    if (orbit === null) return
    for (const [index, place] of layout.seats.entries()) orbit.setColorAt(index, SCRATCH_COLOR.set(divisionColor(place.division)))
    if (orbit.instanceColor !== null) orbit.instanceColor.needsUpdate = true
  }, [layout.seats])

  useFrame(({ clock }) => {
    const mesh = cores.current
    const orbit = orbits.current
    if (mesh === null || orbit === null) return
    const now = performance.now()
    const time = clock.elapsedTime
    const gains = glow.current?.geometry.getAttribute('aGain')
    const sizes = glow.current?.geometry.getAttribute('aSize')
    for (const [index, place] of layout.seats.entries()) {
      const busy = working.has(place.id)
      const flash = fade(flashes.get(place.id), now, FLASH_MS)
      const wave = reduced ? 0.5 : (Math.sin((time * 3.1) + index) * 0.5) + 0.5
      const lit = (base[index] ?? SEAT_GAIN.defined) + (busy ? 0.7 + (wave * 0.3) : 0) + (flash * 1.6)
      SCRATCH_POSITION.set(place.x, place.y, place.z)
      SCRATCH_SCALE.setScalar(0.72 * (busy ? 1.35 : 1) * (1 + (flash * 0.6)) * (hovered === index ? 1.5 : 1))
      SCRATCH_MATRIX.compose(SCRATCH_POSITION, NO_ROTATION, SCRATCH_SCALE)
      mesh.setMatrixAt(index, SCRATCH_MATRIX)
      mesh.setColorAt(index, SCRATCH_COLOR.copy(hues[index] ?? SCRATCH_COLOR).multiplyScalar(Math.min(2.4, lit)))
      if (gains !== undefined && sizes !== undefined) {
        gains.setX(index, Math.min(1.8, (lit * 0.55) - 0.05))
        sizes.setX(index, 7 + (busy ? 8 : 0) + (flash * 14))
      }
      if (busy) {
        SCRATCH_EULER.set(1.1, reduced ? index : (time * 1.2) + index, 0.35)
        SCRATCH_QUATERNION.setFromEuler(SCRATCH_EULER)
        SCRATCH_SCALE.setScalar(2.3)
        SCRATCH_MATRIX.compose(SCRATCH_POSITION, SCRATCH_QUATERNION, SCRATCH_SCALE)
      } else {
        SCRATCH_MATRIX.compose(SCRATCH_POSITION, NO_ROTATION, ZERO)
      }
      orbit.setMatrixAt(index, SCRATCH_MATRIX)
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true
    orbit.instanceMatrix.needsUpdate = true
    if (gains !== undefined) gains.needsUpdate = true
    if (sizes !== undefined) sizes.needsUpdate = true
  })

  const onMove = (event: ThreeEvent<PointerEvent>): void => {
    event.stopPropagation()
    setHovered(event.instanceId)
  }
  const hoverPosition = useMemo(() => stageClamped(150, 26), [])
  const hoveredPlace = hovered === undefined ? undefined : layout.seats[hovered]
  const hoveredSeat = hoveredPlace === undefined ? undefined : byId.get(hoveredPlace.id)
  const hoveredAgent = hoveredPlace === undefined ? undefined : working.get(hoveredPlace.id)
  const labelPosition = useMemo(() => stageClamped(70, 14), [])
  const busyByDivision = useMemo(() => {
    const counts = new Map<string, number>()
    for (const agent of snapshot.agents) {
      if (agent.division !== undefined && agent.seat !== undefined) counts.set(agent.division, (counts.get(agent.division) ?? 0) + 1)
    }
    return counts
  }, [snapshot.agents])

  return (
    <group>
      <instancedMesh
        ref={cores}
        args={[undefined, undefined, Math.max(1, layout.seats.length)]}
        frustumCulled={false}
        onPointerMove={onMove}
        onPointerOut={() => setHovered(undefined)}
      >
        <icosahedronGeometry args={[1, 1]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <points ref={glow} geometry={glowGeometry} material={glowMaterial} frustumCulled={false} />
      <instancedMesh ref={orbits} args={[undefined, undefined, Math.max(1, layout.seats.length)]} frustumCulled={false}>
        <ringGeometry args={[0.9, 1, 40]} />
        <meshBasicMaterial transparent side={DoubleSide} blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
      </instancedMesh>
      {layout.divisions.map(division => (
        <group key={division.id} position={[division.x, division.y + 2, division.z]}>
          <Html center calculatePosition={labelPosition} zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
            <div className={styles.division}>
              <i style={{ background: divisionColor(division.id) }} />
              {division.name}
              {(busyByDivision.get(division.id) ?? 0) > 0 ? <b>{busyByDivision.get(division.id)} working</b> : null}
            </div>
          </Html>
        </group>
      ))}
      {hoveredPlace === undefined ? null : (
        <group position={[hoveredPlace.x, hoveredPlace.y + 3, hoveredPlace.z]}>
          <Html center calculatePosition={hoverPosition} zIndexRange={[30, 20]} style={{ pointerEvents: 'none' }}>
            <div className={styles.seatTip}>
              <b>{hoveredSeat?.name ?? hoveredPlace.id}</b>
              <span>
                {hoveredAgent !== undefined
                  ? `working · ${hoveredAgent.doing}`
                  : hoveredSeat?.activeToday === true
                    ? 'active in the roster\'s day'
                    : hoveredSeat?.occupied === true ? 'occupied by a recorded deliverable' : 'defined, never occupied'}
              </span>
            </div>
          </Html>
        </group>
      )}
    </group>
  )
}

/**
 * The pipeline: five gates on the rail through the ring's centre, each named,
 * brighter while an agent works there and lit by the frames that land on it;
 * what the snapshot counts at each gate is printed over the stage.
 */
function Pipeline({ snapshot, layout }: { snapshot: OpsSnapshot; layout: OpsLayout }): ReactNode {
  const reduced = usePrefersReducedMotion()
  const gates = useRef<(Mesh | null)[]>([])
  const stationFlashes = useOps(state => state.stationFlashes)
  const counts = useMemo(() => stationCounts(snapshot), [snapshot])
  const labelPosition = useMemo(() => stageClamped(40, 10), [])
  const rail = useMemo(() => {
    const first = layout.stations.intake
    const last = layout.stations.ship
    return [new Vector3(first.x - 8, first.y, first.z), new Vector3(last.x + 8, last.y, last.z)] as const
  }, [layout])

  useFrame(({ clock }) => {
    const now = performance.now()
    for (const [index, station] of STATIONS.entries()) {
      const gate = gates.current[index]
      if (gate === undefined || gate === null) continue
      const flash = fade(stationFlashes.get(station), now, FLASH_MS)
      const idle = reduced ? 0.5 : (Math.sin((clock.elapsedTime * 1.3) + index) * 0.5) + 0.5
      const busy = counts[station].busy > 0 ? 0.55 : 0
      const material = gate.material as { color?: Color }
      material.color?.set(PIPE_COLOR).multiplyScalar(0.45 + busy + (idle * 0.15) + (flash * 1.8))
      gate.scale.setScalar(1 + (flash * 0.12))
    }
  })

  return (
    <group>
      <QuadraticBezierLine
        start={rail[0]}
        end={rail[1]}
        mid={[0, layout.stations.review.y, 0]}
        color={PIPE_COLOR}
        lineWidth={1.2}
        transparent
        opacity={0.4}
      />
      {STATIONS.map((station, index) => {
        const point = layout.stations[station]
        return (
          <group key={station} position={[point.x, point.y, point.z]}>
            <mesh ref={(mesh) => { gates.current[index] = mesh }}>
              <torusGeometry args={[4.2, 0.24, 16, 72]} />
              <meshBasicMaterial color={PIPE_COLOR} toneMapped={false} />
            </mesh>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -point.y + 0.05, 0]}>
              <ringGeometry args={[4.6, 5.2, 64]} />
              <meshBasicMaterial color={PIPE_COLOR} transparent opacity={0.22} depthWrite={false} toneMapped={false} />
            </mesh>
            <group position={[0, -point.y - 1.2, 6]}>
              <Html center calculatePosition={labelPosition} zIndexRange={[25, 0]} style={{ pointerEvents: 'none' }}>
                <div className={styles.station}><b>{STATION_NAME[station]}</b></div>
              </Html>
            </group>
          </group>
        )
      })}
    </group>
  )
}

/** A beam from every working agent that has a station to that station, in its division's colour. */
function Beams({ agents, points, layout }: { agents: readonly OpsAgent[]; points: Map<string, Point>; layout: OpsLayout }): ReactNode {
  const beams = agents.flatMap((agent) => {
    const station = stationOf(agent.kind, agent.label)
    const from = points.get(agent.id)
    if (station === undefined || from === undefined) return []
    const to = layout.stations[station]
    const curve = arcTo(from, to)
    return [{ id: agent.id, curve, color: agent.division === undefined ? PIPE_COLOR : divisionColor(agent.division), stuck: agent.state === 'stuck' }]
  })
  return (
    <group>
      {beams.map(beam => (
        <QuadraticBezierLine
          key={beam.id}
          start={beam.curve.v0}
          mid={beam.curve.v1}
          end={beam.curve.v2}
          color={beam.stuck ? '#ff5577' : beam.color}
          lineWidth={beam.stuck ? 1.4 : 1.8}
          dashed={beam.stuck}
          dashSize={1.2}
          gapSize={1}
          transparent
          opacity={beam.stuck ? 0.55 : 0.7}
        />
      ))}
    </group>
  )
}

/** The operator's own agents: violet points on a ring above the floor, flaring as their frames play; the panel names them. */
function Operators({ agents, points }: { agents: readonly OpsAgent[]; points: Map<string, Point> }): ReactNode {
  const reduced = usePrefersReducedMotion()
  const flashes = useOps(state => state.flashes)
  const operators = agents.filter(agent => agent.kind === 'operator-agent')
  const meshes = useRef<(Mesh | null)[]>([])
  useFrame(({ clock }) => {
    const now = performance.now()
    for (const [index, agent] of operators.entries()) {
      const mesh = meshes.current[index]
      if (mesh === undefined || mesh === null) continue
      const flash = fade(flashes.get(agent.id), now, FLASH_MS)
      const wave = reduced ? 0.5 : (Math.sin((clock.elapsedTime * 2.4) + index) * 0.5) + 0.5
      mesh.scale.setScalar(1 + (flash * 0.8) + (wave * 0.12));
      (mesh.material as { color?: Color }).color?.set(agent.state === 'stuck' ? '#ff5577' : OPERATOR_COLOR).multiplyScalar(0.9 + (flash * 1.8))
    }
  })
  return (
    <group>
      {operators.map((agent, index) => {
        const point = points.get(agent.id)
        if (point === undefined) return null
        return (
          <group key={agent.id} position={[point.x, point.y, point.z]}>
            <mesh ref={(mesh) => { meshes.current[index] = mesh }}>
              <octahedronGeometry args={[1.3, 0]} />
              <meshBasicMaterial color={OPERATOR_COLOR} toneMapped={false} />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}

/**
 * The comets: every played frame whose agent works at a station sends one
 * light from its seat, or from its satellite, to that station along its beam.
 * Under reduced motion no comet flies; the station and the seat still flare.
 */
function Comets({ points, layout }: { points: Map<string, Point>; layout: OpsLayout }): ReactNode {
  const reduced = usePrefersReducedMotion()
  const launches = useOps(state => state.launches)
  const flights = useRef<{ curve: QuadraticBezierCurve3; at: number; color: Color }[]>([])
  const glow = useRef<Points>(null)
  const geometry = useMemo(() => {
    const next = new BufferGeometry()
    next.setAttribute('position', new BufferAttribute(new Float32Array(COMETS * 3), 3))
    next.setAttribute('aColor', new BufferAttribute(new Float32Array(COMETS * 3), 3))
    next.setAttribute('aSize', new BufferAttribute(new Float32Array(COMETS).fill(18), 1))
    next.setAttribute('aGain', new BufferAttribute(new Float32Array(COMETS), 1))
    return next
  }, [])
  const material = useMemo(createGlowMaterial, [])
  useEffect(() => () => {
    geometry.dispose()
    material.dispose()
  }, [geometry, material])
  const seatDivision = useMemo(() => new Map(layout.seats.map(seat => [seat.id, seat.division])), [layout.seats])

  useFrame(() => {
    const now = performance.now()
    for (const launch of launches.splice(0)) {
      if (reduced) continue
      const from = points.get(launch.target) ?? layout.seats[layout.index.get(launch.target) ?? -1]
      if (from === undefined) continue
      const division = seatDivision.get(launch.target)
      const color = new Color(division === undefined ? OPERATOR_COLOR : divisionColor(division))
      flights.current.push({ curve: arcTo(from, layout.stations[launch.station]), at: now, color })
    }
    flights.current = flights.current.filter(flight => now - flight.at < COMET_MS).slice(-COMETS)
    const position = glow.current?.geometry.getAttribute('position')
    const colors = glow.current?.geometry.getAttribute('aColor')
    const gains = glow.current?.geometry.getAttribute('aGain')
    if (position === undefined || colors === undefined || gains === undefined) return
    for (let index = 0; index < COMETS; index++) {
      const flight = flights.current[index]
      if (flight === undefined) {
        gains.setX(index, 0)
        continue
      }
      const t = (now - flight.at) / COMET_MS
      const point = flight.curve.getPoint(Math.min(1, t))
      position.setXYZ(index, point.x, point.y, point.z)
      colors.setXYZ(index, flight.color.r, flight.color.g, flight.color.b)
      gains.setX(index, 1.6 * Math.sin(Math.PI * Math.min(1, t)) + 0.2)
    }
    position.needsUpdate = true
    colors.needsUpdate = true
    gains.needsUpdate = true
  })
  return <points ref={glow} geometry={geometry} material={material} frustumCulled={false} />
}

/** The completion rings: a certificate or a merge rings its station once, spreading and fading. */
function Rings({ layout }: { layout: OpsLayout }): ReactNode {
  const reduced = usePrefersReducedMotion()
  const pulses = useOps(state => state.pulses)
  const rings = useRef<InstancedMesh>(null)
  const live = useRef<{ station: Station; at: number }[]>([])
  useFrame(() => {
    const mesh = rings.current
    if (mesh === null) return
    const now = performance.now()
    live.current.push(...pulses.splice(0))
    live.current = live.current.filter(pulse => now - pulse.at < PULSE_MS).slice(-RINGS)
    for (let index = 0; index < RINGS; index++) {
      const pulse = live.current[index]
      if (pulse === undefined || reduced) {
        SCRATCH_MATRIX.compose(ZERO, NO_ROTATION, ZERO)
        mesh.setMatrixAt(index, SCRATCH_MATRIX)
        continue
      }
      const t = (now - pulse.at) / PULSE_MS
      const at = layout.stations[pulse.station]
      SCRATCH_POSITION.set(at.x, at.y, at.z)
      SCRATCH_SCALE.setScalar(4.4 + (t * 9))
      SCRATCH_MATRIX.compose(SCRATCH_POSITION, NO_ROTATION, SCRATCH_SCALE)
      mesh.setMatrixAt(index, SCRATCH_MATRIX)
      mesh.setColorAt(index, SCRATCH_COLOR.set('#ffcf7a').multiplyScalar((1 - t) * 1.6))
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true
  })
  return (
    <instancedMesh ref={rings} args={[undefined, undefined, RINGS]} frustumCulled={false}>
      <ringGeometry args={[0.94, 1, 72]} />
      <meshBasicMaterial transparent side={DoubleSide} blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
    </instancedMesh>
  )
}
