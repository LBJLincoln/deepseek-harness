'use client'

import type { ReactNode } from 'react'
import { PLAYBACK_SPEEDS, type Playback } from '@/deck/playback'
import styles from './workflow.module.css'

/**
 * A recorded duration, as the controls print it.
 * @param ms - The duration in milliseconds.
 * @returns `m:ss`, counting minutes past an hour rather than wrapping.
 */
function span(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/**
 * The transport for replaying the followed run against its own clock.
 *
 * It states what it is doing to the recording rather than to the screen: the
 * two times are the recorded span the cursor has passed and the span still
 * ahead of it, so a viewer can see that a twenty-minute review is being shown
 * in a minute. The same hook backs the keyboard, so the buttons and `Space`,
 * `[` and `]` cannot disagree.
 * @param props - The playback state and controls from `usePlayback`.
 * @returns The controls.
 */
export function PlaybackControls({ playback }: { playback: Playback }): ReactNode {
  const { playing, speed, elapsedMs, remainingMs, spanMs, atHead, ready } = playback

  return (
    <div className={styles.playback}>
      <button
        type="button"
        className="btn"
        data-variant={playing ? 'primary' : undefined}
        disabled={!ready}
        onClick={playback.toggle}
      >
        {playing ? 'Pause' : 'Play'}
      </button>
      <button type="button" className="btn" disabled={atHead && !playing} onClick={playback.stop}>
        Head
      </button>

      <div className={styles.speeds}>
        {PLAYBACK_SPEEDS.map(entry => (
          <button
            key={entry}
            type="button"
            data-active={entry === speed}
            onClick={() => playback.setSpeed(entry)}
            aria-label={`Play at ${entry} times recorded speed`}
          >
            {entry}×
          </button>
        ))}
      </div>

      {ready ? (
        <p className={styles.elapsed}>
          <b>{span(elapsedMs)}</b> of {span(spanMs)} recorded · <b>{span(remainingMs)}</b> left
          {playing ? ` · ${span(remainingMs / speed)} at ${speed}×` : ''}
        </p>
      ) : (
        <p className={styles.elapsed}>No recorded span on this run yet.</p>
      )}
    </div>
  )
}
