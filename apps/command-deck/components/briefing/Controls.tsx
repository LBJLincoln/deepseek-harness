'use client'

import { useEffect, useState, type ReactNode } from 'react'

/** The viewer's theme choice, kept per browser; absent means the operating system's. */
const THEME_KEY = 'daliesk.briefing.theme'

type Theme = 'light' | 'dark'

function stored(): Theme | undefined {
  try {
    const value = window.localStorage.getItem(THEME_KEY)
    return value === 'light' || value === 'dark' ? value : undefined
  } catch {
    // Storage is refused in private windows and by blocked site data; the page then follows the system theme.
    return undefined
  }
}

function root(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-briefing]')
}

/**
 * The briefing's own controls: the light or dark theme (a choice the browser
 * remembers, the system's until one is made) and the print button, which
 * opens the browser's print dialog, where "Save as PDF" writes the paginated
 * A4 or Letter document the print stylesheet lays out.
 *
 * While the briefing is mounted it also holds back the deck's stage keys (the
 * view numbers, the cold open, focus, the tour): the briefing is a document,
 * and a stray key in front of a client must not navigate away from it. It
 * opens every folded source list before the page prints and folds back the
 * ones it opened afterwards, and a citation opens the list its note is in.
 * @returns the controls.
 */
export function Controls(): ReactNode {
  const [theme, setTheme] = useState<Theme | undefined>(undefined)

  useEffect(() => {
    const initial = stored()
    setTheme(initial ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'))
    const element = root()
    if (element !== null && initial !== undefined) element.dataset.theme = initial
  }, [])

  useEffect(() => {
    const guard = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target
      if (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return
      if (/^[1-9ofpg[\] ]$/i.test(event.key) || event.key === 'Escape') event.stopImmediatePropagation()
    }
    window.addEventListener('keydown', guard, { capture: true })
    return () => window.removeEventListener('keydown', guard, { capture: true })
  }, [])

  useEffect(() => {
    let opened: HTMLDetailsElement[] = []
    const open = (): void => {
      opened = [...document.querySelectorAll<HTMLDetailsElement>('[data-briefing] details.bf-notes:not([open])')]
      for (const details of opened) details.open = true
    }
    const restore = (): void => {
      for (const details of opened) details.open = false
      opened = []
    }
    const follow = (event: MouseEvent): void => {
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a.bf-cite__label') : null
      const id = link?.hash.slice(1)
      const details = id === undefined || id === '' ? null : document.getElementById(id)?.closest('details') ?? null
      if (details !== null) details.open = true
    }
    window.addEventListener('beforeprint', open)
    window.addEventListener('afterprint', restore)
    document.addEventListener('click', follow)
    return () => {
      window.removeEventListener('beforeprint', open)
      window.removeEventListener('afterprint', restore)
      document.removeEventListener('click', follow)
    }
  }, [])

  const toggle = (): void => {
    const element = root()
    const current: Theme = theme ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    const next: Theme = current === 'dark' ? 'light' : 'dark'
    setTheme(next)
    if (element !== null) element.dataset.theme = next
    try {
      window.localStorage.setItem(THEME_KEY, next)
    } catch {
      // The choice then lasts for this page view only; nothing else depends on it.
    }
  }

  return (
    <div className="bf-controls">
      <button type="button" className="bf-button" onClick={toggle} aria-label="Switch between light and dark">
        <svg aria-hidden="true" className="bf-button__icon" viewBox="0 0 16 16" width="14" height="14">
          <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 1.75a6.25 6.25 0 0 1 0 12.5z" fill="currentColor" />
        </svg>
        <span className="bf-button__text">{theme === 'dark' ? 'Dark' : theme === 'light' ? 'Light' : 'Theme'}</span>
      </button>
      <button type="button" className="bf-button bf-button--primary" onClick={() => window.print()}>
        Print or save as PDF
      </button>
    </div>
  )
}
