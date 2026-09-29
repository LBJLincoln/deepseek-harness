'use client'

import { Component, useMemo, type ErrorInfo, type ReactNode } from 'react'
import type { OpsSnapshot } from '@/deck/contract'
import { layoutOps, satellitePoint, type Point } from '@/deck/layout-ops'
import { STATION_NAME, STATIONS, stationOf } from '@/deck/ops'
import { divisionColor } from '@/deck/palette'
import styles from './ops.module.css'

/** The frame the floor is projected into, in the drawing's own units. */
const WIDTH = 400
const HEIGHT = 300

/** The part of the drawing the ring, its division labels and the gates fill, so the SVG scales to the floor alone. */
const VIEW_BOX = '-30 58 460 192'

/** How the floor's ground plane maps onto the drawing: wide, and foreshortened front to back. */
function project(point: Point): { x: number; y: number } {
  return { x: (WIDTH / 2) + (point.x * 2.6), y: (HEIGHT / 2) + 10 + (point.z * 1.15) - (point.y * 0.9) }
}

/**
 * The operations floor drawn flat: the same seats, stations, beams and
 * operator agents as the scene, as one still SVG. The view draws it when the
 * browser offers no WebGL 2 or the scene fails, so a laptop without a GPU, a
 * remote desktop or a locked-down browser still shows the floor.
 * @param props - The snapshot, and why the scene is not drawn.
 * @returns The drawing.
 */
export function FlatFloor({ snapshot, reason }: { snapshot: OpsSnapshot; reason: string }): ReactNode {
  const seats = snapshot.seats ?? []
  const layout = useMemo(() => layoutOps(seats, snapshot.big.seats?.divisions ?? []), [seats, snapshot.big.seats])
  const working = new Map(snapshot.agents.flatMap(agent => (agent.seat === undefined ? [] : [[agent.seat, agent] as const])))
  const byId = new Map(seats.map(seat => [seat.id, seat]))
  const operators = snapshot.agents.filter(agent => agent.kind === 'operator-agent')
  const beams = snapshot.agents.flatMap((agent) => {
    const station = stationOf(agent.kind, agent.label)
    const seat = agent.seat === undefined ? undefined : layout.seats[layout.index.get(agent.seat) ?? -1]
    if (station === undefined || seat === undefined) return []
    const from = project(seat)
    const to = project(layout.stations[station])
    return [{ id: agent.id, from, to, color: divisionColor(seat.division), stuck: agent.state === 'stuck' }]
  })
  return (
    <div className={styles.flat}>
      <svg viewBox={VIEW_BOX} role="img" aria-label={`The operations floor drawn flat: ${seats.length} seats, ${snapshot.agents.length} agents working`}>
        <ellipse cx={WIDTH / 2} cy={(HEIGHT / 2) + 10} rx={layout.radius * 2.6} ry={layout.radius * 1.15} fill="none" stroke="#2a3a5c" />
        {beams.map(beam => (
          <path
            key={beam.id}
            d={`M ${beam.from.x} ${beam.from.y} Q ${(beam.from.x + beam.to.x) / 2} ${Math.min(beam.from.y, beam.to.y) - 30} ${beam.to.x} ${beam.to.y}`}
            fill="none"
            stroke={beam.stuck ? '#ff5577' : beam.color}
            strokeWidth={1.2}
            strokeDasharray={beam.stuck ? '3 2' : undefined}
            opacity={0.8}
          />
        ))}
        {layout.seats.map((place) => {
          const seat = byId.get(place.id)
          const at = project(place)
          const busy = working.has(place.id)
          return (
            <circle
              key={place.id}
              cx={at.x}
              cy={at.y}
              r={busy ? 3.4 : 2.4}
              fill={divisionColor(place.division)}
              opacity={busy || seat?.activeToday === true ? 1 : seat?.occupied === true ? 0.7 : 0.28}
              stroke={busy ? '#e8eefc' : 'none'}
              strokeWidth={0.8}
            >
              <title>{`${seat?.name ?? place.id}${busy ? ` · working: ${working.get(place.id)?.doing ?? ''}` : ''}`}</title>
            </circle>
          )
        })}
        {layout.divisions.map((division) => {
          const at = project(division)
          return <text key={division.id} x={at.x} y={at.y} textAnchor="middle" className={styles.flatDivision}>{division.name}</text>
        })}
        {STATIONS.map((station) => {
          const at = project(layout.stations[station])
          return (
            <g key={station}>
              <circle cx={at.x} cy={at.y} r={10} fill="none" stroke="#4fd8ff" strokeWidth={1.6} />
              <text x={at.x} y={at.y + 24} textAnchor="middle" className={styles.flatStation}>{STATION_NAME[station]}</text>
            </g>
          )
        })}
        {operators.map((agent, index) => {
          const at = project(satellitePoint(index, operators.length, undefined, layout))
          return <path key={agent.id} d={`M ${at.x} ${at.y - 4} l 4 4 l -4 4 l -4 -4 z`} fill="#9b7bff"><title>{agent.label}</title></path>
        })}
      </svg>
      <p className={styles.flatNote}>{reason}</p>
    </div>
  )
}

/** What the boundary shows instead of a scene that threw. */
interface SceneBoundaryProps {
  fallback: (message: string) => ReactNode
  children: ReactNode
}

/**
 * Catches an error the three.js scene throws while rendering (a lost WebGL
 * context, a driver the renderer refuses) and draws its fallback in place of
 * the scene, so the rest of the view keeps working.
 */
export class SceneBoundary extends Component<SceneBoundaryProps, { message: string | undefined }> {
  override state: { message: string | undefined } = { message: undefined }

  static getDerivedStateFromError(error: unknown): { message: string } {
    return { message: error instanceof Error ? error.message : String(error) }
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('operations scene failed', error, info.componentStack)
  }

  override render(): ReactNode {
    return this.state.message === undefined ? this.props.children : this.props.fallback(this.state.message)
  }
}

/**
 * Whether this browser can draw the scene: a WebGL 2 context on a scratch canvas.
 * @returns `true` when one is offered.
 */
export function hasWebGL2(): boolean {
  try {
    return document.createElement('canvas').getContext('webgl2') !== null
  } catch {
    // A browser that throws on the request offers no context either.
    return false
  }
}
