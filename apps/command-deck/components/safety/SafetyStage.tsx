'use client'

import { Html, OrbitControls } from '@react-three/drei'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState, type ElementRef, type ReactNode } from 'react'
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  InstancedBufferAttribute,
  Matrix4,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector3,
  type InstancedMesh,
  type Points,
} from 'three'
import type { Finding, SafetyTarget } from '@/deck/contract'
import { layoutCity, type CityBlock, type CityLayout } from '@/deck/layout-city'
import { usePrefersReducedMotion } from '@/deck/motion'
import { languageColor, SEVERITY_COLOR } from '@/deck/palette'
import { createGlowMaterial } from '@/components/three/glow'
import { Stage } from '@/components/three/Stage'
import styles from './safety-stage.module.css'

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

/** Window cell size on a building wall, in scene units: pane width, then floor height. */
const WINDOW_CELL: [number, number] = [0.8, 1.05]

/**
 * The establishing view of one city: far enough back that the tallest tower
 * and its markers stay inside the frame, looking at the towers rather than at
 * the ground.
 * @param extent - Half-extent of the city footprint.
 * @returns The camera position and the point it looks at.
 */
function cityView(extent: number): { position: Vector3; target: Vector3 } {
  return {
    position: new Vector3(0.58, 0.8, 1.28).normalize().multiplyScalar(extent * 3.15),
    target: new Vector3(0, 15, 0),
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
 * The material the buildings are lit with.
 *
 * Walls are dark glass carrying a procedural window grid: a cell is lit when a
 * hash of its position, its wall face and the building's own seed falls under
 * that building's lit fraction, so a larger file lights more of its tower and
 * the same file lights the same windows in every render. The roof is dark with
 * a glowing parapet, and the window light carries the file's language colour
 * at low saturation.
 * @returns A new building material; the layer owns its own instance.
 */
function createBuildingMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    fog: true,
    uniforms: UniformsUtils.merge([
      UniformsLib.fog,
      {
        uTime: { value: 0 },
        uMotion: { value: 1 },
        uCell: { value: WINDOW_CELL },
      },
    ]),
    vertexShader: /* glsl */`
      attribute vec3 aTint;
      attribute vec3 aInfo;
      varying vec3 vTint;
      varying vec3 vInfo;
      varying vec3 vLocal;
      varying vec3 vFace;
      varying vec3 vScale;
      #include <fog_pars_vertex>
      void main() {
        vTint = aTint;
        vInfo = aInfo;
        vLocal = position;
        vFace = normal;
        vScale = vec3(
          length(instanceMatrix[0].xyz),
          length(instanceMatrix[1].xyz),
          length(instanceMatrix[2].xyz)
        );
        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform float uMotion;
      uniform vec2 uCell;
      varying vec3 vTint;
      varying vec3 vInfo;
      varying vec3 vLocal;
      varying vec3 vFace;
      varying vec3 vScale;
      #include <fog_pars_fragment>

      float hash21(vec2 p) {
        return fract(sin(dot(p, vec2(41.317, 289.113))) * 43758.5453);
      }

      void main() {
        vec3 face = normalize(vFace);
        float lit = vInfo.x;
        float seed = vInfo.y;
        float selected = vInfo.z;

        vec3 glassDark = mix(vec3(0.014, 0.022, 0.04), vTint * 0.08, 0.45);
        vec3 colour = glassDark;

        if (face.y > 0.5) {
          float edge = max(abs(vLocal.x), abs(vLocal.z)) * 2.0;
          float rim = smoothstep(0.82, 1.0, edge);
          colour = vec3(0.011, 0.017, 0.029) + (vTint * rim * (0.26 + (selected * 0.7)));
        } else if (face.y < -0.5) {
          colour = vec3(0.006, 0.009, 0.017);
        } else {
          float horizontal = abs(face.x) > 0.5 ? vLocal.z * vScale.z : vLocal.x * vScale.x;
          float vertical = (vLocal.y + 0.5) * vScale.y;
          vec2 grid = vec2(horizontal / uCell.x, vertical / uCell.y);
          vec2 cell = floor(grid);
          vec2 inCell = fract(grid);
          float wall = abs(face.x) > 0.5 ? 0.0 : 1.0;
          float draw = hash21(cell + vec2(seed * 137.0, wall * 19.0));
          float on = step(draw, lit);
          float pane = step(0.16, inCell.x) * step(inCell.x, 0.84)
            * step(0.22, inCell.y) * step(inCell.y, 0.82);
          // A handful of windows breathe; the rest hold, so the city never shimmers.
          float breath = 1.0 - (uMotion * 0.34 * step(0.9, draw)
            * (0.5 + (0.5 * sin((uTime * 1.1) + (draw * 60.0)))));
          // Each window keeps its own brightness, so a wall reads as many
          // offices rather than as one panel.
          float lamp = 0.35 + (0.65 * hash21(cell + vec2(seed * 71.0, 7.3)));
          vec3 pool = mix(vec3(1.0), vTint, 0.86);
          colour = glassDark + (pool * on * pane * lamp * breath * (0.72 + (selected * 0.6)));
          colour += vec3(0.01, 0.015, 0.026) * (1.0 - pane);
        }

        float key = max(dot(face, normalize(vec3(0.42, 0.82, 0.39))), 0.0);
        colour += glassDark * key * 0.9;
        colour += vTint * selected * 0.06;

        gl_FragColor = vec4(colour, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  })
}

/**
 * The file blocks, as one instanced mesh of lit towers.
 * @param props - The laid-out city, the selection, and the pointer callbacks.
 * @returns The city blocks.
 */
function NightBlocks({
  city,
  selectedPath,
  reduced,
  onHover,
  onSelect,
}: {
  city: CityLayout
  selectedPath: string | undefined
  reduced: boolean
  onHover: (block: CityBlock | undefined) => void
  onSelect: (block: CityBlock) => void
}): ReactNode {
  const mesh = useRef<InstancedMesh>(null)
  const blocks = city.blocks
  const count = Math.max(1, blocks.length)

  const geometry = useMemo(() => {
    const built = new BoxGeometry(1, 1, 1)
    built.setAttribute('aTint', new InstancedBufferAttribute(new Float32Array(count * 3), 3))
    built.setAttribute('aInfo', new InstancedBufferAttribute(new Float32Array(count * 3), 3))
    return built
  }, [count])

  const material = useMemo(createBuildingMaterial, [])

  useEffect(() => () => {
    geometry.dispose()
    material.dispose()
  }, [geometry, material])

  useEffect(() => {
    const instanced = mesh.current
    if (instanced === null) return
    const tint = geometry.getAttribute('aTint')
    const info = geometry.getAttribute('aInfo')
    const colour = new Color()
    for (const [index, block] of blocks.entries()) {
      SCRATCH_SCALE.set(block.size, block.height, block.size)
      SCRATCH_POSITION.set(block.x, block.height / 2, block.z)
      SCRATCH.identity().scale(SCRATCH_SCALE).setPosition(SCRATCH_POSITION)
      instanced.setMatrixAt(index, SCRATCH)
      colour.set(languageColor(block.language))
      tint.setXYZ(index, colour.r, colour.g, colour.b)
      info.setXYZ(index, block.lit, block.seed, block.path === selectedPath ? 1 : 0)
    }
    instanced.instanceMatrix.needsUpdate = true
    tint.needsUpdate = true
    info.needsUpdate = true
  }, [blocks, selectedPath, geometry])

  useEffect(() => {
    material.uniforms.uMotion!.value = reduced ? 0 : 1
  }, [material, reduced])

  useFrame(({ clock }) => {
    if (reduced) return
    material.uniforms.uTime!.value = clock.elapsedTime
  })

  return (
    <instancedMesh
      ref={mesh}
      args={[undefined, undefined, count]}
      geometry={geometry}
      material={material}
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
    />
  )
}

/**
 * The district plates, their glowing outlines and their directory names. The
 * outline carries the colour of the language most of the district's files are
 * written in, so a directory reads as one neighbourhood.
 * @param props - The laid-out city.
 * @returns The plates, the outlines and the labels.
 */
function Districts({ city }: { city: CityLayout }): ReactNode {
  const plates = useRef<InstancedMesh>(null)

  const outlineGeometry = useMemo(() => {
    const built = new BufferGeometry()
    const positions = new Float32Array(city.districts.length * 24)
    const colors = new Float32Array(city.districts.length * 24)
    const colour = new Color()
    for (const [index, district] of city.districts.entries()) {
      const left = district.x - (district.width / 2)
      const right = district.x + (district.width / 2)
      const near = district.z - (district.depth / 2)
      const far = district.z + (district.depth / 2)
      const corners: [number, number][] = [[left, near], [right, near], [right, far], [left, far]]
      colour.set(languageColor(district.language))
      for (let edge = 0; edge < 4; edge += 1) {
        const from = corners[edge]!
        const to = corners[(edge + 1) % 4]!
        const offset = (index * 24) + (edge * 6)
        positions.set([from[0], 0.02, from[1], to[0], 0.02, to[1]], offset)
        colors.set([colour.r, colour.g, colour.b, colour.r, colour.g, colour.b], offset)
      }
    }
    built.setAttribute('position', new BufferAttribute(positions, 3))
    built.setAttribute('color', new BufferAttribute(colors, 3))
    return built
  }, [city])

  useEffect(() => () => outlineGeometry.dispose(), [outlineGeometry])

  useEffect(() => {
    const instanced = plates.current
    if (instanced === null) return
    for (const [index, district] of city.districts.entries()) {
      SCRATCH_SCALE.set(district.width, 0.5, district.depth)
      SCRATCH_POSITION.set(district.x, -0.26, district.z)
      SCRATCH.identity().scale(SCRATCH_SCALE).setPosition(SCRATCH_POSITION)
      instanced.setMatrixAt(index, SCRATCH)
    }
    instanced.instanceMatrix.needsUpdate = true
  }, [city])

  return (
    <group>
      <instancedMesh ref={plates} args={[undefined, undefined, Math.max(1, city.districts.length)]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#080e1a" roughness={0.94} metalness={0.06} />
      </instancedMesh>

      <lineSegments geometry={outlineGeometry} frustumCulled={false}>
        <lineBasicMaterial
          vertexColors
          transparent
          opacity={0.38}
          blending={AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </lineSegments>

      {city.districts.map(district => (
        <Html
          key={district.path}
          center
          position={[district.x, 0.4, district.z + (district.depth / 2) + 1.8]}
          zIndexRange={[10, 3]}
          style={{ pointerEvents: 'none' }}
        >
          <div className={styles.districtLabel} style={{ color: languageColor(district.language) }}>
            {district.path}
          </div>
        </Html>
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
  const reduced = usePrefersReducedMotion()
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
      fogNear={city.extent * 2.2}
      fogFar={city.extent * 8}
    >
      <group>
        <mesh position={[0, -0.72, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[city.extent * 8, city.extent * 8]} />
          <meshStandardMaterial color="#04070d" roughness={1} metalness={0} />
        </mesh>
        <gridHelper args={[city.extent * 7, 64, '#1a3355', '#0d1b2e']} position={[0, -0.66, 0]} />

        <Districts city={city} />
        <NightBlocks
          city={city}
          selectedPath={selectedPath}
          reduced={reduced}
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
            <div className={styles.hoverLabel}>
              <b>{hovered.path}</b>
              <span>{hovered.language}</span>
            </div>
          </Html>
        )}
      </group>

      <CityRig city={city} focus={focus} />
    </Stage>
  )
}
