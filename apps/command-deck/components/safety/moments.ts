/**
 * When the Safety view plays its two set pieces.
 *
 * Both are transitions, never states: the launch sequence plays for a review
 * that starts while the deck is watching, and the verdict plays when a review
 * the deck has already seen unfinished reaches its certificate. A review that
 * is loaded in its final state — the recorded reviews, and anything reopened
 * later — plays neither, because nothing happened while anyone was watching.
 *
 * The run ids already played are held per module rather than per component, so
 * leaving the view and coming back, or the tour walking through it, does not
 * replay a moment.
 */

'use client'

import { useEffect, useRef, useState } from 'react'
import type { Run, SafetyReview } from '@/deck/contract'
import { useDeck } from '@/deck/store'

/** How long the launch sequence holds the frame. */
export const LAUNCH_MS = 8_000

/** How long the verdict holds the frame. */
export const VERDICT_MS = 10_000

/** How recently a review must have started for its launch sequence to play. */
const FRESH_MS = 90_000

/** What the certificate said, once the review ended. */
export type VerdictKind = 'certified' | 'uncertified'

/** The set piece the view is playing, if any. */
export interface SafetyMoments {
  /** The six departments are igniting. */
  launch: boolean
  /** The certificate has just landed. */
  verdict: VerdictKind | undefined
}

/** Run ids whose launch sequence has played in this session. */
const launched = new Set<string>()

/** Run ids whose verdict has played in this session. */
const announced = new Set<string>()

/** The certificate state each run was last seen in; the verdict plays on a change from it. */
const seen = new Map<string, { verified: boolean; ended: boolean }>()

/**
 * Whether a review that has just been loaded is one the deck saw start.
 * @param run - The run entry the feed lists for it.
 * @param review - The loaded review.
 * @returns `true` when the run is still running, every department is still
 * pending, and it started inside {@link FRESH_MS}.
 */
function justStarted(run: Run | undefined, review: SafetyReview): boolean {
  if (run?.status !== 'running' || review.departments.length === 0) return false
  if (!review.departments.every(entry => entry.status === 'pending')) return false
  return Date.now() - Date.parse(run.startedAt) <= FRESH_MS
}

/**
 * Read one review's detail once more, on the refresh that first reports its run
 * as no longer running.
 *
 * `DeckState.refresh` re-reads a code-safety review only while the run list
 * still calls it running, so the last read it makes is up to one refresh
 * interval older than the certificate the examiner writes at the end. Without
 * this read the deck can hold a finished review's last running snapshot, and
 * the verdict it never sees cannot play.
 * @param runId - The followed review's run id.
 * @param run - The run entry the feed lists for it.
 */
function useFinalRead(runId: string | undefined, run: Run | undefined): void {
  const done = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (runId === undefined || run === undefined || run.status === 'running') return
    if (done.current === runId) return
    done.current = runId
    void useDeck.getState().loadSafety(runId, true)
  }, [runId, run])
}

/**
 * The set pieces the Safety view should be playing.
 * @param runId - The followed review's run id.
 * @param run - The run entry the feed lists for it, when it lists one.
 * @param review - The loaded review, once it has arrived.
 * @returns Which moment is playing; both are cleared when their time is up.
 */
export function useSafetyMoments(
  runId: string | undefined,
  run: Run | undefined,
  review: SafetyReview | undefined,
): SafetyMoments {
  const [launch, setLaunch] = useState(false)
  const [verdict, setVerdict] = useState<VerdictKind | undefined>(undefined)

  const verified = review?.certificate.verified ?? false
  const ended = review !== undefined && !review.departments.some(entry => entry.status === 'pending')

  useFinalRead(runId, run)

  useEffect(() => {
    if (runId === undefined || review === undefined || launched.has(runId)) return
    launched.add(runId)
    if (justStarted(run, review)) setLaunch(true)
  }, [runId, run, review])

  useEffect(() => {
    if (runId === undefined || review === undefined) return
    const before = seen.get(runId)
    seen.set(runId, { verified, ended })
    if (before === undefined || announced.has(runId)) return
    const kind: VerdictKind | undefined = !before.verified && verified
      ? 'certified'
      : !before.ended && ended && !verified ? 'uncertified' : undefined
    if (kind === undefined) return
    announced.add(runId)
    setVerdict(kind)
  }, [runId, review, verified, ended])

  useEffect(() => {
    if (!launch) return
    const timer = setTimeout(() => setLaunch(false), LAUNCH_MS)
    return () => clearTimeout(timer)
  }, [launch])

  useEffect(() => {
    if (verdict === undefined) return
    const timer = setTimeout(() => setVerdict(undefined), VERDICT_MS)
    return () => clearTimeout(timer)
  }, [verdict])

  return { launch, verdict }
}
