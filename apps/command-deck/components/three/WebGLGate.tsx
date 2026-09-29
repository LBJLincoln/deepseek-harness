'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { publicUrl } from '@/deck/public-url'
import { useDeck } from '@/deck/store'
import { useCoarsePointer } from './pointer.ts'
import { SceneBoundary, supportsWebGL2 } from './scene-boundary.ts'

/** Query parameter that asks every stage for its stand-in instead of the scene: `?flat`. */
const FLAT_PARAM = 'flat'

/**
 * Why a stage shows its stand-in instead of its scene: the address asked for
 * it, the browser offers no WebGL 2 context, or the scene threw after it mounted.
 */
type Stop =
  | { kind: 'asked' }
  | { kind: 'unsupported' }
  | { kind: 'failed'; message: string }

/**
 * The note's headline and sentence for one reason.
 * @param stop - Why the scene is not drawn.
 * @param standIn - What the stage shows instead: the view's flat drawing, or its still.
 * @returns The two lines the note prints.
 */
function noteFor(stop: Stop, standIn: 'flat' | 'still'): { title: string; body: string } {
  const shows = standIn === 'flat' ? 'draws the scene flat' : 'shows a still of the scene'
  switch (stop.kind) {
    case 'asked':
      return { title: 'The 3D scene is off.', body: `The address asks for it (?flat), so the view ${shows}. The panel has the full record.` }
    case 'unsupported':
      return { title: 'Interactive 3D is unavailable on this device.', body: `This browser offers no WebGL 2, so the view ${shows}. The panel has the full record.` }
    case 'failed':
      return { title: 'The 3D scene stopped.', body: `The scene failed (${stop.message.slice(0, 160)}), so the view ${shows}. The panel has the full record.` }
    default:
      return assertNever(stop)
  }
}

/**
 * Exhaustiveness guard for {@link Stop}.
 * @param value - A reason no case handled.
 * @returns Never; it throws.
 */
function assertNever(value: never): never {
  throw new Error(`unhandled stop ${JSON.stringify(value)}`)
}

/**
 * What stands in for a stage's scene, and the note that says why.
 * @param props - The view's flat drawing or the name of its still, what the
 * scene shows, why it stopped, and how to mount the scene again after a failure.
 * @returns The stand-in over the stage.
 */
function StandIn({
  flat,
  poster,
  label,
  stop,
  onRetry,
}: {
  flat: ReactNode
  poster: string | undefined
  label: string
  stop: Stop
  onRetry?: () => void
}): ReactNode {
  const note = noteFor(stop, flat === undefined ? 'still' : 'flat')
  return (
    <div className="gate" data-stop={stop.kind}>
      {flat ?? (poster === undefined ? null : (
        // A plain image: next/image needs the image optimiser, which a static export does not have.
        <img className="gate__poster" src={publicUrl(`posters/${poster}.jpg`)} alt={`A still of ${label}, rendered from the committed fixtures`} />
      ))}
      <div className="gate__note" role="status">
        <b>{note.title}</b>
        <span>{note.body}</span>
        {onRetry === undefined ? null : (
          <button type="button" className="btn" onClick={onRetry}>Reload the scene</button>
        )}
      </div>
    </div>
  )
}

/**
 * The touch screen's switch for a mounted scene: "Explore 3D" hands the
 * fingers to the stage's orbit controls, "Scroll the page" gives them back
 * (see `useOrbitGestures`). Leaving the view gives them back too. A mouse
 * needs no switch, so none is drawn for one.
 * @returns The switch on a touch screen, else nothing.
 */
function ExploreToggle(): ReactNode {
  const coarse = useCoarsePointer()
  const explore = useDeck(state => state.explore)
  const setExplore = useDeck(state => state.setExplore)
  useEffect(() => () => setExplore(false), [setExplore])
  if (!coarse) return null
  return (
    <button type="button" className="btn explore" aria-pressed={explore} onClick={() => setExplore(!explore)}>
      {explore ? 'Scroll the page' : 'Explore 3D'}
    </button>
  )
}

/**
 * The gate every stage mounts behind: the scene where the browser can draw it,
 * and a stand-in otherwise. It is the deck's one mechanism for a missing or
 * failed WebGL scene.
 *
 * On the first client render it reads `?flat` and probes for WebGL 2
 * ({@link supportsWebGL2}). When the address asks for it, or the browser
 * offers no WebGL 2, the scene and the three.js chunk it would load never
 * mount: the stage shows the view's stand-in, either `flat`, a drawing the
 * view makes from its own data, or the still at `public/posters/<poster>.jpg`,
 * under a note that says why and that the panel has the full record. Otherwise
 * the scene mounts inside a {@link SceneBoundary}: a scene that throws later,
 * including a canvas whose context the browser takes back (`Stage` raises
 * that), falls back to the same stand-in with a button that mounts the scene
 * again. The server render and the probe's own frame draw nothing here, since
 * neither can know the answer. Beside a mounted scene a touch screen gets the
 * "Explore 3D" switch.
 *
 * Every view's stage mounts behind this gate: the four scene views pass their
 * poster, and `/ops` passes its flat floor.
 * @param props - The view's flat drawing, or the name of its still under
 * `public/posters/` without its extension; a phrase naming what the scene
 * shows, for the still's alt text; and the scene.
 * @returns The scene, or its stand-in.
 */
export function WebGLGate({
  flat,
  poster,
  label,
  children,
}: {
  flat?: ReactNode
  poster?: string
  label: string
  children: ReactNode
}): ReactNode {
  const [stop, setStop] = useState<Stop | 'scene' | undefined>(undefined)
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has(FLAT_PARAM)) setStop({ kind: 'asked' })
    else setStop(supportsWebGL2() ? 'scene' : { kind: 'unsupported' })
  }, [])

  if (stop === undefined) return null
  if (stop !== 'scene') return <StandIn flat={flat} poster={poster} label={label} stop={stop} />
  return (
    <>
      <SceneBoundary
        fallback={(error, retry) => (
          <StandIn flat={flat} poster={poster} label={label} stop={{ kind: 'failed', message: error.message }} onRetry={retry} />
        )}
      >
        {children}
      </SceneBoundary>
      <ExploreToggle />
    </>
  )
}
