'use client'

import type { ReactNode } from 'react'
import { outcomePhrases, workPhrase } from '@/components/enterprise/evidence'
import { stamp } from '@/deck/format'
import { usePrefersReducedMotion } from '@/deck/motion'
import { useDeck } from '@/deck/store'
import { kinetic } from './kinetic.tsx'
import { useOpening } from './useOpening.ts'

/**
 * Compose the claim from what the deck has actually read: what the enterprise
 * delivered in the roster's 24-hour window, named by the window's end; before
 * the published report arrives, the seats, the active ones split by what they
 * did, which the header keeps showing beside it.
 *
 * Each fact is counted from a payload that has arrived, and a fact the deck
 * does not yet hold is left out rather than filled in, so the first line a
 * client sees claims nothing the room could not check.
 * @returns The claim, which is empty until the roster or the report lands.
 */
function useClaim(): string {
  const roster = useDeck(state => state.roster)
  const report = useDeck(state => state.enterprise)

  if (report?.outcomes !== undefined) return `In the 24 h to ${stamp(report.window.until)} UTC: ${outcomePhrases(report.outcomes).join(' · ')}`
  if (roster === undefined) return ''
  const split = roster.counts.work === undefined ? '' : workPhrase(roster.counts.work.active)
  return `${roster.counts.defined} seats defined · ${roster.counts.occupied} with recorded work${split === '' ? '' : ` · active: ${split}`}`
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
