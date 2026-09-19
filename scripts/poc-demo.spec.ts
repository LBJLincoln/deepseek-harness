import { describe, expect, it } from 'vitest'

import { parsePocArgs } from './poc-demo.ts'

describe('parsePocArgs', () => {
  it('defaults to the feed on 4711, the deck on 3000, and a fresh build', () => {
    expect(parsePocArgs([])).toEqual({ feedPort: 4711, deckPort: 3000, build: true })
  })

  it('serves an existing build only on the default feed port, because the feed URL is compiled into the deck', () => {
    expect(parsePocArgs(['--no-build'])).toEqual({ feedPort: 4711, deckPort: 3000, build: false })
    // pnpm forwards the `--` separator of `pnpm run poc -- --no-build` as an argument.
    expect(parsePocArgs(['--', '--no-build'])).toEqual({ feedPort: 4711, deckPort: 3000, build: false })
    expect(parsePocArgs(['--no-build', '--feed-port', '4712'])).toEqual({ feedPort: 4712, deckPort: 3000, build: true })
    expect(parsePocArgs(['--deck-port', '3010', '--no-build'])).toEqual({ feedPort: 4711, deckPort: 3010, build: false })
  })

  it('refuses an unknown argument and a port that is not a port', () => {
    expect(() => parsePocArgs(['--open'])).toThrow(/unknown argument "--open"/)
    expect(() => parsePocArgs(['--deck-port', 'eighty'])).toThrow(/--deck-port must be a port number/)
    expect(() => parsePocArgs(['--feed-port', '70000'])).toThrow(/--feed-port must be a port number/)
  })
})
