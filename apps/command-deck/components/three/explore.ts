'use client'

import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import { useDeck } from '@/deck/store'
import { useCoarsePointer } from './pointer.ts'

/**
 * Whether a stage's orbit controls take the viewer's gestures.
 *
 * With a mouse they always do. On a touch screen they do only after the
 * viewer taps "Explore 3D": until then a swipe over the stage scrolls the page
 * and a tap still selects, because the stage fills most of a phone's first
 * screen. three's `OrbitControls` writes `touch-action: none` as an inline
 * style on the element it connects to, which no stylesheet can override, so
 * this hook writes `pan-y` there while the controls are off and `none` while
 * they are on. Call it in the component that renders the controls: its effect
 * then runs after theirs has connected.
 * @returns Whether the controls are enabled.
 */
export function useOrbitGestures(): boolean {
  const coarse = useCoarsePointer()
  const explore = useDeck(state => state.explore)
  const surface = useThree(state => (state.events.connected instanceof HTMLElement ? state.events.connected : state.gl.domElement))
  const enabled = !coarse || explore
  useEffect(() => {
    surface.style.touchAction = enabled ? 'none' : 'pan-y'
  }, [enabled, surface])
  return enabled
}
