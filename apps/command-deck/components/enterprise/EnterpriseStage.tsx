'use client'

import { useMemo, type ReactNode } from 'react'
import type { Roster } from '@/deck/contract'
import { layoutRoster } from '@/deck/layout-enterprise'
import { Stage } from '@/components/three/Stage'
import { AgentGraph } from './AgentGraph'
import { CameraRig } from './CameraRig'
import { CertificateBursts } from './CertificateBursts'
import { Constellations } from './Constellations'
import { GraphEdges } from './GraphEdges'

/**
 * The enterprise scene: ten constellations, the agents inside them, the
 * relationships between them, and the traffic the followed run puts on those
 * relationships.
 *
 * The layers are drawn back to front — nebulae, edges and their traffic,
 * agents, certificate bursts — and each one is a single instanced or
 * point-based draw over the whole roster.
 * @param props - The roster to draw.
 * @returns The canvas and its contents.
 */
export function EnterpriseStage({ roster }: { roster: Roster }): ReactNode {
  const layout = useMemo(() => layoutRoster(roster), [roster])

  return (
    <Stage camera={{ position: [0, layout.extent * 0.26, layout.extent * 2.2], fov: 44 }} fogNear={210} fogFar={720}>
      <Constellations roster={roster} layout={layout} />
      <GraphEdges roster={roster} layout={layout} />
      <AgentGraph roster={roster} layout={layout} />
      <CertificateBursts layout={layout} />
      <CameraRig layout={layout} />
    </Stage>
  )
}
