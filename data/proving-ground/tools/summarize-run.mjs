#!/usr/bin/env node
// Summarizes one recorded Proving Ground run from its session logs: one row per
// cell with what the README rows and paragraphs state (arm, environment,
// repetition, implementer, route, certificate, attempts, wall seconds, steps,
// usage), then one line of totals per arm. Usage of a delegated cell is what
// its `environment/delegation` records charged it (the child's reported usage,
// else the in-process child's summed usage), as the runner reports it. Node
// built-ins only.
//
// Usage: node summarize-run.mjs <record-directory> [--json]
//
//   <record-directory>  a directory under data/proving-ground/ holding sessions/
//   --json              print the rows and the totals as JSON instead of a table
//
// A cell is a session log carrying an `environment/run` stamp; a session
// without one (a delegated child) is not a row, its spend reaches its cell's
// row through the cell's delegation records.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const [recordArg, ...flags] = process.argv.slice(2)
if (!recordArg) throw new Error('usage: summarize-run.mjs <record-directory> [--json]')
const asJson = flags.includes('--json')
const root = resolve(recordArg)

function* sessionLogs(directory) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) yield* sessionLogs(path)
    else if (entry.endsWith('.jsonl')) yield path
  }
}

/** Sum token usages the way the runner does: optional counters appear when any entry carries them. */
function sumUsage(usages) {
  const total = { inputTokens: 0, outputTokens: 0 }
  for (const usage of usages) {
    total.inputTokens += usage.inputTokens ?? 0
    total.outputTokens += usage.outputTokens ?? 0
    for (const key of ['cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']) {
      if (usage[key] !== undefined) total[key] = (total[key] ?? 0) + usage[key]
    }
  }
  return total
}

/** The arm a stamp group names: the role suffix of an experiment group, the whole group otherwise. */
function armOf(group) {
  if (group === undefined) return '-'
  const experiment = /^experiment-[0-9a-f]+-(baseline|candidate)$/.exec(group)
  return experiment ? experiment[1] : group.replace(/^fleet-[0-9a-f-]+$/, 'fleet')
}

function cellRow(events) {
  const stamp = events.find(event => event.type === 'environment/run')
  if (stamp === undefined) return undefined
  const data = stamp.data
  const usages = []
  let attempts = 0, steps = 0, toolCalls = 0, breaches = 0, denied = 0, certified = false
  for (const event of events) {
    switch (event.type) {
      case 'verification/run': attempts += 1; break
      case 'verification/certificate': certified = true; break
      case 'step/start': steps += 1; break
      case 'tool/call': toolCalls += 1; break
      case 'budget/breach': breaches += 1; break
      case 'read-barrier/denied': denied += 1; break
      case 'assistant/message': if (event.data.usage) usages.push(event.data.usage); break
      case 'environment/delegation': {
        const spent = event.data.reportedUsage ?? event.data.usage
        if (spent) usages.push(spent)
        break
      }
      default: break
    }
  }
  const times = events.map(event => event.time).filter(time => typeof time === 'number')
  const first = times[0] ?? 0, last = times[times.length - 1] ?? 0
  return {
    arm: armOf(data.group),
    environment: data.environmentId,
    repetition: data.repetition,
    implementer: data.implementer ?? 'route',
    route: (data.ladder ?? [data.model]).map(model => model.model).join('>'),
    certified,
    attempts,
    seconds: Math.round((last - first) / 1000),
    steps,
    toolCalls,
    breaches,
    denied,
    ...sumUsage(usages),
  }
}

const rows = []
for (const path of sessionLogs(join(root, 'sessions'))) {
  const events = readFileSync(path, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
  const row = cellRow(events)
  if (row) rows.push(row)
}
rows.sort((a, b) => a.arm.localeCompare(b.arm) || a.environment.localeCompare(b.environment) || a.repetition - b.repetition)

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.length === 0 ? 0 : sorted[Math.floor(sorted.length / 2)]
}
const totals = []
for (const arm of [...new Set(rows.map(row => row.arm))]) {
  const cells = rows.filter(row => row.arm === arm)
  const sum = key => cells.reduce((total, row) => total + (row[key] ?? 0), 0)
  totals.push({
    arm,
    cells: cells.length,
    certified: cells.filter(row => row.certified).length,
    firstAttempt: cells.filter(row => row.certified && row.attempts === 1).length,
    attemptsMean: cells.length === 0 ? 0 : Number((sum('attempts') / cells.length).toFixed(2)),
    seconds: sum('seconds'),
    secondsMedian: median(cells.map(row => row.seconds)),
    steps: sum('steps'),
    breachedCells: cells.filter(row => row.breaches > 0).length,
    denied: sum('denied'),
    inputTokens: sum('inputTokens'),
    outputTokens: sum('outputTokens'),
    cacheReadTokens: sum('cacheReadTokens'),
    cacheWriteTokens: sum('cacheWriteTokens'),
    billedTokens: sum('inputTokens') + sum('cacheReadTokens') + sum('cacheWriteTokens'),
  })
}

if (asJson) {
  process.stdout.write(`${JSON.stringify({ record: root, rows, totals }, null, 2)}\n`)
} else {
  const pad = (value, width) => String(value).padEnd(width)
  const num = (value, width) => String(value).padStart(width)
  console.log(`${pad('arm', 10)} ${pad('environment', 22)} rep ${pad('implementer', 12)} ${pad('route', 18)} cert att ${num('secs', 6)} ${num('steps', 5)} ${num('output', 8)} ${num('read', 10)} ${num('write', 9)} brk den`)
  for (const row of rows) {
    console.log(`${pad(row.arm, 10)} ${pad(row.environment, 22)} ${num(row.repetition, 3)} ${pad(row.implementer, 12)} ${pad(row.route, 18)} ${pad(row.certified ? 'yes' : 'no', 4)} ${num(row.attempts, 3)} ${num(row.seconds, 6)} ${num(row.steps, 5)} ${num(row.outputTokens, 8)} ${num(row.cacheReadTokens ?? 0, 10)} ${num(row.cacheWriteTokens ?? 0, 9)} ${num(row.breaches, 3)} ${num(row.denied, 3)}`)
  }
  console.log('')
  for (const total of totals) {
    console.log(`${total.arm}: ${total.certified} of ${total.cells} certified (${total.firstAttempt} at the first attempt), attempts mean ${total.attemptsMean}, ${total.seconds} s of cell time (median ${total.secondsMedian} s), ${total.steps} steps, ${total.breachedCells} cells breached a cap, ${total.denied} reads denied, ${total.outputTokens} output tokens, ${total.cacheReadTokens} cache-read, ${total.cacheWriteTokens} cache-write, ${total.billedTokens} billed`)
  }
}
