import test from 'node:test';
import assert from 'node:assert/strict';
import { ACCOUNT_TYPES, LedgerError, normalSide, toNormal } from '../src/index.js';

test('the account taxonomy is fixed', () => {
  assert.deepEqual([...ACCOUNT_TYPES].sort(), ['asset', 'equity', 'expense', 'income', 'liability']);
  assert.equal(Object.isFrozen(ACCOUNT_TYPES), true);
  assert.equal(new LedgerError('X', 'y') instanceof Error, true);
  assert.equal(new LedgerError('X', 'y').name, 'LedgerError');
});

test('normal sides follow the accounting convention', () => {
  assert.equal(normalSide('asset'), 'debit');
  assert.equal(normalSide('expense'), 'debit');
  assert.equal(normalSide('liability'), 'credit');
  assert.equal(normalSide('equity'), 'credit');
  assert.equal(normalSide('income'), 'credit');
  assert.throws(() => normalSide('revenue'), {
    name: 'LedgerError',
    code: 'UNKNOWN_TYPE',
    message: 'unknown account type: revenue',
  });
});

test('toNormal flips only the credit-normal types', () => {
  assert.equal(toNormal('asset', 500), 500);
  assert.equal(toNormal('expense', -25), -25);
  assert.equal(toNormal('income', -900), 900);
  assert.equal(toNormal('liability', -1), 1);
  assert.equal(toNormal('equity', 40), -40);
  assert.equal(toNormal('asset', 0), 0);
  assert.equal(Object.is(toNormal('income', 0), 0) || Object.is(toNormal('income', 0), -0), true);
  assert.throws(() => toNormal('cash', 1), { code: 'UNKNOWN_TYPE' });
});
