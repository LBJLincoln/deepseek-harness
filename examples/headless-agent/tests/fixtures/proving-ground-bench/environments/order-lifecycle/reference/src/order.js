/**
 * The order aggregate: guarded commands, an append-only audit trail and
 * idempotent replay of command ids.
 */
import { COMMAND_TYPES, allowedTypes } from './machine.js';

/**
 * Reject a structurally malformed command.
 *
 * @param {unknown} command Candidate command.
 * @returns {{type: string, commandId: string, at: number}} The validated command.
 */
function checkCommand(command) {
  if (typeof command !== 'object' || command === null || Array.isArray(command)) {
    throw new TypeError('command must be an object');
  }
  if (!COMMAND_TYPES.includes(command.type)) {
    throw new TypeError(`unknown command type: ${command.type}`);
  }
  if (typeof command.commandId !== 'string' || command.commandId === '') {
    throw new TypeError('command must carry a non-empty commandId');
  }
  if (!Number.isInteger(command.at) || command.at < 0) {
    throw new TypeError('command must carry a non-negative integer at');
  }
  return command;
}

/**
 * Check a required non-empty string field.
 *
 * @param {unknown} value Field value.
 * @returns {boolean} True when the field is usable.
 */
function isText(value) {
  return typeof value === 'string' && value !== '';
}

/** An order and everything that has been asked of it. */
export class Order {
  #id;

  #state = 'created';

  #items = new Map();

  #paidCents = 0;

  #refundedCents = 0;

  #clockMs;

  #audit = [];

  #seen = new Map();

  #shipment = null;

  #deliveredAt = null;

  /**
   * @param {{id: string, createdAt?: number}} init Identity and start time.
   */
  constructor(init) {
    if (typeof init !== 'object' || init === null) throw new TypeError('init must be an object');
    if (!isText(init.id)) throw new TypeError('init.id must be a non-empty string');
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
   * Record one command's outcome in the audit trail.
   *
   * @param {object} command The command being recorded.
   * @param {string} from State before the command.
   * @param {object} outcome Result fields to record.
   * @returns {object} The result handed back to the caller.
   */
  #record(command, from, outcome) {
    const seq = this.#audit.length + 1;
    const at = outcome.code === 'CLOCK_REGRESSION' ? this.#clockMs : command.at;
    if (outcome.code !== 'CLOCK_REGRESSION') this.#clockMs = command.at;
    const entry = {
      seq,
      commandId: command.commandId,
      type: command.type,
      at,
      from,
      to: this.#state,
      ok: outcome.ok,
    };
    if (!outcome.ok) entry.code = outcome.code;
    this.#audit.push(entry);
    const result = outcome.ok
      ? { ok: true, state: this.#state, seq, replayed: false }
      : { ok: false, code: outcome.code, message: outcome.message, state: this.#state, seq, replayed: false };
    this.#seen.set(command.commandId, result);
    return result;
  }

  /**
   * Evaluate the guards for one command against the current state.
   *
   * @param {object} command Structurally valid command.
   * @returns {{code: string, message: string}|null} Rejection, or null when the command may run.
   */
  #guard(command) {
    const reject = (code, message) => ({ code, message });
    if (!allowedTypes(this.#state).includes(command.type)) {
      return reject('BAD_STATE', `cannot ${command.type} an order in state ${this.#state}`);
    }
    switch (command.type) {
      case 'addItem': {
        if (!isText(command.sku)) return reject('MISSING_FIELD', 'sku is required');
        if (!Number.isInteger(command.qty) || command.qty < 1) {
          return reject('BAD_AMOUNT', 'qty must be a positive integer');
        }
        if (!Number.isInteger(command.unitPriceCents) || command.unitPriceCents < 0) {
          return reject('BAD_AMOUNT', 'unitPriceCents must be a non-negative integer');
        }
        if (this.#items.has(command.sku)) return reject('DUPLICATE_SKU', `item already present: ${command.sku}`);
        return null;
      }
      case 'removeItem': {
        if (!isText(command.sku)) return reject('MISSING_FIELD', 'sku is required');
        if (!this.#items.has(command.sku)) return reject('NO_SUCH_ITEM', `no such item: ${command.sku}`);
        return null;
      }
      case 'pay': {
        if (!Number.isInteger(command.amountCents) || command.amountCents < 0) {
          return reject('BAD_AMOUNT', 'amountCents must be a non-negative integer');
        }
        if (this.#items.size === 0) return reject('EMPTY_ORDER', 'an order with no items cannot be paid');
        if (command.amountCents !== this.totalCents) {
          return reject('AMOUNT_MISMATCH', `payment of ${command.amountCents} does not match ${this.totalCents}`);
        }
        return null;
      }
      case 'ship': {
        if (!isText(command.carrier)) return reject('MISSING_FIELD', 'carrier is required');
        if (!isText(command.tracking)) return reject('MISSING_FIELD', 'tracking is required');
        return null;
      }
      case 'cancel': {
        if (!isText(command.reason)) return reject('MISSING_FIELD', 'reason is required');
        return null;
      }
      case 'refund': {
        if (!Number.isInteger(command.amountCents) || command.amountCents < 1) {
          return reject('BAD_AMOUNT', 'amountCents must be a positive integer');
        }
        const remaining = this.#paidCents - this.#refundedCents;
        if (command.amountCents > remaining) {
          return reject('REFUND_TOO_LARGE', `refund of ${command.amountCents} exceeds the remaining ${remaining}`);
        }
        return null;
      }
      default:
        return null;
    }
  }

  /**
   * Apply the effect of a command whose guards have passed.
   *
   * @param {object} command Guarded command.
   * @returns {void}
   */
  #effect(command) {
    switch (command.type) {
      case 'addItem':
        this.#items.set(command.sku, {
          sku: command.sku,
          qty: command.qty,
          unitPriceCents: command.unitPriceCents,
        });
        break;
      case 'removeItem':
        this.#items.delete(command.sku);
        break;
      case 'pay':
        this.#paidCents = command.amountCents;
        this.#state = 'paid';
        break;
      case 'pack':
        this.#state = 'packed';
        break;
      case 'ship':
        this.#shipment = { carrier: command.carrier, tracking: command.tracking };
        this.#state = 'shipped';
        break;
      case 'deliver':
        this.#deliveredAt = command.at;
        this.#state = 'delivered';
        break;
      case 'cancel':
        this.#refundedCents = this.#paidCents;
        this.#state = 'cancelled';
        break;
      case 'refund':
        this.#refundedCents += command.amountCents;
        if (this.#refundedCents === this.#paidCents) this.#state = 'refunded';
        break;
      default:
        break;
    }
  }

  /**
   * Apply one command.
   *
   * @param {object} command Command to apply.
   * @returns {{ok: boolean, state: string, seq: number, replayed: boolean, code?: string, message?: string}} Outcome.
   */
  apply(command) {
    checkCommand(command);
    const seen = this.#seen.get(command.commandId);
    if (seen !== undefined) return { ...seen, replayed: true };
    const from = this.#state;
    if (command.at < this.#clockMs) {
      return this.#record(command, from, {
        ok: false,
        code: 'CLOCK_REGRESSION',
        message: `at ${command.at} is earlier than the order clock ${this.#clockMs}`,
      });
    }
    const rejection = this.#guard(command);
    if (rejection !== null) {
      return this.#record(command, from, { ok: false, ...rejection });
    }
    this.#effect(command);
    return this.#record(command, from, { ok: true });
  }

  /** @returns {{carrier: string, tracking: string}|null} Shipment details once shipped. */
  get shipment() {
    return this.#shipment === null ? null : { ...this.#shipment };
  }

  /** @returns {number|null} Timestamp of delivery, once delivered. */
  get deliveredAt() {
    return this.#deliveredAt;
  }

  /**
   * Build an order by applying a command list in order.
   *
   * @param {{id: string, createdAt?: number}} init Identity and start time.
   * @param {object[]} commands Commands to apply.
   * @returns {Order} The resulting order.
   */
  static replay(init, commands) {
    if (!Array.isArray(commands)) throw new TypeError('commands must be an array');
    const order = new Order(init);
    for (const command of commands) order.apply(command);
    return order;
  }
}
