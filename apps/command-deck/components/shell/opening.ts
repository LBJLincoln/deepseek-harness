/**
 * The cold open's clock.
 *
 * One module owns every mark, because the claim card, the header counters and
 * the enterprise reveal are three readings of the same sequence and must not
 * drift apart. The marks are absolute milliseconds from the key press, so a
 * beat lands where it was written whatever the frame rate.
 */

/** How long the claim holds over a black stage before the first division lights. */
const CLAIM_MS = 4_400

/** How long the divisions take to light, from the first node to the last edge threading in. */
const IGNITE_MS = 10_200

/** When the graph starts to assemble. */
const IGNITE_AT = CLAIM_MS

/** When every division is lit. */
const REVEAL_AT = IGNITE_AT + IGNITE_MS

/** How long the claim takes to dissolve off the lit graph. */
export const DISSOLVE_MS = 1_400

/** The claim starts to go before the last division has finished, so the two beats overlap. */
const DISSOLVE_AT = REVEAL_AT - 1_000

/**
 * The whole sequence, from the key press to the claim gone.
 *
 * The camera's own settling flight runs after this, so the deck is at work
 * about eighteen seconds after the key.
 */
export const OPENING_MS = DISSOLVE_AT + DISSOLVE_MS

/**
 * The sequence under `prefers-reduced-motion: reduce`: the claim card alone,
 * over a graph that is already whole.
 */
export const REDUCED_OPENING_MS = 4_000

/** How long the header counters take to climb from zero; they land as the last division lights. */
export const COUNTER_CLIMB_MS = REVEAL_AT

/**
 * What the claim card is doing.
 *
 * `black` is the stage behind the mark and the claim, `ignite` the same claim
 * over the assembling graph, and `out` the dissolve that leaves the deck.
 */
export type OpeningBeat = 'black' | 'ignite' | 'out'

/**
 * The beat at one point in the sequence.
 * @param elapsed - Milliseconds since the sequence started.
 * @param reduced - Whether the viewer asked for reduced motion, which has no ignition to sit over.
 * @returns The beat the card is on.
 */
export function openingBeat(elapsed: number, reduced: boolean): OpeningBeat {
  if (reduced) return elapsed < REDUCED_OPENING_MS ? 'black' : 'out'
  if (elapsed < IGNITE_AT) return 'black'
  if (elapsed < DISSOLVE_AT) return 'ignite'
  return 'out'
}

/**
 * How far the graph has assembled.
 * @param elapsed - Milliseconds since the sequence started.
 * @returns `0` with the graph dark, `1` with every division lit.
 */
export function openingReveal(elapsed: number): number {
  return Math.min(1, Math.max(0, (elapsed - IGNITE_AT) / IGNITE_MS))
}
