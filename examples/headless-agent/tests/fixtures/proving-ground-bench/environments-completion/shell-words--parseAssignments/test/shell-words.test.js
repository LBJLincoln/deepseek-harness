import test from 'node:test';
import assert from 'node:assert/strict';
import { ShellWordsError, join, parseAssignments, quote, splitCommands, tokenize, tokenizeDetailed } from '../src/index.js';

/** Deterministic 32-bit PRNG so generated command lines replay identically. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('whitespace separates words', () => {
  assert.deepEqual(tokenize('ls -la /tmp'), ['ls', '-la', '/tmp']);
  assert.deepEqual(tokenize('  spaced   out  '), ['spaced', 'out']);
  assert.deepEqual(tokenize('tab\tseparated\nlines'), ['tab', 'separated', 'lines']);
  assert.deepEqual(tokenize(''), []);
  assert.deepEqual(tokenize('   '), []);
  assert.deepEqual(tokenize('one'), ['one']);
});

test('single quotes take everything literally', () => {
  assert.deepEqual(tokenize("'a b'"), ['a b']);
  assert.deepEqual(tokenize("'$HOME #x \\n'"), ['$HOME #x \\n']);
  assert.deepEqual(tokenize("''"), ['']);
  assert.deepEqual(tokenize("a''b"), ['ab']);
  assert.deepEqual(tokenize("'a'\\''b'"), ["a'b"]);
  assert.deepEqual(tokenize("pre'mid'post"), ['premidpost']);
});

test('double quotes keep spaces but expand variables', () => {
  const env = { NAME: 'bo', EMPTY: '' };
  assert.deepEqual(tokenize('"a b"'), ['a b']);
  assert.deepEqual(tokenize('"hi $NAME"', { env }), ['hi bo']);
  assert.deepEqual(tokenize('"${NAME}s"', { env }), ['bos']);
  assert.deepEqual(tokenize('""'), ['']);
  assert.deepEqual(tokenize('a"b c"d'), ['ab cd']);
  assert.deepEqual(tokenize('"$EMPTY"', { env }), ['']);
});

test('a backslash inside double quotes escapes only four characters', () => {
  assert.deepEqual(tokenize('"a\\"b"'), ['a"b']);
  assert.deepEqual(tokenize('"a\\\\b"'), ['a\\b']);
  assert.deepEqual(tokenize('"a\\$b"'), ['a$b']);
  assert.deepEqual(tokenize('"a\\`b"'), ['a`b']);
  assert.deepEqual(tokenize('"a\\nb"'), ['a\\nb'], 'a backslash before n stays literal');
  assert.deepEqual(tokenize('"a\\tb"'), ['a\\tb'], 'a backslash before t stays literal');
  assert.deepEqual(tokenize('"c:\\path"'), ['c:\\path']);
  assert.deepEqual(tokenize('"a\\\nb"'), ['ab'], 'a backslash before a newline continues the line');
});

test('a backslash outside quotes escapes anything', () => {
  assert.deepEqual(tokenize('a\\ b'), ['a b']);
  assert.deepEqual(tokenize('\\$HOME'), ['$HOME']);
  assert.deepEqual(tokenize('a\\\\b'), ['a\\b']);
  assert.deepEqual(tokenize('\\#not-a-comment'), ['#not-a-comment']);
  assert.deepEqual(tokenize('a\\\nb'), ['ab']);
  assert.deepEqual(tokenize('\\"quoted\\"'), ['"quoted"']);
});

test('a comment needs to start a word', () => {
  assert.deepEqual(tokenize('a # b'), ['a']);
  assert.deepEqual(tokenize('a#b'), ['a#b'], 'a hash inside a word is an ordinary character');
  assert.deepEqual(tokenize('#everything'), []);
  assert.deepEqual(tokenize('a # b\nc'), ['a', 'c']);
  assert.deepEqual(tokenize('"#"'), ['#']);
  assert.deepEqual(tokenize("a '#' b"), ['a', '#', 'b']);
  assert.deepEqual(tokenize('x=1#2'), ['x=1#2']);
  assert.deepEqual(tokenize('a "b"#c'), ['a', 'b#c']);
});

test('variables expand from the given environment only', () => {
  const env = { FOO: 'bar', N: '3', SPACED: 'x y' };
  assert.deepEqual(tokenize('$FOO', { env }), ['bar']);
  assert.deepEqual(tokenize('${FOO}', { env }), ['bar']);
  assert.deepEqual(tokenize('a${FOO}b', { env }), ['abarb']);
  assert.deepEqual(tokenize('$FOO$N', { env }), ['bar3']);
  assert.deepEqual(tokenize('$SPACED', { env }), ['x y'], 'an expansion is never split again');
  assert.deepEqual(tokenize('$MISSING', { env }), ['']);
  assert.deepEqual(tokenize('a$MISSING', { env }), ['a']);
  assert.deepEqual(tokenize("'$FOO'", { env }), ['$FOO']);
  assert.deepEqual(tokenize('$FOO_', { env }), [''], 'the name runs to the last name character');
});

test('a dollar that starts no name is an ordinary character', () => {
  assert.deepEqual(tokenize('$1'), ['$1']);
  assert.deepEqual(tokenize('$-x'), ['$-x']);
  assert.deepEqual(tokenize('$'), ['$']);
  assert.deepEqual(tokenize('a$ b'), ['a$', 'b']);
  assert.deepEqual(tokenize('"$9"'), ['$9']);
  assert.deepEqual(tokenize('100$'), ['100$']);
});

test('unreadable input reports a code and an offset', () => {
  const cases = [
    ["'unclosed", 'UNTERMINATED_SINGLE_QUOTE', 0],
    ['a b \'x', 'UNTERMINATED_SINGLE_QUOTE', 4],
    ['"unclosed', 'UNTERMINATED_DOUBLE_QUOTE', 0],
    ['ok "then', 'UNTERMINATED_DOUBLE_QUOTE', 3],
    ['trailing\\', 'DANGLING_ESCAPE', 8],
    ['"inside\\', 'DANGLING_ESCAPE', 7],
    ['${FOO', 'UNTERMINATED_BRACE', 0],
    ['a ${', 'UNTERMINATED_BRACE', 2],
    ['${}', 'BAD_NAME', 0],
    ['${1bad}', 'BAD_NAME', 0],
    ['${a-b}', 'BAD_NAME', 0],
  ];
  for (const [input, code, index] of cases) {
    assert.throws(() => tokenize(input), { name: 'ShellWordsError', code, index }, `case ${JSON.stringify(input)}`);
  }
  assert.throws(() => tokenize('$NOPE', { env: {}, strict: true }), {
    code: 'UNSET_VARIABLE',
    message: 'unset variable: NOPE',
  });
  assert.equal(tokenize('$NOPE', { env: { NOPE: 'set' }, strict: true })[0], 'set');
  assert.throws(() => tokenize(7), { code: 'BAD_INPUT' });
  assert.throws(() => tokenize('a', { env: 'no' }), { code: 'BAD_INPUT' });
});

test('detailed tokens carry their span and whether they were quoted', () => {
  assert.deepEqual(tokenizeDetailed('echo "hi $NAME" plain', { env: { NAME: 'bo' } }), [
    { value: 'echo', start: 0, end: 4, quoted: false },
    { value: 'hi bo', start: 5, end: 15, quoted: true },
    { value: 'plain', start: 16, end: 21, quoted: false },
  ]);
  assert.deepEqual(tokenizeDetailed("'a' b"), [
    { value: 'a', start: 0, end: 3, quoted: true },
    { value: 'b', start: 4, end: 5, quoted: false },
  ]);
  assert.deepEqual(tokenizeDetailed('x "y" z w'), [
    { value: 'x', start: 0, end: 1, quoted: false },
    { value: 'y', start: 2, end: 5, quoted: true },
    { value: 'z', start: 6, end: 7, quoted: false },
    { value: 'w', start: 8, end: 9, quoted: false },
  ]);
  assert.deepEqual(tokenizeDetailed('  a  '), [{ value: 'a', start: 2, end: 3, quoted: false }]);
});

test('quote produces something the tokenizer reads back', () => {
  assert.equal(quote('plain'), 'plain');
  assert.equal(quote('a/b-c_d.e'), 'a/b-c_d.e');
  assert.equal(quote(''), "''");
  assert.equal(quote('a b'), "'a b'");
  assert.equal(quote('$HOME'), "'$HOME'");
  assert.equal(quote("it's"), "'it'\\''s'");
  assert.equal(quote('#hash'), "'#hash'");
  assert.equal(join(['echo', 'a b', "it's"]), "echo 'a b' 'it'\\''s'");
  assert.equal(join([]), '');
  assert.deepEqual(tokenize(join(['echo', 'a b', "it's", '', '$X', '#c'])), ['echo', 'a b', "it's", '', '$X', '#c']);
  assert.throws(() => quote(5), { code: 'BAD_INPUT' });
  assert.throws(() => join('a'), { code: 'BAD_INPUT' });
});

test('leading assignments stop at the first ordinary word', () => {
  assert.deepEqual(parseAssignments(['A=1', 'B=2', 'run', 'C=3']), {
    assignments: { A: '1', B: '2' },
    argv: ['run', 'C=3'],
  });
  assert.deepEqual(parseAssignments(['run', 'A=1']), { assignments: {}, argv: ['run', 'A=1'] });
  assert.deepEqual(parseAssignments(['A=', 'x']), { assignments: { A: '' }, argv: ['x'] });
  assert.deepEqual(parseAssignments(['A=1', 'A=2', 'x']), { assignments: { A: '2' }, argv: ['x'] });
  assert.deepEqual(parseAssignments(['1A=1', 'x']), { assignments: {}, argv: ['1A=1', 'x'] });
  assert.deepEqual(parseAssignments(['A=a=b', 'x']), { assignments: { A: 'a=b' }, argv: ['x'] });
  assert.deepEqual(parseAssignments([]), { assignments: {}, argv: [] });
  assert.deepEqual(parseAssignments(tokenize('PATH="/a b" LANG=C run -x')), {
    assignments: { PATH: '/a b', LANG: 'C' },
    argv: ['run', '-x'],
  });
  assert.throws(() => parseAssignments('A=1'), { code: 'BAD_INPUT' });
});

test('only a bare semicolon separates commands', () => {
  assert.deepEqual(splitCommands('a b ; c'), [['a', 'b'], ['c']]);
  assert.deepEqual(splitCommands('a;b'), [['a;b']], 'a semicolon inside a word is data');
  assert.deepEqual(splitCommands('a ";" b'), [['a', ';', 'b']], 'a quoted semicolon is data');
  assert.deepEqual(splitCommands("a ';' b"), [['a', ';', 'b']]);
  assert.deepEqual(splitCommands('a \\; b'), [['a', ';', 'b']], 'an escaped semicolon is data');
  assert.deepEqual(splitCommands(' ; ; a ; '), [['a']]);
  assert.deepEqual(splitCommands(''), []);
  assert.deepEqual(splitCommands('echo $X ; echo done', { env: { X: 'v' } }), [['echo', 'v'], ['echo', 'done']]);
  assert.throws(() => splitCommands("a ; 'b"), { code: 'UNTERMINATED_SINGLE_QUOTE' });
});

test('quoting round-trips every generated word list', () => {
  const pick = mulberry32(515151);
  const alphabet = ['a', 'b', ' ', '\t', '\n', "'", '"', '\\', '$', '#', '=', '日', '*', '{', '}', ';', 'X'];
  for (let round = 0; round < 300; round += 1) {
    const words = [];
    const count = Math.floor(pick() * 4);
    for (let index = 0; index < count; index += 1) {
      const length = Math.floor(pick() * 6);
      let word = '';
      for (let position = 0; position < length; position += 1) {
        word += alphabet[Math.floor(pick() * alphabet.length)];
      }
      words.push(word);
    }
    const line = join(words);
    assert.deepEqual(tokenize(line), words, `round ${round} for ${JSON.stringify(line)}`);
    assert.deepEqual(tokenize(line, { env: { a: 'NOPE' }, strict: true }), words, 'quoting blocks expansion');
    const detailed = tokenizeDetailed(line);
    assert.equal(detailed.length, words.length, 'one detailed token per word');
    for (const token of detailed) {
      assert.equal(line.slice(token.start, token.end).length, token.end - token.start, 'spans stay inside the line');
      assert.ok(token.start >= 0 && token.end <= line.length && token.start < token.end, 'spans are ordered');
    }
  }
});
