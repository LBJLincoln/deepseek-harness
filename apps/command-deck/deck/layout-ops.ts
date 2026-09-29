/**
 * The Operations scene's layout: the enterprise's seats on one ring, each
 * division an arc of it in roster order, and the five pipeline stations on a
 * line across the ring's centre, intake on the left and ship on the right.
 *
 * It is a pure function of the snapshot's seat list, so the same enterprise
 * always stands in the same places and a seat keeps its position between
 * snapshots.
 */

import type { OpsSeat } from './contract.ts'
import { STATIONS, type Station } from './ops.ts'

/** A point on or above the floor. */
export interface Point {
  x: number
  y: number
  z: number
}

/** One seat's place on the ring. */
interface SeatPlace extends Point {
  id: string
  division: string
  /** Its angle on the ring, radians. */
  angle: number
}

/** One division's arc: where its label stands and how many seats it holds. */
interface DivisionArc extends Point {
  id: string
  name: string
  count: number
}

/** The laid-out floor. */
export interface OpsLayout {
  seats: SeatPlace[]
  index: Map<string, number>
  divisions: DivisionArc[]
  stations: Record<Station, Point>
  /** The ring's radius, for the floor and the camera. */
  radius: number
}

/** Radius of the seat ring. */
const RING_RADIUS = 60

/** Height the seats float at. */
const SEAT_HEIGHT = 1.6

/** Empty slots left between two divisions' arcs, so each division reads as one body. */
const DIVISION_GAP = 3

/** Distance between two neighbouring stations. */
const STATION_SPACING = 21

/** Height of a station gate's centre. */
const STATION_HEIGHT = 6

/**
 * Lay out one snapshot's seats and the pipeline.
 * @param seats - The seats, in roster order.
 * @param divisions - The divisions, in roster order, with their names.
 * @returns The layout.
 */
export function layoutOps(seats: readonly OpsSeat[], divisions: readonly { id: string; name: string }[]): OpsLayout {
  const order = divisions.map(division => division.id)
  for (const seat of seats) if (!order.includes(seat.division)) order.push(seat.division)
  const grouped = order.map(id => seats.filter(seat => seat.division === id))
  const slots = seats.length + (DIVISION_GAP * order.length)
  const step = (Math.PI * 2) / Math.max(1, slots)
  const places: SeatPlace[] = []
  const arcs: DivisionArc[] = []
  let slot = DIVISION_GAP / 2
  // The first division starts at the back left so the arcs read clockwise from the camera's left.
  const origin = Math.PI * 0.62
  for (const [ordinal, members] of grouped.entries()) {
    const id = order[ordinal] ?? ''
    const first = slot
    for (const seat of members) {
      const angle = origin - (slot * step)
      places.push({ id: seat.id, division: id, angle, x: Math.cos(angle) * RING_RADIUS, y: SEAT_HEIGHT, z: -Math.sin(angle) * RING_RADIUS })
      slot += 1
    }
    if (members.length > 0) {
      const middle = origin - (((first + slot - 1) / 2) * step)
      arcs.push({
        id,
        name: divisions.find(division => division.id === id)?.name ?? id,
        count: members.length,
        x: Math.cos(middle) * (RING_RADIUS + 11),
        y: SEAT_HEIGHT,
        z: -Math.sin(middle) * (RING_RADIUS + 11),
      })
    }
    slot += DIVISION_GAP
  }
  const stations = Object.fromEntries(STATIONS.map((station, index) => [
    station,
    { x: (index - ((STATIONS.length - 1) / 2)) * STATION_SPACING, y: STATION_HEIGHT, z: 0 },
  ])) as Record<Station, Point>
  const index = new Map(places.map((place, ordinal) => [place.id, ordinal]))
  return { seats: places, index, divisions: arcs, stations, radius: RING_RADIUS }
}

/**
 * Where an agent with no seat stands: the operator's agents on a ring high
 * above the floor's centre, and a seatless agent at a station (a reviewer, an
 * integration) on a small ring around that station.
 * @param ordinal - Its position among the agents placed on the same ring.
 * @param count - How many agents share that ring.
 * @param around - The station it circles, or `undefined` for the operator's ring.
 * @param layout - The layout, for the station's position.
 * @returns Its point.
 */
export function satellitePoint(ordinal: number, count: number, around: Station | undefined, layout: OpsLayout): Point {
  const angle = (Math.PI * 2 * ordinal) / Math.max(1, count) + (Math.PI / 2)
  if (around === undefined) return { x: Math.cos(angle) * 22, y: 30, z: Math.sin(angle) * 22 }
  const centre = layout.stations[around]
  return { x: centre.x + (Math.cos(angle) * 4.5), y: centre.y + 7.5, z: centre.z + (Math.sin(angle) * 4.5) }
}
