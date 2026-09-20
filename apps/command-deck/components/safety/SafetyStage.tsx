'use client'

import { Html, OrbitControls } from '@react-three/drei'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState, type ElementRef, type ReactNode } from 'react'
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  InstancedBufferAttribute,
  Matrix4,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector3,
  type InstancedMesh,
  type LineBasicMaterial,
  type Mesh,
} from 'three'
import type { Finding, SafetyDepartment, SafetyTarget } from '@/deck/contract'
import { easeInOutCubic } from '@/deck/easing'
import { layoutCity, type CityBlock, type CityLayout } from '@/deck/layout-city'
import { usePrefersReducedMotion } from '@/deck/motion'
import { languageColor, SEVERITY_COLOR } from '@/deck/palette'
import { createGlowMaterial } from '@/components/three/glow'
import { Stage } from '@/components/three/Stage'
import type { VerdictKind } from './moments.ts'
import { useReadTrail, type ReadTrail } from './read-trail.ts'
import styles from './safety-stage.module.css'

/** Beacon height per severity, in scene units: a critical finding stands over the whole city. */
const BEACON_HEIGHT: Record<string, number> = {
  critical: 36,
  high: 27,
  medium: 19,
  low: 13,
  info: 9,
}

/** Beacon radius per severity. */
const BEACON_RADIUS: Record<string, number> = {
  critical: 0.66,
  high: 0.54,
  medium: 0.45,
  low: 0.38,
  info: 0.32,
}

/** Beacon and halo brightness per severity. */
const BEACON_GAIN: Record<string, number> = {
  critical: 1.55,
  high: 1.15,
  medium: 0.92,
  low: 0.74,
  info: 0.6,
}

/** Marker-head size per severity, in the point material's units. */
const MARKER_SIZE: Record<string, number> = {
  critical: 8.5,
  high: 7,
  medium: 6,
  low: 5.2,
  info: 4.6,
}

/** Radius of the halo standing at a beacon's foot, in scene units. */
const HALO_RADIUS = 1.9

/** Window cell size on a building wall, in scene units: pane width, then floor height. */
const WINDOW_CELL: [number, number] = [0.8, 1.05]

/**
 * Exponential decay rate of a read flare, per second.
 *
 * At this rate a file's flare is down to a twentieth about two and a half
 * seconds after the department opened it, so the reads read as a rhythm rather
 * than as a city that only ever gets brighter.
 */
const FLARE_DECAY = 1.2

/** Seconds the pulse takes to run from a flaring file's foot to its roof. */
const FLARE_PULSE_SECONDS = 0.85

/**
 * What a file keeps once its flare has decayed.
 *
 * A file the departments have opened holds a faint tint of the department's
 * colour for the rest of the run, so the city fills in as the review reads it
 * and the panel's file count has something on screen that matches it.
 */
const FLARE_MARK = 0.13

/** Seconds the opening fly-over takes. */
const FLYOVER_SECONDS = 3

/** Seconds a flight to or from a selected finding takes. */
const FOCUS_SECONDS = 1.2

/** Seconds one scan sweep takes to cross the city. */
const SWEEP_SECONDS = 5.5

/** Seconds between one scan sweep and the next. */
const SWEEP_GAP_SECONDS = 1.6

/**
 * Seconds the verdict ring takes to travel from the city centre to its edge.
 *
 * The beacons read the same number, because each one flares as the ring
 * reaches its own district rather than all at once.
 */
const VERDICT_RING_SECONDS = 3.2

/**
 * How far back the camera stands from a city of this size, in scene units.
 *
 * A wide repository is framed by its footprint; a narrow one by its tallest
 * beacon, which stands well above even the tallest file. Taking the larger of
 * the two keeps the critical shafts inside the frame whatever the target's
 * proportions, so height keeps reading as severity.
 * @param extent - Half-extent of the city footprint.
 * @param reach - Height of the tallest beacon above the ground.
 * @returns The resting camera distance.
 */
function cityDistance(extent: number, reach: number): number {
  return Math.max(extent * 3.15, reach * 2.7)
}

/**
 * The establishing view of one city: far enough back that the tallest beacon
 * stays inside the frame, looking at the towers rather than at the ground.
 * @param extent - Half-extent of the city footprint.
 * @param reach - Height of the tallest beacon above the ground.
 * @returns The camera position and the point it looks at.
 */
function cityView(extent: number, reach: number): { position: Vector3; target: Vector3 } {
  return {
    position: new Vector3(0.58, 0.8, 1.28).normalize().multiplyScalar(cityDistance(extent, reach)),
    target: new Vector3(0, 15, 0),
  }
}

/**
 * Where the opening fly-over starts: high over the far edge of the city,
 * looking back across it.
 * @param extent - Half-extent of the city footprint.
 * @param reach - Height of the tallest beacon above the ground.
 * @returns The camera position and the point it looks at.
 */
function flyoverStart(extent: number, reach: number): { position: Vector3; target: Vector3 } {
  return {
    position: new Vector3(-0.5, 1.52, -1).normalize().multiplyScalar(cityDistance(extent, reach) * 1.27),
    target: new Vector3(0, 4, 0),
  }
}

/**
 * Where the callout hangs on one beacon: part-way up the shaft, so it stays in
 * frame while the building below it stays readable.
 * @param entry - The placed finding.
 * @returns The anchor point.
 */
function calloutAnchor(entry: PlacedFinding): Vector3 {
  return entry.base.clone().setY(entry.base.y + (entry.height * 0.34))
}

/**
 * The framing of one finding: the camera stands off its building far enough to
 * hold the building, its halo and the callout on its shaft.
 * @param entry - The finding to frame.
 * @returns The camera position and the point it looks at.
 */
function focusView(entry: PlacedFinding): { position: Vector3; target: Vector3 } {
  const target = new Vector3(entry.base.x, (entry.base.y * 0.82) + (entry.height * 0.16), entry.base.z)
  const distance = 23 + (entry.height * 0.62) + (entry.block.height * 0.6)
  return {
    position: target.clone().add(new Vector3(0.58, 0.55, 1.05).normalize().multiplyScalar(distance)),
    target,
  }
}

const SCRATCH = new Matrix4()
const SCRATCH_SCALE = new Vector3()
const SCRATCH_POSITION = new Vector3()

/** One finding, resolved to a beacon standing on its file. */
interface PlacedFinding {
  finding: Finding
  block: CityBlock
  /** Foot of the beacon, on the file's roof. */
  base: Vector3
  /** Top of the beacon: the marker head and the callout anchor. */
  head: Vector3
  height: number
  radius: number
  /** Brightness multiplier the severity earns. */
  gain: number
}

/**
 * Resolve every finding onto its file's block, spreading repeats on one file
 * around the roof so two beacons never stand in the same place.
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
    // Repeats stand on a golden-angle ring, which spreads any count evenly.
    const angle = ordinal * 2.399_96
    const spread = ordinal === 0 ? 0 : 0.78
    const height = (BEACON_HEIGHT[finding.severity] ?? 12) * (1 - (ordinal * 0.06))
    const base = new Vector3(
      block.x + (Math.cos(angle) * spread),
      block.height,
      block.z + (Math.sin(angle) * spread),
    )
    placed.push({
      finding,
      block,
      base,
      head: base.clone().setY(block.height + height),
      height,
      radius: BEACON_RADIUS[finding.severity] ?? 0.4,
      gain: BEACON_GAIN[finding.severity] ?? 0.7,
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
 *
 * A building also carries the read trail: `aFlare` holds the acting
 * department's colour and the scene time the file was last opened at, offset by
 * one second so that a zero means never. The flare lights more of the tower's
 * windows, runs a band of light up its walls and decays over
 * {@link FLARE_DECAY}; with `uSteady` set it holds instead of decaying, which
 * is what a reduced-motion city shows on the last file touched.
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
        uSteady: { value: 0 },
        uCell: { value: WINDOW_CELL },
      },
    ]),
    vertexShader: /* glsl */`
      attribute vec3 aTint;
      attribute vec3 aInfo;
      attribute vec4 aFlare;
      varying vec3 vTint;
      varying vec3 vInfo;
      varying vec4 vFlare;
      varying vec3 vLocal;
      varying vec3 vFace;
      varying vec3 vScale;
      #include <fog_pars_vertex>
      void main() {
        vTint = aTint;
        vInfo = aInfo;
        vFlare = aFlare;
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
      uniform float uSteady;
      uniform vec2 uCell;
      varying vec3 vTint;
      varying vec3 vInfo;
      varying vec4 vFlare;
      varying vec3 vLocal;
      varying vec3 vFace;
      varying vec3 vScale;
      #include <fog_pars_fragment>

      float hash21(vec2 p) {
        return fract(sin(dot(p, vec2(41.317, 289.113))) * 43758.5453);
      }

      void main() {
        vec3 face = normalize(vFace);
        float seed = vInfo.y;
        float selected = vInfo.z;

        float touched = step(0.5, vFlare.w);
        float age = max(uTime - (vFlare.w - 1.0), 0.0);
        float live = mix(exp(-age * ${FLARE_DECAY.toFixed(2)}), 1.0, uSteady);
        float flare = touched * max(live, ${FLARE_MARK.toFixed(2)});
        float lit = vInfo.x + (flare * 0.44);

        vec3 glassDark = mix(vec3(0.014, 0.022, 0.04), vTint * 0.08, 0.45);
        vec3 colour = glassDark;

        if (face.y > 0.5) {
          float edge = max(abs(vLocal.x), abs(vLocal.z)) * 2.0;
          float rim = smoothstep(0.82, 1.0, edge);
          colour = vec3(0.011, 0.017, 0.029) + (vTint * rim * (0.26 + (selected * 0.7)));
          // A file being read lights its own roof, which is what the city shows
          // from the resting camera.
          colour += vFlare.rgb * flare * (0.85 + (rim * 1.3));
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
          // The band of light the read runs up the file, once, on the way in.
          float travel = clamp(age / ${FLARE_PULSE_SECONDS.toFixed(2)}, 0.0, 1.0);
          float pulse = touched * (1.0 - uSteady) * (1.0 - travel)
            * smoothstep(0.17, 0.0, abs((vLocal.y + 0.5) - travel));
          colour += vFlare.rgb * pulse * 0.85;
        }

        float key = max(dot(face, normalize(vec3(0.42, 0.82, 0.39))), 0.0);
        colour += glassDark * key * 0.9;
        colour += vTint * selected * 0.06;
        colour += vFlare.rgb * flare * 0.6;

        gl_FragColor = vec4(colour, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  })
}

/**
 * The material the beacon shafts are drawn with: an additive tube that fades
 * upward and glows at its silhouette, so the shaft reads as a column of light
 * rather than as geometry. Distance fades it into the city's own fog.
 *
 * `uFlare` is the scene time the verdict landed at, or a negative number while
 * no verdict is playing. Each beacon bursts as the verdict ring reaches its own
 * distance from the city centre, which `aInfo.z` carries.
 * @returns A new beacon material; the layer owns its own instance.
 */
function createBeaconMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    fog: true,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
    toneMapped: false,
    uniforms: UniformsUtils.merge([UniformsLib.fog, { uTime: { value: 0 }, uFlare: { value: -1 } }]),
    vertexShader: /* glsl */`
      uniform float uTime;
      uniform float uFlare;
      attribute vec3 aColor;
      attribute vec3 aInfo;
      varying vec3 vColor;
      varying float vGain;
      varying float vBurst;
      varying float vUp;
      varying float vRim;
      #include <fog_pars_vertex>
      void main() {
        vColor = aColor;
        vGain = aInfo.x * (1.0 + (aInfo.y * 1.15));
        float age = uTime - uFlare - (aInfo.z * ${VERDICT_RING_SECONDS.toFixed(2)});
        vBurst = step(0.0, uFlare) * step(0.0, age) * exp(-max(age, 0.0) * 1.1);
        vUp = position.y + 0.5;
        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        vec3 viewNormal = normalize(mat3(modelViewMatrix) * mat3(instanceMatrix) * normal);
        vRim = 1.0 - abs(dot(viewNormal, normalize(-mvPosition.xyz)));
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */`
      varying vec3 vColor;
      varying float vGain;
      varying float vBurst;
      varying float vUp;
      varying float vRim;
      #include <fog_pars_fragment>
      void main() {
        float fade = pow(1.0 - vUp, 1.5);
        float edge = pow(clamp(vRim, 0.0, 1.0), 1.7);
        float foot = smoothstep(0.14, 0.0, vUp) * 0.8;
        float alpha = ((fade * (0.2 + (0.95 * edge))) + foot) * vGain * 0.62 * (1.0 + (vBurst * 2.2));
        #ifdef USE_FOG
          alpha *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
        #endif
        if (alpha < 0.003) discard;
        gl_FragColor = vec4(vColor * (0.8 + (0.85 * edge) + (vBurst * 0.9)), alpha);
      }
    `,
  })
}

/**
 * The material the halo at a beacon's foot is drawn with: an additive ring
 * that breathes on the clock, one phase per finding, and bursts once with its
 * beacon when the verdict ring passes over it.
 * @returns A new halo material; the layer owns its own instance.
 */
function createHaloMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    fog: true,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    toneMapped: false,
    uniforms: UniformsUtils.merge([
      UniformsLib.fog,
      { uTime: { value: 0 }, uMotion: { value: 1 }, uFlare: { value: -1 } },
    ]),
    vertexShader: /* glsl */`
      uniform float uTime;
      uniform float uFlare;
      attribute vec3 aColor;
      attribute vec3 aInfo;
      varying vec3 vColor;
      varying vec2 vInfo;
      varying float vBurst;
      varying vec2 vUv;
      #include <fog_pars_vertex>
      void main() {
        vColor = aColor;
        vInfo = aInfo.xy;
        float age = uTime - uFlare - (aInfo.z * ${VERDICT_RING_SECONDS.toFixed(2)});
        vBurst = step(0.0, uFlare) * step(0.0, age) * exp(-max(age, 0.0) * 1.1);
        vUv = uv;
        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform float uMotion;
      varying vec3 vColor;
      varying vec2 vInfo;
      varying float vBurst;
      varying vec2 vUv;
      #include <fog_pars_fragment>
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float breath = mix(0.62, 0.58 + (0.42 * sin((uTime * 1.9) + vInfo.y)), uMotion);
        float radius = 0.5 + (0.34 * breath);
        float ring = smoothstep(radius + 0.28, radius, d) * smoothstep(radius - 0.32, radius, d);
        float core = smoothstep(0.42, 0.0, d) * 0.5;
        float alpha = ((ring * 1.05) + core) * vInfo.x * breath * (1.0 + (vBurst * 2.6));
        #ifdef USE_FOG
          alpha *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
        #endif
        if (alpha < 0.003) discard;
        gl_FragColor = vec4(vColor, alpha);
      }
    `,
  })
}

/**
 * The material the scan sweep is drawn with: a wall of light, brightest where
 * it meets the ground and fading with height, with scan lines that only travel
 * when motion is allowed.
 * @returns A new sweep material.
 */
function createSweepMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
    toneMapped: false,
    uniforms: {
      uTime: { value: 0 },
      uMotion: { value: 1 },
      uColor: { value: new Color('#4fd8ff') },
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform float uMotion;
      uniform vec3 uColor;
      varying vec2 vUv;
      void main() {
        float rise = pow(1.0 - vUv.y, 2.8);
        float ground = smoothstep(0.05, 0.0, vUv.y);
        float ends = smoothstep(0.0, 0.07, vUv.x) * smoothstep(1.0, 0.93, vUv.x);
        float lines = 0.72 + (0.28 * sin((vUv.y * 190.0) - (uTime * 2.6 * uMotion)));
        float alpha = ((rise * 0.26 * lines) + (ground * 0.85)) * ends;
        if (alpha < 0.003) discard;
        gl_FragColor = vec4(uColor * (0.85 + (ground * 1.2)), alpha);
      }
    `,
  })
}

/**
 * The file blocks, as one instanced mesh of lit towers.
 * @param props - The laid-out city, the read trail, the selection, and the
 * pointer callbacks.
 * @returns The city blocks.
 */
function NightBlocks({
  city,
  trail,
  selectedPath,
  reduced,
  onHover,
  onSelect,
}: {
  city: CityLayout
  trail: ReadTrail
  selectedPath: string | undefined
  reduced: boolean
  onHover: (block: CityBlock | undefined) => void
  onSelect: (block: CityBlock) => void
}): ReactNode {
  const mesh = useRef<InstancedMesh>(null)
  const clock = useThree(state => state.clock)
  const blocks = city.blocks
  const count = Math.max(1, blocks.length)
  // When each flaring file was last opened, so a trail update restarts only the
  // files whose touch is new.
  const stamps = useRef(new Map<string, { seq: number; at: number }>())

  const geometry = useMemo(() => {
    const built = new BoxGeometry(1, 1, 1)
    built.setAttribute('aTint', new InstancedBufferAttribute(new Float32Array(count * 3), 3))
    built.setAttribute('aInfo', new InstancedBufferAttribute(new Float32Array(count * 3), 3))
    built.setAttribute('aFlare', new InstancedBufferAttribute(new Float32Array(count * 4), 4))
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

  // The read trail, as one instanced attribute: the acting department's colour
  // and the scene time the file was opened at, one second in so that an
  // untouched file is a plain zero. Under reduced motion only the last file
  // touched carries a flare, and it holds instead of decaying.
  useEffect(() => {
    const flare = geometry.getAttribute('aFlare')
    const held = stamps.current
    const colour = new Color()
    const now = clock.elapsedTime
    for (const path of held.keys()) if (!trail.byPath.has(path)) held.delete(path)
    for (const [index, block] of blocks.entries()) {
      const touch = reduced
        ? (trail.last?.path === block.path ? trail.last : undefined)
        : trail.byPath.get(block.path)
      if (touch === undefined) {
        flare.setXYZW(index, 0, 0, 0, 0)
        continue
      }
      const previous = held.get(touch.path)
      const at = previous?.seq === touch.seq ? previous.at : now
      held.set(touch.path, { seq: touch.seq, at })
      colour.set(touch.color)
      flare.setXYZW(index, colour.r, colour.g, colour.b, reduced ? 1 : at + 1)
    }
    flare.needsUpdate = true
  }, [blocks, trail, reduced, geometry, clock])

  useEffect(() => {
    material.uniforms.uMotion!.value = reduced ? 0 : 1
    material.uniforms.uSteady!.value = reduced ? 1 : 0
  }, [material, reduced])

  useFrame(({ clock: running }) => {
    if (reduced) return
    material.uniforms.uTime!.value = running.elapsedTime
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
 * outlines pulse while the review is still running.
 * @param props - The laid-out city, whether a department is still out, and the
 * motion preference.
 * @returns The plates, the outlines and the labels.
 */
function Districts({
  city,
  running,
  reduced,
}: {
  city: CityLayout
  running: boolean
  reduced: boolean
}): ReactNode {
  const plates = useRef<InstancedMesh>(null)
  const outline = useRef<LineBasicMaterial>(null)

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

  useFrame(({ clock }) => {
    const material = outline.current
    if (material === null) return
    if (!running) {
      material.opacity = 0.38
      return
    }
    material.opacity = reduced
      ? 0.56
      : 0.3 + (0.36 * ((Math.sin(clock.elapsedTime * 1.7) * 0.5) + 0.5))
  })

  return (
    <group>
      <instancedMesh ref={plates} args={[undefined, undefined, Math.max(1, city.districts.length)]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#080e1a" roughness={0.94} metalness={0.06} />
      </instancedMesh>

      <lineSegments geometry={outlineGeometry} frustumCulled={false}>
        <lineBasicMaterial
          ref={outline}
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
 * The finding beacons: one light shaft per finding, a breathing halo at each
 * foot, and the marker head that carries the hover and the click.
 * @param props - The placed findings, how far the city reaches, the selection,
 * the verdict burst, the motion preference and the pointer callbacks.
 * @returns The beacon layers.
 */
function Beacons({
  placed,
  extent,
  selectedId,
  verdictAt,
  reduced,
  onHover,
  onSelect,
}: {
  placed: PlacedFinding[]
  extent: number
  selectedId: string | undefined
  verdictAt: number | undefined
  reduced: boolean
  onHover: (entry: PlacedFinding | undefined) => void
  onSelect: (id: string) => void
}): ReactNode {
  const shafts = useRef<InstancedMesh>(null)
  const halos = useRef<InstancedMesh>(null)
  const count = Math.max(1, placed.length)

  const shaftGeometry = useMemo(() => {
    const built = new CylinderGeometry(1, 1, 1, 7, 1, true)
    built.setAttribute('aColor', new InstancedBufferAttribute(new Float32Array(count * 3), 3))
    built.setAttribute('aInfo', new InstancedBufferAttribute(new Float32Array(count * 3), 3))
    return built
  }, [count])

  const haloGeometry = useMemo(() => {
    const built = new CircleGeometry(1, 22)
    built.rotateX(-Math.PI / 2)
    built.setAttribute('aColor', new InstancedBufferAttribute(new Float32Array(count * 3), 3))
    built.setAttribute('aInfo', new InstancedBufferAttribute(new Float32Array(count * 3), 3))
    return built
  }, [count])

  const headGeometry = useMemo(() => {
    const built = new BufferGeometry()
    built.setAttribute('position', new BufferAttribute(new Float32Array(placed.length * 3), 3))
    built.setAttribute('aColor', new BufferAttribute(new Float32Array(placed.length * 3), 3))
    built.setAttribute('aSize', new BufferAttribute(new Float32Array(placed.length), 1))
    built.setAttribute('aGain', new BufferAttribute(new Float32Array(placed.length), 1))
    return built
  }, [placed.length])

  const shaftMaterial = useMemo(createBeaconMaterial, [])
  const haloMaterial = useMemo(createHaloMaterial, [])
  const headMaterial = useMemo(createGlowMaterial, [])

  useEffect(() => () => {
    shaftGeometry.dispose()
    haloGeometry.dispose()
    headGeometry.dispose()
    shaftMaterial.dispose()
    haloMaterial.dispose()
    headMaterial.dispose()
  }, [shaftGeometry, haloGeometry, headGeometry, shaftMaterial, haloMaterial, headMaterial])

  useEffect(() => {
    const shaft = shafts.current
    const halo = halos.current
    if (shaft === null || halo === null) return
    const shaftColour = shaftGeometry.getAttribute('aColor')
    const shaftInfo = shaftGeometry.getAttribute('aInfo')
    const haloColour = haloGeometry.getAttribute('aColor')
    const haloInfo = haloGeometry.getAttribute('aInfo')
    const headPosition = headGeometry.getAttribute('position')
    const headColour = headGeometry.getAttribute('aColor')
    const headSize = headGeometry.getAttribute('aSize')
    const headGain = headGeometry.getAttribute('aGain')
    const colour = new Color()

    for (const [index, entry] of placed.entries()) {
      const selected = entry.finding.id === selectedId ? 1 : 0
      colour.set(SEVERITY_COLOR[entry.finding.severity] ?? '#7f8fb0')
      // Where the verdict ring reaches this beacon, as a share of its travel.
      const reachedAt = Math.min(1, Math.hypot(entry.base.x, entry.base.z) / Math.max(extent, 1))

      SCRATCH_SCALE.set(entry.radius, entry.height, entry.radius)
      SCRATCH_POSITION.set(entry.base.x, entry.base.y + (entry.height / 2), entry.base.z)
      SCRATCH.identity().scale(SCRATCH_SCALE).setPosition(SCRATCH_POSITION)
      shaft.setMatrixAt(index, SCRATCH)
      shaftColour.setXYZ(index, colour.r, colour.g, colour.b)
      shaftInfo.setXYZ(index, entry.gain, selected, reachedAt)

      const halved = HALO_RADIUS * (0.7 + (entry.gain * 0.36))
      SCRATCH_SCALE.set(halved, 1, halved)
      SCRATCH_POSITION.set(entry.base.x, entry.base.y + 0.07, entry.base.z)
      SCRATCH.identity().scale(SCRATCH_SCALE).setPosition(SCRATCH_POSITION)
      halo.setMatrixAt(index, SCRATCH)
      haloColour.setXYZ(index, colour.r, colour.g, colour.b)
      haloInfo.setXYZ(index, entry.gain * (selected === 1 ? 1.9 : 1), index * 1.37, reachedAt)

      headPosition.setXYZ(index, entry.head.x, entry.head.y, entry.head.z)
      headColour.setXYZ(index, colour.r, colour.g, colour.b)
      headSize.setX(index, MARKER_SIZE[entry.finding.severity] ?? 6)
      headGain.setX(index, selected === 1 ? 2.2 : 0.8 + (entry.gain * 0.3))
    }

    shaft.instanceMatrix.needsUpdate = true
    halo.instanceMatrix.needsUpdate = true
    for (const attribute of [
      shaftColour, shaftInfo, haloColour, haloInfo, headPosition, headColour, headSize, headGain,
    ]) attribute.needsUpdate = true
    headGeometry.computeBoundingSphere()
  }, [placed, selectedId, extent, shaftGeometry, haloGeometry, headGeometry])

  useEffect(() => {
    haloMaterial.uniforms.uMotion!.value = reduced ? 0 : 1
  }, [haloMaterial, reduced])

  useEffect(() => {
    const at = verdictAt ?? -1
    haloMaterial.uniforms.uFlare!.value = at
    shaftMaterial.uniforms.uFlare!.value = at
  }, [haloMaterial, shaftMaterial, verdictAt])

  useFrame(({ clock }) => {
    if (reduced) return
    haloMaterial.uniforms.uTime!.value = clock.elapsedTime
    shaftMaterial.uniforms.uTime!.value = clock.elapsedTime
  })

  return (
    <group>
      <instancedMesh
        ref={shafts}
        args={[undefined, undefined, count]}
        geometry={shaftGeometry}
        material={shaftMaterial}
        frustumCulled={false}
        renderOrder={2}
        onPointerMove={(event: ThreeEvent<PointerEvent>) => {
          event.stopPropagation()
          const entry = event.instanceId === undefined ? undefined : placed[event.instanceId]
          onHover(entry)
          document.body.style.cursor = entry === undefined ? 'auto' : 'pointer'
        }}
        onPointerOut={() => {
          onHover(undefined)
          document.body.style.cursor = 'auto'
        }}
        onClick={(event: ThreeEvent<MouseEvent>) => {
          event.stopPropagation()
          const entry = event.instanceId === undefined ? undefined : placed[event.instanceId]
          if (entry !== undefined) onSelect(entry.finding.id)
        }}
      />

      <instancedMesh
        ref={halos}
        args={[undefined, undefined, count]}
        geometry={haloGeometry}
        material={haloMaterial}
        frustumCulled={false}
        renderOrder={1}
      />

      <points
        geometry={headGeometry}
        material={headMaterial}
        frustumCulled={false}
        renderOrder={3}
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
 * The scan sweep: a wall of light crossing the city while any department is
 * still out. Under reduced motion it stands still over the centre instead.
 * @param props - The laid-out city and the motion preference.
 * @returns The sweep plane.
 */
function ScanSweep({ city, reduced }: { city: CityLayout; reduced: boolean }): ReactNode {
  const plane = useRef<Mesh>(null)
  const material = useMemo(createSweepMaterial, [])
  const height = city.extent * 0.62
  const travel = city.extent * 1.25

  useEffect(() => () => material.dispose(), [material])

  useEffect(() => {
    material.uniforms.uMotion!.value = reduced ? 0 : 1
  }, [material, reduced])

  useFrame(({ clock }) => {
    const mesh = plane.current
    if (mesh === null || reduced) return
    material.uniforms.uTime!.value = clock.elapsedTime
    const phase = clock.elapsedTime % (SWEEP_SECONDS + SWEEP_GAP_SECONDS)
    const progress = phase / SWEEP_SECONDS
    mesh.visible = progress <= 1
    if (mesh.visible) mesh.position.x = -travel + (progress * travel * 2)
  })

  return (
    <mesh
      ref={plane}
      position={[reduced ? 0 : -travel, height / 2, 0]}
      rotation={[0, Math.PI / 2, 0]}
      material={material}
      renderOrder={4}
    >
      <planeGeometry args={[city.extent * 2.2, height]} />
    </mesh>
  )
}

/**
 * The material the verdict ring is drawn with: one bright band travelling out
 * from the city centre over a dimmer wake, fading as it leaves the districts
 * behind. `uProgress` is the band's radius as a share of the plane's own
 * half-width.
 * @returns A new ring material.
 */
function createVerdictMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
    toneMapped: false,
    uniforms: {
      uProgress: { value: 0 },
      uColor: { value: new Color('#49e0a6') },
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uProgress;
      uniform vec3 uColor;
      varying vec2 vUv;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float band = smoothstep(0.085, 0.0, abs(d - uProgress));
        float wake = smoothstep(uProgress, uProgress - 0.4, d) * step(d, uProgress) * 0.2;
        float fade = 1.0 - smoothstep(0.9, 1.3, uProgress);
        float alpha = ((band * 0.9) + wake) * fade;
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(uColor * (0.7 + (band * 0.8)), alpha);
      }
    `,
  })
}

/**
 * The scene clock reading one moment began at.
 *
 * The overlays are timed in wall-clock milliseconds and the scene in its own
 * elapsed seconds, so a moment that reaches the city is stamped once, on the
 * render that first sees it, in the clock the shaders read.
 * @param moment - What is playing, or `undefined` when nothing is.
 * @returns The scene time the moment began at, or `undefined`.
 */
function useSceneStamp(moment: string | undefined): number | undefined {
  const clock = useThree(state => state.clock)
  const [stamp, setStamp] = useState<number | undefined>(undefined)

  useEffect(() => {
    setStamp(moment === undefined ? undefined : clock.elapsedTime)
  }, [moment, clock])

  return stamp
}

/**
 * The verdict ring: a wall of light leaving the city centre when the
 * certificate lands, green when it was issued and amber when it was withheld.
 * @param props - The city, the verdict, and the scene time it landed at.
 * @returns The ring plane.
 */
function VerdictRing({
  city,
  verdict,
  at,
}: {
  city: CityLayout
  verdict: VerdictKind
  at: number
}): ReactNode {
  const material = useMemo(createVerdictMaterial, [])
  const span = city.extent * 2.6
  // One unit of travel is the city's own half-extent, which is where the
  // beacons place themselves on the ring's clock; the plane reaches further so
  // the ring is still drawn as it leaves the outermost district.
  const unit = city.extent / (span / 2)

  useEffect(() => () => material.dispose(), [material])

  useEffect(() => {
    const colour = material.uniforms.uColor!.value as Color
    colour.set(verdict === 'certified' ? '#49e0a6' : '#ffbe5c')
  }, [material, verdict])

  useFrame(({ clock }) => {
    material.uniforms.uProgress!.value = ((clock.elapsedTime - at) / VERDICT_RING_SECONDS) * unit
  })

  return (
    <mesh position={[0, 0.08, 0]} rotation={[-Math.PI / 2, 0, 0]} material={material} renderOrder={5}>
      <planeGeometry args={[span, span]} />
    </mesh>
  )
}

/**
 * Camera behaviour: the opening fly-over, the flight to a selected finding and
 * back, and the orbit controls in between. Under reduced motion every move is
 * an instant cut.
 * @param props - The city, its beacon reach, the finding to frame, and the
 * motion preference.
 * @returns The controls.
 */
function CityRig({
  city,
  reach,
  focus,
  reduced,
}: {
  city: CityLayout
  reach: number
  focus: PlacedFinding | undefined
  reduced: boolean
}): ReactNode {
  const controls = useRef<ElementRef<typeof OrbitControls>>(null)
  const { camera } = useThree()
  const flight = useRef<{
    fromPosition: Vector3
    fromTarget: Vector3
    toPosition: Vector3
    toTarget: Vector3
    elapsed: number
    duration: number
  } | undefined>(undefined)
  const opened = useRef(false)

  useEffect(() => {
    const control = controls.current
    if (control === null) return
    const destination = focus === undefined ? cityView(city.extent, reach) : focusView(focus)
    const opening = !opened.current
    opened.current = true

    if (reduced) {
      flight.current = undefined
      control.enabled = true
      camera.position.copy(destination.position)
      control.target.copy(destination.target)
      control.update()
      return
    }

    if (opening) {
      const start = flyoverStart(city.extent, reach)
      camera.position.copy(start.position)
      control.target.copy(start.target)
    }
    control.enabled = false
    flight.current = {
      fromPosition: camera.position.clone(),
      fromTarget: control.target.clone(),
      toPosition: destination.position,
      toTarget: destination.target,
      elapsed: 0,
      duration: opening ? FLYOVER_SECONDS : FOCUS_SECONDS,
    }
  }, [focus, city.extent, reach, reduced, camera])

  useFrame((_, delta) => {
    const control = controls.current
    if (control === null) return
    const current = flight.current
    if (current !== undefined) {
      current.elapsed += delta
      const progress = Math.min(1, current.elapsed / current.duration)
      const eased = easeInOutCubic(progress)
      camera.position.lerpVectors(current.fromPosition, current.toPosition, eased)
      control.target.lerpVectors(current.fromTarget, current.toTarget, eased)
      if (progress >= 1) {
        flight.current = undefined
        control.enabled = true
      }
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
      maxDistance={cityDistance(city.extent, reach) * 1.35}
      maxPolarAngle={Math.PI * 0.47}
    />
  )
}

/**
 * Everything the city draws from the followed run: the read trail on the
 * buildings, the verdict ring, and the beacon burst that travels with it.
 * @param props - The city, the placed findings, the selection, the verdict, and
 * the motion preference.
 * @returns The building layer, the beacons and the ring.
 */
function LiveCity({
  city,
  target,
  placed,
  selectedPath,
  selectedId,
  verdict,
  reduced,
  onHoverBlock,
  onHoverFinding,
  onSelectBlock,
  onSelectFinding,
}: {
  city: CityLayout
  target: SafetyTarget
  placed: PlacedFinding[]
  selectedPath: string | undefined
  selectedId: string | undefined
  verdict: VerdictKind | undefined
  reduced: boolean
  onHoverBlock: (block: CityBlock | undefined) => void
  onHoverFinding: (entry: PlacedFinding | undefined) => void
  onSelectBlock: (block: CityBlock) => void
  onSelectFinding: (id: string | undefined) => void
}): ReactNode {
  const trail = useReadTrail(target)
  // A reduced-motion city shows the verdict on the card alone, so the ring and
  // the burst never start.
  const verdictAt = useSceneStamp(reduced ? undefined : verdict)

  return (
    <group>
      <NightBlocks
        city={city}
        trail={trail}
        selectedPath={selectedPath}
        reduced={reduced}
        onHover={onHoverBlock}
        onSelect={onSelectBlock}
      />
      <Beacons
        placed={placed}
        extent={city.extent}
        selectedId={selectedId}
        verdictAt={verdictAt}
        reduced={reduced}
        onHover={onHoverFinding}
        onSelect={onSelectFinding}
      />
      {verdict === undefined || verdictAt === undefined
        ? null
        : <VerdictRing city={city} verdict={verdict} at={verdictAt} />}
    </group>
  )
}

/**
 * The code-city scene.
 * @param props - The reviewed target, its departments, its findings, the
 * selection, and the verdict the review has just reached, if any.
 * @returns The canvas and its contents.
 */
export function SafetyStage({
  target,
  departments,
  findings,
  selectedFindingId,
  verdict,
  onSelectFinding,
}: {
  target: SafetyTarget
  departments: readonly SafetyDepartment[]
  findings: readonly Finding[]
  selectedFindingId: string | undefined
  verdict: VerdictKind | undefined
  onSelectFinding: (id: string | undefined) => void
}): ReactNode {
  const reduced = usePrefersReducedMotion()
  const city = useMemo(() => layoutCity(target), [target])
  const placed = useMemo(() => placeFindings(findings, city), [findings, city])
  // How high the scene actually stands: the tallest beacon, or the tallest
  // file where the review found nothing.
  const reach = useMemo(
    () => placed.reduce(
      (acc, entry) => Math.max(acc, entry.base.y + entry.height),
      city.blocks.reduce((acc, block) => Math.max(acc, block.height), 0),
    ),
    [placed, city],
  )
  const view = useMemo(() => cityView(city.extent, reach), [city.extent, reach])
  const [hoveredBlock, setHoveredBlock] = useState<CityBlock | undefined>(undefined)
  const [hoveredFinding, setHoveredFinding] = useState<PlacedFinding | undefined>(undefined)

  // A department the feed still reports as pending is the one honest signal
  // that the review is running; every other status means it has reported.
  const running = departments.some(entry => entry.status === 'pending')

  const focus = useMemo(
    () => placed.find(entry => entry.finding.id === selectedFindingId),
    [placed, selectedFindingId],
  )

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

        <Districts city={city} running={running} reduced={reduced} />
        <LiveCity
          city={city}
          target={target}
          placed={placed}
          selectedPath={focus?.block.path}
          selectedId={selectedFindingId}
          verdict={verdict}
          reduced={reduced}
          onHoverBlock={setHoveredBlock}
          onHoverFinding={setHoveredFinding}
          onSelectBlock={(block) => {
            const first = placed.find(entry => entry.block.path === block.path)
            if (first !== undefined) onSelectFinding(first.finding.id)
          }}
          onSelectFinding={onSelectFinding}
        />
        {running ? <ScanSweep city={city} reduced={reduced} /> : null}

        {hoveredFinding === undefined || hoveredFinding.finding.id === selectedFindingId ? null : (
          <Html
            center
            position={[hoveredFinding.head.x, hoveredFinding.head.y + 1.7, hoveredFinding.head.z]}
            zIndexRange={[40, 20]}
            style={{ pointerEvents: 'none' }}
          >
            <div className={styles.hoverLabel}>
              <b>{hoveredFinding.finding.file}:{hoveredFinding.finding.line}</b>
              <span>{hoveredFinding.finding.severity}</span>
              <em>{hoveredFinding.finding.title}</em>
            </div>
          </Html>
        )}

        {hoveredFinding !== undefined || hoveredBlock === undefined ? null : (
          <Html
            center
            position={[hoveredBlock.x, hoveredBlock.height + 1.6, hoveredBlock.z]}
            zIndexRange={[40, 20]}
            style={{ pointerEvents: 'none' }}
          >
            <div className={styles.hoverLabel}>
              <b>{hoveredBlock.path}</b>
              <span>{hoveredBlock.language}</span>
            </div>
          </Html>
        )}

        {focus === undefined ? null : (
          <Html
            position={calloutAnchor(focus).toArray()}
            zIndexRange={[60, 40]}
            style={{ pointerEvents: 'none' }}
          >
            <div
              className={styles.callout}
              style={{ color: SEVERITY_COLOR[focus.finding.severity] ?? '#7f8fb0' }}
            >
              <div className={styles.calloutHead}>
                <span className={styles.calloutPill}>{focus.finding.severity}</span>
                <span>{focus.finding.cwe}</span>
              </div>
              <div className={styles.calloutWhere}>{focus.finding.file}:{focus.finding.line}</div>
              <div className={styles.calloutTitle}>{focus.finding.title}</div>
            </div>
          </Html>
        )}
      </group>

      <CityRig city={city} reach={reach} focus={focus} reduced={reduced} />
    </Stage>
  )
}
