#!/usr/bin/env node
/**
 * The csv-tools command line: validate the argument list, read the input files,
 * dispatch to the subcommand module and write the table it returns.
 *
 * This file is committed at the base revision and no department changes it. It
 * is also the only place the reader and a subcommand meet: a department branch
 * carries one module and cannot load another's, so the modules are composed
 * here and nowhere else.
 */

import { readFileSync } from 'node:fs';

/** Arguments each subcommand takes after its own name. */
const ARITY = { stats: 1, filter: 4, join: 3 };

/** Exit code per error class; anything unclassified is an input failure. */
const EXIT = { usage: 1, data: 2 };

/**
 * @param {string} message diagnostic, without prefix or terminator
 * @returns {Error} a wrong-command-line failure
 */
function usageError(message) {
  const error = new Error(message);
  error.code = 'usage';
  return error;
}

/**
 * @param {string} message diagnostic, without prefix or terminator
 * @returns {Error} a wrong-input failure
 */
function dataError(message) {
  const error = new Error(message);
  error.code = 'data';
  return error;
}

/**
 * @param {string} path file to read
 * @returns {string} its UTF-8 text
 */
function readText(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    // Absent, a directory, or unreadable: one diagnostic covers all three.
    throw dataError(`cannot read ${path}`);
  }
}

/**
 * Run one command line.
 *
 * @param {string[]} argv arguments after the program name
 * @returns {Promise<string>} the document to write to stdout
 */
async function run(argv) {
  const [command, ...args] = argv;
  if (command === undefined || !Object.hasOwn(ARITY, command)) {
    throw usageError(`expected one of ${Object.keys(ARITY).join(', ')}, got ${command ?? 'nothing'}`);
  }
  if (args.length !== ARITY[command]) {
    throw usageError(`${command} takes ${ARITY[command]} argument(s), got ${args.length}`);
  }
  const { parseCsv, formatCsv } = await import('../src/csv.js');
  if (command === 'stats') {
    const { stats } = await import('../src/stats.js');
    return formatCsv(stats(parseCsv(readText(args[0]))));
  }
  if (command === 'filter') {
    const { filter } = await import('../src/filter.js');
    return formatCsv(filter(parseCsv(readText(args[0])), args[1], args[2], args[3]));
  }
  const { join } = await import('../src/join.js');
  return formatCsv(join(parseCsv(readText(args[0])), parseCsv(readText(args[1])), args[2]));
}

try {
  process.stdout.write(await run(process.argv.slice(2)));
} catch (error) {
  process.stderr.write(`csv-tools: ${error.message}\n`);
  process.exitCode = EXIT[error.code] ?? EXIT.data;
}
