'use client'

import { useEffect, type ReactNode } from 'react'

/**
 * The deck's own error screen, in place of Next's "Application error" page:
 * what failed, a button that renders the failed part again, and one that
 * reloads the page. `app/error.tsx` shows it inside the shell, so the header
 * and its navigation stay; `app/global-error.tsx` shows it under a header of
 * its own when the shell itself failed.
 * @param props - What was thrown, which part of the deck it stopped, and the
 * reset Next hands the error file.
 * @returns The error screen.
 */
export function DeckError({
  error,
  scope,
  onRetry,
}: {
  error: Error & { digest?: string }
  scope: 'view' | 'deck'
  onRetry: () => void
}): ReactNode {
  useEffect(() => {
    console.error(scope === 'view' ? 'A deck view failed.' : 'The deck shell failed.', error)
  }, [error, scope])

  return (
    <div className="deck-error" role="alert">
      <div className="deck-error__card">
        <div className="panel__eyebrow">{scope === 'view' ? 'This view stopped' : 'The deck stopped'}</div>
        <h1 className="deck-error__title">Something on this page failed to render.</h1>
        <p className="deck-error__lead">
          {scope === 'view'
            ? 'The other views still work from the navigation above. Trying again renders this view from the data the deck already holds.'
            : 'Reloading the page starts the deck again, and each view in the navigation above opens on a fresh page.'}
        </p>
        <p className="deck-error__message">
          {error.message === '' ? 'No message was given.' : error.message}
          {error.digest === undefined ? '' : ` · ${error.digest}`}
        </p>
        <div className="deck-error__actions">
          <button type="button" className="btn" data-variant="primary" onClick={onRetry}>Try again</button>
          <button type="button" className="btn" onClick={() => window.location.reload()}>Reload the page</button>
        </div>
      </div>
    </div>
  )
}
