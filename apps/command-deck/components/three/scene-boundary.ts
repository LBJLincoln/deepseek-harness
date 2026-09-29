'use client'

import { Component, type ErrorInfo, type ReactNode } from 'react'

/** The probe's answer, read once per page load; `undefined` until the first gate asks. */
let probed: boolean | undefined

/**
 * Whether this browser can create a WebGL 2 context.
 *
 * three r169 creates only WebGL 2 contexts, so a browser that offers WebGL 1
 * alone cannot draw the deck either. The probe releases the context it
 * created, because a page may hold only a few at once, and remembers its
 * answer for the rest of the page load.
 * @returns `true` when a stage can mount its canvas.
 */
export function supportsWebGL2(): boolean {
  if (probed !== undefined) return probed
  let context: WebGL2RenderingContext | null = null
  try {
    context = document.createElement('canvas').getContext('webgl2')
  } catch {
    // A hardened browser can throw here instead of answering null; either way the page has no context, which `probed` records.
  }
  probed = context !== null
  context?.getExtension('WEBGL_lose_context')?.loseContext()
  return probed
}

/** Props of {@link SceneBoundary}. */
interface SceneBoundaryProps {
  children: ReactNode
  /** What replaces the children once one of them has thrown; `retry` mounts them again. */
  fallback: (error: Error, retry: () => void) => ReactNode
}

/** State of {@link SceneBoundary}: the error that replaced the children, if any. */
interface SceneBoundaryState {
  error: Error | undefined
}

/**
 * A React error boundary around one stage.
 *
 * react-three-fiber rethrows every error raised inside its scene, and
 * `WebGLRenderer` throws from the canvas's layout effect when it cannot create
 * a context; without a boundary either reaches Next's root error screen and
 * takes the header and the panel with it. This boundary holds the failure to
 * the stage, so the rest of the view keeps working.
 */
export class SceneBoundary extends Component<SceneBoundaryProps, SceneBoundaryState> {
  override state: SceneBoundaryState = { error: undefined }

  /**
   * Record the error that replaces the children.
   * @param error - What a child threw; a non-`Error` value is wrapped.
   * @returns The boundary's next state.
   */
  static getDerivedStateFromError(error: unknown): SceneBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('A deck stage failed and shows its poster instead.', error, info.componentStack)
  }

  private readonly retry = (): void => {
    this.setState({ error: undefined })
  }

  override render(): ReactNode {
    return this.state.error === undefined ? this.props.children : this.props.fallback(this.state.error, this.retry)
  }
}
