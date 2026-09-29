// @vitest-environment jsdom
/**
 * The probe and the boundary behind the gate every stage mounts in
 * (`components/three/scene-boundary.ts`, used by `WebGLGate.tsx`): whether the
 * browser offers WebGL 2, asked once per page load, and a scene that throws
 * held to the stage with a way to mount it again.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** A scene that draws a marker, or throws the way a renderer without a context does. */
const scene = { fail: false }
function Scene(): ReactNode {
  if (scene.fail) throw new Error('Error creating WebGL context.')
  return createElement('p', null, 'scene mounted')
}

/**
 * Load the module fresh, so its once-per-page probe starts unanswered.
 * @param webgl2 - What the browser hands out for `webgl2`: a context, nothing, or a thrown error.
 * @returns The module, the probe's spy and the context's release.
 */
async function load(webgl2: 'context' | 'null' | 'throws') {
  vi.resetModules()
  const loseContext = vi.fn()
  const context = { getExtension: () => ({ loseContext }) }
  const probe = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((kind: string) => {
    if (kind !== 'webgl2' || webgl2 === 'null') return null
    if (webgl2 === 'throws') throw new Error('blocked by policy')
    return context
  }) as unknown as HTMLCanvasElement['getContext'])
  return { module: await import('../components/three/scene-boundary.ts'), probe, loseContext }
}

/** React's development build reports a caught render error to the window too; the boundary is what the test reads. */
const quiet = (event: ErrorEvent): void => {
  event.preventDefault()
}

beforeEach(() => {
  scene.fail = false
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  window.addEventListener('error', quiet)
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.removeEventListener('error', quiet)
})

describe('supportsWebGL2', () => {
  it('answers from one probe per page load and releases the context it created', async () => {
    const { module, probe, loseContext } = await load('context')
    expect(module.supportsWebGL2()).toBe(true)
    expect(module.supportsWebGL2()).toBe(true)
    expect(probe).toHaveBeenCalledTimes(1)
    expect(loseContext).toHaveBeenCalledTimes(1)
  })

  it('answers false when the browser has no WebGL 2, or refuses by throwing', async () => {
    expect((await load('null')).module.supportsWebGL2()).toBe(false)
    expect((await load('throws')).module.supportsWebGL2()).toBe(false)
  })
})

describe('SceneBoundary', () => {
  it('replaces a scene that throws with the fallback, then mounts the scene again on retry', async () => {
    const { module } = await load('context')
    scene.fail = true
    const fallback = (error: Error, retry: () => void): ReactNode => createElement('button', { type: 'button', onClick: retry }, `stopped: ${error.message}`)
    await act(async () => { render(createElement(module.SceneBoundary, { fallback }, createElement(Scene))) })
    expect(screen.queryByText('scene mounted')).toBeNull()
    const retry = screen.getByRole('button', { name: 'stopped: Error creating WebGL context.' })
    scene.fail = false
    fireEvent.click(retry)
    expect(screen.getByText('scene mounted')).toBeTruthy()
  })
})
