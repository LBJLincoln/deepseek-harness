/**
 * The deck's single client store.
 *
 * Two kinds of state live here. React state (roster, runs, events, selection)
 * drives rendering. Frame state — `activity` and `bursts` — is mutated in
 * place and read from `useFrame`, because a sixty-times-a-second render pass
 * must not go through React at all.
 */

'use client'

import { create } from 'zustand'
import type { Roster, Run, RunEvent, SafetyReview } from './contract.ts'
import { getRoster, getRuns, getSafety, resolveFeed, type FeedSource } from './feed.ts'
import { subscribeRun, type StreamState } from './stream.ts'

/** How many events one run keeps in memory; older frames fall off the head. */
const EVENT_WINDOW = 4_000

/** A certificate burst waiting to be drawn once, then dropped. */
export interface Burst {
  agentId: string
  at: number
}

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
  /** Timeline position as a sequence number; `undefined` follows the head. */
  cursor: number | undefined
  /** Last activity timestamp per agent, in `performance.now()` milliseconds. */
  activity: Map<string, number>
  /** Certificate bursts the enterprise scene has not drawn yet. */
  bursts: Burst[]
  boot: () => Promise<void>
  selectRun: (id: string) => void
  selectAgent: (id: string | undefined) => void
  selectFinding: (id: string | undefined) => void
  setCursor: (seq: number | undefined) => void
  loadSafety: (id: string) => Promise<void>
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
  },

  selectRun: (id) => {
    const source = get().source
    if (source === undefined || get().selectedRunId === id) return
    unsubscribe?.()
    set({ selectedRunId: id, events: [], cursor: undefined })
    const { activity } = get()
    activity.clear()
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
  setCursor: seq => set({ cursor: seq }),

  loadSafety: async (id) => {
    const source = get().source
    if (source === undefined || get().safetyRunId === id) return
    try {
      // No finding is preselected: the view opens on the whole city, and the
      // camera only flies in once a reviewer picks one.
      const safety = await getSafety(source.base, id)
      set({ safety, safetyRunId: id, selectedFindingId: undefined })
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
    }
  },
}))

/**
 * The events the timeline currently admits.
 * @param events - The full window.
 * @param cursor - Sequence cap, or `undefined` to follow the head.
 * @returns Events up to and including the cursor.
 */
export function eventsUpTo(events: readonly RunEvent[], cursor: number | undefined): RunEvent[] {
  if (cursor === undefined) return [...events]
  return events.filter(event => event.seq <= cursor)
}
