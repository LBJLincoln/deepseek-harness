#!/usr/bin/env node
// Folds every recorded Proving Ground trajectory into one dataset under
// data/proving-ground/datasets/<name>/: train.jsonl, heldout.jsonl, and a
// manifest with the source records, the counts, the distributions of the
// written train set, the token totals, and every written file's SHA-256.
// Node built-ins only.
//
// Usage: node build-dataset.mjs <name> [--purpose <purpose>] [--include-delegated] [--include-held-out] [--check]
//
//   <name>               the dataset directory name, e.g. 2026-09-18-proving-ground-v1
//   --purpose <purpose>  delivery, training, or evaluation: write only the
//                        trajectories whose data-use terms admit it
//   --include-delegated  also write the cells a delegated implementer ran
//   --include-held-out   also write the held-out environments into heldout.jsonl
//   --check              rebuild in memory and compare with the recorded
//                        manifest; exit 1 on drift, write nothing
//
// Sources are every record directory under data/proving-ground/ holding
// trajectories.jsonl. Held-out environments never reach train.jsonl, and
// without --include-held-out they reach no file at all, so a trainer pointed
// at the directory cannot take an evaluation task by accident.
//
// A dataset built for one purpose keeps a trajectory only when its own `terms`
// admit that purpose. A trajectory carrying no `terms` states no purpose, and a
// purpose nobody recorded is never assumed, so it is withheld and counted under
// `withheldTerms`. Without --purpose nothing is withheld on those grounds.
//
// A reward of 0 is a failure only when the session's last unit of work ended on
// its own, which the record states as `stopReason: 'completed'`. A train-bound
// trajectory scored 0 under any other stop reason — the budget, an abort, a
// provider error, an output-token ceiling, a crash — is masked: it reaches no
// file and is counted under `maskedNegatives`, per reason in
// `maskedStopReasons`. A record whose format predates the field
// (`dsh-trajectory/1`, `dsh-trajectory/2`) states no stop reason, so its zero is
// masked as `(unstated)` until the record is re-exported. heldout.jsonl keeps
// such rows: an evaluation that ran out of budget did fail.
//
// Nothing is written while any trajectory carries a credential- or
// mailbox-shaped string: the run prints every match and exits 1. There is no
// accept flag — a recorded run is never edited, so a hit is a record to
// re-export, not a finding to wave through.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { armOf } from './summarize-run.mjs'

const REPO_DIR = resolve(import.meta.dirname, '..', '..', '..')
const RUNS_DIR = resolve(import.meta.dirname, '..')
const DATASETS_DIR = join(RUNS_DIR, 'datasets')
const TASKS_DIR = join(REPO_DIR, 'examples/headless-agent/tests/fixtures/proving-ground-bench/environments')
const TOOL_PATH = relative(REPO_DIR, fileURLToPath(import.meta.url))
/** Directories under data/proving-ground/ that are not run records. */
const NON_RECORDS = new Set(['folds', 'datasets', 'tools'])
/** Format tag of the lines this tool writes, bumped when the `dataset` field changes meaning. */
const DATASET_FORMAT = 'dsh-proving-ground-dataset/1'
const TOOL_VERSION = 3
/** The only stop reason under which a reward of 0 measures the work rather than a session cut short. */
const COMPLETED_STOP = 'completed'
/** The stop reason a record written before the field existed is counted under. */
const UNSTATED_STOP = '(unstated)'

/**
 * Data-use purposes `--purpose` accepts, which are the purposes
 * `@deepseek-ai/dsh-data-use` defines and a trajectory's `terms.purposes` lists.
 */
const PURPOSES = ['delivery', 'training', 'evaluation']

/**
 * Credential-shaped text, copied from
 * `data/transcripts/tools/collect-claude-code-session.mjs`, which owns the list
 * and does not export it. Keep the two in step.
 */
const SECRET_PATTERNS = [
  { name: 'anthropic-key', re: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: 'openrouter-key', re: /\bsk-or-v1-[A-Za-z0-9]{20,}/g },
  { name: 'openai-style-key', re: /\bsk-(?:proj-)?[A-Za-z0-9]{20,}/g },
  { name: 'github-token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{20,}/g },
  { name: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'slack-token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { name: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { name: 'bearer-token', re: /\bBearer [A-Za-z0-9._~+/=-]{20,}/g },
]

/** An address with its mail domain captured, because the domain decides whether the match is a mailbox. */
const EMAIL_RE = /\b[A-Za-z0-9._%+'-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)\b/g
/** Documentation and test domains RFC 2606 and RFC 6761 reserve: never a deliverable mailbox. */
const RESERVED_EMAIL_DOMAIN_RE = /(^|\.)(example\.(com|net|org|edu)|test|example|invalid|localhost)$/i
/**
 * Shortest registrable label this scan treats as a real mail domain. The
 * corpus's URI, query-string, and URL-template environments feed their parsers
 * stand-in addresses at one-to-three-letter domains (`x@y.com`, `foo@bar.com`,
 * `user@a.com`), while the providers an operator address could name are longer.
 * A real mailbox at a shorter domain (`qq.com`) passes the scan, so it bounds
 * the accident it was built for rather than every address that could exist.
 */
const MIN_MAILBOX_LABEL = 4

/**
 * @param {Buffer | string} content bytes to digest
 * @returns {string} lowercase hex SHA-256
 */
function sha256(content) {
  return createHash('sha256').update(content).digest('hex')
}

/**
 * Parses the command line.
 * @param {string[]} argv arguments after the script path
 * @returns {{ name: string, purpose: string | undefined, includeDelegated: boolean, includeHeldOut: boolean, check: boolean }}
 */
function parseArgs(argv) {
  const options = { name: undefined, purpose: undefined, includeDelegated: false, includeHeldOut: false, check: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--include-delegated') options.includeDelegated = true
    else if (arg === '--include-held-out') options.includeHeldOut = true
    else if (arg === '--check') options.check = true
    else if (arg === '--purpose') {
      index += 1
      options.purpose = argv[index]
      if (options.purpose === undefined) throw new Error(`--purpose takes one of ${PURPOSES.join(', ')}`)
      if (!PURPOSES.includes(options.purpose)) throw new Error(`--purpose must be one of ${PURPOSES.join(', ')}: ${options.purpose}`)
    }
    else if (arg.startsWith('--')) throw new Error(`unknown argument ${arg}`)
    else if (options.name === undefined) options.name = arg
    else throw new Error(`unexpected argument ${arg}`)
  }
  if (options.name === undefined) {
    throw new Error('usage: node build-dataset.mjs <name> [--purpose <purpose>] [--include-delegated] [--include-held-out] [--check]')
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(options.name)) throw new Error(`dataset name must be a plain directory name: ${options.name}`)
  return options
}

/**
 * Reads the bench environment catalog: the tier and domain each `code:<task>` id was authored with.
 * @returns {Map<string, { tier: number, domain: string }>} keyed by environment id
 */
function readTaskCatalog() {
  if (!existsSync(TASKS_DIR)) throw new Error(`no environment catalog at ${relative(REPO_DIR, TASKS_DIR)}`)
  const catalog = new Map()
  for (const name of readdirSync(TASKS_DIR).sort()) {
    const path = join(TASKS_DIR, name, 'task.json')
    if (!existsSync(path)) continue
    const task = JSON.parse(readFileSync(path, 'utf8'))
    catalog.set(task.id, { tier: task.tier, domain: task.domain })
  }
  return catalog
}

/**
 * The record directories that hold an export, in name order.
 * @returns {string[]} directory names under data/proving-ground/
 */
function recordNames() {
  return readdirSync(RUNS_DIR)
    .filter(name => !NON_RECORDS.has(name) && existsSync(join(RUNS_DIR, name, 'trajectories.jsonl')))
    .sort()
}

/**
 * Yields every string the value holds, with the JSON path that reached it.
 * @param {unknown} value a parsed trajectory or any part of one
 * @param {string} path path of the value, for the report
 * @yields {{ path: string, text: string }} one string and where it sits
 */
function* strings(value, path) {
  if (typeof value === 'string') yield { path, text: value }
  else if (Array.isArray(value)) for (const [index, item] of value.entries()) yield* strings(item, `${path}[${index}]`)
  else if (value !== null && typeof value === 'object') for (const [key, item] of Object.entries(value)) yield* strings(item, `${path}.${key}`)
}

/**
 * Whether one e-mail match names a mailbox rather than a parser fixture.
 * @param {string} domain the address's mail domain
 * @returns {boolean} true when the domain could receive mail
 */
function isMailboxDomain(domain) {
  if (RESERVED_EMAIL_DOMAIN_RE.test(domain)) return false
  const labels = domain.split('.')
  // A two-letter-or-shorter public suffix takes two labels (`x.co.uk`), so the registrable name sits one further left.
  const registrable = labels.length > 2 && labels.at(-2).length <= 3 ? labels.at(-3) : labels.at(-2)
  return registrable.length >= MIN_MAILBOX_LABEL
}

/**
 * The matched text replaced by `[redacted]` inside a short window of its
 * string, so a refusal locates the hit without reprinting it.
 * @param {string} text the string the match was found in
 * @param {number} index where the match starts
 * @param {number} length how long the match is
 * @returns {string} a single-line excerpt
 */
function redactedExcerpt(text, index, length) {
  const window = 40
  const start = Math.max(0, index - window)
  const end = Math.min(text.length, index + length + window)
  const excerpt = `${start > 0 ? '…' : ''}${text.slice(start, index)}[redacted]${text.slice(index + length, end)}${end < text.length ? '…' : ''}`
  return excerpt.replace(/\s+/g, ' ')
}

/**
 * Scans one trajectory for credential- and mailbox-shaped strings.
 * @param {string} record the record directory the trajectory came from
 * @param {object} trajectory one parsed trajectory line
 * @param {object[]} hits collector every match is appended to
 */
function scanTrajectory(record, trajectory, hits) {
  const found = (path, pattern, text, match) => {
    hits.push({ record, id: trajectory.id, path, pattern, digest: sha256(match[0]), excerpt: redactedExcerpt(text, match.index, match[0].length) })
  }
  for (const { path, text } of strings(trajectory, 'trajectory')) {
    for (const { name, re } of SECRET_PATTERNS) {
      for (const match of text.matchAll(re)) found(path, name, text, match)
    }
    for (const match of text.matchAll(EMAIL_RE)) {
      if (isMailboxDomain(match[1])) found(path, 'email-address', text, match)
    }
  }
}

/** Running token totals over the steps of the written trajectories. */
function newTokenTotals() {
  return { steps: 0, stepsWithUsage: 0, inputTokens: 0, outputTokens: 0 }
}

/**
 * Adds one trajectory's steps to the running totals, keeping the optional
 * counters only when a step reported them.
 * @param {object} totals what {@link newTokenTotals} returned
 * @param {readonly object[]} steps the trajectory's steps
 */
function addUsage(totals, steps) {
  for (const step of steps) {
    totals.steps += 1
    if (step.usage === undefined) continue
    totals.stepsWithUsage += 1
    totals.inputTokens += step.usage.inputTokens ?? 0
    totals.outputTokens += step.usage.outputTokens ?? 0
    for (const key of ['cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']) {
      if (step.usage[key] !== undefined) totals[key] = (totals[key] ?? 0) + step.usage[key]
    }
  }
}

/** The model route a stamp names, as `provider/model`. */
const routeOf = (model) => `${model.provider}/${model.model}`

/**
 * Counts one key of one distribution.
 * @param {Map<string, Map<string, number>>} distributions every distribution by name
 * @param {string} name which distribution
 * @param {string} key the bucket
 */
function tally(distributions, name, key) {
  const bucket = distributions.get(name) ?? new Map()
  bucket.set(key, (bucket.get(key) ?? 0) + 1)
  distributions.set(name, bucket)
}

/** Sorts a map's entries by key into a plain object, so the manifest reads the same on every build. */
function sorted(entries) {
  return Object.fromEntries([...entries].sort(([a], [b]) => a.localeCompare(b)))
}

/**
 * Reads the repository branch and head for the manifest.
 * @returns {{ branch: string, head: string }}
 */
function readRepository() {
  const git = (args) => execFileSync('git', ['-C', REPO_DIR, ...args], { encoding: 'utf8' }).trim()
  return { branch: git(['branch', '--show-current']), head: git(['rev-parse', 'HEAD']) }
}

/**
 * Whether one trajectory's own data-use terms admit the purpose this dataset is
 * built for. A record carrying no `terms` states no purpose, so it admits none.
 * @param {object} trajectory one parsed trajectory line
 * @param {string} purpose the purpose the build names
 * @returns {boolean} true when the record's terms list that purpose
 */
function admitsPurpose(trajectory, purpose) {
  return trajectory.terms?.purposes?.includes(purpose) === true
}

/**
 * Reads every record and folds it into the dataset's files and manifest, writing nothing.
 * @param {{ name: string, purpose: string | undefined, includeDelegated: boolean, includeHeldOut: boolean }} options what to build
 * @returns {{ files: { path: string, content: string }[], manifest: object, hits: object[] }} the built dataset; a non-empty `hits` means it must not be written
 */
function buildDataset(options) {
  const catalog = readTaskCatalog()
  const counts = {
    seen: 0,
    train: 0,
    heldout: 0,
    withheldTerms: 0,
    withheldHeldOut: 0,
    delegated: 0,
    delegatedExcluded: 0,
    tamperedExcluded: 0,
    maskedNegatives: 0,
    duplicatesDropped: 0,
  }
  const maskedStopReasons = new Map()
  const distributions = new Map()
  const tokens = newTokenTotals()
  const records = []
  const hits = []
  const seen = new Set()
  const trainLines = []
  const heldoutLines = []

  for (const record of recordNames()) {
    const manifestPath = join(RUNS_DIR, record, 'manifest.json')
    if (!existsSync(manifestPath)) throw new Error(`${record} holds trajectories.jsonl but no manifest.json`)
    const manifestBytes = readFileSync(manifestPath)
    const recordManifest = JSON.parse(manifestBytes.toString('utf8'))
    records.push({
      record,
      composition: recordManifest.composition ?? null,
      head: recordManifest.repository?.head ?? null,
      manifestSha256: sha256(manifestBytes),
    })

    const lines = readFileSync(join(RUNS_DIR, record, 'trajectories.jsonl'), 'utf8').split('\n').filter(Boolean)
    // Sorting by id is stable, so duplicates inside one record stay in export order and the first one wins.
    const trajectories = lines.map(line => JSON.parse(line)).sort((a, b) => a.id.localeCompare(b.id))
    for (const trajectory of trajectories) {
      counts.seen += 1
      scanTrajectory(record, trajectory, hits)
      if (seen.has(trajectory.id)) { counts.duplicatesDropped += 1; continue }
      seen.add(trajectory.id)
      // The terms gate runs before every other classification, so a record this
      // dataset may not carry reaches no file and no distribution.
      if (options.purpose !== undefined && !admitsPurpose(trajectory, options.purpose)) { counts.withheldTerms += 1; continue }
      if (trajectory.reward.basis === 'tamper') { counts.tamperedExcluded += 1; continue }

      const stamp = trajectory.environment
      const task = catalog.get(stamp?.environmentId)
      const delegated = (stamp?.implementer ?? 'route') !== 'route'
      if (delegated) counts.delegated += 1
      const dataset = {
        record,
        tier: task?.tier ?? null,
        domain: task?.domain ?? null,
        arm: armOf(stamp?.group),
        reward: { value: trajectory.reward.outcome, basis: trajectory.reward.basis },
      }
      const line = `${JSON.stringify({ ...trajectory, dataset })}\n`

      if (stamp?.heldOut === true) {
        if (options.includeHeldOut) { heldoutLines.push(line); counts.heldout += 1 }
        else counts.withheldHeldOut += 1
        continue
      }
      if (delegated && !options.includeDelegated) { counts.delegatedExcluded += 1; continue }
      const stopReason = trajectory.stopReason ?? UNSTATED_STOP
      if (trajectory.reward.outcome === 0 && stopReason !== COMPLETED_STOP) {
        counts.maskedNegatives += 1
        maskedStopReasons.set(stopReason, (maskedStopReasons.get(stopReason) ?? 0) + 1)
        continue
      }

      trainLines.push(line)
      counts.train += 1
      addUsage(tokens, trajectory.steps)
      tally(distributions, 'arm', dataset.arm)
      tally(distributions, 'domain', dataset.domain ?? '(none)')
      tally(distributions, 'environment', stamp?.environmentId ?? '(none)')
      tally(distributions, 'implementer', stamp?.implementer ?? 'route')
      tally(distributions, 'ladder', stamp === undefined ? '(none)' : (stamp.ladder ?? [stamp.model]).map(routeOf).join('>'))
      tally(distributions, 'model', stamp === undefined ? '(none)' : routeOf(stamp.model))
      tally(distributions, 'reward', String(dataset.reward.value))
      tally(distributions, 'stopReason', stopReason)
      tally(distributions, 'tier', dataset.tier === null ? '(none)' : String(dataset.tier))
    }
  }

  if (tokens.stepsWithUsage === 0) tokens.note = 'no step of the written set reported usage'
  const files = [
    { path: 'train.jsonl', content: trainLines.join('') },
    { path: 'heldout.jsonl', content: heldoutLines.join('') },
  ]
  const manifest = {
    name: options.name,
    format: DATASET_FORMAT,
    builtAt: new Date().toISOString(),
    repository: readRepository(),
    tool: { path: TOOL_PATH, version: TOOL_VERSION },
    options: {
      purpose: options.purpose ?? null,
      includeDelegated: options.includeDelegated,
      includeHeldOut: options.includeHeldOut,
    },
    records,
    counts,
    maskedStopReasons: sorted(maskedStopReasons),
    distributions: sorted([...distributions].map(([name, bucket]) => [name, sorted(bucket)])),
    tokens,
    files: files.map(({ path, content }) => ({ path, bytes: Buffer.byteLength(content, 'utf8'), sha256: sha256(content) })),
  }
  return { files, manifest, hits }
}

/**
 * One line per count, per distribution, and per written file, for the console.
 * @param {object} manifest the manifest {@link buildDataset} produced
 * @returns {string} the summary, newline-joined
 */
function formatSummary(manifest) {
  const { counts, tokens } = manifest
  const purpose = manifest.options.purpose
  const lines = [
    `${manifest.name}: ${counts.train} train, ${counts.heldout} held out, of ${counts.seen} trajectories in ${manifest.records.length} records${purpose === null ? '' : ` admitted for ${purpose}`}`,
    `  excluded: ${counts.withheldTerms} withheld by terms, ${counts.withheldHeldOut} withheld held-out, ${counts.delegatedExcluded} delegated (${counts.delegated} seen), ${counts.tamperedExcluded} tampered, ${counts.maskedNegatives} negatives masked by stop reason (${Object.entries(manifest.maskedStopReasons).map(([reason, count]) => `${reason}=${count}`).join(' ') || 'none'}), ${counts.duplicatesDropped} duplicates`,
    `  tokens: ${tokens.inputTokens} input, ${tokens.outputTokens} output, ${tokens.cacheReadTokens ?? 0} cache-read, ${tokens.cacheWriteTokens ?? 0} cache-write over ${tokens.stepsWithUsage} of ${tokens.steps} steps${tokens.note === undefined ? '' : ` (${tokens.note})`}`,
  ]
  for (const [name, bucket] of Object.entries(manifest.distributions)) {
    lines.push(`  ${name}: ${Object.entries(bucket).map(([key, count]) => `${key}=${count}`).join(' ')}`)
  }
  for (const file of manifest.files) lines.push(`  ${file.path}: ${file.bytes} bytes, ${file.sha256}`)
  return lines.join('\n')
}

/**
 * Compares a rebuilt dataset with the manifest recorded beside it, and with
 * whichever of its files the repository carries.
 * @param {string} directory the dataset directory
 * @param {{ manifest: object }} built what {@link buildDataset} produced
 * @returns {string[]} one line per drift, empty when the recorded manifest matches
 */
function checkDataset(directory, built) {
  const manifestPath = join(directory, 'manifest.json')
  if (!existsSync(manifestPath)) return [`${relative(REPO_DIR, manifestPath)} does not exist; build the dataset first`]
  const recorded = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const drift = []
  for (const file of built.manifest.files) {
    const entry = recorded.files.find(candidate => candidate.path === file.path)
    if (entry === undefined) { drift.push(`${file.path}: the recorded manifest lists no such file`); continue }
    if (entry.sha256 !== file.sha256) drift.push(`${file.path}: rebuilt ${file.sha256}, manifest records ${entry.sha256}`)
    if (entry.bytes !== file.bytes) drift.push(`${file.path}: rebuilt ${file.bytes} bytes, manifest records ${entry.bytes}`)
    const onDisk = join(directory, file.path)
    // A dataset too large to commit keeps only its manifest, so an absent file is not drift.
    if (existsSync(onDisk) && sha256(readFileSync(onDisk)) !== entry.sha256) drift.push(`${file.path}: the file in the repository does not match the manifest`)
  }
  for (const entry of recorded.files) {
    if (!built.manifest.files.some(file => file.path === entry.path)) drift.push(`${entry.path}: the rebuild writes no such file`)
  }
  if (JSON.stringify(recorded.counts) !== JSON.stringify(built.manifest.counts)) drift.push('counts: the rebuild does not reproduce the recorded counts')
  return drift
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const directory = join(DATASETS_DIR, options.name)
  const built = buildDataset(options)

  if (built.hits.length > 0) {
    console.error(`refusing to build ${relative(REPO_DIR, directory)}: ${built.hits.length} credential- or mailbox-shaped match(es); re-export the record, there is no accept flag`)
    for (const hit of built.hits) console.error(`  ${hit.record} ${hit.id} ${hit.path} ${hit.pattern} sha256=${hit.digest} ${hit.excerpt}`)
    process.exit(1)
  }

  if (options.check) {
    const drift = checkDataset(directory, built)
    if (drift.length > 0) {
      console.error(`${relative(REPO_DIR, directory)} has drifted from its manifest:`)
      for (const line of drift) console.error(`  ${line}`)
      process.exit(1)
    }
    console.log(`${relative(REPO_DIR, directory)}: the rebuild matches the recorded manifest`)
    return
  }

  mkdirSync(directory, { recursive: true })
  for (const file of built.files) writeFileSync(join(directory, file.path), file.content)
  writeFileSync(join(directory, 'manifest.json'), `${JSON.stringify(built.manifest, null, 2)}\n`)
  console.log(`wrote ${relative(REPO_DIR, directory)}`)
  console.log(formatSummary(built.manifest))
}

main()
