#!/usr/bin/env node
/** The command: `rounds` prints every round of the runoff, `tally` prints only the outcome. */

import { readFileSync } from 'node:fs'
import { BallotError, parse, run } from './election.js'

/** Report one failure the way the specification words it, and stop. */
function fail(message) {
  process.stderr.write(`error: ${message}\n`)
  process.exit(2)
}

/** Every input line, with the trailing newline's empty tail dropped. */
function lines() {
  const split = readFileSync(0, 'utf8').split('\n')
  if (split.length > 0 && split[split.length - 1] === '') split.pop()
  return split
}

const argv = process.argv.slice(2)
if (argv.length !== 1 || (argv[0] !== 'rounds' && argv[0] !== 'tally')) fail('usage: cli.js rounds|tally')

let election
try {
  election = parse(lines())
} catch (error) {
  if (!(error instanceof BallotError)) throw error
  fail(error.line === 0 ? error.message : `line ${error.line}: ${error.message}`)
}

const result = run(election.candidates, election.ballots)
const out = []
if (argv[0] === 'rounds') {
  result.rounds.forEach((round, index) => {
    const ordered = [...round.tally.entries()].sort((left, right) => right[1] - left[1] || (left[0] < right[0] ? -1 : 1))
    out.push(`round ${index + 1}: ${ordered.map(([name, votes]) => `${name}=${votes}`).join(' ')} exhausted=${round.exhausted}`)
    if (round.eliminated !== undefined) out.push(`eliminated ${round.eliminated}`)
  })
} else {
  out.push(`rounds ${result.rounds.length}`)
}
out.push(result.winner === undefined ? 'no winner' : `winner ${result.winner}`)
process.stdout.write(out.map(line => `${line}\n`).join(''))
