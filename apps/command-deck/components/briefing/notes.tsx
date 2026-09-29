import type { ReactNode } from 'react'
import { pathUrl } from './format.ts'
import type { Figure, Source } from './types.ts'

/** One source note: the label its citations print, and what it says. */
export interface Note {
  /** `3.2`: the section's number and the note's position in it. */
  label: string
  /** The anchor the citation links to. */
  anchor: string
  source: Source
  /** The reason, for a figure the builder could not compute. */
  unknown?: string
}

/**
 * The source notes of one section, numbered in the order the section cites
 * them. A section cites every figure in its body before it renders, so the
 * numbering is fixed by the code's order rather than by render timing; a source
 * cited twice keeps its first number.
 */
export class Notes {
  private readonly notes: Note[] = []

  /** @param section - the section's number. */
  constructor(private readonly section: string) {}

  /**
   * @param source - a figure's source, or a figure.
   * @returns the note for it.
   */
  cite(source: Source | Figure<unknown>): Note {
    const figure = 'source' in source ? source : undefined
    const origin = figure === undefined ? (source as Source) : figure.source
    const unknown = figure !== undefined && 'unknown' in figure && typeof figure.unknown === 'string' ? figure.unknown : undefined
    const key = JSON.stringify([origin, unknown])
    const existing = this.notes.find(note => JSON.stringify([note.source, note.unknown]) === key)
    if (existing !== undefined) return existing
    const index = this.notes.length + 1
    const note: Note = { label: `${this.section}.${index}`, anchor: `note-${this.section}-${index}`, source: origin, ...unknown === undefined ? {} : { unknown } }
    this.notes.push(note)
    return note
  }

  /** @returns the notes in citation order. */
  list(): Note[] {
    return [...this.notes]
  }
}

function SourceBody({ note, branch }: { note: Note; branch: string }): ReactNode {
  return (
    <>
      {note.unknown === undefined ? null : <span className="bf-note__unknown">Unknown: {note.unknown}. </span>}
      <span className="bf-note__computation">{note.source.computation}</span>{' '}
      <span className="bf-note__paths">
        {note.source.paths.map((path, index) => (
          <span key={path}>
            {index === 0 ? '' : ' · '}
            <a href={pathUrl(path, branch)}><code>{path}</code></a>
          </span>
        ))}
        {(note.source.urls ?? []).map(url => (
          <span key={url}> · <a href={url}>{url.replace(/^https:\/\//, '')}</a></span>
        ))}
      </span>
    </>
  )
}

/**
 * The source affordance on a figure: a superscript label that links to the
 * section's note and, on hover or keyboard focus, shows the note in place.
 * @param props - the note and the branch its paths link to.
 * @returns the citation.
 */
export function Cite({ note, branch }: { note: Note; branch: string }): ReactNode {
  return (
    <span className="bf-cite">
      <a href={`#${note.anchor}`} className="bf-cite__label" aria-describedby={`${note.anchor}-card`}>{note.label}</a>
      <span className="bf-cite__card" role="tooltip" id={`${note.anchor}-card`}>
        <span className="bf-cite__title">Source {note.label}</span>
        <SourceBody note={note} branch={branch} />
      </span>
    </span>
  )
}

/**
 * A section's source notes at its end: folded on screen behind a summary that
 * counts them, opened by a citation that links into them (the browser unfolds
 * a disclosure its fragment target is in) and opened for printing, so a printed
 * page carries every note.
 * @param props - the notes and the branch their paths link to.
 * @returns the list.
 */
export function SourceNotes({ notes, branch }: { notes: readonly Note[]; branch: string }): ReactNode {
  if (notes.length === 0) return null
  return (
    <details className="bf-notes" aria-label="Sources">
      <summary className="bf-notes__title">Sources · {notes.length} {notes.length === 1 ? 'note' : 'notes'}</summary>
      <ol className="bf-notes__list">
        {notes.map(note => (
          <li key={note.anchor} id={note.anchor} className="bf-note">
            <span className="bf-note__label">{note.label}</span>
            <span className="bf-note__body"><SourceBody note={note} branch={branch} /></span>
          </li>
        ))}
      </ol>
    </details>
  )
}
