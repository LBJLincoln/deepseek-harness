import test from 'node:test';
import assert from 'node:assert/strict';
import { Ledger } from '../src/index.js';

/** Deterministic 32-bit PRNG so generated postings replay identically. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A ledger with the five accounts used across these cases. */
function chartOfAccounts() {
  const ledger = new Ledger();
  ledger.openAccount({ id: 'cash', name: 'Cash', type: 'asset' });
  ledger.openAccount({ id: 'revenue', name: 'Revenue', type: 'income' });
  ledger.openAccount({ id: 'ap', name: 'Payables', type: 'liability' });
  ledger.openAccount({ id: 'rent', name: 'Rent', type: 'expense' });
  ledger.openAccount({ id: 'equity', name: 'Equity', type: 'equity' });
  return ledger;
}

/** The worked example used by the balance and reversal cases. */
function seeded() {
  const ledger = chartOfAccounts();
  ledger.post({ id: 'e1', at: 10, memo: 'sale', lines: [{ account: 'cash', amountCents: 1000 }, { account: 'revenue', amountCents: -1000 }] });
  ledger.post({ id: 'e2', at: 20, lines: [{ account: 'rent', amountCents: 300 }, { account: 'cash', amountCents: -300 }] });
  ledger.post({ id: 'e3', at: 20, lines: [{ account: 'rent', amountCents: 450 }, { account: 'ap', amountCents: -450 }] });
  return ledger;
}

test('accounts are opened once and listed in order', () => {
  const ledger = chartOfAccounts();
  assert.deepEqual(ledger.accounts().map((account) => account.id), ['ap', 'cash', 'equity', 'rent', 'revenue']);
  assert.deepEqual(ledger.accounts()[1], { id: 'cash', name: 'Cash', type: 'asset' });
  assert.equal(Object.isFrozen(ledger.accounts()[0]), true);
  assert.throws(() => ledger.openAccount({ id: 'cash', name: 'Again', type: 'asset' }), {
    code: 'DUPLICATE_ACCOUNT',
    message: 'account already exists: cash',
  });
  assert.throws(() => ledger.openAccount({ id: '', name: 'X', type: 'asset' }), { code: 'BAD_ACCOUNT' });
  assert.throws(() => ledger.openAccount({ id: 'x', name: '', type: 'asset' }), { code: 'BAD_ACCOUNT' });
  assert.throws(() => ledger.openAccount({ id: 'x', name: 'X', type: 'cash' }), { code: 'UNKNOWN_TYPE' });
  assert.throws(() => ledger.openAccount(null), { code: 'BAD_ACCOUNT', message: 'account must be an object' });
});

test('a posted entry is stored immutably with its posting order', () => {
  const ledger = seeded();
  const entry = ledger.getEntry('e1');
  assert.equal(entry.seq, 1);
  assert.equal(entry.at, 10);
  assert.equal(entry.memo, 'sale');
  assert.equal(entry.reverses, null);
  assert.equal(entry.reversedBy, null);
  assert.deepEqual(entry.lines.map((line) => line.amountCents), [1000, -1000]);
  assert.equal(Object.isFrozen(entry), true);
  assert.equal(ledger.getEntry('e3').seq, 3);
  assert.equal(ledger.getEntry('missing'), undefined);
  assert.equal(ledger.post({ id: 'e0', at: 0, lines: [{ account: 'cash', amountCents: 5 }, { account: 'equity', amountCents: -5 }] }).memo, '');
});

test('posting rejects everything that would break the books', () => {
  const ledger = chartOfAccounts();
  const line = (account, amountCents) => ({ account, amountCents });
  const cases = [
    [{ id: 'x', at: 1, lines: [line('cash', 5), line('equity', -4)] }, 'UNBALANCED'],
    [{ id: 'x', at: 1, lines: [line('cash', 5)] }, 'TOO_FEW_LINES'],
    [{ id: 'x', at: 1, lines: [] }, 'TOO_FEW_LINES'],
    [{ id: 'x', at: 1, lines: 'nope' }, 'TOO_FEW_LINES'],
    [{ id: 'x', at: 1, lines: [line('cash', 0), line('equity', 0)] }, 'ZERO_LINE'],
    [{ id: 'x', at: 1, lines: [line('cash', 1.5), line('equity', -1.5)] }, 'NOT_INTEGER'],
    [{ id: 'x', at: 1, lines: [line('cash', Number.MAX_SAFE_INTEGER + 2), line('equity', -5)] }, 'NOT_INTEGER'],
    [{ id: 'x', at: 1, lines: [line('nope', 5), line('equity', -5)] }, 'UNKNOWN_ACCOUNT'],
    [{ id: '', at: 1, lines: [line('cash', 5), line('equity', -5)] }, 'BAD_ENTRY'],
    [{ id: 'x', at: -1, lines: [line('cash', 5), line('equity', -5)] }, 'BAD_TIME'],
    [{ id: 'x', at: 1.5, lines: [line('cash', 5), line('equity', -5)] }, 'BAD_TIME'],
    [{ id: 'x', at: 1, memo: 9, lines: [line('cash', 5), line('equity', -5)] }, 'BAD_ENTRY'],
    [null, 'BAD_ENTRY'],
  ];
  for (const [entry, code] of cases) {
    assert.throws(() => ledger.post(entry), { name: 'LedgerError', code }, `case ${code}`);
  }
  assert.equal(ledger.entries().length, 0, 'a rejected entry is never stored');
  ledger.post({ id: 'ok', at: 1, lines: [line('cash', 5), line('equity', -5)] });
  assert.throws(() => ledger.post({ id: 'ok', at: 2, lines: [line('cash', 1), line('equity', -1)] }), {
    code: 'DUPLICATE_ENTRY',
    message: 'entry already exists: ok',
  });
  assert.equal(ledger.entries().length, 1);
});

test('balances answer as of any moment', () => {
  const ledger = seeded();
  assert.equal(ledger.balance('cash'), 700);
  assert.equal(ledger.balance('cash', { asOf: 9 }), 0);
  assert.equal(ledger.balance('cash', { asOf: 10 }), 1000);
  assert.equal(ledger.balance('cash', { asOf: 19 }), 1000);
  assert.equal(ledger.balance('cash', { asOf: 20 }), 700);
  assert.equal(ledger.balance('rent', { asOf: 20 }), 750);
  assert.equal(ledger.balance('revenue'), -1000);
  assert.equal(ledger.normalBalance('revenue'), 1000);
  assert.equal(ledger.normalBalance('ap'), 450);
  assert.equal(ledger.normalBalance('rent'), 750);
  assert.equal(ledger.balance('equity'), 0);
  assert.throws(() => ledger.balance('nope'), { code: 'UNKNOWN_ACCOUNT', message: 'unknown account: nope' });
  assert.throws(() => ledger.balance('cash', { asOf: -1 }), { code: 'BAD_TIME' });
});

test('the trial balance always balances', () => {
  const ledger = seeded();
  const full = ledger.trialBalance();
  assert.equal(full.debits, 1450);
  assert.equal(full.credits, 1450);
  assert.deepEqual(full.byAccount, { ap: -450, cash: 700, equity: 0, rent: 750, revenue: -1000 });
  const early = ledger.trialBalance({ asOf: 10 });
  assert.equal(early.debits, 1000);
  assert.equal(early.credits, 1000);
  assert.deepEqual(early.byAccount, { ap: 0, cash: 1000, equity: 0, rent: 0, revenue: -1000 });
  const empty = chartOfAccounts().trialBalance();
  assert.equal(empty.debits, 0);
  assert.equal(empty.credits, 0);
});

test('entries are ordered by time and then by posting order', () => {
  const ledger = seeded();
  ledger.post({ id: 'e4', at: 5, lines: [{ account: 'cash', amountCents: 10 }, { account: 'equity', amountCents: -10 }] });
  assert.deepEqual(ledger.entries().map((entry) => entry.id), ['e4', 'e1', 'e2', 'e3']);
  assert.deepEqual(ledger.entries({ asOf: 10 }).map((entry) => entry.id), ['e4', 'e1']);
  assert.deepEqual(ledger.entries({ asOf: 4 }), []);
  assert.deepEqual(ledger.entries().map((entry) => entry.seq), [4, 1, 2, 3]);
});

test('a reversal mirrors its entry and links both ways', () => {
  const ledger = seeded();
  const reversal = ledger.reverse('e2', { id: 'e2r', at: 25 });
  assert.equal(reversal.id, 'e2r');
  assert.equal(reversal.reverses, 'e2');
  assert.equal(reversal.memo, 'reversal of e2');
  assert.deepEqual(reversal.lines.map((line) => [line.account, line.amountCents]), [['rent', -300], ['cash', 300]]);
  assert.equal(ledger.getEntry('e2').reversedBy, 'e2r');
  assert.equal(ledger.balance('cash'), 1000);
  assert.equal(ledger.balance('rent'), 450);
  assert.equal(ledger.balance('cash', { asOf: 24 }), 700, 'a reversal only counts from its own time');
  assert.equal(ledger.trialBalance().debits, ledger.trialBalance().credits);
});

test('reversal refuses the cases that would double-count', () => {
  const ledger = seeded();
  ledger.reverse('e2', { id: 'e2r', at: 25 });
  assert.throws(() => ledger.reverse('e2', { id: 'again', at: 26 }), {
    code: 'ALREADY_REVERSED',
    message: 'entry already reversed: e2',
  });
  assert.throws(() => ledger.reverse('e2r', { id: 'twice', at: 27 }), { code: 'REVERSAL_OF_REVERSAL' });
  assert.throws(() => ledger.reverse('ghost', { id: 'x', at: 27 }), { code: 'NOT_FOUND', message: 'unknown entry: ghost' });
  assert.throws(() => ledger.reverse('e1', { id: 'early', at: 9 }), { code: 'BAD_TIME' });
  assert.throws(() => ledger.reverse('e1', { id: 'e1', at: 30 }), { code: 'DUPLICATE_ENTRY' });
  assert.equal(ledger.getEntry('e1').reversedBy, null, 'a failed reversal leaves no link');
});

test('a statement lists one account with a running balance', () => {
  const ledger = seeded();
  ledger.reverse('e2', { id: 'e2r', at: 25 });
  const rows = ledger.statement('cash');
  assert.deepEqual(rows, [
    { entryId: 'e1', at: 10, seq: 1, amountCents: 1000, balanceCents: 1000 },
    { entryId: 'e2', at: 20, seq: 2, amountCents: -300, balanceCents: 700 },
    { entryId: 'e2r', at: 25, seq: 4, amountCents: 300, balanceCents: 1000 },
  ]);
  const window = ledger.statement('cash', { from: 20, to: 24 });
  assert.deepEqual(window, [{ entryId: 'e2', at: 20, seq: 2, amountCents: -300, balanceCents: 700 }]);
  assert.deepEqual(ledger.statement('equity'), []);
  assert.throws(() => ledger.statement('nope'), { code: 'UNKNOWN_ACCOUNT' });
});

test('randomised postings conserve value at every moment', () => {
  const pick = mulberry32(112233);
  const ledger = chartOfAccounts();
  const ids = ledger.accounts().map((account) => account.id);
  const posted = [];
  for (let index = 0; index < 200; index += 1) {
    const count = 2 + Math.floor(pick() * 3);
    const chosen = [];
    while (chosen.length < count) {
      const candidate = ids[Math.floor(pick() * ids.length)];
      if (!chosen.includes(candidate)) chosen.push(candidate);
    }
    const amounts = [];
    let sum = 0;
    for (let line = 0; line < count - 1; line += 1) {
      const value = 1 + Math.floor(pick() * 5000) * (pick() < 0.5 ? 1 : -1);
      amounts.push(value);
      sum += value;
    }
    if (sum === 0) {
      amounts[0] += 1;
      sum = 1;
    }
    amounts.push(-sum);
    const at = Math.floor(pick() * 200);
    const id = `r${index}`;
    ledger.post({ id, at, lines: chosen.map((account, position) => ({ account, amountCents: amounts[position] })) });
    posted.push(id);
  }

  for (let asOf = 0; asOf <= 200; asOf += 10) {
    const total = ids.reduce((sum, id) => sum + ledger.balance(id, { asOf }), 0);
    assert.equal(total, 0, `value is conserved as of ${asOf}`);
    const trial = ledger.trialBalance({ asOf });
    assert.equal(trial.debits, trial.credits, `the trial balance agrees as of ${asOf}`);
    assert.equal(
      Object.values(trial.byAccount).reduce((sum, value) => sum + value, 0),
      0,
      `the trial balance sums to zero as of ${asOf}`,
    );
  }

  const beforeReversal = Object.fromEntries(ids.map((id) => [id, ledger.balance(id)]));
  for (const id of posted) {
    const original = ledger.getEntry(id);
    assert.equal(original.reverses, null);
    ledger.reverse(id, { id: `${id}-rev`, at: 500 });
  }
  for (const id of ids) {
    assert.equal(ledger.balance(id), 0, `${id} is empty once every entry is reversed`);
    assert.equal(ledger.balance(id, { asOf: 499 }), beforeReversal[id], `${id} is untouched before the reversals`);
  }
  assert.equal(ledger.entries().length, 400);
  assert.equal(ledger.trialBalance().debits, 0);
});
