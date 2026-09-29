'use client'

import type { ReactNode } from 'react'
import { DeckError } from '@/components/shell/DeckError'
import { VIEWS } from '@/components/shell/views'
import { publicUrl } from '@/deck/public-url'
import './globals.css'

/**
 * What the deck shows when the shell itself throws.
 *
 * Next renders this file in place of the root layout, so it carries its own
 * document and a header with the deck's mark and navigation. The links are
 * plain anchors under the base path: a page load gives the next view a fresh
 * shell rather than the one that failed.
 * @param props - The error, and the reset that renders the layout again.
 * @returns The document.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }): ReactNode {
  return (
    <html lang="en">
      <body>
        <div className="deck" data-presentation="off" data-opening="idle">
          <header className="deck__header">
            <div className="deck__mark">
              <b>Daliesk</b>
              <span>Command Deck</span>
            </div>
            <nav className="deck__nav" aria-label="Views">
              {VIEWS.map(view => (
                <a key={view.href} href={publicUrl(view.href === '/' ? '' : `${view.href.slice(1)}/`)}>{view.label}</a>
              ))}
            </nav>
          </header>
          <main className="deck__main">
            <DeckError error={error} scope="deck" onRetry={reset} />
          </main>
          <footer className="deck__footer" />
        </div>
      </body>
    </html>
  )
}
