'use client'

import { Html, OrbitControls } from '@react-three/drei'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState, type ElementRef, type ReactNode } from 'react'
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Matrix4,
  Vector3,
  type InstancedMesh,
  type Points,
} from 'three'
import type { Finding, SafetyTarget } from '@/lib/contract'
import { layoutCity, type CityBlock, type CityLayout } from '@/lib/layout-city'
import { usePrefersReducedMotion } from '@/lib/motion'
import { languageColor, SEVERITY_COLOR } from '@/lib/palette'
import { createGlowMaterial } from '@/components/three/glow'
import { Stage } from '@/components/three/Stage'

/** Height of the first marker above its block. */
const MARKER_LIFT = 3.2

/** Vertical spacing between markers stacked on the same file. */
const MARKER_STACK = 2.1

/** Marker size per severity, in the point material's units. */
const MARKER_SIZE: Record<string, number> = {
  critical: 8.5,
  high: 7,
  medium: 6,
  low: 5.2,
  info: 4.6,
}

/**
 * The establishing view of one city: far enough back that the tallest tower
 * and its markers stay inside the frame, looking at the towers rather than at
 * the ground.
 * @param extent - Half-extent of the city footprint.
 * @returns The camera position and the point it looks at.
 */
function cityView(extent: number): { position: Vector3; target: Vector3 } {
  return {
    position: new Vector3(0.58, 0.82, 1.28).normalize().multiplyScalar(extent * 3.6),
    target: new Vector3(0, 11, 0),
  }
}

const SCRATCH = new Matrix4()
const SCRATCH_SCALE = new Vector3()
const SCRATCH_POSITION = new Vector3()

/** One finding, resolved to a scene position. */
interface PlacedFinding {
  finding: Finding
  position: Vector3
  block: CityBlock
}

/**
 * Resolve every finding onto its file's block, stacking repeats on one file.
 * @param findings - The review's findings.
 * @param city - The laid-out city.
 * @returns Only the findings whose file the target actually reports.
 */
function placeFindings(findings: readonly Finding[], city: CityLayout): PlacedFinding[] {
  const perFile = new Map<string, number>()
  const placed: PlacedFinding[] = []
  for (const finding of findings) {
    const block = city.byPath.get(finding.file)
    if (block === undefined) continue
    const ordinal = perFile.get(finding.file) ?? 0
    perFile.set(finding.file, ordinal + 1)
    placed.push({
      finding,
      block,
      position: new Vector3(
        block.x + (ordinal % 2 === 0 ? 0 : 0.7),
        block.height + MARKER_LIFT + (ordinal * MARKER_STACK),
        block.z + (ordinal % 2 === 0 ? 0 : -0.7),
      ),
    })
  }
  return placed
}

/**
 * The file blocks, as one instanced mesh with a per-language colour.
 * @param props - The laid-out city and the selection callbacks.
 * @returns The city blocks.
 */
function Blocks({
  city,
  selectedPath,
  onHover,
  onSelect,
}: {
  city: CityLayout
  selectedPath: string | undefined
  onHover: (block: CityBlock | undefined) => void
  onSelect: (block: CityBlock) => void
}): ReactNode {
  const mesh = useRef<InstancedMesh>(null)
  const blocks = useMemo(() => city.districts.flatMap(district => district.blocks), [city])

  useEffect(() => {
    const instanced = mesh.current
    if (instanced === null) return
    const colour = new Color()
    for (const [index, block] of blocks.entries()) {
      SCRATCH_SCALE.set(block.size, block.height, block.size)
      SCRATCH_POSITION.set(block.x, block.height / 2, block.z)
      SCRATCH.identity().scale(SCRATCH_SCALE).setPosition(SCRATCH_POSITION)
      instanced.setMatrixAt(index, SCRATCH)
      colour.set(languageColor(block.language)).multiplyScalar(block.path === selectedPath ? 1 : 0.55)
      instanced.setColorAt(index, colour)
    }
    instanced.instanceMatrix.needsUpdate = true
    if (instanced.instanceColor !== null) instanced.instanceColor.needsUpdate = true
  }, [blocks, selectedPath])

  return (
    <instancedMesh
      ref={mesh}
      args={[undefined, undefined, blocks.length]}
      onPointerMove={(event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation()
        const block = event.instanceId === undefined ? undefined : blocks[event.instanceId]
        onHover(block)
        document.body.style.cursor = block === undefined ? 'auto' : 'pointer'
      }}
      onPointerOut={() => {
        onHover(undefined)
        document.body.style.cursor = 'auto'
      }}
      onClick={(event: ThreeEvent<MouseEvent>) => {
        event.stopPropagation()
        const block = event.instanceId === undefined ? undefined : blocks[event.instanceId]
        if (block !== undefined) onSelect(block)
      }}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial roughness={0.62} metalness={0.22} />
    </instancedMesh>
  )
}

/**
 * The district plates and their directory names.
 * @param props - The laid-out city.
 * @returns The plates and labels.
 */
function Districts({ city }: { city: CityLayout }): ReactNode {
  return (
    <group>
      {city.districts.map(district => (
        <group key={district.path}>
          <mesh position={[district.x, -0.35, district.z]} receiveShadow={false}>
            <boxGeometry args={[district.width, 0.5, district.depth]} />
            <meshStandardMaterial color="#0a1120" roughness={0.9} metalness={0.05} />
          </mesh>
          <Html
            center
            position={[district.x, 0.4, district.z + (district.depth / 2) + 1.8]}
            zIndexRange={[10, 3]}
            style={{ pointerEvents: 'none' }}
          >
            <div style={{
              whiteSpace: 'nowrap',
              fontFamily: 'var(--font-mono)',
              fontSize: 9,
              letterSpacing: '0.08em',
              color: 'rgba(176,192,220,0.9)',
              background: 'rgba(4,6,11,0.72)',
              border: '1px solid rgba(122,152,205,0.16)',
              borderRadius: 4,
              padding: '1px 6px',
            }}>
              {district.path}
            </div>
          </Html>
        </group>
      ))}
    </group>
  )
}

/**
 * The finding markers and the beams that tie them to their file.
 * @param props - The placed findings and the current selection.
 * @returns The marker layer.
 */
function Markers({
  placed,
  selectedId,
  onSelect,
}: {
  placed: PlacedFinding[]
  selectedId: string | undefined
  onSelect: (id: string) => void
}): ReactNode {
  const points = useRef<Points>(null)
  const reduced = usePrefersReducedMotion()

  const geometry = useMemo(() => {
    const built = new BufferGeometry()
    const positions = new Float32Array(placed.length * 3)
    const colors = new Float32Array(placed.length * 3)
    const sizes = new Float32Array(placed.length)
    const gains = new Float32Array(placed.length).fill(1)
    const colour = new Color()
    for (const [index, entry] of placed.entries()) {
      positions.set([entry.position.x, entry.position.y, entry.position.z], index * 3)
      colour.set(SEVERITY_COLOR[entry.finding.severity])
      colors.set([colour.r, colour.g, colour.b], index * 3)
      sizes[index] = MARKER_SIZE[entry.finding.severity] ?? 10
    }
    built.setAttribute('position', new BufferAttribute(positions, 3))
    built.setAttribute('aColor', new BufferAttribute(colors, 3))
    built.setAttribute('aSize', new BufferAttribute(sizes, 1))
    built.setAttribute('aGain', new BufferAttribute(gains, 1))
    return built
  }, [placed])

  const material = useMemo(createGlowMaterial, [])

  const beams = useMemo(() => {
    const positions = new Float32Array(placed.length * 6)
    const colors = new Float32Array(placed.length * 6)
    const colour = new Color()
    for (const [index, entry] of placed.entries()) {
      positions.set(
        [entry.block.x, entry.block.height, entry.block.z, entry.position.x, entry.position.y, entry.position.z],
        index * 6,
      )
      colour.set(SEVERITY_COLOR[entry.finding.severity]).multiplyScalar(0.6)
      colors.set([colour.r, colour.g, colour.b, colour.r, colour.g, colour.b], index * 6)
    }
    const built = new BufferGeometry()
    built.setAttribute('position', new BufferAttribute(positions, 3))
    built.setAttribute('color', new BufferAttribute(colors, 3))
    return built
  }, [placed])

  useEffect(() => () => {
    geometry.dispose()
    beams.dispose()
    material.dispose()
  }, [geometry, beams, material])

  useFrame(({ clock }) => {
    const layer = points.current
    if (layer === null) return
    const gain = layer.geometry.getAttribute('aGain')
    for (const [index, entry] of placed.entries()) {
      const selected = entry.finding.id === selectedId
      const wave = reduced ? 0.5 : (Math.sin((clock.elapsedTime * 2.2) + (index * 0.9)) * 0.5) + 0.5
      const weight = entry.finding.severity === 'critical' ? 0.55 : 0.32
      gain.setX(index, (selected ? 1.6 : 0.55) + (wave * weight))
    }
    gain.needsUpdate = true
  })

  return (
    <group>
      <lineSegments geometry={beams} frustumCulled={false}>
        <lineBasicMaterial vertexColors transparent opacity={0.45} blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
      </lineSegments>
      <points
        ref={points}
        geometry={geometry}
        material={material}
        frustumCulled={false}
        onClick={(event: ThreeEvent<MouseEvent>) => {
          event.stopPropagation()
          const entry = event.index === undefined ? undefined : placed[event.index]
          if (entry !== undefined) onSelect(entry.finding.id)
        }}
      />
    </group>
  )
}

/**
 * Camera behaviour: an establishing view of the whole city, and a flight to
 * the selected finding.
 * @param props - The city extent and the finding to fly to.
 * @returns The controls.
 */
function CityRig({ city, focus }: { city: CityLayout; focus: Vector3 | undefined }): ReactNode {
  const controls = useRef<ElementRef<typeof OrbitControls>>(null)
  const { camera } = useThree()
  const goal = useRef<{ position: Vector3; target: Vector3 } | undefined>(undefined)

  useEffect(() => {
    if (focus === undefined) {
      goal.current = cityView(city.extent)
      return
    }
    goal.current = {
      position: focus.clone().add(new Vector3(17, 21, 25)),
      target: focus.clone(),
    }
  }, [focus, city.extent])

  useFrame((_, delta) => {
    const control = controls.current
    if (control === null) return
    const destination = goal.current
    if (destination !== undefined) {
      const step = Math.min(1, delta * 2.4)
      camera.position.lerp(destination.position, step)
      control.target.lerp(destination.target, step)
      if (camera.position.distanceTo(destination.position) < 0.4) goal.current = undefined
    }
    control.update()
  })

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.07}
      rotateSpeed={0.45}
      zoomSpeed={0.75}
      minDistance={14}
      maxDistance={city.extent * 3.4}
      maxPolarAngle={Math.PI * 0.47}
    />
  )
}

/**
 * The code-city scene.
 * @param props - The reviewed target and its findings.
 * @returns The canvas and its contents.
 */
export function SafetyStage({
  target,
  findings,
  selectedFindingId,
  onSelectFinding,
}: {
  target: SafetyTarget
  findings: readonly Finding[]
  selectedFindingId: string | undefined
  onSelectFinding: (id: string) => void
}): ReactNode {
  const city = useMemo(() => layoutCity(target), [target])
  const view = useMemo(() => cityView(city.extent), [city.extent])
  const placed = useMemo(() => placeFindings(findings, city), [findings, city])
  const [hovered, setHovered] = useState<CityBlock | undefined>(undefined)

  const focus = useMemo(() => {
    const entry = placed.find(item => item.finding.id === selectedFindingId)
    return entry?.position
  }, [placed, selectedFindingId])

  const selectedPath = placed.find(item => item.finding.id === selectedFindingId)?.block.path

  return (
    <Stage
      camera={{ position: [view.position.x, view.position.y, view.position.z], fov: 40 }}
      fogNear={city.extent * 2.6}
      fogFar={city.extent * 9}
    >
      <group>
        <mesh position={[0, -0.7, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[city.extent * 6, city.extent * 6]} />
          <meshStandardMaterial color="#05080f" roughness={1} metalness={0} />
        </mesh>
        <gridHelper args={[city.extent * 4, 40, '#122036', '#0a1220']} position={[0, -0.6, 0]} />

        <Districts city={city} />
        <Blocks
          city={city}
          selectedPath={selectedPath}
          onHover={setHovered}
          onSelect={(block) => {
            const first = placed.find(item => item.block.path === block.path)
            if (first !== undefined) onSelectFinding(first.finding.id)
          }}
        />
        <Markers placed={placed} selectedId={selectedFindingId} onSelect={onSelectFinding} />

        {hovered === undefined ? null : (
          <Html
            center
            position={[hovered.x, hovered.height + 1.6, hovered.z]}
            zIndexRange={[40, 20]}
            style={{ pointerEvents: 'none' }}
          >
            <div style={{
              whiteSpace: 'nowrap',
              padding: '4px 9px',
              borderRadius: 7,
              border: '1px solid rgba(122,152,205,0.3)',
              background: 'rgba(6,10,18,0.92)',
              fontFamily: 'var(--font-mono)',
              fontSize: 10.5,
              color: '#e8eefc',
            }}>
              {hovered.path}
              <span style={{ color: '#64749a', marginLeft: 8 }}>{hovered.language}</span>
            </div>
          </Html>
        )}
      </group>

      <CityRig city={city} focus={focus} />
    </Stage>
  )
}
