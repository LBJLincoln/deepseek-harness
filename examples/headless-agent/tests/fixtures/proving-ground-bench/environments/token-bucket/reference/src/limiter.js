/**
 * Token-bucket rate limiter with one bucket per key.
 *
 * A bucket holds at most `capacity` tokens and gains `refillTokens` every
 * `refillIntervalMs`, spread evenly over that interval rather than granted in
 * lumps, so time that does not add up to a whole interval is still credited.
 * Buckets are created full, which is what allows an initial burst, and time
 * comes from an injectable clock so callers can drive it exactly.
 */
export class RateLimiter {
  /** @type {Map<string, {tokens: number, updatedAt: number}>} */
  #buckets = new Map();
  #capacity;
  #refillTokens;
  #refillIntervalMs;
  #clock;
  /** @type {string | null} */
  #recentKey = null;
  /** @type {{tokens: number, updatedAt: number} | null} */
  #recentBucket = null;
  #allowed = 0;
  #denied = 0;

  /**
   * @param {object} options Limiter options.
   * @param {number} options.capacity Bucket size in tokens; a positive safe integer.
   * @param {number} options.refillTokens Tokens granted per interval; a positive safe integer.
   * @param {number} options.refillIntervalMs Length of the refill interval; a positive safe integer.
   * @param {() => number} [options.clock] Millisecond clock, `Date.now` by default.
   */
  constructor(options) {
    if (typeof options !== 'object' || options === null) throw new TypeError('options must be an object');
    const { capacity, refillTokens, refillIntervalMs, clock = Date.now } = options;
    checkPositiveInteger(capacity, 'capacity');
    checkPositiveInteger(refillTokens, 'refillTokens');
    checkPositiveInteger(refillIntervalMs, 'refillIntervalMs');
    if (typeof clock !== 'function') throw new TypeError('clock must be a function');
    this.#capacity = capacity;
    this.#refillTokens = refillTokens;
    this.#refillIntervalMs = refillIntervalMs;
    this.#clock = clock;
  }

  /** @returns {number} Bucket size in tokens. */
  get capacity() {
    return this.#capacity;
  }

  /** @returns {number} How many keys currently have a bucket. */
  get size() {
    return this.#buckets.size;
  }

  /**
   * Returns the bucket for a key, creating a full one when the key is new.
   *
   * The most recently used bucket is kept beside the map because callers
   * usually hit the same key several times in a row.
   * @param {string} key Bucket key.
   * @returns {{tokens: number, updatedAt: number}} The key's bucket.
   */
  #bucketFor(key) {
    if (this.#recentKey === key && this.#recentBucket !== null) return this.#recentBucket;
    let bucket = this.#buckets.get(key);
    if (bucket === undefined) {
      bucket = { tokens: this.#capacity, updatedAt: this.#clock() };
      this.#buckets.set(key, bucket);
    }
    this.#recentKey = key;
    this.#recentBucket = bucket;
    return bucket;
  }

  /**
   * Forgets the cached bucket.
   * @returns {void}
   */
  #forgetRecent() {
    this.#recentKey = null;
    this.#recentBucket = null;
  }

  /**
   * Credits the tokens earned since the bucket was last touched.
   *
   * A clock that moves backwards credits nothing and leaves the timestamp
   * alone, so the bucket cannot be refilled twice for the same span.
   * @param {{tokens: number, updatedAt: number}} bucket Bucket to update.
   * @returns {{tokens: number, updatedAt: number}} The same bucket.
   */
  #refill(bucket) {
    const now = this.#clock();
    if (now <= bucket.updatedAt) return bucket;
    bucket.tokens = this.#projected(bucket, now);
    bucket.updatedAt = now;
    return bucket;
  }

  /**
   * Tokens a bucket would hold at a given moment, without touching it.
   * @param {{tokens: number, updatedAt: number}} bucket Bucket to inspect.
   * @param {number} now Clock reading to project to.
   * @returns {number} Projected token count, never above the bucket size.
   */
  #projected(bucket, now) {
    const elapsed = now - bucket.updatedAt;
    if (elapsed <= 0) return bucket.tokens;
    const earned = (elapsed * this.#refillTokens) / this.#refillIntervalMs;
    return Math.min(this.#capacity, bucket.tokens + earned);
  }

  /**
   * Milliseconds until a bucket could pay for a request.
   * @param {{tokens: number, updatedAt: number}} bucket Refilled bucket.
   * @param {number} tokens Tokens the request needs.
   * @returns {number | null} Zero when it can pay now, or null when the request can never be paid.
   */
  #waitFor(bucket, tokens) {
    if (tokens > this.#capacity) return null;
    if (bucket.tokens >= tokens) return 0;
    const deficit = tokens - bucket.tokens;
    return Math.ceil((deficit * this.#refillIntervalMs) / this.#refillTokens);
  }

  /**
   * Takes tokens from a key's bucket when it can pay for them.
   * @param {string} key Bucket key.
   * @param {number} [tokens] Tokens to take; a positive safe integer.
   * @returns {{allowed: boolean, remaining: number, retryAfterMs: number | null}} Outcome, whole tokens left, and the wait before retrying.
   * @throws {TypeError} When the key or token count is malformed.
   */
  tryConsume(key, tokens = 1) {
    checkKey(key);
    checkPositiveInteger(tokens, 'tokens');
    const bucket = this.#refill(this.#bucketFor(key));
    if (bucket.tokens >= tokens) {
      bucket.tokens -= tokens;
      this.#allowed += 1;
      return { allowed: true, remaining: Math.floor(bucket.tokens), retryAfterMs: 0 };
    }
    this.#denied += 1;
    return { allowed: false, remaining: Math.floor(bucket.tokens), retryAfterMs: this.#waitFor(bucket, tokens) };
  }

  /**
   * Takes tokens or reports the refusal as an error.
   * @param {string} key Bucket key.
   * @param {number} [tokens] Tokens to take.
   * @returns {number} Whole tokens left after the call.
   * @throws {Error} When the bucket cannot pay; the error carries `retryAfterMs`.
   */
  consume(key, tokens = 1) {
    const outcome = this.tryConsume(key, tokens);
    if (!outcome.allowed) {
      const error = new Error(`rate limit exceeded for "${key}"`);
      error.retryAfterMs = outcome.retryAfterMs;
      throw error;
    }
    return outcome.remaining;
  }

  /**
   * Takes the same number of tokens from several buckets at once, or from none
   * of them, so a request limited along more than one dimension cannot spend
   * half its budget and then be refused.
   * @param {string[]} keys Bucket keys the request is charged against.
   * @param {number} [tokens] Tokens to take from each bucket.
   * @returns {{allowed: boolean, retryAfterMs: number | null}} Outcome and the longest wait among the buckets that could not pay.
   * @throws {TypeError} When the keys or token count are malformed.
   */
  tryConsumeAll(keys, tokens = 1) {
    if (!Array.isArray(keys) || keys.length === 0 || keys.some((key) => typeof key !== 'string')) {
      throw new TypeError('keys must be a non-empty array of strings');
    }
    checkPositiveInteger(tokens, 'tokens');
    const buckets = keys.map((key) => this.#refill(this.#bucketFor(key)));
    let wait = 0;
    for (const bucket of buckets) {
      const needed = this.#waitFor(bucket, tokens);
      if (needed === null) wait = null;
      else if (wait !== null && needed > wait) wait = needed;
    }
    if (wait !== 0) {
      this.#denied += 1;
      return { allowed: false, retryAfterMs: wait };
    }
    for (const bucket of buckets) bucket.tokens -= tokens;
    this.#allowed += 1;
    return { allowed: true, retryAfterMs: 0 };
  }

  /**
   * Puts tokens back, never above the bucket size.
   * @param {string} key Bucket key.
   * @param {number} [tokens] Tokens to return.
   * @returns {number} Whole tokens available after the refund.
   */
  refund(key, tokens = 1) {
    checkKey(key);
    checkPositiveInteger(tokens, 'tokens');
    const bucket = this.#refill(this.#bucketFor(key));
    bucket.tokens = Math.min(this.#capacity, bucket.tokens + tokens);
    return Math.floor(bucket.tokens);
  }

  /**
   * Whole tokens a key could spend right now.
   *
   * An unknown key reports a full bucket without creating one.
   * @param {string} key Bucket key.
   * @returns {number} Whole tokens available.
   */
  remaining(key) {
    checkKey(key);
    const bucket = this.#buckets.get(key);
    if (bucket === undefined) return this.#capacity;
    return Math.floor(this.#refill(bucket).tokens);
  }

  /**
   * Milliseconds a key must wait before a request would be allowed.
   *
   * An unknown key is treated as a full bucket and is not created.
   * @param {string} key Bucket key.
   * @param {number} [tokens] Tokens the request needs.
   * @returns {number | null} Zero when it can pay now, or null when the request can never be paid.
   */
  waitFor(key, tokens = 1) {
    checkKey(key);
    checkPositiveInteger(tokens, 'tokens');
    const bucket = this.#buckets.get(key);
    if (bucket === undefined) return this.#waitFor({ tokens: this.#capacity, updatedAt: this.#clock() }, tokens);
    return this.#waitFor(this.#refill(bucket), tokens);
  }

  /**
   * Drops a key's bucket, so its next request starts from a full one.
   * @param {string} key Bucket key.
   * @returns {boolean} True when a bucket was dropped.
   */
  reset(key) {
    checkKey(key);
    this.#forgetRecent();
    return this.#buckets.delete(key);
  }

  /**
   * Drops every bucket.
   * @returns {void}
   */
  clear() {
    this.#forgetRecent();
    this.#buckets.clear();
  }

  /**
   * Lists the keys that currently have a bucket, oldest first.
   * @returns {string[]} Keys in creation order.
   */
  keys() {
    return [...this.#buckets.keys()];
  }

  /**
   * Describes every stored bucket after crediting the time that has passed.
   * @returns {Array<{key: string, remaining: number, retryAfterMs: number | null}>} One entry per key, in creation order.
   */
  snapshot() {
    return [...this.#buckets.entries()].map(([key, bucket]) => ({
      key,
      remaining: Math.floor(this.#refill(bucket).tokens),
      retryAfterMs: this.#waitFor(bucket, 1),
    }));
  }

  /**
   * Drops buckets that have been idle long enough to have refilled completely,
   * since a full bucket behaves exactly like a key that was never seen.
   * @param {number} idleMs How long a bucket must have gone untouched.
   * @returns {number} How many buckets were dropped.
   * @throws {TypeError} When the idle time is not a non-negative safe integer.
   */
  sweep(idleMs) {
    if (!Number.isSafeInteger(idleMs) || idleMs < 0) throw new TypeError('idleMs must be a non-negative integer');
    const now = this.#clock();
    let dropped = 0;
    for (const [key, bucket] of [...this.#buckets.entries()]) {
      if (now - bucket.updatedAt < idleMs) continue;
      if (this.#projected(bucket, now) < this.#capacity) continue;
      this.#buckets.delete(key);
      dropped += 1;
    }
    if (dropped > 0) this.#forgetRecent();
    return dropped;
  }

  /**
   * Reports cumulative decision counters.
   * @returns {{allowed: number, denied: number}} Counters.
   */
  stats() {
    return { allowed: this.#allowed, denied: this.#denied };
  }
}

/**
 * Validates a bucket key.
 * @param {unknown} key Candidate key.
 * @returns {void}
 * @throws {TypeError} When the key is not a string.
 */
function checkKey(key) {
  if (typeof key !== 'string') throw new TypeError('key must be a string');
}

/**
 * Validates a positive whole number.
 * @param {unknown} value Candidate value.
 * @param {string} label Name used in the message.
 * @returns {void}
 * @throws {TypeError} When the value is not a positive safe integer.
 */
function checkPositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${label} must be a positive integer`);
}
