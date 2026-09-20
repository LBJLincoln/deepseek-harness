'use client'

import { useEffect, useState } from 'react'
import { usePrefersReducedMotion } from '@/deck/motion'
import { useDeck } from '@/deck/store'
import {
  DISSOLVE_MS,
  OPENING_MS,
  openingBeat,
  openingReveal,
  REDUCED_OPENING_MS,
  type OpeningBeat,
} from './opening.ts'

/**
 * The cold open's driver.
 *
 * It walks the clock in `requestAnimationFrame` and writes the reveal onto the
 * store's frame state, which the enterprise layers read from `useFrame`: the
 * graph assembles without a single React render per frame. Only the card's beat
 * is React state, and it changes three times in eighteen seconds.
 *
 * A sequence that ends early — any key, any click — is not cut: the card leaves
 * on the same dissolve it would have had, over a graph the store has already
 * taken to whole.
 * @returns The beat the claim card is on, or `undefined` when no card is up.
 */
export function useOpening(): OpeningBeat | undefined {
  const reduced = usePrefersReducedMotion()
  const opening = useDeck(state => state.opening)
  const openingAt = useDeck(state => state.openingAt)
  const frame = useDeck(state => state.openingFrame)
  const endOpening = useDeck(state => state.endOpening)
  const [beat, setBeat] = useState<OpeningBeat | undefined>(undefined)

  useEffect(() => {
    if (opening === 'idle') return
    if (opening === 'done' || openingAt === undefined) {
      setBeat('out')
      const timer = setTimeout(() => setBeat(undefined), DISSOLVE_MS)
      return () => clearTimeout(timer)
    }

    const total = reduced ? REDUCED_OPENING_MS : OPENING_MS
    let raf = 0
    let shown: OpeningBeat | undefined
    const tick = (): void => {
      const elapsed = performance.now() - openingAt
      // Reduced motion opens on a graph already at rest, so the reveal is left
      // where `startOpening` put it rather than walked up from dark.
      if (!reduced) frame.reveal = openingReveal(elapsed)
      const next = openingBeat(elapsed, reduced)
      if (next !== shown) {
        shown = next
        setBeat(next)
      }
      if (elapsed >= total) {
        endOpening()
        return
      }
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [endOpening, frame, opening, openingAt, reduced])

  return beat
}
