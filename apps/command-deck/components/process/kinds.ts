/**
 * How each event kind travels the pipeline.
 *
 * One table drives the comet, its trail and the panel legend, so what the
 * viewer reads in the scene and what the legend names are the same colour.
 * Tool and step events — the bulk of any run — are small and quick; the
 * events a person would stop the demo for, a certificate and a merge, are
 * larger, slower and carry a longer trail.
 */

import type { EventKind, RunEvent } from '@/deck/contract'
import { SEVERITY_COLOR } from '@/deck/palette'

/** The look of one event kind in flight. */
export interface KindLook {
  /** Hex colour of the comet, its trail and the legend swatch. */
  color: string
  /** Head size in the point material's units. */
  size: number
  /** Flight time between two stages, in milliseconds. */
  flightMs: number
  /** Half-width of the trail ribbon, in scene units. */
  width: number
  /** Trail length, as a fraction of the flight. */
  span: number
  /** How far the comet arcs above its rail at mid-flight. */
  lift: number
}

/** The look of every event kind the feed can carry. */
export const KIND_LOOK: Record<EventKind, KindLook> = {
  tool: { color: '#4fd8ff', size: 9.5, flightMs: 1_500, width: 0.85, span: 0.22, lift: 3.4 },
  step: { color: '#5fa8ff', size: 10.5, flightMs: 1_650, width: 0.95, span: 0.24, lift: 4 },
  delegation: { color: '#9b7bff', size: 15, flightMs: 2_100, width: 1.3, span: 0.26, lift: 5.2 },
  directive: { color: '#ffbe5c', size: 19, flightMs: 2_400, width: 1.7, span: 0.28, lift: 6.2 },
  certificate: { color: '#49e0a6', size: 30, flightMs: 3_600, width: 2.8, span: 0.36, lift: 9.4 },
  finding: { color: SEVERITY_COLOR.critical, size: 21, flightMs: 2_200, width: 1.9, span: 0.28, lift: 6.6 },
  merge: { color: '#ff8a6b', size: 26, flightMs: 3_200, width: 2.6, span: 0.34, lift: 8.4 },
  refusal: { color: '#ff8a3d', size: 19, flightMs: 2_000, width: 1.7, span: 0.26, lift: 5.6 },
}

/**
 * The look one event flies with.
 *
 * A finding takes its severity's colour, because the one thing a reviewer must
 * see across the room is how bad the worst finding is.
 * @param event - The event about to be launched.
 * @returns Its kind's look, with a finding's colour resolved to its severity.
 */
export function lookOf(event: RunEvent): KindLook {
  const look = KIND_LOOK[event.kind]
  if (event.kind !== 'finding' || event.severity === undefined) return look
  return { ...look, color: SEVERITY_COLOR[event.severity] }
}
