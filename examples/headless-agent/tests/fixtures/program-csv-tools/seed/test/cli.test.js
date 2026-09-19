/**
 * The command line end to end: the exit codes and the stdout/stderr discipline
 * of SPEC.md, over the real `bin/csv-tools.js`.
 *
 * Every subcommand module has to exist for this file to pass, so no department
 * branch satisfies it and the integration over the merged head is what does.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const CLI = fileURLToPath(new URL('../bin/csv-tools.js', import.meta.url));
const WORK = mkdtempSync(join(tmpdir(), 'csv-tools-cli-'));

/**
 * @param {string} name file to write under the scratch directory
 * @param {string} text its contents
 * @returns {string} the absolute path
 */
function fixture(name, text) {
  const path = join(WORK, name);
  writeFileSync(path, text);
  return path;
}

/**
 * Run the command line and capture all three channels.
 *
 * @param {string[]} args arguments after the program name
 * @returns {{ status: number, stdout: string, stderr: string }} what the run came to
 */
function run(args) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    return { status: error.status, stdout: error.stdout, stderr: error.stderr };
  }
}

const PEOPLE = fixture('people.csv', 'name,age\r\nalice,30\r\n"bo, b",9\r\n');
const CITIES = fixture('cities.csv', 'name,city\nalice,"Paris"\n"bo, b",Lyon\n');

test('stats prints its header and every numeric column', () => {
  assert.deepEqual(run(['stats', PEOPLE]), { status: 0, stdout: 'column,count,min,max,mean\nage,2,9,30,19.5\n', stderr: '' });
});

test('filter prints the header and the matching rows, re-quoted', () => {
  assert.deepEqual(run(['filter', PEOPLE, 'age', '<', '10']), { status: 0, stdout: 'name,age\n"bo, b",9\n', stderr: '' });
});

test('join prints the left columns and the right ones', () => {
  assert.deepEqual(run(['join', PEOPLE, CITIES, 'name']), {
    status: 0,
    stdout: 'name,age,city\nalice,30,Paris\n"bo, b",9,Lyon\n',
    stderr: '',
  });
});

test('a missing subcommand is a usage failure on stderr alone', () => {
  const result = run([]);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'csv-tools: expected one of stats, filter, join, got nothing\n');
});

test('an unknown subcommand is a usage failure', () => {
  assert.equal(run(['sort', PEOPLE]).stderr, 'csv-tools: expected one of stats, filter, join, got sort\n');
  assert.equal(run(['sort', PEOPLE]).status, 1);
});

test('the wrong number of arguments is a usage failure', () => {
  const result = run(['filter', PEOPLE, 'age']);
  assert.equal(result.status, 1);
  assert.equal(result.stderr, 'csv-tools: filter takes 4 argument(s), got 2\n');
});

test('an unknown operator is a usage failure', () => {
  const result = run(['filter', PEOPLE, 'age', '~', '9']);
  assert.equal(result.status, 1);
  assert.equal(result.stderr, 'csv-tools: unknown operator: ~\n');
});

test('an unreadable file is an input failure', () => {
  const result = run(['stats', join(WORK, 'absent.csv')]);
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, `csv-tools: cannot read ${join(WORK, 'absent.csv')}\n`);
});

test('a malformed document is an input failure', () => {
  const ragged = fixture('ragged.csv', 'a,b\n1\n');
  const result = run(['stats', ragged]);
  assert.equal(result.status, 2);
  assert.equal(result.stderr, 'csv-tools: row 1: expected 2 fields, got 1\n');
});

test('an unknown column is an input failure', () => {
  assert.equal(run(['filter', PEOPLE, 'height', '=', '1']).status, 2);
  assert.equal(run(['join', PEOPLE, CITIES, 'height']).stderr, 'csv-tools: unknown column: height\n');
});
