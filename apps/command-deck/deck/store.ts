/**
 * The deck's single client store.
 *
 * Two kinds of state live here. React state (roster, runs, events, selection)
 * drives rendering. Frame state — `activity`, `bursts` and `openingFrame` — is
 * mutated in place and read from `useFrame`, because a sixty-times-a-second
 * render pass must not go through React at all.
 */

'use client'

import { create } from 'zustand'
import type { Roster, Run, RunEvent, SafetyReview } from './contract.ts'
import { getRoster, getRuns, getSafety, resolveFeed, type FeedSource } from './feed.ts'
import { subscribeRun, type StreamState } from './stream.ts'

/** How many events one run keeps in memory; older frames fall off the head. */
const EVENT_WINDOW = 4_000

/** How often a live deck re-reads the run list and a running review's detail. */
const REFRESH_MS = 10_000

/** A certificate burst waiting to be drawn once, then dropped. */
interface Burst {
  agentId: string
  at: number
}

/**
 * How the deck is being shown.
 *
 * `off` is the working deck: header, stage and panel. `focus` hides the panel
 * and gives the stage the whole frame. `tour` is `focus` plus a timer that
 * walks the three views, announcing each one; anything the viewer does ends it.
 */
type PresentationMode = 'off' | 'focus' | 'tour'

/**
 * How far the cold open has got.
 *
 * It runs at most once per page load: `idle` is a deck that has not opened,
 * `playing` the sequence itself, and `done` a deck that has already assembled,
 * which is why a second tour starts on its first view instead of replaying it.
 */
type OpeningPhase = 'idle' | 'playing' | 'done'

/**
 * Frame state the cold open drives.
 *
 * `reveal` walks from 0, with the graph dark, to 1, with every division lit.
 * The enterprise layers read it from `useFrame` and turn it into per-division
 * progress; nothing renders on it, so the sequence costs no React work.
 */
interface OpeningFrame {
  reveal: number
}

/**
 * The grade the shared stage renders at.
 *
 * The three tiers trade image for frame time: pixel ratio, the antialiasing
 * pass and the bloom are what a weak GPU cannot afford.
 */
export type QualityTier = 'high' | 'medium' | 'low'

/** Everything the deck holds for one session. */
export interface DeckState {
  source: FeedSource | undefined
  streamState: StreamState
  roster: Roster | undefined
  runs: Run[]
  selectedRunId: string | undefined
  events: RunEvent[]
  safety: SafetyReview | undefined
  safetyRunId: string | undefined
  selectedAgentId: string | undefined
  selectedFindingId: string | undefined
  error: string | undefined
  booted: boolean
  /** Timeline position as an epoch-millisecond cap; `undefined` follows the head. */
  cursor: number | undefined
  /** Last activity timestamp per agent, in `performance.now()` milliseconds. */
  activity: Map<string, number>
  /** Certificate bursts the enterprise scene has not drawn yet. */
  bursts: Burst[]
  /** How the deck is being shown; presentation only, no effect on what is read. */
  presentation: PresentationMode
  /** How far the cold open has got; it runs at most once per page load. */
  opening: OpeningPhase
  /** `performance.now()` at which the running sequence started, or `undefined` outside one. */
  openingAt: number | undefined
  /** The cold open's frame state, mutated in place and read from `useFrame`. */
  openingFrame: OpeningFrame
  /** The grade the stage renders at, kept across a view change so a learned tier is not relearned. */
  qualityTier: QualityTier
  /** Whether a `?quality=` query pinned the tier, which also stops the performance monitor. */
  qualityPinned: boolean
  boot: () => Promise<void>
  selectRun: (id: string) => void
  /** List a run the feed does not report yet, such as a review this deck just started. */
  addRun: (run: Run) => void
  /** Re-read the run list and, while the followed review is still running, its detail. */
  refresh: () => Promise<void>
  selectAgent: (id: string | undefined) => void
  selectFinding: (id: string | undefined) => void
  setCursor: (atMs: number | undefined) => void
  /** Load a review's detail; `force` re-reads one already loaded. */
  loadSafety: (id: string, force?: boolean) => Promise<void>
  setPresentation: (mode: PresentationMode) => void
  /** Enter one presentation mode, or leave it when it is already the current one. */
  togglePresentation: (mode: Exclude<PresentationMode, 'off'>) => void
  /**
   * Start the cold open, unless it has already run.
   * @param ignite - Whether the graph assembles; `false` holds it at rest, for reduced motion.
   * @returns Whether this call started the sequence.
   */
  startOpening: (ignite: boolean) => boolean
  /** End the sequence at once, leaving the graph whole rather than half lit. */
  endOpening: () => void
  setQualityTier: (tier: QualityTier) => void
  /** Fix the tier a `?quality=` query named, which the performance monitor then never moves. */
  pinQualityTier: (tier: QualityTier) => void
}

let unsubscribe: (() => void) | undefined

/**
 * Append one event to the window, dropping the oldest frames past the cap.
 * @param events - The current window.
 * @param event - The frame to append.
 * @returns The new window.
 */
function appendEvent(events: RunEvent[], event: RunEvent): RunEvent[] {
  const next = [...events, event]
  return next.length > EVENT_WINDOW ? next.slice(next.length - EVENT_WINDOW) : next
}

export const useDeck = create<DeckState>((set, get) => ({
  source: undefined,
  streamState: 'idle',
  roster: undefined,
  runs: [],
  selectedRunId: undefined,
  events: [],
  safety: undefined,
  safetyRunId: undefined,
  selectedAgentId: undefined,
  selectedFindingId: undefined,
  error: undefined,
  booted: false,
  cursor: undefined,
  activity: new Map<string, number>(),
  bursts: [],
  presentation: 'off',
  opening: 'idle',
  openingAt: undefined,
  openingFrame: { reveal: 1 },
  qualityTier: 'high',
  qualityPinned: false,

  boot: async () => {
    if (get().booted) return
    set({ booted: true })
    const source = await resolveFeed()
    set({ source })
    try {
      const [roster, runs] = await Promise.all([getRoster(source.base), getRuns(source.base)])
      set({ roster, runs })
      const safetyRun = runs.find(run => run.kind === 'code-safety') ?? runs[0]
      if (safetyRun !== undefined) get().selectRun(safetyRun.id)
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
    }
    // Replay is a fixed record; only a live feed changes underneath the deck.
    if (source.mode === 'live') setInterval(() => { void get().refresh() }, REFRESH_MS)
  },

  addRun: (run) => {
    set(state => (state.runs.some(entry => entry.id === run.id) ? {} : { runs: [run, ...state.runs] }))
  },

  refresh: async () => {
    const { source, runs: known, selectedRunId } = get()
    if (source === undefined) return
    try {
      const listed = await getRuns(source.base)
      // A review this deck started stays listed until the feed reports it.
      const pending = known.filter(run => !listed.some(entry => entry.id === run.id))
      set({ runs: [...pending, ...listed] })
      const selected = [...pending, ...listed].find(run => run.id === selectedRunId)
      // The refresh that first reports a review as no longer running re-reads it
      // once more: the certificate lands after the last read made while it ran,
      // and a deck that stopped reading at that moment would never show it.
      const wasRunning = known.find(run => run.id === selectedRunId)?.status === 'running'
      if (
        selected?.kind === 'code-safety'
        && (selected.status === 'running' || wasRunning || get().safetyRunId !== selected.id)
      ) {
        await get().loadSafety(selected.id, true)
      }
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
    }
  },

  selectRun: (id) => {
    const source = get().source
    if (source === undefined || get().selectedRunId === id) return
    unsubscribe?.()
    set({ selectedRunId: id, events: [], cursor: undefined })
    const { activity, bursts } = get()
    activity.clear()
    // A certificate queued under the previous run must not burst on this one.
    bursts.length = 0
    unsubscribe = subscribeRun(source.base, id, {
      onState: state => set({ streamState: state }),
      onEvent: (event) => {
        get().activity.set(event.agentId, performance.now())
        if (event.kind === 'certificate') {
          get().bursts.push({ agentId: event.agentId, at: performance.now() })
        }
        set(state => ({ events: appendEvent(state.events, event) }))
      },
    })
    const run = get().runs.find(entry => entry.id === id)
    if (run?.kind === 'code-safety') void get().loadSafety(id)
  },

  selectAgent: id => set({ selectedAgentId: id }),
  selectFinding: id => set({ selectedFindingId: id }),
  setCursor: atMs => set({ cursor: atMs }),

  loadSafety: async (id, force = false) => {
    const source = get().source
    if (source === undefined || (!force && get().safetyRunId === id)) return
    try {
      // No finding is preselected: the view opens on the whole city, and the
      // camera only flies in once a reviewer picks one. A re-read keeps the
      // selection when the finding is still there.
      const safety = await getSafety(source.base, id)
      const selectedFindingId = get().selectedFindingId
      const kept = force && safety.findings.some(finding => finding.id === selectedFindingId) ? selectedFindingId : undefined
      set({ safety, safetyRunId: id, selectedFindingId: kept, error: undefined })
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
    }
  },

  setPresentation: mode => set({ presentation: mode }),
  togglePresentation: mode => set(state => ({
    presentation: state.presentation === mode ? 'off' : mode,
  })),

  startOpening: (ignite) => {
    if (get().opening !== 'idle') return false
    get().openingFrame.reveal = ignite ? 0 : 1
    set({ opening: 'playing', openingAt: performance.now() })
    return true
  },

  endOpening: () => {
    if (get().opening !== 'playing') return
    // A sequence cut short leaves the graph whole: the reveal is taken to its
    // end here rather than wherever the viewer interrupted it.
    get().openingFrame.reveal = 1
    set({ opening: 'done', openingAt: undefined })
  },

  setQualityTier: tier => set({ qualityTier: tier }),
  pinQualityTier: tier => set({ qualityTier: tier, qualityPinned: true }),
}))

/**
 * When one frame was logged.
 *
 * `seq` restarts at the head of every session the feed folds, so it orders one
 * session's own work and nothing across sessions; `ts`, epoch milliseconds, is
 * the only field that orders a whole run, and this is the one place it is read.
 * @param event - The frame to place.
 * @returns Milliseconds since the epoch, or `NaN` when the field does not parse.
 */
export function eventTimeMs(event: RunEvent): number {
  return new Date(event.ts).getTime()
}

/**
 * The events the timeline currently admits.
 *
 * A frame whose timestamp does not parse is admitted rather than hidden: the
 * deck received it, so a cut of the run that dropped it would under-report what
 * the run produced.
 * @param events - The full window.
 * @param cursor - Epoch-millisecond cap, or `undefined` to follow the head.
 * @returns Events logged at or before the cursor.
 */
export function eventsUpTo(events: readonly RunEvent[], cursor: number | undefined): RunEvent[] {
  if (cursor === undefined) return [...events]
  return events.filter((event) => {
    const at = eventTimeMs(event)
    return Number.isNaN(at) || at <= cursor
  })
}
