'use client'

import { PerformanceMonitor } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { Bloom, ChromaticAberration, EffectComposer, Noise, SMAA, Vignette } from '@react-three/postprocessing'
import { BlendFunction, EdgeDetectionMode, SMAAPreset, ToneMappingEffect, ToneMappingMode } from 'postprocessing'
import { useEffect, useMemo, type ReactNode } from 'react'
import { Vector2 } from 'three'
import { Atmosphere } from '@/components/three/Atmosphere'
import { pinnedQuality, qualityBounds, QUALITY, REDUCED_QUALITY, useQualityLadder } from '@/components/three/quality'
import { usePrefersReducedMotion } from '@/deck/motion'
import { useDeck } from '@/deck/store'

/** Camera placement one stage asks for. */
export interface StageCamera {
  position: [number, number, number]
  fov: number
}

/**
 * ACES film tone mapping, as its own effect rather than the renderer's.
 *
 * `EffectComposer` forces `NoToneMapping` on the renderer, so without this the
 * scene reaches the screen with its highlights clipped flat. Placed after
 * `Bloom`, it rolls off light the bloom has already spread, which is what makes
 * a bright core read as bright rather than as white.
 *
 * The wrapper component `@react-three/postprocessing` exports declares itself a
 * convolution effect, which would put it in a full-screen pass of its own; the
 * underlying effect is not one, so building it here keeps the whole grade —
 * bloom, tone map, grain, vignette — inside a single pass.
 * @returns The effect, disposed with the stage.
 */
function useToneMapping(): ToneMappingEffect {
  const effect = useMemo(
    () => new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }),
    [],
  )
  useEffect(() => () => effect.dispose(), [effect])
  return effect
}

/**
 * The shared three.js stage: one canvas, one colour grade.
 *
 * Every view renders through the same composer so the three scenes read as one
 * instrument, and every view gets the same {@link Atmosphere} behind it. The
 * grade is bloom, ACES tone mapping, film grain and a vignette in one pass,
 * then chromatic aberration, then SMAA — which carries the edges, since the
 * canvas asks for no multisampling.
 *
 * Under `prefers-reduced-motion` the grade loses its chromatic aberration,
 * halves the grain and holds bloom at a lower constant intensity, because the
 * effects that sell the image at rest are also the ones that shimmer.
 *
 * The pixel ratio, SMAA and the bloom are stepped between the three tiers in
 * {@link QUALITY} on sustained evidence from drei's performance monitor, so an
 * unknown laptop keeps its frame rate instead of its image. `?quality=` pins a
 * tier and stops the monitor; the reduced grade overrides everything but the
 * pixel ratio.
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
  const toneMapping = useToneMapping()
  const tier = useDeck(state => state.qualityTier)
  const pinned = useDeck(state => state.qualityPinned)
  const pinQualityTier = useDeck(state => state.pinQualityTier)
  const ladder = useQualityLadder()

  // The stage mounts only in the browser, through `next/dynamic` with
  // `ssr: false`, so the query is read from the location rather than through
  // `useSearchParams`, which would opt each route out of static rendering.
  useEffect(() => {
    const asked = pinnedQuality(window.location.search)
    if (asked !== undefined) pinQualityTier(asked)
  }, [pinQualityTier])

  const grade = QUALITY[tier]
  const bloom = reduced ? REDUCED_QUALITY.bloom : grade.bloom
  const radius = reduced ? REDUCED_QUALITY.radius : grade.radius
  const smaa = reduced ? REDUCED_QUALITY.smaa : grade.smaa

  return (
    <Canvas
      dpr={[1, grade.dpr]}
      gl={{ antialias: false, alpha: false, powerPreference: 'high-performance' }}
      camera={{ position: camera.position, fov: camera.fov, near: 0.5, far: 2_000 }}
      frameloop="always"
    >
      <color attach="background" args={['#04060b']} />
      <fog attach="fog" args={['#04060b', fogNear, fogFar]} />

      <ambientLight intensity={0.55} />
      <directionalLight position={[40, 90, 60]} intensity={0.9} color="#bcd6ff" />
      <directionalLight position={[-60, -30, -40]} intensity={0.35} color="#7b6bff" />

      <Atmosphere near={fogNear} far={fogFar} />
      {children}

      {pinned ? <></> : (
        <PerformanceMonitor bounds={qualityBounds} onDecline={ladder.onDecline} onIncline={ladder.onIncline} />
      )}

      {/*
        Order is pass layout as much as look: the composer opens a new
        full-screen pass at every convolution effect, so the four effects that
        merge are kept together and the two that cannot follow at the end.
      */}
      <EffectComposer multisampling={0} enableNormalPass={false}>
        <Bloom
          intensity={bloom}
          luminanceThreshold={0.1}
          luminanceSmoothing={0.42}
          mipmapBlur
          radius={radius}
        />
        <primitive object={toneMapping} dispose={null} />
        <Noise
          blendFunction={BlendFunction.OVERLAY}
          opacity={reduced ? 0.05 : 0.11}
          premultiply={false}
        />
        <Vignette offset={0.2} darkness={0.82} eskil={false} blendFunction={BlendFunction.NORMAL} />
        {reduced ? <></> : (
          <ChromaticAberration
            blendFunction={BlendFunction.NORMAL}
            offset={aberration}
            radialModulation
            modulationOffset={0.35}
          />
        )}
        {/*
          SMAA carries every edge in the deck, so it runs on the graded image
          and its cost is paid on every view. Luma edges over colour edges and
          the low preset over the medium one together halve the two search
          passes on a scene full of thin rails and wires, for a difference this
          deck's geometry does not show. It is also the pass the `low` tier
          gives up, because it is the one worth a whole tier of frame time.
        */}
        {smaa ? <SMAA preset={SMAAPreset.LOW} edgeDetectionMode={EdgeDetectionMode.LUMA} /> : <></>}
      </EffectComposer>
    </Canvas>
  )
}
