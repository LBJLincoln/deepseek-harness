'use client'

/**
 * The three grades the shared stage steps between, and the ladder that picks one.
 *
 * Bloom and the device pixel ratio are the deck's frame cost, and SMAA is the
 * single most expensive pass on a scene made of thin rails and wires, so those
 * three are what a tier trades. Everything else — the tone map, the grain, the
 * vignette, the atmosphere — is the same picture at every tier, because a deck
 * that changes its look under load is a deck the room notices adapting.
 */

import { useCallback, useRef } from 'react'
import { useDeck, type QualityTier } from '@/deck/store'

/** What one tier costs the frame. */
export interface QualityGrade {
  /** Upper bound on the canvas device pixel ratio. */
  dpr: number
  /** Whether the graded image is resolved through SMAA. */
  smaa: boolean
  /** Bloom intensity. */
  bloom: number
  /** Bloom blur radius. */
  radius: number
}

/**
 * The grade each tier renders at.
 *
 * `medium` keeps every pass and takes a fifth off the pixel ratio, the bloom
 * intensity and its radius; `low` drops SMAA, which is the step that buys the
 * most frame time, and holds the bloom low enough that an unresolved edge does
 * not bloom into a smear.
 */
export const QUALITY: Record<QualityTier, QualityGrade> = {
  high: { dpr: 1.75, smaa: true, bloom: 1.35, radius: 0.78 },
  medium: { dpr: 1.25, smaa: true, bloom: 1.08, radius: 0.62 },
  low: { dpr: 1, smaa: false, bloom: 0.8, radius: 0.62 },
}

/**
 * The grade `prefers-reduced-motion: reduce` holds, whatever the tier.
 *
 * The reduced grade is an accessibility floor rather than a performance one, so
 * the monitor still steps the pixel ratio underneath it but never brightens the
 * bloom back up or drops the pass that keeps a still image clean.
 */
export const REDUCED_QUALITY: Omit<QualityGrade, 'dpr'> = { smaa: true, bloom: 0.7, radius: 0.78 }

/** The tiers from cheapest to richest; a step is one place along this list. */
const LADDER: readonly QualityTier[] = ['low', 'medium', 'high']

/**
 * The frames per second a tier is expected to hold, and the rate above which it
 * may climb.
 *
 * Measured against the fastest rate the monitor has seen rather than a declared
 * refresh rate, because a browser that never reaches its panel's rate would
 * otherwise read every tier as a failure.
 * @param refreshrate - The highest rate sampled so far.
 * @returns The lower bound a tier must hold and the upper bound a climb needs.
 */
export function qualityBounds(refreshrate: number): [lower: number, upper: number] {
  return refreshrate > 90 ? [70, 100] : [45, 56]
}

/** Consecutive declines before the grade steps down. */
const DOWN_STRIKES = 2

/** Consecutive inclines before it steps back up: a climb has to be earned twice over. */
const UP_STRIKES = 4

/** How long a tier holds after a change, so the composer's own rebuild never counts as evidence. */
const HOLD_MS = 5_000

/** Steps down after which the tier reached becomes the ceiling and the grade stops climbing. */
const RATCHET = 2

/** What the monitor calls when the frame rate leaves its bounds. */
export interface QualityLadder {
  onDecline: () => void
  onIncline: () => void
}

/**
 * Move the tier on sustained evidence, and never on a single sample.
 *
 * A drop needs {@link DOWN_STRIKES} declines in a row and a climb
 * {@link UP_STRIKES} inclines, either run broken by one signal the other way;
 * a tier then holds for {@link HOLD_MS} whatever arrives. After
 * {@link RATCHET} drops the tier reached becomes the ceiling, so a laptop that
 * cannot hold the richer grade is never walked back into it — which is the
 * difference between adapting once and flickering all afternoon.
 * @returns The two handlers the performance monitor is given.
 */
export function useQualityLadder(): QualityLadder {
  const setTier = useDeck(state => state.setQualityTier)
  const gate = useRef({ strikes: 0, changedAt: 0, drops: 0, ceiling: LADDER.length - 1 })

  const step = useCallback((direction: 1 | -1, needed: number): void => {
    const now = performance.now()
    const state = gate.current
    // A run of one kind cancels the other, so an unsteady frame rate never adds
    // up to a change from two signals pointing opposite ways.
    state.strikes = Math.sign(state.strikes) === direction ? state.strikes + direction : direction
    if (Math.abs(state.strikes) < needed || now - state.changedAt < HOLD_MS) return

    const current = LADDER.indexOf(useDeck.getState().qualityTier)
    const wanted = Math.min(state.ceiling, Math.max(0, current + direction))
    const next = LADDER[wanted]
    state.strikes = 0
    if (next === undefined || wanted === current) return

    state.changedAt = now
    if (direction === -1) {
      state.drops += 1
      if (state.drops >= RATCHET) state.ceiling = wanted
    }
    setTier(next)
  }, [setTier])

  const onDecline = useCallback(() => step(-1, DOWN_STRIKES), [step])
  const onIncline = useCallback(() => step(1, UP_STRIKES), [step])

  return { onDecline, onIncline }
}

/**
 * The tier a `?quality=` query pins.
 *
 * The demo laptop is pinned after a rehearsal rather than left to discover its
 * own tier in front of the room.
 * @param search - The document's query string, leading `?` included.
 * @returns The named tier, or `undefined` when the query names none.
 */
export function pinnedQuality(search: string): QualityTier | undefined {
  const asked = new URLSearchParams(search).get('quality')
  if (asked === 'high' || asked === 'medium' || asked === 'low') return asked
  return undefined
}
