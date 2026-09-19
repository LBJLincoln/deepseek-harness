import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import { DeckShell } from '@/components/shell/DeckShell'
import './globals.css'

export const metadata: Metadata = {
  title: 'Command Deck — Daliesk',
  description: 'The Daliesk agent enterprise: 147 agents, the workflows between them, and code-safety review placed on the code.',
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
