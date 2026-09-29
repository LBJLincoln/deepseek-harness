'use client'

import type { ReactNode } from 'react'
import { DeckError } from '@/components/shell/DeckError'

/**
 * What a route shows when its view throws during rendering.
 *
 * Next mounts this file's boundary inside the root layout, so the shell's
 * header, navigation and footer stay on screen and only the view is replaced.
 * A stage's own failures stop earlier, at its `WebGLGate`, which keeps the
 * panel as well.
 * @param props - The error, and the reset that renders the view again.
 * @returns The deck's error screen in place of the view.
 */
export default function ViewError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }): ReactNode {
  return <DeckError error={error} scope="view" onRetry={reset} />
}
