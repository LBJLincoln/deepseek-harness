import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import { DeckShell } from '@/components/shell/DeckShell'
import './globals.css'

/** Daliesk's one line of positioning, the same as the root README's first sentence. */
const POSITIONING = 'Daliesk is a pilot organisation of AI agents that changes a codebase through a ticket queue, '
  + 'has an independent reviewer approve each change before it ships, and records every step in its repository.'

export const metadata: Metadata = {
  title: 'Daliesk Command Deck',
  description: POSITIONING,
  applicationName: 'Daliesk Command Deck',
  openGraph: { title: 'Daliesk Command Deck', description: POSITIONING, siteName: 'Daliesk', type: 'website' },
}

export const viewport: Viewport = {
  themeColor: '#04060b',
  width: 'device-width',
  initialScale: 1,
}

/**
 * The application shell.
 *
 * A Server Component: the header, the footer and the document itself are
 * static, and only the parts that read the feed or touch three.js cross into
 * the client.
 * @param props - The routed page.
 * @returns The document.
 */
export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <html lang="en">
      <body>
        <DeckShell>{children}</DeckShell>
      </body>
    </html>
  )
}
