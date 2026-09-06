/**
 * Producer: the live Proving Ground's environments — four small program
 * tasks, each a Node project whose own test suite is the standard and whose
 * tests are immutable; three are training-eligible and one is held out.
 */

import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { EnvironmentId } from '@deepseek-ai/dsh-environments'
import type { EnvironmentDefinition } from '@deepseek-ai/dsh-environments'
import { CheckId } from '@deepseek-ai/dsh-verification'

declare module '@deepseek-ai/dsh-environments/types' {
  interface EnvironmentKindMap {
    /** A small program task in one language, verified by the fixture's own test suite. */
    code: { readonly language: string }
  }
}

export const name = 'register-environments'
export const inject = ['environments']

const OWNER = 'headless-agent village-live fixture'
const TESTS_PASS = CheckId('tests-pass')
const NO_DEPENDENCIES = CheckId('no-dependencies')

/** The rules every task shares: only `src/` changes, the tests and the manifest stay, nothing gets installed. */
const SHARED_RULES = 'Change only files under src/. Do not modify anything under test/ or package.json, and add no dependencies: node_modules must not exist. The standard is `node --test test/` passing in the workspace root.'

/** A Node project task whose fixture's tests are the standard and may not be edited. */
function code(id: string, fixture: string, description: string, prompt: string, heldOut: boolean): EnvironmentDefinition<'code'> {
  return {
    id: EnvironmentId(id),
    kind: 'code',
    name: id,
    description,
    task: {
      prompt: `${prompt} ${SHARED_RULES}`,
      fixture: fileURLToPath(new URL(`./environments/${fixture}`, import.meta.url)),
      immutable: ['test', 'package.json'],
    },
    checks: [
      { id: TESTS_PASS, outcome: 'node --test test/ passes in the workspace root', run: 'node --test test/' },
      { id: NO_DEPENDENCIES, outcome: 'no dependency was installed', run: 'test ! -e node_modules' },
    ],
    heldOut,
    owner: OWNER,
    provenance: 'curated',
    detail: { language: 'javascript' },
  }
}

/**
 * Register the four environments under the producer's own fiber.
 * @param ctx - the plugin context carrying the environment registry.
 */
export function apply(ctx: Context): void {
  const definitions = [
    code(
      'code:slugify',
      'slugify',
      'Implement a URL slug function against its test suite.',
      'Implement `slugify(input)` in `src/slugify.js`: lowercase the text, remove diacritics (NFD normalization, then drop the combining marks), replace every run of characters other than ASCII letters and digits with a single hyphen, trim leading and trailing hyphens, return an empty string when nothing remains, and throw a TypeError for a non-string argument.',
      false,
    ),
    code(
      'code:parse-duration',
      'parse-duration',
      'Implement a duration parser against its test suite.',
      'Implement `parseDuration(text)` in `src/duration.js`: a duration is a non-empty string of one to three components in the fixed order hours, minutes, seconds, each a non-negative integer immediately followed by `h`, `m`, or `s`, each unit at most once (`1h30m15s`, `2h`, `45m`, `90s`); return the total number of seconds as a number, and throw a TypeError for anything else, including a non-string, an empty string, whitespace, a sign, decimals, unknown units, repeated units, or units out of order.',
      false,
    ),
    code(
      'code:paginate-fix',
      'paginate-fix',
      'Fix a pagination function so its test suite passes.',
      '`src/paginate.js` is wrong and `node --test test/` fails. Fix `paginate(items, page, size)` so pages are 1-based, `pages` is the number of pages needed to hold every item (0 for an empty list), pages past the last are empty, the input is never mutated, and a non-positive or fractional page or size throws a RangeError.',
      false,
    ),
    code(
      'code:csv-sum',
      'csv-sum',
      'Held out: sum one CSV column against its test suite.',
      'Implement `sumColumn(csv, column)` in `src/csv.js`: parse a comma-separated document whose first line is the header, find the named column, and return the sum of its numeric cells as a number; ignore empty cells and a missing trailing newline; return 0 when only the header is present; throw a RangeError for an unknown column, and a TypeError whose message names the offending data row as `row N` (counting data rows from 1) for a non-numeric cell.',
      true,
    ),
  ]
  for (const definition of definitions) ctx.effect(() => ctx.environments.register(definition))
}
