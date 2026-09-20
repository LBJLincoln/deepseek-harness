import type { CSSProperties, ReactNode } from 'react'

/**
 * Split a line into per-letter spans that arrive one after another.
 *
 * Words stay whole so the line still wraps on word breaks; only the letters
 * inside them are staggered. The stagger itself is CSS: each span carries its
 * place as `--i`, and `.title-card__char` turns that into a delay.
 * @param text - The line to set.
 * @returns The spans, each carrying its place in the stagger.
 */
export function kinetic(text: string): ReactNode {
  let letter = 0
  return text.split(' ').map((word, wordIndex) => (
    <span className="title-card__word" key={`${word}-${wordIndex}`}>
      {[...word].map((char, charIndex) => (
        <span
          className="title-card__char"
          key={charIndex}
          style={{ '--i': letter++ } as CSSProperties}
        >
          {char}
        </span>
      ))}
    </span>
  ))
}
