#!/usr/bin/env node
/** The command: `dump <file>` and `get <file> <key>`. */

import { existsSync, readFileSync } from 'node:fs'
import { IniError, parse as parseIni } from './ini.js'
import { merge } from './layer.js'
import { SETTINGS, setting } from './schema.js'

const USAGE = 'usage: cli.js dump <file>|get <file> <key>'

/** Report one failure the way the specification words it, and stop. */
function fail(message) {
  process.stderr.write(`error: ${message}\n`)
  process.exit(2)
}

/** One INI layer, refused at its own position when the grammar rejects it. */
function iniLayer(name, path) {
  if (!existsSync(path)) fail(`cannot read ${path}`)
  try {
    return { name, values: parseIni(readFileSync(path, 'utf8')) }
  } catch (error) {
    if (!(error instanceof IniError)) throw error
    return fail(`${path}:${error.line}:${error.column}: ${error.message}`)
  }
}

const argv = process.argv.slice(2)
const mode = argv[0]
const arity = { dump: 2, get: 3 }
if (argv.length !== arity[mode]) fail(USAGE)

const values = merge([iniLayer('file', argv[1])])
const raw = key => (values.has(key) ? values.get(key) : setting(key).default)
const out = []
if (mode === 'dump') {
  for (const declared of SETTINGS) out.push(`${declared.key}=${raw(declared.key)}`)
} else {
  if (setting(argv[2]) === undefined) fail(`unknown setting ${argv[2]}`)
  out.push(raw(argv[2]))
}
process.stdout.write(out.map(line => `${line}\n`).join(''))
