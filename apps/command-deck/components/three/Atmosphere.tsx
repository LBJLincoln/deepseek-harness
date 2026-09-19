'use client'

import { useFrame } from '@react-three/fiber'
import { useMemo, useRef, type ReactNode } from 'react'
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  ShaderMaterial,
  Uniform,
  type Mesh,
  type Points,
} from 'three'

/**
 * How many dust points the field holds.
 *
 * One `Points` object, so the whole field is one draw call whatever the count;
 * the ceiling is fill rate, and at these sizes each point covers a pixel or
 * three.
 */
const DUST_COUNT = 3_200

/**
 * How much of the camera's own movement the dust field follows.
 *
 * At `1` the field would be welded to the camera and read as a flat backdrop;
 * at `0` it would swing past like foreground geometry. The remaining fraction
 * is the parallax that makes it read as distance.
 */
const DUST_PARALLAX = 0.82

/** Radians per second the field turns about the vertical, its only motion. */
const DUST_DRIFT = 0.011

/**
 * Deterministic field generator.
 *
 * The dust is the same on every load, so two screenshots of one view differ
 * only where the data differs.
 * @param seed - Any 32-bit integer.
 * @returns A generator over `[0, 1)`.
 */
function mulberry32(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

/**
 * The dust field's geometry, laid out in the shell the scene's fog covers.
 * @param near - The scene's `fog.near`.
 * @param far - The scene's `fog.far`.
 * @returns A geometry carrying position, size, twinkle phase and tint.
 */
function useDustGeometry(near: number, far: number): BufferGeometry {
  return useMemo(() => {
    const random = mulberry32(0x5eed_1f05)
    const positions = new Float32Array(DUST_COUNT * 3)
    const sizes = new Float32Array(DUST_COUNT)
    const phases = new Float32Array(DUST_COUNT)
    const tints = new Float32Array(DUST_COUNT)
    // Inside the fog's own range: nothing sits in front of it, and nothing
    // sits so far back that the fog has already taken it to black.
    const inner = near * 1.15
    const outer = far * 0.86

    for (let index = 0; index < DUST_COUNT; index += 1) {
      const height = random() * 2 - 1
      const angle = random() * Math.PI * 2
      const ring = Math.sqrt(Math.max(0, 1 - height * height))
      // Cube-root weighting fills the shell evenly instead of crowding its
      // inner face, where the points would be largest and most obvious.
      const radius = Math.cbrt(inner ** 3 + random() * (outer ** 3 - inner ** 3))
      positions[index * 3] = Math.cos(angle) * ring * radius
      // Slightly flattened, so the field reads as a plane of dust seen edge-on
      // rather than a ball the camera sits inside.
      positions[index * 3 + 1] = height * radius * 0.74
      positions[index * 3 + 2] = Math.sin(angle) * ring * radius
      // Sizes are world units proportional to the fog's depth, so a point
      // covers the same few pixels in all three scenes despite their scales.
      sizes[index] = far * (0.0013 + random() ** 2 * 0.0039)
      phases[index] = random() * Math.PI * 2
      tints[index] = random() ** 2
    }

    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(positions, 3))
    geometry.setAttribute('aSize', new BufferAttribute(sizes, 1))
    geometry.setAttribute('aPhase', new BufferAttribute(phases, 1))
    geometry.setAttribute('aTint', new BufferAttribute(tints, 1))
    return geometry
  }, [near, far])
}

/** A dust material together with the two uniforms the frame loop writes. */
interface DustMaterial {
  material: ShaderMaterial
  time: Uniform<number>
  pixelScale: Uniform<number>
}

/**
 * The dust material: additive points, fogged by hand.
 *
 * `ShaderMaterial` does not take three's fog chunks, and an additive layer
 * cannot be faded towards a fog colour anyway — it is faded towards nothing,
 * which against this background is the same image.
 * @param near - The scene's `fog.near`.
 * @param far - The scene's `fog.far`.
 * @returns The material and the uniforms to animate; the caller owns disposal.
 */
function useDustMaterial(near: number, far: number): DustMaterial {
  return useMemo(() => {
    const time = new Uniform(0)
    const pixelScale = new Uniform(500)
    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        uTime: time,
        uPixelScale: pixelScale,
        uNear: new Uniform(near),
        uFar: new Uniform(far),
        uGain: new Uniform(1.15),
        uTintNear: new Uniform(new Color('#e7f1ff')),
        uTintFar: new Uniform(new Color('#5fa6ff')),
      },
      vertexShader: /* glsl */`
      uniform float uTime;
      uniform float uPixelScale;
      uniform float uNear;
      uniform float uFar;
      uniform float uGain;
      uniform vec3 uTintNear;
      uniform vec3 uTintFar;
      attribute float aSize;
      attribute float aPhase;
      attribute float aTint;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float dist = max(-mv.z, 1.0);
        gl_PointSize = aSize * uPixelScale / dist;
        float fog = 1.0 - clamp((dist - uNear) / max(uFar - uNear, 0.001), 0.0, 1.0);
        float twinkle = 0.66 + 0.34 * sin(uTime * 0.55 + aPhase);
        vAlpha = fog * fog * twinkle * uGain;
        vColor = mix(uTintNear, uTintFar, aTint);
        gl_Position = projectionMatrix * mv;
      }
    `,
      fragmentShader: /* glsl */`
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - vec2(0.5));
        float core = smoothstep(0.5, 0.0, d);
        if (core * vAlpha < 0.004) discard;
        gl_FragColor = vec4(vColor * core * vAlpha, core * vAlpha);
      }
    `,
    })
    return { material, time, pixelScale }
  }, [near, far])
}

/**
 * Distant dust that drifts and parallaxes with the camera.
 * @param props - The scene's fog range, which sets where the field sits.
 * @returns The field.
 */
function DustField({ near, far }: { near: number; far: number }): ReactNode {
  const points = useRef<Points>(null)
  const geometry = useDustGeometry(near, far)
  const { material, time, pixelScale } = useDustMaterial(near, far)

  useFrame((state) => {
    const field = points.current
    if (field === null) return
    field.position.copy(state.camera.position).multiplyScalar(DUST_PARALLAX)
    field.rotation.y = state.clock.elapsedTime * DUST_DRIFT
    time.value = state.clock.elapsedTime
    // `gl_PointSize` is in drawing-buffer pixels, so it has to track both the
    // canvas height and the device ratio or the field coarsens on a retina
    // screen and thins out on a projector.
    pixelScale.value = state.size.height * state.viewport.dpr * 0.5
  })

  return (
    <points
      ref={points}
      geometry={geometry}
      material={material}
      frustumCulled={false}
      renderOrder={-5}
    />
  )
}

/**
 * The horizon glow's material: a faint band on a dome around the camera.
 * @returns The material; the caller owns its disposal.
 */
function useHorizonMaterial(): ShaderMaterial {
  return useMemo(() => new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: BackSide,
    blending: AdditiveBlending,
    uniforms: {
      uIntensity: new Uniform(0.45),
      uSky: new Uniform(new Color('#1d5088')),
      uGround: new Uniform(new Color('#2a2170')),
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uIntensity;
      uniform vec3 uSky;
      uniform vec3 uGround;
      varying vec3 vDir;
      void main() {
        float y = vDir.y * 6.5;
        float band = exp(-y * y);
        float alpha = band * uIntensity;
        if (alpha < 0.004) discard;
        vec3 tint = mix(uSky, uGround, smoothstep(0.0, -0.3, vDir.y));
        gl_FragColor = vec4(tint * alpha, alpha);
      }
    `,
  }), [])
}

/**
 * A faint glow along the horizon, drawn behind the scene.
 *
 * The dome rides the camera, so it is always the furthest thing in frame and
 * every fogged object composites over it; it carries no fog of its own,
 * because at that distance the fog would take it to black and there would be
 * no glow left to see.
 * @param props - The scene's `fog.far`, which sets the dome's radius.
 * @returns The glow.
 */
function HorizonGlow({ far }: { far: number }): ReactNode {
  const dome = useRef<Mesh>(null)
  const material = useHorizonMaterial()
  // Past the fog and past every scene's own extent, but inside the camera's
  // far plane, so the depth test still hides it behind foreground geometry.
  const radius = Math.min(far * 1.15, 1_700)

  useFrame((state) => {
    dome.current?.position.copy(state.camera.position)
  })

  return (
    <mesh ref={dome} material={material} scale={radius} renderOrder={-10}>
      <sphereGeometry args={[1, 32, 20]} />
    </mesh>
  )
}

/**
 * The atmosphere every view renders: distant dust, and a glow at the horizon.
 *
 * Both layers sit under the scene's fog and behind its geometry, so they add
 * depth to an otherwise empty background without competing with the data on
 * top of it. Together they cost two draw calls.
 * @param props - The scene's fog range, which places both layers.
 * @returns The atmosphere.
 */
export function Atmosphere({ near, far }: { near: number; far: number }): ReactNode {
  return (
    <>
      <HorizonGlow far={far} />
      <DustField near={near} far={far} />
    </>
  )
}
