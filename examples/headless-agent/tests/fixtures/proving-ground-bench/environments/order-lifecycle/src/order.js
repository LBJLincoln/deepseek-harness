/**
 * The order aggregate: guarded commands, an append-only audit trail and
 * idempotent replay of command ids.
 *
 * Construction and the read side exist; nothing applies commands yet.
 */

/** An order and everything that has been asked of it. */
export class Order {
  #id;

  #state = 'created';

  #items = new Map();

  #paidCents = 0;

  #refundedCents = 0;

  #clockMs;

  #audit = [];

  #shipment = null;

  #deliveredAt = null;

  /**
   * @param {{id: string, createdAt?: number}} init Identity and start time.
   */
  constructor(init) {
    if (typeof init !== 'object' || init === null) throw new TypeError('init must be an object');
    if (typeof init.id !== 'string' || init.id === '') throw new TypeError('init.id must be a non-empty string');
    const createdAt = init.createdAt === undefined ? 0 : init.createdAt;
    if (!Number.isInteger(createdAt) || createdAt < 0) {
      throw new TypeError('init.createdAt must be a non-negative integer');
    }
    this.#id = init.id;
    this.#clockMs = createdAt;
  }

  /** @returns {string} Order identity. */
  get id() {
    return this.#id;
  }

  /** @returns {string} Current state. */
  get state() {
    return this.#state;
  }

  /** @returns {Array<{sku: string, qty: number, unitPriceCents: number}>} Items in ascending sku order. */
  get items() {
    return [...this.#items.keys()].sort().map((sku) => ({ ...this.#items.get(sku) }));
  }

  /** @returns {number} Sum of quantity times unit price over all items. */
  get totalCents() {
    let total = 0;
    for (const item of this.#items.values()) total += item.qty * item.unitPriceCents;
    return total;
  }

  /** @returns {number} Amount captured by a successful payment. */
  get paidCents() {
    return this.#paidCents;
  }

  /** @returns {number} Amount refunded so far. */
  get refundedCents() {
    return this.#refundedCents;
  }

  /** @returns {number} High-water mark of command timestamps. */
  get clockMs() {
    return this.#clockMs;
  }

  /** @returns {object[]} Copy of the audit trail, oldest first. */
  get audit() {
    return this.#audit.map((entry) => ({ ...entry }));
  }

  /** @returns {{carrier: string, tracking: string}|null} Shipment details once shipped. */
  get shipment() {
    return this.#shipment === null ? null : { ...this.#shipment };
  }

  /** @returns {number|null} Timestamp of delivery, once delivered. */
  get deliveredAt() {
    return this.#deliveredAt;
  }

  /** @returns {object} Plain description of the order's visible state. */
  snapshot() {
    return {
      id: this.#id,
      state: this.#state,
      items: this.items,
      totalCents: this.totalCents,
      paidCents: this.#paidCents,
      refundedCents: this.#refundedCents,
      clockMs: this.#clockMs,
      seq: this.#audit.length,
    };
  }

  /**
   * Apply one command.
   *
   * @param {object} command Command to apply.
   * @returns {{ok: boolean, state: string, seq: number, replayed: boolean, code?: string, message?: string}} Outcome.
   */
  apply(command) {
    throw new Error('not implemented');
  }

  /**
   * Build an order by applying a command list in order.
   *
   * @param {{id: string, createdAt?: number}} init Identity and start time.
   * @param {object[]} commands Commands to apply.
   * @returns {Order} The resulting order.
   */
  static replay(init, commands) {
    throw new Error('not implemented');
  }
}
