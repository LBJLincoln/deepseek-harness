'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { easeInOutCubic } from '@/deck/easing'
import { usePrefersReducedMotion } from '@/deck/motion'

/** How long a counter takes to travel from its old value to its new one. */
const ROLL_MS = 720

/**
 * Walk a number towards a new value over {@link ROLL_MS}.
 *
 * A counter that jumps is a number that changed; a counter that travels is a
 * number that is being watched, which on a boardroom screen is the difference
 * between a table and an instrument. Under `prefers-reduced-motion` the value
 * is taken whole, since the point of the tween is the motion.
 * @param value - The value to reach.
 * @param reduced - Whether the viewer asked for reduced motion.
 * @returns The value to draw this frame.
 */
function useRoll(value: number, reduced: boolean): number {
  const [shown, setShown] = useState(value)
  const from = useRef(value)

  useEffect(() => {
    if (reduced || from.current === value) {
      from.current = value
      setShown(value)
      return
    }
    const origin = from.current
    const start = performance.now()
    let frame = 0
    const tick = (now: number): void => {
      const progress = Math.min(1, (now - start) / ROLL_MS)
      const next = Math.round(origin + (value - origin) * easeInOutCubic(progress))
      from.current = next
      setShown(next)
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [value, reduced])

  return shown
}

/**
 * One header counter, which travels between values instead of cutting.
 * @param props - The value to show; `undefined` until the roster has loaded.
 * @returns The number.
 */
export function RollingNumber({ value }: { value: number | undefined }): ReactNode {
  const reduced = usePrefersReducedMotion()
  const rolled = useRoll(value ?? 0, reduced)

  if (value === undefined) return <>—</>
  return <span data-rolling={rolled !== value}>{rolled}</span>
}
