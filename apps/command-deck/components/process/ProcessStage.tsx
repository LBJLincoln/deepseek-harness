'use client'

import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { seatOf, type Agent, type RunEvent } from '@/deck/contract'
import { usePrefersReducedMotion } from '@/deck/motion'
import {
  discoverLanes,
  flightOf,
  laneTotals,
  pipelineHalfWidth,
  STAGES,
  type Lanes,
} from '@/deck/pipeline'
import { Stage as Canvas3D } from '@/components/three/Stage'
import { createHeat } from './heat'
import { Director, ESTABLISH } from './Director'
import { Flow } from './Flow'
import { Gates } from './Gates'
import { Ground } from './Ground'

/** How long the ring that marks a finished run takes, in milliseconds. */
const COMPLETION_RING_MS = 2_600

/** How far the ring that marks a finished run reaches. */
const COMPLETION_RING_RADIUS = 64

/**
 * The lanes of a run, held still while its events keep arriving.
 *
 * Lane discovery reads the whole event window, so it produces a new object
 * every time the stream delivers. The rail mesh and the labels are rebuilt from
 * that object, so it is only handed on once the lanes themselves have changed.
 * @param history - The whole event window, oldest first.
 * @param agents - The roster index.
 * @returns The lanes, unchanged for as long as they describe the same run.
 */
function useLanes(history: readonly RunEvent[], agents: Map<string, Agent>): Lanes {
  const fresh = useMemo(() => discoverLanes(history, agents), [history, agents])
  const signature = fresh.list
    .map(lane => `${lane.key}/${lane.label}/${lane.color}/${lane.agentIds.join(',')}`)
    .join('|')
  const held = useRef(fresh)
  const heldSignature = useRef(signature)
  if (signature !== heldSignature.current) {
    heldSignature.current = signature
    held.current = fresh
  }
  return held.current
}

/**
 * The process scene: lane rails running through three luminous gates.
 *
 * Everything drawn here comes from the run's own events. A lane exists because
 * an agent emitted work under it, its rail lights because that agent has just
 * acted, a gate flares because an event arrived at it, and the Integration gate
 * only holds its glow once a merge has landed or the run has been reported
 * finished.
 * @param props - The events the timeline admits, the whole event window, the
 * roster index, whether the run has finished, and the cursor's position in the
 * run while the timeline is off the head.
 * @returns The canvas and its contents.
 */
export function ProcessStage({
  events,
  history,
  agents,
  completed,
  progress,
}: {
  events: readonly RunEvent[]
  history: readonly RunEvent[]
  agents: Map<string, Agent>
  completed: boolean
  progress: number | undefined
}): ReactNode {
  const reduced = usePrefersReducedMotion()
  const heat = useMemo(createHeat, [])
  const lanes = useLanes(history, agents)
  const totals = useMemo(() => laneTotals(events, agents, lanes), [events, agents, lanes])
  const halfWidth = pipelineHalfWidth(Math.max(1, lanes.list.length))

  const arrivals = useMemo(() => {
    const perStage = STAGES.map(() => 0)
    for (const event of events) {
      const at = flightOf(event, seatOf(event, agents), lanes).arrival
      perStage[at] = (perStage[at] ?? 0) + 1
    }
    return perStage
  }, [events, agents, lanes])

  const merged = useMemo(() => events.some(event => event.kind === 'merge'), [events])

  useEffect(() => { heat.merged = merged }, [heat, merged])

  // A finished run rings once, and is silent afterwards. A viewer who asked for
  // reduced motion gets the held glow without the ring.
  useEffect(() => {
    heat.completed = completed
    if (!completed || reduced) return
    const integration = STAGES[STAGES.length - 1]
    if (integration === undefined) return
    heat.rings.push({
      x: integration.x,
      color: integration.color,
      life: COMPLETION_RING_MS,
      radius: COMPLETION_RING_RADIUS,
    })
  }, [heat, completed, reduced])

  return (
    <Canvas3D
      camera={{ position: [ESTABLISH.position.x, ESTABLISH.position.y, ESTABLISH.position.z], fov: 42 }}
      fogNear={130}
      fogFar={430}
    >
      <Ground lanes={lanes} totals={totals} halfWidth={halfWidth} progress={progress} />
      <Gates halfWidth={halfWidth} heat={heat} arrivals={arrivals} />
      <Flow events={events} agents={agents} lanes={lanes} heat={heat} />
      <Director completed={completed} progress={progress} />
    </Canvas3D>
  )
}
