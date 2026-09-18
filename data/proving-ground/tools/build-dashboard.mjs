#!/usr/bin/env node
// Builds the Proving Ground dashboard: one self-contained HTML page folded from
// every record under data/proving-ground/ (manifests, driver results, session
// logs, folds) and, optionally, from run directories a driver is still writing.
// Node built-ins only. The page's markup, styles, and renderer live in
// `dashboard.template.html` beside this file; this tool computes the data the
// page embeds and writes the page.
//
// Usage: node build-dashboard.mjs [--out <path>] [--live <run dir>]... [--fragment]
//
//   --out <path>      where to write the page (default data/proving-ground/dashboard.html)
//   --live <run dir>  a driver's run directory not yet recorded (cell logs under
//                     .sessions/, plan.json, run.log); shown as running unless its
//                     run.log carries a result line; repeatable
//   --fragment        write the template's fragment (title, styles, body) without
//                     the document wrapper, for hosts that supply their own
//
// Every number on the page is read from the records: certificates and attempts
// from the session logs (through summarize-run.mjs), verdicts and intervals from
// the experiment results and the offline folds, escapes from the census.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { censusRecord } from './census-escapes.mjs'
import { summarizeRun } from './summarize-run.mjs'

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url))
const PROVING_GROUND = resolve(TOOLS_DIR, '..')
const REPO_DIR = resolve(PROVING_GROUND, '..', '..')
const BENCH = join(REPO_DIR, 'examples', 'headless-agent', 'tests', 'fixtures', 'proving-ground-bench')
const FIXTURES_PREFIX = 'examples/headless-agent/tests/fixtures/'
const SEALED_SINCE = '2026-09-08T09:25:00Z'
const MODEL_SLOTS = { haiku: 0, sonnet: 1, opus: 2 }

function parseArgs(argv) {
  const options = { out: join(PROVING_GROUND, 'dashboard.html'), live: [], fragment: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--out') options.out = resolve(argv[++index])
    else if (arg === '--live') options.live.push(resolve(argv[++index]))
    else if (arg === '--fragment') options.fragment = true
    else throw new Error(`unknown argument ${arg}; usage: build-dashboard.mjs [--out <path>] [--live <run dir>]... [--fragment]`)
  }
  return options
}

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const tryJson = (path) => (existsSync(path) ? readJson(path) : undefined)
const git = (...args) => execFileSync('git', ['-C', REPO_DIR, ...args], { encoding: 'utf8' }).trim()

/** Bench environments by id, with the tier, domain, and held-out flag their task.json declares. */
function benchEnvironments() {
  const environments = new Map()
  const root = join(BENCH, 'environments')
  if (!existsSync(root)) return environments
  for (const name of readdirSync(root)) {
    const task = tryJson(join(root, name, 'task.json'))
    if (task === undefined) continue
    environments.set(`code:${name}`, { id: `code:${name}`, tier: task.tier ?? null, domain: task.domain ?? null, heldOut: task.heldOut === true })
  }
  return environments
}

const ORDINAL_UNITS = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20, thirtieth: 30, fortieth: 40, fiftieth: 50, sixtieth: 60, seventieth: 70, eightieth: 80, ninetieth: 90 }
const ORDINAL_TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 }

/** `twenty-eighth` → 28; undefined for a word that is not an ordinal. */
function ordinalNumber(word) {
  if (ORDINAL_UNITS[word] !== undefined) return ORDINAL_UNITS[word]
  const [tens, unit] = word.split('-')
  return ORDINAL_TENS[tens] !== undefined && ORDINAL_UNITS[unit] !== undefined && ORDINAL_UNITS[unit] < 10 ? ORDINAL_TENS[tens] + ORDINAL_UNITS[unit] : undefined
}

/**
 * The README paragraph about each record, as plain text. The README numbers its
 * paragraphs by ordinal (`The twenty-eighth record is …`) and lists every record's
 * rows in the same order in its table, so the n-th distinct record of the table
 * is the subject of the n-th paragraph.
 */
function readmeNotes() {
  const notes = new Map()
  const readme = join(PROVING_GROUND, 'README.md')
  if (!existsSync(readme)) return notes
  const lines = readFileSync(readme, 'utf8').split('\n')
  const order = []
  for (const line of lines) {
    const row = /^\| \[([0-9]{4}-[0-9]{2}-[0-9]{2}-[^\]]+)\]\(/.exec(line)
    if (row && !order.includes(row[1])) order.push(row[1])
  }
  for (const line of lines) {
    const head = /^The ([a-z-]+) record is/.exec(line)
    if (!head) continue
    const number = ordinalNumber(head[1])
    const name = number === undefined ? undefined : order[number - 1]
    if (name !== undefined && !notes.has(name)) notes.set(name, line.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/`/g, '').replace(/\*\*/g, ''))
  }
  return notes
}

/**
 * A row's route as the page names it: the model alone for a run without a
 * ladder and for a same-model ladder of the composition's own three rungs (the
 * same arm), `model ×n` for a same-model ladder of another length, and the
 * rungs joined for a ladder that changes model.
 */
function routeLabel(row) {
  const rungs = row.route.split('>')
  const same = rungs.every(rung => rung === rungs[0])
  if (row.rungs === null || (same && row.rungs === 3)) return rungs[0]
  return same ? `${rungs[0]} ×${row.rungs}` : rungs.join('›')
}

/** Whether a row is the plain arm of one model under the composition's default attempt bound. */
const isPlainArm = row => row.implementer === 'route' && !routeLabel(row).includes('›') && !routeLabel(row).includes('×')

function humanize(name) {
  const tier = /-t(\d)$/.exec(name)
  return name.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/^bench-/, '').replace(/-t\d$/, '').replace(/-/g, ' ')
    .replace(/^([eh]\d)\b/, (m) => m.toUpperCase()) + (tier ? `, tier ${tier[1]}` : '')
}

function compositionShort(composition) {
  const short = String(composition ?? '').replace(FIXTURES_PREFIX, '')
  const overlay = /proving-ground-bench\/overlays\/([^/]+)\.cordis\.yml$/.exec(short)
  if (overlay) return `bench + ${overlay[1]}`
  if (short === 'proving-ground-bench/cordis.yml') return 'bench'
  return short.replace(/\/cordis\.yml$/, '')
}

/** One arm's route as the page names it: the first rung, the ladder, the implementer. */
function describeArm(arm) {
  const own = arm.model?.model ?? '?'
  const rungs = (arm.ladder ?? []).map(rung => rung.model?.model ?? own)
  const route = rungs.length > 1 ? rungs.join('›') : own
  const implementer = arm.implementer?.kind === 'subagent' ? arm.implementer.provider : 'route'
  return `${route} · ${implementer}`
}

const median = (values) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length === 0 ? 0 : sorted[Math.floor(sorted.length / 2)] }

/** Per-arm totals over rows, the same fields summarize-run.mjs folds. */
function aggregate(rows) {
  const sum = key => rows.reduce((total, row) => total + (row[key] ?? 0), 0)
  return {
    cells: rows.length,
    certified: rows.filter(row => row.certified).length,
    firstAttempt: rows.filter(row => row.certified && row.attempts === 1).length,
    attemptsMean: rows.length === 0 ? 0 : Number((sum('attempts') / rows.length).toFixed(2)),
    seconds: sum('seconds'),
    secondsMedian: median(rows.map(row => row.seconds)),
    steps: sum('steps'),
    breachedCells: rows.filter(row => row.breaches > 0).length,
    denied: sum('denied'),
    inputTokens: sum('inputTokens'),
    outputTokens: sum('outputTokens'),
    cacheReadTokens: sum('cacheReadTokens'),
    cacheWriteTokens: sum('cacheWriteTokens'),
    billedTokens: sum('inputTokens') + sum('cacheReadTokens') + sum('cacheWriteTokens'),
  }
}

function normalizeRows(rows) {
  return rows.map(row => ({ ...row, arm: row.arm.startsWith('shift-') ? 'shift' : row.arm, route: routeLabel(row) }))
}

function tierLabel(tiers) {
  if (tiers.length === 0) return '–'
  const sorted = [...tiers].sort((a, b) => a - b)
  if (sorted.length === 1) return String(sorted[0])
  const contiguous = sorted.every((tier, index) => index === 0 || tier === sorted[index - 1] + 1)
  return contiguous ? `${sorted[0]}–${sorted[sorted.length - 1]}` : sorted.join(', ')
}

function censusSummary(directory) {
  let census
  try {
    census = censusRecord(directory)
  } catch {
    // A record without a sessions directory (a program ledger) has no cells to census.
    return undefined
  }
  const cells = census.cells ?? []
  return {
    cells: cells.length,
    delegated: cells.filter(cell => cell.delegated).length,
    escaped: cells.filter(cell => (cell.escapes ?? 0) > 0).length,
    calls: cells.reduce((total, cell) => total + (cell.escapes ?? 0), 0),
    named: cells.reduce((total, cell) => total + (cell.byReason?.runDirectory ?? 0) + (cell.byReason?.sibling ?? 0), 0),
    denied: cells.reduce((total, cell) => total + (cell.denied ?? 0), 0),
  }
}

function kindOf(result, manifest) {
  if (result?.result?.verdict !== undefined) return 'experiment'
  if (result?.report?.leaderboard !== undefined) return 'fleet'
  if (result?.report?.programId !== undefined) return 'program'
  if (result?.type === 'status' || (manifest.districts ?? []).includes('proving-ground')) return 'district'
  return 'fleet'
}

/** One record folded for the page. */
function loadRecord(name, environments, notes) {
  const directory = join(PROVING_GROUND, name)
  const manifest = readJson(join(directory, 'manifest.json'))
  const result = tryJson(join(directory, 'result.json'))
  const kind = kindOf(result, manifest)
  let rows = []
  try {
    rows = normalizeRows(summarizeRun(directory).rows)
  } catch {
    // A record without session logs contributes no cells.
  }
  const armKeys = [...new Set(rows.map(row => row.arm))]
  const experiment = kind === 'experiment' ? result.result : undefined
  const armKeysInOrder = experiment ? ['baseline', 'candidate'] : armKeys
  const arms = armKeysInOrder.map((key) => {
    const armRows = rows.filter(row => row.arm === key)
    const spec = experiment?.arms?.[key]
    const label = spec ? `${key}: ${describeArm(spec)}` : [...new Set(armRows.map(row => `${row.route} · ${row.implementer}`))].join(', ')
    return { key, label, totals: aggregate(armRows) }
  })
  const environmentIds = [...new Set([...(result?.environments ?? []), ...rows.map(row => row.environment)])]
  const tiers = [...new Set(environmentIds.map(id => environments.get(id)?.tier).filter(tier => tier !== undefined && tier !== null))]
  const totals = aggregate(rows)
  const ranAt = manifest.ranAt ?? result?.startedAt
  const endedAt = manifest.endedAt ?? result?.endedAt ?? (ranAt && manifest.elapsedSeconds ? new Date(Date.parse(ranAt) + manifest.elapsedSeconds * 1000).toISOString() : undefined)
  const composition = manifest.composition ?? ''
  const sealed = composition.includes('proving-ground-bench') && ranAt !== undefined && ranAt >= SEALED_SINCE
  const baseline = arms.find(arm => arm.key === 'baseline'), candidate = arms.find(arm => arm.key === 'candidate')
  const certifiedLabel = experiment && baseline && candidate
    ? `${baseline.totals.certified} vs ${candidate.totals.certified} of ${baseline.totals.cells}`
    : kind === 'program' ? (result?.report?.outcome ?? '–') : `${totals.certified} of ${totals.cells}`
  const census = censusSummary(directory)
  const armsLabel = arms.map(arm => arm.label).join(' | ') || (kind === 'program' ? 'department on the route' : '–')
  return {
    name, kind, composition, compositionShort: compositionShort(composition), sealed,
    head: manifest.repository?.head ?? '', branch: manifest.repository?.branch ?? '',
    ranAt, endedAt, elapsedSeconds: manifest.elapsedSeconds ?? (ranAt && endedAt ? Math.round((Date.parse(endedAt) - Date.parse(ranAt)) / 1000) : undefined),
    districts: manifest.districts ?? (manifest.district ? [manifest.district] : []),
    implementers: manifest.implementers ?? (manifest.implementer ? [manifest.implementer.provider ?? manifest.implementer.kind] : []),
    environments: environmentIds, tiers, tierLabel: tierLabel(tiers),
    arms, armsLabel, rows,
    cells: totals.cells, certified: totals.certified, certifiedLabel, firstAttempt: totals.firstAttempt,
    seconds: totals.seconds, secondsMedian: totals.secondsMedian, steps: totals.steps,
    output: totals.outputTokens, read: totals.cacheReadTokens, write: totals.cacheWriteTokens, billed: totals.billedTokens, breachedCells: totals.breachedCells,
    census, escapes: census ? census.escaped : undefined,
    experiment: experiment ? { digest: experiment.digest, verdict: experiment.verdict, delta: experiment.delta, interval: experiment.interval, seedsPaired: experiment.seedsPaired, thresholds: experiment.thresholds, caps: experiment.caps, errors: experiment.errors?.length ?? 0, spend: experiment.spend } : undefined,
    verdict: experiment?.verdict, verdictLabel: experiment?.verdict ?? '',
    program: kind === 'program' ? { outcome: result?.report?.outcome, goals: (result?.report?.goals ?? []).map(goal => `${goal.key}: ${goal.status}`) } : undefined,
    note: notes.get(name),
    search: [name, kind, compositionShort(composition), ...environmentIds, ...arms.map(arm => arm.label), manifest.repository?.head ?? ''].join(' ').toLowerCase(),
  }
}

/** A frozen experiment's card. */
function experimentCard(record) {
  const baseline = record.arms.find(arm => arm.key === 'baseline'), candidate = record.arms.find(arm => arm.key === 'candidate')
  const experiment = record.experiment
  return {
    id: record.name, label: humanize(record.name), date: record.ranAt ?? '', tier: record.tierLabel, method: 'frozen pair',
    baselineLabel: baseline?.label.replace(/^baseline: /, '') ?? 'baseline', candidateLabel: candidate?.label.replace(/^candidate: /, '') ?? 'candidate',
    baseline: baseline ? { certified: baseline.totals.certified, cells: baseline.totals.cells } : undefined,
    candidate: candidate ? { certified: candidate.totals.certified, cells: candidate.totals.cells } : undefined,
    delta: experiment.delta, interval: experiment.interval, verdict: experiment.verdict, minimumDelta: experiment.thresholds?.minimumDelta,
    seedsPaired: experiment.seedsPaired, errors: experiment.errors, source: record.name, href: `data/proving-ground/${record.name}/result.json`,
  }
}

/** An offline fold's card. */
function foldCard(file, fold) {
  const name = basename(file, '.json')
  const tier = /-t(\d)\.json$/.exec(file)?.[1] ?? null
  const cells = fold.result?.cells ?? []
  const count = (rateKey) => cells.reduce((total, cell) => total + Math.round((cell[rateKey] ?? 0) * (cell.pairs ?? 0)), 0)
  const perArm = (fold.environments?.length ?? cells.length) * (fold.repetitions ?? 1)
  return {
    id: name, label: humanize(name.replace(/-against-/, ' vs ')), date: name.slice(0, 10), tier,
    method: /counterfactual/.test(name) ? 'counterfactual fold' : 'offline fold',
    baselineLabel: String(fold.baseline), candidateLabel: String(fold.candidate),
    baseline: { certified: count('baselineRate'), cells: perArm }, candidate: { certified: count('candidateRate'), cells: perArm },
    delta: fold.result?.delta, interval: fold.result?.interval, verdict: fold.result?.verdict, minimumDelta: fold.result?.thresholds?.minimumDelta,
    seedsPaired: fold.result?.seedsPaired, errors: 0, source: name, href: `data/proving-ground/folds/${name}.json`,
  }
}

/** A run directory a driver is still writing, or has finished without being recorded. */
function loadLive(directory, environments) {
  const plan = tryJson(join(directory, 'plan.json'))
  const name = plan?.name ?? basename(directory)
  const log = existsSync(join(directory, 'run.log')) ? readFileSync(join(directory, 'run.log'), 'utf8') : ''
  const banner = /^=== start (\S+) (.*)$/m.exec(log)
  const finished = /^\{"type":"result"/m.test(log)
  let rows = []
  try {
    rows = normalizeRows(summarizeRun(directory).rows)
  } catch {
    // No cell has written a log yet.
  }
  const arms = [...new Set(rows.map(row => row.arm))].map(key => ({ key, label: key, totals: aggregate(rows.filter(row => row.arm === key)) }))
  const totals = aggregate(rows)
  let lastEvent
  const sessions = join(directory, '.sessions')
  if (existsSync(sessions)) {
    const walk = (dir) => { for (const entry of readdirSync(dir, { withFileTypes: true })) { const path = join(dir, entry.name); if (entry.isDirectory()) walk(path); else { const time = statSync(path).mtime.toISOString(); if (!lastEvent || time > lastEvent) lastEvent = time } } }
    walk(sessions)
  }
  const environmentIds = [...new Set(rows.map(row => row.environment))]
  const tiers = [...new Set(environmentIds.map(id => environments.get(id)?.tier).filter(tier => tier !== undefined && tier !== null))]
  const startedAt = banner?.[1]
  return {
    name, label: humanize(name), description: banner?.[2] ?? '', startedAt, finished, lastEvent,
    totals: arms.map(arm => ({ arm: arm.key, ...arm.totals })), rows,
    asRecord: {
      name, kind: 'live', composition: '', compositionShort: plan?.implementer?.provider === 'spawn' ? 'bench + with-spawn' : 'bench', sealed: true, head: '', ranAt: startedAt, endedAt: lastEvent,
      elapsedSeconds: startedAt && lastEvent ? Math.round((Date.parse(lastEvent) - Date.parse(startedAt)) / 1000) : undefined,
      districts: [], implementers: [...new Set(rows.map(row => row.implementer))], environments: environmentIds, tiers, tierLabel: tierLabel(tiers),
      arms, armsLabel: arms.map(arm => arm.label).join(' | '), rows,
      cells: totals.cells, certified: totals.certified, certifiedLabel: `${totals.certified} of ${totals.cells} so far`, firstAttempt: totals.firstAttempt,
      seconds: totals.seconds, secondsMedian: totals.secondsMedian, steps: totals.steps, output: totals.outputTokens, read: totals.cacheReadTokens, write: totals.cacheWriteTokens, billed: totals.billedTokens, breachedCells: totals.breachedCells,
      census: undefined, verdict: undefined, verdictLabel: finished ? 'finished, not recorded' : 'running', note: banner?.[2],
      search: [name, 'live', ...environmentIds].join(' ').toLowerCase(),
    },
  }
}

function build(options) {
  const environments = benchEnvironments()
  // A record has a manifest and either a driver result or session logs; a directory with a manifest alone holds a record's attachments.
  const recordNames = readdirSync(PROVING_GROUND).filter(name => /^\d{4}-\d{2}-\d{2}-/.test(name)
    && existsSync(join(PROVING_GROUND, name, 'manifest.json'))
    && (existsSync(join(PROVING_GROUND, name, 'result.json')) || existsSync(join(PROVING_GROUND, name, 'sessions')))).sort()
  const notes = readmeNotes()
  const records = recordNames.map(name => loadRecord(name, environments, notes))
  const foldsDir = join(PROVING_GROUND, 'folds')
  const foldFiles = existsSync(foldsDir) ? readdirSync(foldsDir).filter(name => name.endsWith('.json')).sort() : []
  const folds = foldFiles.map(name => ({ file: name, fold: readJson(join(foldsDir, name)) }))
  const experiments = [
    ...records.filter(record => record.kind === 'experiment').map(experimentCard),
    ...folds.filter(({ fold }) => fold.type === 'offline-fold').map(({ file, fold }) => foldCard(file, fold)),
  ]
  const routing = folds.find(({ fold }) => fold.type === 'offline-routing')?.fold
  const repeatability = folds.find(({ fold }) => fold.type === 'offline-repeatability')?.fold

  // Plain single-model arms on the base composition, sealed, over the audited tier-5 tasks, by model.
  const sealedRows = records.filter(record => record.sealed).flatMap(record => record.rows.map(row => ({ ...row, record: record.name, base: record.compositionShort === 'bench' })))
  const tier5 = sealedRows.filter(row => row.base && isPlainArm(row) && environments.get(row.environment)?.tier === 5 && !environments.get(row.environment)?.heldOut)
  const tier5Models = [...new Set(tier5.map(row => row.route))].sort((a, b) => (MODEL_SLOTS[a] ?? 9) - (MODEL_SLOTS[b] ?? 9)).map((model) => {
    const rows = tier5.filter(row => row.route === model)
    const totals = aggregate(rows)
    return { key: model, label: model, ...totals, output: totals.outputTokens, outputPerCertified: totals.certified ? totals.outputTokens / totals.certified : 0, runs: new Set(rows.map(row => row.record)).size }
  })

  // Difficulty matrix over sealed rows.
  const matrixCells = {}
  const routeCounts = new Map()
  for (const row of sealedRows) {
    const key = `${row.route} · ${row.implementer}`
    routeCounts.set(key, (routeCounts.get(key) ?? 0) + 1)
    const byRoute = matrixCells[row.environment] ??= {}
    const cell = byRoute[key] ??= { n: 0, certified: 0 }
    cell.n += 1
    if (row.certified) cell.certified += 1
  }
  const matrix = {
    environments: [...environments.values()].filter(env => matrixCells[env.id]).sort((a, b) => (b.tier ?? 0) - (a.tier ?? 0) || a.id.localeCompare(b.id)),
    routes: [...routeCounts.entries()].sort((a, b) => b[1] - a[1]).map(([key]) => ({ key, label: key })),
    cells: matrixCells,
  }

  const datasetsDir = join(PROVING_GROUND, 'datasets')
  const datasets = existsSync(datasetsDir)
    ? readdirSync(datasetsDir).filter(name => existsSync(join(datasetsDir, name, 'manifest.json'))).sort().map(name => ({ name, manifest: readJson(join(datasetsDir, name, 'manifest.json')) }))
    : []
  const dataset = datasets.length ? datasets[datasets.length - 1] : undefined

  const live = options.live.map(directory => loadLive(directory, environments))
  const timeline = [
    ...records.map(record => ({ name: record.name, kind: record.kind, start: record.ranAt, end: record.endedAt, note: record.certifiedLabel })),
    ...live.map(item => ({ name: item.name, kind: 'live', start: item.startedAt, end: item.lastEvent ?? new Date().toISOString(), note: item.finished ? 'finished' : 'running' })),
  ]
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD')
  const head = git('rev-parse', 'HEAD')
  const linkBase = `https://github.com/LBJLincoln/deepseek-harness/blob/${branch}/`
  const summary = {
    records: records.length,
    cells: records.reduce((total, record) => total + record.cells, 0),
    certified: records.reduce((total, record) => total + record.certified, 0),
    experiments: records.filter(record => record.kind === 'experiment').length,
    folds: experiments.filter(card => card.method !== 'frozen pair').length,
    environments: environments.size,
  }
  const pageNotes = [
    'A <b>cell</b> is one task, one repetition, one arm. The runner restores the fixture, lets the implementer work, runs the task\'s checks itself after each attempt, issues a directive for what failed, and <b>certifies</b> when every hidden case passes. Certificates, attempts, and usage on this page are read from the cells\' own session logs.',
    `<b>Sealed</b> marks runs since ${SEALED_SINCE.replace('T', ' ').slice(0, 16)} UTC on the bench composition: bubblewrap mounts an empty parent over the run directory with only the cell's workspace bound in, and the read barrier denies the parent; escapes are counted, not assumed away. Earlier records ran unconfined, and the census column counts the cells that left their workspace.`,
    'A <b>frozen pair</b> is one experiment whose plan was digested before any cell ran; both arms ran the same cells at the same seeds. An <b>offline fold</b> pairs two separately recorded runs with the same statistics and is evidence, never a promotion. The verdict rule reads the bootstrap interval of the paired certificate-rate delta: promote when its lower bound exceeds the minimum delta, reject when its upper bound is below zero, inconclusive otherwise.',
    'The <b>noise floor</b> is one to two flips in sixteen between two sealed runs of the same arm, so a paired delta of 0.0625 on sixteen cells is inside one arm\'s own variation. Arms of an experiment ran one after the other, so an arm is confounded with its hour on the shared subscription; interleaving is queued.',
    'Held-out environments are withheld from every observatory page by rule; the held-out fleet is read here from its fleet report and session logs and stands as the untuned estimate.',
    `Sources: <a href="${linkBase}data/proving-ground/README.md">the records README</a> (one paragraph per record), <a href="${linkBase}.agents/notes/proposed/architecture/2026-09-08-hypothesis-program-results.md">the results note</a>, and the record directories linked from each row.`,
  ]
  return {
    builtAt: new Date().toISOString(), head, branch, linkBase, summary,
    records, experiments, tier5Models, routeSlots: MODEL_SLOTS, matrix, timeline, live,
    dataset: dataset ? { name: dataset.name, counts: dataset.manifest.counts, distributions: dataset.manifest.distributions, tokens: dataset.manifest.tokens, files: dataset.manifest.files, records: (dataset.manifest.records ?? []).length, builtAt: dataset.manifest.builtAt } : undefined,
    readings: { routing: routing ? { note: routing.note, results: routing.results } : undefined, repeatability: repeatability ? { note: repeatability.note, pairs: repeatability.pairs } : undefined },
    notes: pageNotes,
  }
}

function render(data, fragment) {
  const template = readFileSync(join(TOOLS_DIR, 'dashboard.template.html'), 'utf8')
  const json = JSON.stringify(data).replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--')
  const page = template.replace('/*__DATA__*/', json)
  if (fragment) return page
  const split = page.indexOf('<header>')
  const head = page.slice(0, split), body = page.slice(split)
  return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n${head}</head>\n<body>\n${body}</body>\n</html>\n`
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const data = build(options)
  writeFileSync(options.out, render(data, options.fragment))
  const live = data.live.length ? `, ${data.live.length} live run(s)` : ''
  console.log(`wrote ${options.out}: ${data.summary.records} records, ${data.summary.cells} cells, ${data.summary.certified} certificates, ${data.experiments.length} comparisons${live}`)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
