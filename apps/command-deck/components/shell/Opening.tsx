'use client'

import type { ReactNode } from 'react'
import { usePrefersReducedMotion } from '@/deck/motion'
import { useDeck } from '@/deck/store'
import { kinetic } from './kinetic.tsx'
import { useOpening } from './useOpening.ts'

/**
 * Compose the claim from what the deck has actually read.
 *
 * Each fact is counted from a payload that has arrived, and a fact the deck
 * does not yet hold is left out rather than filled in, so the first line a
 * client sees claims nothing the room could not check.
 * @returns The claim, which is empty until the roster lands.
 */
function useClaim(): string {
  const roster = useDeck(state => state.roster)
  const runs = useDeck(state => state.runs)

  const facts: string[] = []
  if (roster !== undefined) {
    facts.push(`${roster.counts.defined} agents`)
    facts.push(`${roster.divisions.length} divisions`)
  }
  if (runs.length > 0) facts.push(`${runs.length} runs`)
  const certified = roster?.agents.filter(agent => agent.status === 'certified').length ?? 0
  if (certified > 0) facts.push(`${certified} certified today`)
  return facts.join(' · ')
}

/**
 * The cold open: the mark and one claim over a black stage, then the same claim
 * over the enterprise assembling itself, then nothing.
 *
 * The card carries the black: it is opaque for the first beat, thins to the
 * title cards' own gradient while the graph ignites behind it, and dissolves
 * off. Nothing here drives the graph — {@link useOpening} does that on the
 * store's frame state — so the card re-renders three times in the whole
 * sequence.
 * @returns The card, or nothing outside a sequence.
 */
export function Opening(): ReactNode {
  const reduced = usePrefersReducedMotion()
  const beat = useOpening()
  const claim = useClaim()

  if (beat === undefined) return null

  return (
    <div className="opening" data-beat={beat}>
      <div className="opening__inner">
        <div className="opening__mark">
          <b>Daliesk</b>
          <span>Command Deck</span>
        </div>
        {claim === '' ? null : (
          <h2 className="title-card__title opening__claim" key={claim}>
            {reduced ? claim : kinetic(claim)}
          </h2>
        )}
      </div>
    </div>
  )
}
