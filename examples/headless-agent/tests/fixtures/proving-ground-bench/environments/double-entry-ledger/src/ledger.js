/**
 * An event-sourced double-entry ledger: accounts, immutable entries, balances
 * at any point in time, and reversals.
 *
 * Opening accounts works; nothing is posted or reported yet.
 */
import { ACCOUNT_TYPES, LedgerError } from './money.js';

/** A ledger of accounts and the balanced entries posted against them. */
export class Ledger {
  #accounts = new Map();

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
   * Post a balanced entry.
   *
   * @param {{id: string, at: number, memo?: string, lines: Array<{account: string, amountCents: number}>}} entry Entry to post.
   * @returns {Readonly<object>} The stored entry.
   */
  post(entry) {
    throw new Error('not implemented');
  }

  /**
   * Look up an entry.
   *
   * @param {string} id Entry id.
   * @returns {Readonly<object>|undefined} The entry, if it exists.
   */
  getEntry(id) {
    throw new Error('not implemented');
  }

  /**
   * Entries up to a moment, oldest first.
   *
   * @param {{asOf?: number}} [options] Cut-off, inclusive.
   * @returns {Array<Readonly<object>>} Matching entries ordered by time then posting order.
   */
  entries(options = {}) {
    throw new Error('not implemented');
  }

  /**
   * Debit-positive balance of one account.
   *
   * @param {string} accountId Account to measure.
   * @param {{asOf?: number}} [options] Cut-off, inclusive.
   * @returns {number} Signed balance in cents.
   */
  balance(accountId, options = {}) {
    throw new Error('not implemented');
  }

  /**
   * Balance of one account in its own normal direction.
   *
   * @param {string} accountId Account to measure.
   * @param {{asOf?: number}} [options] Cut-off, inclusive.
   * @returns {number} Balance in cents, positive when on the normal side.
   */
  normalBalance(accountId, options = {}) {
    throw new Error('not implemented');
  }

  /**
   * Debit and credit totals across every account.
   *
   * @param {{asOf?: number}} [options] Cut-off, inclusive.
   * @returns {{debits: number, credits: number, byAccount: Record<string, number>}} Trial balance.
   */
  trialBalance(options = {}) {
    throw new Error('not implemented');
  }

  /**
   * Post the mirror image of an entry.
   *
   * @param {string} entryId Entry to reverse.
   * @param {{id: string, at: number, memo?: string}} options Identity and time of the reversal.
   * @returns {Readonly<object>} The reversing entry.
   */
  reverse(entryId, options) {
    throw new Error('not implemented');
  }

  /**
   * Every line touching one account inside a window, with a running balance.
   *
   * @param {string} accountId Account to report on.
   * @param {{from?: number, to?: number}} [options] Inclusive window.
   * @returns {Array<{entryId: string, at: number, seq: number, amountCents: number, balanceCents: number}>} Statement rows.
   */
  statement(accountId, options = {}) {
    throw new Error('not implemented');
  }
}
