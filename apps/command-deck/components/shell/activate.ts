import type { KeyboardEvent } from 'react'

/**
 * The keyboard half of a clickable row: Enter or Space runs the row's action,
 * as a click does, so a row with `tabIndex={0}` works without a pointer.
 * @param action - What a click on the row does.
 * @returns An `onKeyDown` handler for the row.
 */
export function onActivate(action: () => void): (event: KeyboardEvent<HTMLElement>) => void {
  return (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    action()
  }
}
