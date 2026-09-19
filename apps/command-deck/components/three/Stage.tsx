'use client'

import { Canvas } from '@react-three/fiber'
import { Bloom, ChromaticAberration, EffectComposer, Vignette } from '@react-three/postprocessing'
import { BlendFunction } from 'postprocessing'
import { useMemo, type ReactNode } from 'react'
import { Vector2 } from 'three'
import { usePrefersReducedMotion } from '@/lib/motion'

/** Camera placement one stage asks for. */
export interface StageCamera {
  position: [number, number, number]
  fov: number
}

/**
 * The shared three.js stage: one canvas, one colour grade.
 *
 * Every view renders through the same composer so the three scenes read as one
 * instrument. Under `prefers-reduced-motion` the grade loses its chromatic
 * aberration and holds bloom at a lower constant intensity, because the effect
 * that sells the image at rest is also the one that shimmers.
 * @param props - Camera placement and the scene contents.
 * @returns The canvas.
 */
export function Stage({
  camera,
  children,
  fogNear = 120,
  fogFar = 420,
}: {
  camera: StageCamera
  children: ReactNode
  fogNear?: number
  fogFar?: number
}): ReactNode {
  const reduced = usePrefersReducedMotion()
  const aberration = useMemo(() => new Vector2(0.00055, 0.0009), [])

  return (
    <Canvas
      dpr={[1, 1.75]}
      gl={{ antialias: false, alpha: false, powerPreference: 'high-performance' }}
      camera={{ position: camera.position, fov: camera.fov, near: 0.5, far: 2_000 }}
      frameloop="always"
    >
      <color attach="background" args={['#04060b']} />
      <fog attach="fog" args={['#04060b', fogNear, fogFar]} />

      <ambientLight intensity={0.55} />
      <directionalLight position={[40, 90, 60]} intensity={0.9} color="#bcd6ff" />
      <directionalLight position={[-60, -30, -40]} intensity={0.35} color="#7b6bff" />

      {children}

      <EffectComposer multisampling={0} enableNormalPass={false}>
        <Bloom
          intensity={reduced ? 0.7 : 1.35}
          luminanceThreshold={0.1}
          luminanceSmoothing={0.42}
          mipmapBlur
          radius={0.78}
        />
        {reduced ? <></> : (
          <ChromaticAberration
            blendFunction={BlendFunction.NORMAL}
            offset={aberration}
            radialModulation
            modulationOffset={0.35}
          />
        )}
        <Vignette offset={0.2} darkness={0.82} eskil={false} blendFunction={BlendFunction.NORMAL} />
      </EffectComposer>
    </Canvas>
  )
}
