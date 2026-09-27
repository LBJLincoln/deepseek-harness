#!/usr/bin/env node
// Prints the rows of the `## Runs` table of data/proving-ground/README.md
// (`--lang en`) or README.zh.md (`--lang zh`) for one recorded bench run, so a
// record's rows are generated from the record instead of hand-written. It
// reads the record's own durable files and nothing else: manifest.json for the
// run name and the repository head, result.json for whether the run was a
// fleet or a frozen pair, and facts.jsonl for one fact per cell (environment,
// model, repetition, group, certificate, attempts, wall milliseconds). Node
// built-ins only.
//
// Usage: node readme-rows.mjs <record-directory> --lang en|zh --implementer "<text>"
//
//   <record-directory>  a directory under data/proving-ground/ holding
//                       manifest.json, result.json and facts.jsonl
//   --lang              which README the rows are for
//   --implementer       the Implementer column, hand-written per record and
//                       printed verbatim, except that `{model}` in it is
//                       replaced by the row's model id, which is how a fleet
//                       of several models gets one row per model
//
// A fleet record (result.json carries `report`) prints one row per environment
// and model, sorted by environment then model. A frozen-pair record
// (result.json carries `result.arms`) prints one row per environment whose
// cells state the baseline arm, then ` vs ` (` 对 `), then the candidate arm.
// Within a cell the repetitions are in repetition order: `X of N` (`X 之 N`)
// certified; the attempts as `N` for one repetition, `N each` (`各 N`) when
// every repetition agrees, else the list; and the wall seconds of each
// repetition, `Math.round(wallMs / 1000)`, as a list followed by ` s`. A list
// reads `a and b` or `a, b, and c` in English and `a 与 b` or `a、b 与 c` in
// Chinese, except a pair's seconds, which read `a、b`.
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { armOf } from './summarize-run.mjs'

/** The two arms of a frozen pair, in the order a row states them. */
const PAIR_ARMS = ['baseline', 'candidate']

/** Placeholder of `--implementer` that stands for the row's model id. */
const MODEL_PLACEHOLDER = '{model}'

/** Characters of the repository head a row shows. */
const SHORT_HEAD = 9

/** Per-language separators and list forms. */
const LANGUAGES = {
  en: {
    of: ' of ',
    each: count => `${count} each`,
    vs: ' vs ',
    list: joinEnglish,
    pairSeconds: joinEnglish,
  },
  zh: {
    of: ' 之 ',
    each: count => `各 ${count}`,
    vs: ' 对 ',
    list: joinChinese,
    pairSeconds: items => items.join('、'),
  },
}

/**
 * `a`, `a and b`, or `a, b, and c`.
 * @param {(string | number)[]} items at least one item.
 * @returns {string} the English list.
 */
export function joinEnglish(items) {
  if (items.length <= 1) return items.join('')
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
}

/**
 * `a`, `a 与 b`, or `a、b 与 c`.
 * @param {(string | number)[]} items at least one item.
 * @returns {string} the Chinese list.
 */
export function joinChinese(items) {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join('、')} 与 ${items[items.length - 1]}`
}

/**
 * Read one record's durable files into the cells a row is built from.
 * @param {string} directory the record directory.
 * @returns {{ run: string, head: string, kind: 'fleet' | 'pair', cells: { environment: string, model: string, repetition: number, arm: string, certified: boolean, attempts: number, seconds: number }[] }} the record.
 */
export function readRecord(directory) {
  const root = resolve(directory)
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'))
  const result = JSON.parse(readFileSync(join(root, 'result.json'), 'utf8'))
  const kind = result.result?.arms !== undefined ? 'pair' : result.report !== undefined ? 'fleet' : undefined
  if (kind === undefined) throw new Error(`${root}/result.json is neither a fleet report nor a frozen pair; only bench records have rows this tool can print`)
  const cells = readFileSync(join(root, 'facts.jsonl'), 'utf8').split('\n').filter(Boolean).map((line) => {
    const fact = JSON.parse(line)
    const environment = fact.identity.environment
    return {
      environment: environment.environmentId,
      model: environment.model,
      repetition: environment.repetition,
      arm: armOf(environment.group),
      certified: fact.outcome.certified === true,
      attempts: fact.outcome.attempts,
      seconds: Math.round(fact.efficiency.wallMs / 1000),
    }
  })
  return { run: manifest.run, head: manifest.repository.head, kind, cells }
}

/**
 * The three cells of one arm or one fleet row over its repetitions.
 * @param {{ certified: boolean, attempts: number, seconds: number, repetition: number }[]} cells the repetitions, unordered.
 * @param {typeof LANGUAGES.en} language the language's forms.
 * @param {(items: number[]) => string} seconds how this row lists seconds.
 * @returns {{ certified: string, attempts: string, elapsed: string }} the cell texts.
 */
function armCells(cells, language, seconds) {
  const ordered = [...cells].sort((a, b) => a.repetition - b.repetition)
  const attempts = ordered.map(cell => cell.attempts)
  return {
    certified: `${ordered.filter(cell => cell.certified).length}${language.of}${ordered.length}`,
    attempts: ordered.length === 1
      ? `${attempts[0]}`
      : attempts.every(value => value === attempts[0]) ? language.each(attempts[0]) : language.list(attempts),
    elapsed: `${seconds(ordered.map(cell => cell.seconds))} s`,
  }
}

/**
 * The Implementer column of one row.
 * @param {string} implementer the `--implementer` text.
 * @param {{ model: string }[]} cells the row's cells.
 * @param {string} environment the row's environment, for the refusal.
 * @returns {string} the text with `{model}` replaced by the row's one model.
 */
function implementerColumn(implementer, cells, environment) {
  if (!implementer.includes(MODEL_PLACEHOLDER)) return implementer
  const models = new Set(cells.map(cell => cell.model))
  if (models.size !== 1) throw new Error(`${environment}: its cells ran ${[...models].sort().join(', ')}, so ${MODEL_PLACEHOLDER} names no one model; write the models into --implementer by hand`)
  return implementer.replaceAll(MODEL_PLACEHOLDER, cells[0].model)
}

/**
 * The README rows of one record, in table order.
 * @param {ReturnType<typeof readRecord>} record what {@link readRecord} returned.
 * @param {{ lang: 'en' | 'zh', implementer: string }} options the language and the Implementer column.
 * @returns {string[]} one Markdown table row per line, without newlines.
 */
export function rowsOf(record, { lang, implementer }) {
  const language = LANGUAGES[lang]
  if (language === undefined) throw new Error(`--lang must be en or zh, got ${lang}`)
  const groups = new Map()
  for (const cell of record.cells) {
    const key = record.kind === 'fleet' ? `${cell.environment}\u0000${cell.model}` : cell.environment
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(cell)
  }
  const keys = [...groups.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  return keys.map((key) => {
    const cells = groups.get(key)
    const environment = cells[0].environment
    let columns
    if (record.kind === 'fleet') {
      columns = armCells(cells, language, language.list)
    } else {
      const arms = PAIR_ARMS.map((arm) => {
        const own = cells.filter(cell => cell.arm === arm)
        if (own.length === 0) throw new Error(`${environment}: no ${arm} cell in this record; a pair an arm never ran is stated by hand`)
        return armCells(own, language, language.pairSeconds)
      })
      columns = Object.fromEntries(['certified', 'attempts', 'elapsed'].map(column => [column, arms.map(arm => arm[column]).join(language.vs)]))
    }
    return [
      `[${record.run}](${record.run}/manifest.json)`,
      `\`${record.head.slice(0, SHORT_HEAD)}\``,
      implementerColumn(implementer, cells, environment),
      `\`${environment}\``,
      columns.certified,
      columns.attempts,
      columns.elapsed,
    ].join(' | ').replace(/^/, '| ').replace(/$/, ' |')
  })
}

/**
 * Parse the command line.
 * @param {string[]} argv arguments after the script path.
 * @returns {{ directory: string, lang: 'en' | 'zh', implementer: string }} the request.
 */
export function parseArgs(argv) {
  const usage = 'usage: node readme-rows.mjs <record-directory> --lang en|zh --implementer "<text>"'
  const positional = []
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--lang' || argument === '--implementer') {
      const value = argv[index + 1]
      if (value === undefined) throw new Error(`${argument} needs a value\n${usage}`)
      options[argument.slice(2)] = value
      index += 1
    } else if (argument.startsWith('--')) {
      throw new Error(`unknown option ${argument}\n${usage}`)
    } else {
      positional.push(argument)
    }
  }
  if (positional.length !== 1 || options.lang === undefined || options.implementer === undefined) throw new Error(usage)
  if (!Object.hasOwn(LANGUAGES, options.lang)) throw new Error(`--lang must be en or zh, got ${options.lang}\n${usage}`)
  return { directory: positional[0], lang: options.lang, implementer: options.implementer }
}

function main() {
  const { directory, lang, implementer } = parseArgs(process.argv.slice(2))
  const rows = rowsOf(readRecord(directory), { lang, implementer })
  process.stdout.write(rows.map(row => `${row}\n`).join(''))
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
