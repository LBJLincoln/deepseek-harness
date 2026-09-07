import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Trie } from '../src/trie.js';

/**
 * Deterministic 32-bit PRNG.
 * @param {number} seed Initial state.
 * @returns {() => number} Generator returning floats in [0, 1).
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Compares two strings by Unicode code point.
 * @param {string} a First string.
 * @param {string} b Second string.
 * @returns {number} Negative, zero, or positive.
 */
function byCodePoint(a, b) {
  const left = [...a];
  const right = [...b];
  for (let i = 0; i < Math.min(left.length, right.length); i += 1) {
    const diff = left[i].codePointAt(0) - right[i].codePointAt(0);
    if (diff !== 0) return diff;
  }
  return left.length - right.length;
}

/**
 * Every distinct prefix of a set of words, the empty prefix included.
 * @param {Iterable<string>} words Stored words.
 * @returns {Set<string>} Distinct prefixes.
 */
function prefixesOf(words) {
  const out = new Set(['']);
  for (const word of words) {
    const chars = [...word];
    for (let i = 1; i <= chars.length; i += 1) out.add(chars.slice(0, i).join(''));
  }
  return out;
}

test('an empty trie holds nothing but its root', () => {
  const trie = new Trie();
  assert.deepEqual([trie.size, trie.nodeCount], [0, 1]);
  assert.deepEqual([trie.has('a'), trie.get('a'), trie.delete('a')], [false, undefined, false]);
  assert.deepEqual([trie.countPrefix(''), trie.search(''), trie.entries()], [0, [], []]);
  assert.equal(trie.longestPrefixMatch('anything'), null);
});

test('insert stores values and reports the one it replaced', () => {
  const trie = new Trie();
  assert.equal(trie.insert('cat', 1), undefined);
  assert.equal(trie.insert('car', 2), undefined);
  assert.equal(trie.insert('cat', 3), 1);
  assert.deepEqual([trie.get('cat'), trie.get('car'), trie.get('ca')], [3, 2, undefined]);
  assert.deepEqual([trie.size, trie.nodeCount], [2, 5]);
  assert.deepEqual([trie.has('cat'), trie.has('ca'), trie.has('cats')], [true, false, false]);
  assert.equal(trie.insert('', 'root'), undefined);
  assert.deepEqual([trie.size, trie.nodeCount, trie.has(''), trie.get('')], [3, 5, true, 'root']);
});

test('delete removes only what a word alone kept alive', () => {
  const trie = new Trie();
  for (const word of ['cat', 'car', 'cart', 'dog']) trie.insert(word, word.length);
  assert.deepEqual([trie.size, trie.nodeCount], [4, 9]);
  assert.equal(trie.delete('ca'), false);
  assert.equal(trie.delete('cat'), true);
  assert.deepEqual([trie.size, trie.nodeCount, trie.has('cat')], [3, 8, false]);
  assert.equal(trie.delete('cat'), false);
  assert.equal(trie.delete('cart'), true);
  assert.deepEqual([trie.size, trie.nodeCount], [2, 7]);
  assert.deepEqual(trie.entries(), [['car', 3], ['dog', 3]]);
  for (const word of ['car', 'dog']) trie.delete(word);
  assert.deepEqual([trie.size, trie.nodeCount, trie.entries()], [0, 1, []]);
});

test('prefix counts stay exact through inserts and deletes', () => {
  const trie = new Trie();
  for (const word of ['a', 'ab', 'abc', 'abd', 'b', '']) trie.insert(word, word);
  assert.deepEqual([trie.countPrefix(''), trie.countPrefix('a'), trie.countPrefix('ab')], [6, 4, 3]);
  assert.deepEqual([trie.countPrefix('abc'), trie.countPrefix('abz'), trie.countPrefix('zz')], [1, 0, 0]);
  trie.delete('ab');
  assert.deepEqual([trie.countPrefix('a'), trie.countPrefix('ab')], [3, 2]);
  trie.insert('ab', 'again');
  assert.deepEqual([trie.countPrefix('a'), trie.countPrefix('ab'), trie.size], [4, 3, 6]);
  trie.insert('ab', 'replaced');
  assert.deepEqual([trie.countPrefix('ab'), trie.size], [3, 6]);
});

test('search lists matches in code point order and honours a limit', () => {
  const trie = new Trie();
  for (const word of ['ba', 'b', 'abc', 'ab', 'a', 'abd']) trie.insert(word, true);
  assert.deepEqual(trie.search(''), ['a', 'ab', 'abc', 'abd', 'b', 'ba']);
  assert.deepEqual(trie.search('a'), ['a', 'ab', 'abc', 'abd']);
  assert.deepEqual(trie.search('ab', 2), ['ab', 'abc']);
  assert.deepEqual([trie.search('a', 0), trie.search('zz'), trie.search('abcd')], [[], [], []]);
  assert.deepEqual(trie.search('b', 99), ['b', 'ba']);
});

test('code points outside the basic plane are single characters', () => {
  const trie = new Trie();
  for (const word of ['a', 'z', '\u{1F600}', '\uFFFD', '\uFF10']) trie.insert(word, word);
  assert.deepEqual(trie.search(''), ['a', 'z', '\uFF10', '\uFFFD', '\u{1F600}']);
  assert.deepEqual([trie.size, trie.nodeCount], [5, 6]);
  const emoji = new Trie();
  emoji.insert('\u{1F600}\u{1F601}', 'pair');
  assert.deepEqual([emoji.nodeCount, emoji.countPrefix('\u{1F600}')], [3, 1]);
  assert.equal(emoji.has('\u{1F600}'), false);
  assert.deepEqual(emoji.longestPrefixMatch('\u{1F600}\u{1F601}\u{1F602}'), { word: '\u{1F600}\u{1F601}', value: 'pair' });
  assert.equal(emoji.longestPrefixMatch('\u{1F600}'), null);
});

test('longestPrefixMatch takes the longest stored word', () => {
  const trie = new Trie();
  for (const word of ['a', 'ab', 'abcd']) trie.insert(word, word.length);
  assert.deepEqual(trie.longestPrefixMatch('abcdef'), { word: 'abcd', value: 4 });
  assert.deepEqual(trie.longestPrefixMatch('abc'), { word: 'ab', value: 2 });
  assert.deepEqual(trie.longestPrefixMatch('a'), { word: 'a', value: 1 });
  assert.equal(trie.longestPrefixMatch('b'), null);
  assert.equal(trie.longestPrefixMatch(''), null);
  trie.insert('', 'empty');
  assert.deepEqual([trie.longestPrefixMatch(''), trie.longestPrefixMatch('zzz')], [
    { word: '', value: 'empty' },
    { word: '', value: 'empty' },
  ]);
});

test('rejects malformed arguments', () => {
  const trie = new Trie();
  const bad = [
    [() => trie.insert(7, 1), 'word must be a string'],
    [() => trie.get(null), 'word must be a string'],
    [() => trie.has(undefined), 'word must be a string'],
    [() => trie.delete(['a']), 'word must be a string'],
    [() => trie.countPrefix(3), 'prefix must be a string'],
    [() => trie.search(3), 'prefix must be a string'],
    [() => trie.longestPrefixMatch(3), 'text must be a string'],
    [() => trie.search('a', -1), 'limit must be a non-negative integer'],
    [() => trie.search('a', 1.5), 'limit must be a non-negative integer'],
    [() => trie.search('a', '2'), 'limit must be a non-negative integer'],
  ];
  for (const [call, message] of bad) assert.throws(call, { name: 'TypeError', message }, message);
});

test('stays consistent with a plain map across a long random operation sequence', () => {
  const rnd = mulberry32(0x7a1e);
  const alphabet = ['a', 'b', 'c', '\u{1F600}'];
  const trie = new Trie();
  const model = new Map();
  const randomWord = () => {
    const length = Math.floor(rnd() * 5);
    let word = '';
    for (let i = 0; i < length; i += 1) word += alphabet[Math.floor(rnd() * alphabet.length)];
    return word;
  };

  for (let step = 0; step < 3000; step += 1) {
    const word = randomWord();
    if (rnd() < 0.6) {
      const value = step;
      assert.equal(trie.insert(word, value), model.get(word), `insert ${JSON.stringify(word)} at step ${step}`);
      model.set(word, value);
    } else {
      assert.equal(trie.delete(word), model.delete(word), `delete ${JSON.stringify(word)} at step ${step}`);
    }
    assert.deepEqual([trie.size, trie.nodeCount], [model.size, prefixesOf(model.keys()).size], `counts at step ${step}`);

    if (step % 25 === 0) {
      const words = [...model.keys()].sort(byCodePoint);
      assert.deepEqual(trie.entries(), words.map((key) => [key, model.get(key)]), `entries at step ${step}`);
      const probe = randomWord();
      const matching = words.filter((key) => key.startsWith(probe));
      assert.equal(trie.countPrefix(probe), matching.length, `countPrefix ${JSON.stringify(probe)} at step ${step}`);
      assert.deepEqual(trie.search(probe, 3), matching.slice(0, 3), `search ${JSON.stringify(probe)} at step ${step}`);
      const text = randomWord();
      const longest = words.filter((key) => text.startsWith(key)).sort((a, b) => a.length - b.length).pop();
      assert.deepEqual(
        trie.longestPrefixMatch(text),
        longest === undefined ? null : { word: longest, value: model.get(longest) },
        `longestPrefixMatch ${JSON.stringify(text)} at step ${step}`,
      );
    }
  }
  assert.ok(model.size > 20, `expected a populated trie, saw ${model.size}`);
});
