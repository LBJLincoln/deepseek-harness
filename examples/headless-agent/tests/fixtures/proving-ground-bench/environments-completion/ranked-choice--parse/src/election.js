/** Parsing the ballot file and running the instant-runoff rounds over it. */

/** Raised for input the specification rejects; `line` is 0 when the failure names none. */
export class BallotError extends Error {
  /**
   * @param message - the reported reason.
   * @param line - the 1-based input line, or 0 when the failure names none.
   */
  constructor(message, line) {
    super(message)
    this.name = 'BallotError'
    this.line = line
  }
}

/** A candidate name: letters, digits, underscore and dash. */
const NAME = /^[A-Za-z0-9_-]+$/u

/** A ballot multiplier: an unsigned decimal integer of at least 1, with no leading zero. */
const COUNT = /^[1-9]\d*$/u

/**
 * Parse the directive lines into the candidate list and the ballots.
 * @param lines - the input lines, in order.
 * @returns the declared candidates in declaration order and the ballots as `{ count, ranking }`.
 * @throws {BallotError} for any malformed directive.
 */
export function parse(lines) {
  throw new Error('not implemented')
}

/** The counts one round gives each continuing candidate, plus the exhausted total. */
function count(ballots, continuing) {
  const tally = new Map([...continuing].map(name => [name, 0]))
  let exhausted = 0
  for (const ballot of ballots) {
    const choice = ballot.ranking.find(name => continuing.has(name))
    if (choice === undefined) exhausted += ballot.count
    else tally.set(choice, tally.get(choice) + ballot.count)
  }
  return { tally, exhausted }
}

/**
 * The candidate eliminated from a set that ties for the fewest votes: the one
 * that trailed in the earliest round where the tied candidates differed, and
 * the alphabetically last of them when no round ever separated them.
 * @param tied - the tied candidate names.
 * @param history - every round's tally so far, oldest first.
 * @returns the name to eliminate.
 */
function breakTie(tied, history) {
  for (const round of history) {
    const counts = tied.map(name => round.get(name))
    const fewest = Math.min(...counts)
    const trailing = tied.filter(name => round.get(name) === fewest)
    if (trailing.length < tied.length) return breakTie(trailing, history)
  }
  return [...tied].sort().pop()
}

/**
 * Run the rounds to a winner or to an exhausted electorate.
 * @param candidates - the declared candidates, in declaration order.
 * @param ballots - the parsed ballots.
 * @returns each round's tally, exhausted count and elimination, and the winner if there is one.
 */
export function run(candidates, ballots) {
  const continuing = new Set(candidates)
  const rounds = []
  const history = []
  for (;;) {
    const { tally, exhausted } = count(ballots, continuing)
    history.push(tally)
    const active = [...tally.values()].reduce((sum, votes) => sum + votes, 0)
    if (active === 0) {
      rounds.push({ tally, exhausted })
      return { rounds }
    }
    const leader = [...tally.entries()].find(([, votes]) => votes * 2 > active)
    if (leader !== undefined) {
      rounds.push({ tally, exhausted })
      return { rounds, winner: leader[0] }
    }
    const fewest = Math.min(...tally.values())
    const tied = [...tally.keys()].filter(name => tally.get(name) === fewest)
    const eliminated = tied.length === 1 ? tied[0] : breakTie(tied, history)
    rounds.push({ tally, exhausted, eliminated })
    continuing.delete(eliminated)
  }
}
