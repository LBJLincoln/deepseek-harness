/**
 * An event-sourced double-entry ledger: accounts, immutable entries, balances
 * at any point in time, and reversals.
 */
import { ACCOUNT_TYPES, LedgerError, toNormal } from './money.js';

/**
 * Reject a time that cannot order an entry.
 *
 * @param {unknown} value Candidate timestamp.
 * @param {string} field Field name for the message.
 * @param {boolean} [allowInfinite] Whether Infinity is acceptable.
 * @returns {number} The validated timestamp.
 */
function checkTime(value, field, allowInfinite = false) {
  if (allowInfinite && value === Infinity) return value;
  if (!Number.isInteger(value) || value < 0) {
    throw new LedgerError('BAD_TIME', `${field} must be a non-negative integer`);
  }
  return value;
}

/** A ledger of accounts and the balanced entries posted against them. */
export class Ledger {
  #accounts = new Map();

  #entries = new Map();

  #order = [];

  /**
   * Open an account.
   *
   * @param {{id: string, name: string, type: string}} account Account to open.
   * @returns {Readonly<{id: string, name: string, type: string}>} The opened account.
   */
  openAccount(account) {
    if (typeof account !== 'object' || account === null) {
      throw new LedgerError('BAD_ACCOUNT', 'account must be an object');
    }
    const { id, name, type } = account;
    if (typeof id !== 'string' || id === '') {
      throw new LedgerError('BAD_ACCOUNT', 'account id must be a non-empty string');
    }
    if (typeof name !== 'string' || name === '') {
      throw new LedgerError('BAD_ACCOUNT', 'account name must be a non-empty string');
    }
    if (!ACCOUNT_TYPES.includes(type)) throw new LedgerError('UNKNOWN_TYPE', `unknown account type: ${type}`);
    if (this.#accounts.has(id)) throw new LedgerError('DUPLICATE_ACCOUNT', `account already exists: ${id}`);
    const record = Object.freeze({ id, name, type });
    this.#accounts.set(id, record);
    return record;
  }

  /** @returns {Array<Readonly<object>>} Accounts in ascending id order. */
  accounts() {
    return [...this.#accounts.keys()].sort().map((id) => this.#accounts.get(id));
  }

  /**
   * Look up an account.
   *
   * @param {string} id Account id.
   * @returns {Readonly<object>} The account.
   */
  #account(id) {
    const found = this.#accounts.get(id);
    if (found === undefined) throw new LedgerError('UNKNOWN_ACCOUNT', `unknown account: ${id}`);
    return found;
  }

  /**
   * Post a balanced entry.
   *
   * @param {{id: string, at: number, memo?: string, lines: Array<{account: string, amountCents: number}>}} entry Entry to post.
   * @returns {Readonly<object>} The stored entry.
   */
  post(entry) {
    return this.#post(entry, null);
  }

  /**
   * Validate and store an entry, optionally marking it as a reversal.
   *
   * @param {object} entry Entry to post.
   * @param {string|null} reverses Id of the entry this one reverses.
   * @returns {Readonly<object>} The stored entry.
   */
  #post(entry, reverses) {
    if (typeof entry !== 'object' || entry === null) throw new LedgerError('BAD_ENTRY', 'entry must be an object');
    const { id, at, memo = '', lines } = entry;
    if (typeof id !== 'string' || id === '') {
      throw new LedgerError('BAD_ENTRY', 'entry id must be a non-empty string');
    }
    if (this.#entries.has(id)) throw new LedgerError('DUPLICATE_ENTRY', `entry already exists: ${id}`);
    checkTime(at, 'at');
    if (typeof memo !== 'string') throw new LedgerError('BAD_ENTRY', 'memo must be a string');
    if (!Array.isArray(lines) || lines.length < 2) {
      throw new LedgerError('TOO_FEW_LINES', 'an entry needs at least two lines');
    }
    let sum = 0;
    const stored = lines.map((line) => {
      if (typeof line !== 'object' || line === null) throw new LedgerError('BAD_ENTRY', 'each line must be an object');
      this.#account(line.account);
      if (!Number.isSafeInteger(line.amountCents)) {
        throw new LedgerError('NOT_INTEGER', 'amountCents must be a safe integer');
      }
      if (line.amountCents === 0) throw new LedgerError('ZERO_LINE', 'a line may not be zero');
      sum += line.amountCents;
      return Object.freeze({ account: line.account, amountCents: line.amountCents });
    });
    if (sum !== 0) throw new LedgerError('UNBALANCED', `entry does not balance: ${sum}`);

    const record = Object.freeze({
      id,
      at,
      seq: this.#order.length + 1,
      memo,
      lines: Object.freeze(stored),
      reverses,
      reversedBy: null,
    });
    this.#entries.set(id, record);
    this.#order.push(record);
    return record;
  }

  /**
   * Look up an entry.
   *
   * @param {string} id Entry id.
   * @returns {Readonly<object>|undefined} The entry, if it exists.
   */
  getEntry(id) {
    return this.#entries.get(id);
  }

  /**
   * Entries up to a moment, oldest first.
   *
   * @param {{asOf?: number}} [options] Cut-off, inclusive.
   * @returns {Array<Readonly<object>>} Matching entries ordered by time then posting order.
   */
  entries(options = {}) {
    const asOf = checkTime(options.asOf ?? Infinity, 'asOf', true);
    return this.#order
      .filter((record) => record.at <= asOf)
      .sort((left, right) => left.at - right.at || left.seq - right.seq);
  }

  /**
   * Debit-positive balance of one account.
   *
   * @param {string} accountId Account to measure.
   * @param {{asOf?: number}} [options] Cut-off, inclusive.
   * @returns {number} Signed balance in cents.
   */
  balance(accountId, options = {}) {
    this.#account(accountId);
    const asOf = checkTime(options.asOf ?? Infinity, 'asOf', true);
    let total = 0;
    for (const record of this.#order) {
      if (record.at > asOf) continue;
      for (const line of record.lines) {
        if (line.account === accountId) total += line.amountCents;
      }
    }
    return total;
  }

  /**
   * Balance of one account in its own normal direction.
   *
   * @param {string} accountId Account to measure.
   * @param {{asOf?: number}} [options] Cut-off, inclusive.
   * @returns {number} Balance in cents, positive when on the normal side.
   */
  normalBalance(accountId, options = {}) {
    return toNormal(this.#account(accountId).type, this.balance(accountId, options));
  }

  /**
   * Debit and credit totals across every account.
   *
   * @param {{asOf?: number}} [options] Cut-off, inclusive.
   * @returns {{debits: number, credits: number, byAccount: Record<string, number>}} Trial balance.
   */
  trialBalance(options = {}) {
    const byAccount = {};
    let debits = 0;
    let credits = 0;
    for (const id of [...this.#accounts.keys()].sort()) {
      const value = this.balance(id, options);
      byAccount[id] = value;
      if (value > 0) debits += value;
      else credits -= value;
    }
    return { debits, credits, byAccount };
  }

  /**
   * Post the mirror image of an entry.
   *
   * @param {string} entryId Entry to reverse.
   * @param {{id: string, at: number, memo?: string}} options Identity and time of the reversal.
   * @returns {Readonly<object>} The reversing entry.
   */
  reverse(entryId, options) {
    const original = this.#entries.get(entryId);
    if (original === undefined) throw new LedgerError('NOT_FOUND', `unknown entry: ${entryId}`);
    if (original.reverses !== null) {
      throw new LedgerError('REVERSAL_OF_REVERSAL', `entry is itself a reversal: ${entryId}`);
    }
    if (original.reversedBy !== null) {
      throw new LedgerError('ALREADY_REVERSED', `entry already reversed: ${entryId}`);
    }
    if (typeof options !== 'object' || options === null) {
      throw new LedgerError('BAD_ENTRY', 'entry must be an object');
    }
    checkTime(options.at, 'at');
    if (options.at < original.at) throw new LedgerError('BAD_TIME', 'a reversal cannot precede its entry');
    const reversal = this.#post(
      {
        id: options.id,
        at: options.at,
        memo: options.memo ?? `reversal of ${entryId}`,
        lines: original.lines.map((line) => ({ account: line.account, amountCents: -line.amountCents })),
      },
      entryId,
    );
    const linked = Object.freeze({ ...original, reversedBy: reversal.id });
    this.#entries.set(entryId, linked);
    this.#order[original.seq - 1] = linked;
    return reversal;
  }

  /**
   * Every line touching one account inside a window, with a running balance.
   *
   * @param {string} accountId Account to report on.
   * @param {{from?: number, to?: number}} [options] Inclusive window.
   * @returns {Array<{entryId: string, at: number, seq: number, amountCents: number, balanceCents: number}>} Statement rows.
   */
  statement(accountId, options = {}) {
    this.#account(accountId);
    const from = checkTime(options.from ?? 0, 'from');
    const to = checkTime(options.to ?? Infinity, 'to', true);
    let running = 0;
    const rows = [];
    for (const record of this.entries()) {
      for (const line of record.lines) {
        if (line.account !== accountId) continue;
        running += line.amountCents;
        if (record.at >= from && record.at <= to) {
          rows.push({
            entryId: record.id,
            at: record.at,
            seq: record.seq,
            amountCents: line.amountCents,
            balanceCents: running,
          });
        }
      }
    }
    return rows;
  }
}
