#!/usr/bin/env node
/** The command: `dump <file>`, `get <file> <key>`, `load <base> <site>` and `origin <base> <site>`. */

import { existsSync, readFileSync } from 'node:fs'
import { EnvError, parse as parseEnv } from './env.js'
import { IniError, parse as parseIni } from './ini.js'
import { merge } from './layer.js'
import { coerce, SETTINGS, setting, ValueError } from './schema.js'

const USAGE = 'usage: cli.js dump <file>|get <file> <key>|load <base> <site>|origin <base> <site>'

/** Report one failure the way the specification words it, and stop. */
function fail(message) {
  process.stderr.write(`error: ${message}\n`)
  process.exit(2)
}

/** One INI layer, refused at its own position when the grammar or the schema rejects it. */
function iniLayer(name, path, strict) {
  if (!existsSync(path)) fail(`cannot read ${path}`)
  let values
  try {
    values = parseIni(readFileSync(path, 'utf8'))
  } catch (error) {
    if (!(error instanceof IniError)) throw error
    fail(`${path}:${error.line}:${error.column}: ${error.message}`)
  }
  if (strict) {
    for (const [key, value] of values) {
      if (setting(key) === undefined) fail(`${path}:${value.line}:${value.column}: unknown setting ${key}`)
    }
  }
  return { name, values }
}

/** The environment layer, refused at its own position. */
function envLayer() {
  try {
    return { name: 'env', values: parseEnv(readFileSync(0, 'utf8'), SETTINGS) }
  } catch (error) {
    if (!(error instanceof EnvError)) throw error
    return fail(`<stdin>:${error.line}:${error.column}: ${error.message}`)
  }
}

const argv = process.argv.slice(2)
const mode = argv[0]
const arity = { dump: 2, get: 3, load: 3, origin: 3 }
if (argv.length !== arity[mode]) fail(USAGE)

const out = []
if (mode === 'dump' || mode === 'get') {
  const { values } = iniLayer('file', argv[1], false)
  const raw = key => (values.has(key) ? values.get(key).text : setting(key).default)
  if (mode === 'dump') {
    for (const declared of SETTINGS) out.push(`${declared.key}=${raw(declared.key)}`)
  } else {
    if (setting(argv[2]) === undefined) fail(`unknown setting ${argv[2]}`)
    out.push(raw(argv[2]))
  }
} else {
  const merged = merge([iniLayer('base', argv[1], true), iniLayer('site', argv[2], true), envLayer()])
  const source = { base: argv[1], site: argv[2], env: '<stdin>' }
  for (const declared of SETTINGS) {
    const won = merged.get(declared.key)
    if (mode === 'origin') {
      out.push(`${declared.key} ${won === undefined ? 'default' : won.name}`)
      continue
    }
    if (won === undefined) {
      out.push(`${declared.key}=${coerce(declared, declared.default)}`)
      continue
    }
    try {
      out.push(`${declared.key}=${coerce(declared, won.text)}`)
    } catch (error) {
      if (!(error instanceof ValueError)) throw error
      fail(`${source[won.name]}:${won.line}:${won.column}: ${error.message}`)
    }
  }
}
process.stdout.write(out.map(line => `${line}\n`).join(''))
