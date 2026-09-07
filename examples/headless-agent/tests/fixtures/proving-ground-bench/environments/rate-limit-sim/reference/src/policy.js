/** The two limiter kinds, each keeping one state per key. */

/**
 * A token bucket. Tokens are held scaled by `per`, so a refill of `refill`
 * tokens every `per` ticks is exact integer arithmetic and no drift can build
 * up over a long replay.
 */
export class Bucket {
  /**
   * @param name - the policy's name, as a deny reports it.
   * @param capacity - tokens the bucket holds when full, at least 1.
   * @param refill - tokens added every `per` ticks.
   * @param per - the refill period in ticks, at least 1.
   */
  constructor(name, capacity, refill, per) {
    this.name = name
    this.capacity = capacity
    this.refill = refill
    this.per = per
    this.state = new Map()
  }

  /** Bring one key's bucket up to `tick`, creating it full when it is new. */
  advance(key, tick) {
    const known = this.state.get(key)
    if (known === undefined) {
      const fresh = { tokens: this.capacity * this.per, at: tick }
      this.state.set(key, fresh)
      return fresh
    }
    known.tokens = Math.min(this.capacity * this.per, known.tokens + this.refill * (tick - known.at))
    known.at = tick
    return known
  }

  /** Whether the key has a whole token at this tick. */
  allows(key, tick) {
    return this.advance(key, tick).tokens >= this.per
  }

  /** Spend one token, which the caller has confirmed is there. */
  take(key, tick) {
    this.advance(key, tick).tokens -= this.per
  }
}

/** A sliding window over the ticks of the requests it accepted. */
export class Window {
  /**
   * @param name - the policy's name, as a deny reports it.
   * @param limit - accepted requests allowed in any window, at least 0.
   * @param span - the window's width in ticks, at least 1.
   */
  constructor(name, limit, span) {
    this.name = name
    this.limit = limit
    this.span = span
    this.state = new Map()
  }

  /** Drop the accepted ticks that have fallen out of the window ending at `tick`. */
  advance(key, tick) {
    const known = this.state.get(key) ?? []
    const kept = known.filter(when => when > tick - this.span)
    this.state.set(key, kept)
    return kept
  }

  /** Whether the window ending at this tick still has room. */
  allows(key, tick) {
    return this.advance(key, tick).length < this.limit
  }

  /** Record one accepted request at this tick. */
  take(key, tick) {
    this.advance(key, tick).push(tick)
  }
}
