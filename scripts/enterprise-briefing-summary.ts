/**
 * Renders the one-page executive summary pair `docs/client/daliesk-executive-summary.md` and its `.zh.md`
 * counterpart from a built briefing, so the summary carries exactly the figures `briefing.json` carries.
 * Both sides are rendered from one briefing in one call, share every heading, list, table and link in the same
 * order, and state the briefing's `asOf`; a figure the briefing marks unknown is printed as unknown with its reason.
 *
 * `pnpm run enterprise:briefing -- --summary` writes the pair and `--check-summary` compares it; after writing,
 * the pair is re-recorded with `pnpm run verify-translation-pairing --write docs/client/daliesk-executive-summary.md`.
 *
 * @module enterprise-briefing-summary
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Briefing, ExperimentRow, Figure, PilotRow, ShipmentCi, Starter } from './enterprise-briefing.ts'

/** The English side of the summary, relative to the repository root. */
const SUMMARY_PATH = 'docs/client/daliesk-executive-summary.md'

/** The Chinese side of the summary, relative to the repository root. */
const SUMMARY_ZH_PATH = 'docs/client/daliesk-executive-summary.zh.md'

/** The published briefing page the summary points to. */
const BRIEFING_URL = 'https://lbjlincoln.github.io/deepseek-harness/briefing/'

type Locale = 'en' | 'zh'

/** One phrase in both languages. */
interface Both {
  en: string
  zh: string
}

const FAMILY: Record<string, Both> = {
  bench: { en: 'bench sessions', zh: '基准会话' },
  codeSafety: { en: 'code-safety sessions', zh: '代码安全会话' },
  shifts: { en: 'shift sessions', zh: '班次会话' },
  intake: { en: 'intake sessions', zh: '受理会话' },
}

const STARTER: Record<Starter, Both> = {
  scheduler: { en: 'scheduler', zh: '调度器' },
  operator: { en: 'operator', zh: '操作员' },
  unknown: { en: 'unknown', zh: '未知' },
}

/** The UTC day whose container resets `data/transcripts/LOSSES.md` accounts for. */
const LOSSES_DAY = '2026-09-28'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function count(value: number): string {
  return value.toLocaleString('en-US')
}

function moment(iso: string, locale: Locale): string {
  const date = new Date(iso)
  const hh = String(date.getUTCHours()).padStart(2, '0')
  const mm = String(date.getUTCMinutes()).padStart(2, '0')
  if (locale === 'zh') return `${date.getUTCFullYear()} 年 ${date.getUTCMonth() + 1} 月 ${date.getUTCDate()} 日 ${hh}:${mm} UTC`
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}, ${hh}:${mm} UTC`
}

function clock(iso: string): string {
  const date = new Date(iso)
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')} UTC`
}

function decimal(value: number): string {
  const text = Math.abs(value).toFixed(2)
  return `${value < 0 && text !== '0.00' ? '−' : ''}${text}`
}

function signed(value: number): string {
  return `${value > 0 && Math.abs(value).toFixed(2) !== '0.00' ? '+' : ''}${decimal(value)}`
}

function interval(lower: number, upper: number): string {
  return `[${decimal(lower)}, ${decimal(upper)}]`
}

/**
 * @param items - the items.
 * @param locale - the side being rendered.
 * @returns the items as one phrase: `a, b and c`, or `a、b与c`, with spaces around 与 only beside Latin text.
 */
function listed(items: readonly string[], locale: Locale): string {
  const last = items.at(-1)
  if (last === undefined || items.length === 1) return items.join('')
  const head = items.slice(0, -1)
  if (locale === 'en') return `${head.join(', ')} and ${last}`
  const latin = /[\u0000-\u007f]/
  const spaced = latin.test(head.at(-1)?.slice(-1) ?? '') || latin.test(last.charAt(0))
  return `${head.join('、')}${spaced ? ' 与 ' : '与'}${last}`
}

function code(items: readonly string[]): string[] {
  return items.map(item => `\`${item}\``)
}

/**
 * A figure's value, or `unknown` with the reason.
 * @param figure - the figure; `undefined` when the briefing does not carry it.
 * @param locale - the side being rendered.
 * @param show - formats a known value.
 * @returns the text.
 */
function shown<T>(figure: Figure<T> | undefined, locale: Locale, show: (value: T) => string): string {
  if (figure === undefined) return locale === 'zh' ? '未知（简报未包含此数值）' : 'unknown (the briefing does not carry it)'
  if ('unknown' in figure) return locale === 'zh' ? `未知（${figure.unknown}）` : `unknown (${figure.unknown})`
  return show(figure.value)
}

function experiment(briefing: Briefing, plan: string): ExperimentRow | undefined {
  return briefing.bench.experiments.value?.filter(row => row.plan === plan).at(0)
}

/**
 * The Branch CI verdicts of one pilot unit's shipped commits: whether a run tested each exact commit, and the conclusion
 * of the containing run of the push that carried them.
 * @param briefing - the built briefing.
 * @param row - the unit.
 * @param locale - the side being rendered.
 * @returns the cell text.
 */
function unitCi(briefing: Briefing, row: PilotRow, locale: Locale): string {
  const zh = locale === 'zh'
  const shipped = (briefing.shipped.value ?? []).filter(entry => row.shifts.includes(entry.shift))
  if (shipped.length === 0) return zh ? '无交付' : 'nothing shipped'
  const verdicts = shipped.map(entry => entry.ci.value)
  if (verdicts.some(verdict => verdict === null)) return zh ? '未知' : 'unknown'
  const known = verdicts as ShipmentCi[]
  const exact = known.filter(verdict => verdict.exact !== null).length
  const conclusions = [...new Set(known.map(verdict => verdict.carrying?.conclusion ?? 'none'))]
  const outcome = (conclusion: string): string => {
    if (conclusion === 'success') return zh ? '通过' : 'passed'
    if (conclusion === 'failure') return zh ? '失败' : 'failed'
    if (conclusion === 'none') return zh ? '尚无' : 'none yet'
    return conclusion
  }
  return zh
    ? `确切提交：${exact}/${known.length} 有运行；包含运行：${conclusions.map(outcome).join('、')}`
    : `exact commit: ${exact} of ${known.length} run; containing run: ${conclusions.map(outcome).join(', ')}`
}

/**
 * The pilot table: one row per cycle and per shift outside a cycle.
 * @param briefing - the built briefing.
 * @param locale - the side being rendered.
 * @returns the table's lines.
 */
function pilotTable(briefing: Briefing, locale: Locale): string[] {
  const zh = locale === 'zh'
  const rows = briefing.pilot.value ?? []
  const unknown = zh ? '未知' : 'unknown'
  const lines = zh
    ? ['| 单元 | 开始时间 | 启动者 | 尝试 | 交付 | 失败或中止 | 丢失 | Branch CI | 模型 token |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |']
    : ['| Unit | Started | Started by | Attempted | Shipped | Failed or halted | Lost | Branch CI | Model tokens |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |']
  for (const row of rows) {
    const unit = row.kind === 'cycle' ? `\`${row.id}\`` : `${zh ? '班次' : 'shift'} \`${row.id}\``
    const checks = [...new Set(row.failed.flatMap(entry => entry.failedChecks))]
    const failed = row.failed.length === 0 ? '0' : `${row.failed.length} (${checks.length === 0 ? (zh ? '审阅' : 'review') : code(checks).join(', ')})`
    const shipped = row.shipped.length === 0 ? '0' : `${row.shipped.length} (${row.shipped.join(', ')})`
    lines.push(`| ${unit} | ${moment(row.startedAt, locale)} | ${STARTER[row.startedBy][locale]} | ${row.attempted ?? unknown} | ${shipped} | ${failed} | ${row.lost ?? unknown} | ${unitCi(briefing, row, locale)} | ${row.tokens === null ? unknown : count(row.tokens)} |`)
  }
  return lines
}

/**
 * The shipped-work sentence: the tickets, their shift, checks and review, and the Branch CI verdicts on them, with the
 * run on each exact commit kept apart from the containing run of the push that carried it.
 * @param briefing - the built briefing.
 * @param locale - the side being rendered.
 * @returns the sentence.
 */
function shippedSentence(briefing: Briefing, locale: Locale): string {
  const zh = locale === 'zh'
  const shipped = briefing.shipped.value ?? []
  if (shipped.length === 0) return zh ? '尚无工单交付。' : 'No ticket has shipped yet.'
  const shifts = [...new Set(shipped.map(row => row.shift))]
  const units = (briefing.pilot.value ?? []).filter(row => row.shifts.some(shift => shifts.includes(shift)))
  const starters = [...new Set(units.map(row => row.startedBy))]
  const tickets = listed(shipped.map(row => `${row.ticket} (\`${row.commit.slice(0, 9)}\`)`), locale)
  const allPassed = shipped.every(row => row.checks.passed === row.checks.total)
  const totals = [...new Set(shipped.map(row => row.checks.total))]
  const blind = shipped.every(row => row.reviewToolCalls === 0)
  const parts: string[] = []
  const by = listed(starters.map(starter => STARTER[starter][locale]), locale)
  if (zh) {
    parts.push(`${shipped.length} 张工单在由${by}启动的班次 ${listed(shifts, locale)} 中交付：${tickets}。`)
    parts.push(allPassed ? `每张都通过了全部 ${totals.join('、')} 项检查，` : `检查通过情况：${shipped.map(row => `${row.checks.passed}/${row.checks.total}`).join('、')}，`)
    parts.push(blind ? '并由一位没有调用任何工具的审阅者批准。' : '并经审阅者批准。')
  } else {
    parts.push(`${shipped.length} ${shipped.length === 1 ? 'ticket' : 'tickets'} shipped in shift ${listed(shifts, locale)}, started by the ${by}: ${tickets}.`)
    parts.push(allPassed ? `Each passed all ${listed(totals.map(String), locale)} of its checks` : `Checks passed: ${shipped.map(row => `${row.checks.passed}/${row.checks.total}`).join(', ')};`)
    parts.push(blind ? 'and was approved by a reviewer that made no tool call.' : 'and was approved by a reviewer.')
  }
  const unknownCi = shipped.map(row => row.ci).find(figure => figure.value === null)
  const joined = (): string => parts.join(zh ? '' : ' ')
  if (unknownCi !== undefined && 'unknown' in unknownCi) {
    parts.push(zh ? `这些提交的 Branch CI 结论未知（${unknownCi.unknown}）。` : `The Branch CI verdict on these commits is unknown (${unknownCi.unknown}).`)
    return joined()
  }
  const known = shipped.flatMap(row => (row.ci.value === null ? [] : [row.ci.value]))
  const exact = known.filter(value => value.exact !== null).length
  parts.push(zh
    ? `${exact === 0 ? '没有任何 Branch CI 运行单独测试过其中任何一个确切提交' : `${known.length} 个确切提交中有 ${exact} 个有 Branch CI 运行`}。`
    : `${exact === 0 ? 'No Branch CI run tested any of these exact commits' : `Branch CI ran on ${exact} of the ${known.length} exact commits`}.`)
  const carrying = [...new Map(known.flatMap(value => (value.carrying === null ? [] : [[value.carrying.id, value] as const]))).values()]
  if (carrying.length !== 1 || known.some(value => value.carrying === null)) {
    const passed = carrying.filter(value => value.carrying?.conclusion === 'success').length
    parts.push(zh ? `携带它们的 ${carrying.length} 次推送的包含运行中有 ${passed} 次通过。` : `Of the containing runs of the ${carrying.length} pushes that carried them, ${passed} passed.`)
    return joined()
  }
  const ci = carrying[0] as ShipmentCi
  const run = ci.carrying as NonNullable<ShipmentCi['carrying']>
  const passed = run.conclusion === 'success'
  const minutes = ci.firstGreen === null ? null : Math.round((Date.parse(ci.firstGreen.updatedAt) - Date.parse(run.createdAt)) / 60000)
  if (zh) {
    const failures = ci.introduced.length === 0 ? '没有引入新的失败关卡' : `它引入了 ${listed(code(ci.introduced), locale)} 的失败`
    const before = ci.preExisting.length === 0 ? '' : `，而 ${listed(code(ci.preExisting), locale)} 在该班次之前已经失败`
    const green = passed ? '' : ci.firstGreen === null ? '；尚无包含它们的完全成功运行。' : `；第一次包含它们的完全成功运行在推送 ${minutes} 分钟后、于 ${clock(ci.firstGreen.updatedAt)} 结束。`
    parts.push(passed ? '携带它们的推送的包含运行通过了。' : `携带它们的推送的包含运行失败：${failures}${before}${green}`)
  } else {
    const failures = ci.introduced.length === 0 ? 'the push introduced no failing gate' : `the push introduced a failure of ${listed(code(ci.introduced), locale)}`
    const before = ci.preExisting.length === 0 ? '' : `, while ${listed(code(ci.preExisting), locale)} already failed before the shift`
    const green = passed ? '' : ci.firstGreen === null ? '; no fully successful run contains them yet.' : `; the first fully successful run containing them finished ${minutes} minutes after the push, at ${clock(ci.firstGreen.updatedAt)}.`
    parts.push(passed ? 'The containing run of the push that carried them passed.' : `The containing run of the push that carried them failed: ${failures}${before}${green}`)
  }
  return joined()
}

/**
 * Render one side of the summary.
 * @param briefing - the built briefing.
 * @param locale - `en` or `zh`.
 * @returns the Markdown, ending in one newline.
 */
export function renderSummary(briefing: Briefing, locale: Locale): string {
  const zh = locale === 'zh'
  const f = briefing.figures
  const n = (id: string): string => shown(f[id], locale, value => (typeof value === 'number' ? count(value) : value))
  const recall = briefing.safety.recall.value ?? []
  const nodegoat = recall.filter(row => row.record.includes('nodegoat'))
  const dvja = recall.find(row => row.record.includes('dvja'))
  const tiers = briefing.safety.tiers.value ?? []
  const tier = (id: string): string => {
    const row = tiers.find(entry => entry.id === id)
    return row === undefined ? (zh ? '未知' : 'unknown') : zh ? `${row.found} 个` : `${row.found} of ${row.knownIssues}`
  }
  const known = nodegoat[0]?.knownIssues
  const opus = experiment(briefing, 'e1-sonnet-vs-opus-t5')
  const sealed = experiment(briefing, 'e2-harness-vs-product-sonnet-t5-sealed')
  const attemptsPair = experiment(briefing, 'e3-attempts-t5')
  const seeded = briefing.safety.seeded
  const terms = briefing.governance.terms.value ?? []
  const unpinned = terms.filter(row => row.family !== 'bench')
  const bench = terms.find(row => row.family === 'bench')
  const signoffs = briefing.governance.signoffs.value ?? []
  const events = signoffs.filter(row => row.form === 'event')
  const decisions = signoffs.filter(row => row.form === 'decision')
  const eventRuns = [...new Set(events.map(row => row.run))]
  const decisionRuns = [...new Set(decisions.map(row => row.run))]
  const ticked = (items: readonly string[]): string => listed([...new Set(items)].map(item => `\`${item}\``), locale)
  const spread = Math.max(0, ...eventRuns.map((run) => {
    const times = events.filter(row => row.run === run).map(row => Date.parse(row.at ?? ''))
    return Math.max(...times) - Math.min(...times)
  }).filter(Number.isFinite))
  const reviews = briefing.governance.reviews.value ?? []
  const toolful = reviews.filter(row => row.toolCalls > 0)
  const toolless = reviews.filter(row => row.toolCalls === 0)
  const withChecklists = nodegoat.filter(row => row.iteration?.pair === '3' && row.iteration.arm === 'with').map(row => String(row.found))
  const withoutChecklists = nodegoat.filter(row => row.iteration?.pair === '3' && row.iteration.arm === 'without').map(row => String(row.found))
  const schedulerCycles = f['pilot.schedulerCycles']
  const economics = briefing.economics.tickets.value ?? []
  const routes = briefing.routes.value ?? []
  const pilot = briefing.pilot.value ?? []
  const cycles = pilot.filter(row => row.kind === 'cycle')
  const lostCycle = cycles.find(row => row.attempted === null && row !== cycles.at(-1) && row.startedAt.startsWith(LOSSES_DAY))
  const reviewsOf = (target: string): number => recall.filter(row => row.target === target).length
  const targets = [...new Set(recall.map(row => row.target))].sort((left, right) => reviewsOf(right) - reviewsOf(left))
  const visibility = shown(f['repository.visibility'], locale, value => String(value))
  const lines: string[] = []

  if (zh) {
    lines.push('# Daliesk：执行摘要', '', '[English](daliesk-executive-summary.md) | 中文', '')
    lines.push(`数值截至 ${moment(briefing.asOf, locale)}，由 \`pnpm run enterprise:briefing -- --summary\` 从 [\`briefing.json\`](../../apps/command-deck/public/fixtures/briefing.json) 生成；[简报页面](${BRIEFING_URL})为每个数值注明来源文件与计算方法。`, '')
    lines.push(`Daliesk 是一个处于试点阶段的 AI（人工智能）智能体组织，通过工单队列修改代码库：每张工单在独立的 worktree 中实现，通过其验收检查，由一位只看到差异和检查输出的审阅者批准，然后作为一个提交推送到开发分支；每一步都记录在仓库中。迄今已交付的 ${n('pilot.operatorShipped')} 张工单全部来自操作员启动的班次；调度器已启动 ${n('pilot.schedulerCycles')} 个周期，交付了 ${n('pilot.schedulerShipped')} 张。本摘要只陈述记录能够支持的内容。`, '')
    lines.push('## 关键数值', '', '| 指标 | 数值 | 来源 |', '| --- | --- | --- |')
    lines.push(`| 已交付工单：操作员启动的单元 / 调度器启动的周期 | ${n('pilot.operatorShipped')} / ${n('pilot.schedulerShipped')} | [ledger.jsonl](../../data/enterprise/ledger.jsonl) |`)
    lines.push(`| 已运行周期 / 其中由调度器启动 | ${n('pilot.cycles')} / ${n('pilot.schedulerCycles')} | [scheduler.log 的实时捕获](../../data/transcripts/live/enterprise-cycles) |`)
    lines.push(`| 已交付提交中有 Branch CI 运行测试确切提交的数量 | ${n('ci.exactShipped')} / ${n('tickets.shipped')} | [Branch CI](https://github.com/LBJLincoln/deepseek-harness/actions/workflows/branch-ci.yml) |`)
    lines.push(`| Branch CI 已完成运行 / 成功运行 | ${n('ci.completed')} / ${n('ci.success')} | [Branch CI](https://github.com/LBJLincoln/deepseek-harness/actions/workflows/branch-ci.yml) |`)
    lines.push(`| 已定义席位（事业部数）/ 被已记录交付物占用的席位 | ${n('seats.defined')}（${n('divisions.count')}）/ ${n('seats.occupied')} | [roster.json](../../data/enterprise/roster.json) |`)
    lines.push(`| 每张已交付工单的模型 token 与耗时（${economics.length} 张的平均值） | ${n('economics.tokensPerShipped')} token，${n('economics.secondsPerShipped')} 秒 | [ledger.jsonl](../../data/enterprise/ledger.jsonl) |`)
    lines.push(`| Proving Ground 冻结配对实验 / 结论明确的实验 | ${n('bench.frozenPairs')} / ${n('bench.decisive')} | [data/proving-ground](../../data/proving-ground/README.md) |`)
    lines.push(`| 安全审查召回率，NodeGoat：${nodegoat.length} 次审查，每次在 ${known ?? '未知'} 个已记录问题中找到的数量（发现须在问题行范围三行以内） | ${n('safety.nodegoatMin')} 至 ${n('safety.nodegoatMax')} | [data/code-safety](../../data/code-safety/README.md) |`)
    lines.push(`| 对本仓库代码植入缺陷的召回率（三行以内） | ${shown(seeded, locale, value => `${value.planted} 个中的 ${value.caught} 个，95% 区间 ${value.interval.low.toFixed(2)}–${value.interval.high.toFixed(2)}`)} | [seeded-recall.json](../../data/code-safety/2026-09-28-dsh-self-review/seeded-recall.json) |`)
    lines.push('')
    lines.push('## 试点记录', '')
    lines.push(...pilotTable(briefing, locale), '')
    lines.push('## 证据表明什么', '')
    lines.push(`- **已交付的工作。** ${shippedSentence(briefing, locale)}`)
    lines.push(`- **无人值守的周期。** ${lostCycle === undefined ? '' : `\`${lostCycle.id}\` 的班次没有在分支上留下任何记录：[LOSSES.md](../../data/transcripts/LOSSES.md) 记载它在 22:07Z 的容器重置中丢失。`}调度器启动的周期尚未交付任何工单。`)
    lines.push(`- **基准测试。** 在 ${n('bench.environments')} 个内部编写的环境上，${opus === undefined ? '' : `更大的模型在第 5 层级上胜过中间模型（${opus.pairs} 个单元中 ${opus.candidateCertified} 对 ${opus.baselineCertified}，${signed(opus.delta)}，区间 ${interval(opus.interval.lower, opus.interval.upper)}）；`}${sealed === undefined ? '' : `harness 循环与产品自身的循环持平（${sealed.pairs} 个中 ${sealed.baselineCertified} 对 ${sealed.candidateCertified}，无定论）；`}${attemptsPair === undefined ? '' : `把尝试次数从三次减到一次会降低认证率（${signed(attemptsPair.delta)}，区间 ${interval(attemptsPair.interval.lower, attemptsPair.interval.upper)}）。`}尚无冻结配对实验推动过 harness 的改动。`)
    lines.push(`- **安全审查。** 在 NodeGoat 的三层对比中，扫描器、单个模型单次审查与本企业分别找到 ${tiers[0]?.knownIssues ?? '未知'} 个已记录问题中的 ${listed([tier('semgrep'), tier('single-model'), tier('enterprise')], locale)}，均以发现落在问题行范围三行以内为准。${withChecklists.length === 0 ? '' : `依据对本企业在该应用上漏报的诊断编写检查清单后，两次运行分别找到 ${listed(withChecklists, locale)} 个，未使用时为 ${listed(withoutChecklists, locale)} 个；这些清单能否迁移到其他代码库尚未验证。`}${dvja === undefined ? '' : `在 dvja 上找到 ${dvja.knownIssues} 个中的 ${dvja.found} 个。`}`)
    lines.push('')
    lines.push('## 数据流向', '')
    lines.push('- **模型请求。** 各部门、审阅者与受理协调员通过操作员的 Claude Code 登录运行：每次模型请求，连同部门读取的每个文件的内容，都在该账户下发送到 Anthropic 的模型 API。')
    lines.push(`- **发布的记录。** 班次记录提交每个会话日志，实时捕获每五分钟把操作员与各部门的对话记录提交到本仓库；该仓库在 GitHub 上的可见性为 ${visibility}。`)
    lines.push('- **客户合作的要求。** 在读取任何客户代码之前：一个签有数据处理协议（DPA）并启用零数据保留的 Anthropic API 组织，以及一个存放记录的私有仓库。')
    lines.push('')
    lines.push('## 控制措施', '')
    lines.push('- **隔离。** 基准单元在 Linux 上的沙箱（bubblewrap，然后 Landlock）中运行；班次部门尚未在沙箱中运行，而是在无法推送的临时克隆的独立 worktree 中运行。')
    lines.push(`- **职责分离。** 审阅者是一个没有父会话、工作目录为空的新会话，只阅读差异、提交说明与检查输出${toolful.length === 0 ? '' : `；班次 ${listed(toolful.map(row => row.shift), locale)} 的审阅会话仍调用了 ${toolful.reduce((sum, row) => sum + row.toolCalls, 0)} 次工具，此后引擎移除了审阅者的全部工具`}${toolless.length === 0 ? '' : `，班次 ${listed(toolless.map(row => row.shift), locale)} 的审阅会话没有调用工具`}。代码安全发现由已提交的检查器逐行核对（${n('safety.records')} 份记录中 ${n('safety.examinerPassed')} 份退出码为 0）。`)
    lines.push(`- **签署。** 在推送之前，没有任何人员签署变更。引擎自行决定班次的规格冻结与发布。${eventRuns.length === 0 ? '' : `${eventRuns.length} 份记录中的签署事件由引擎在程序启动时写入，间隔不超过 ${spread} 毫秒，主体为 ${ticked(events.map(row => row.principal))}，类型标为 ${ticked(events.map(row => row.kind))}。`}${decisionRuns.length === 0 ? '尚无记录载有引擎的决定。' : `${decisionRuns.length} 份记录以机器主体 ${ticked(decisions.map(row => row.principal))} 载有引擎的决定。`}`)
    lines.push('')
    lines.push('## 局限与风险', '')
    lines.push(`- **规模。** 试点共交付 ${n('tickets.shipped')} 张工单，另有 ${n('tickets.open')} 张未关闭；${n('shifts.count')} 个班次记录。`)
    lines.push(`- **CI。** 自 ${shown(f['ci.first'], locale, value => moment(String(value), locale))} 以来，${n('ci.completed')} 次已完成的 Branch CI 运行中有 ${n('ci.success')} 次成功，最近一次有结论的运行${shown(f['ci.latestConclusion'], locale, value => (value === 'success' ? '通过' : '失败'))}。`)
    lines.push(`- **数据使用条款。** ${bench === undefined ? '' : `${count(bench.sessions)} 个基准会话中有 ${count(bench.withTerms)} 个固定了数据使用条款；`}${listed(unpinned.map(row => `${FAMILY[row.family]?.zh ?? row.family} ${count(row.sessions)} 个中有 ${count(row.withTerms)} 个`), locale)}。`)
    lines.push(`- **单一供应商。** 已记录会话按供应商路由统计：${routes.map(row => `${row.route} ${count(row.sessions)}`).join('、')}。`)
    lines.push('')
    lines.push('## 合作方式', '')
    lines.push(`先满足上述数据流向要求，并在每个会话上固定写明客户、协议、用途、驻留地与保留期限的数据使用条款；然后对客户选定的代码库做一次代码安全审查，由客户自己的工程师核对每一项发现；再在一个一致认可的队列上运行受监督的班次，每次发布由一位人员签署；最后依据测得的记录决定是否继续。目前记录在案的代码安全审查对象是 ${listed([...targets, '本仓库自身的代码'], locale)}。`)
  } else {
    lines.push('# Daliesk: executive summary', '', 'English | [中文](daliesk-executive-summary.zh.md)', '')
    lines.push(`Figures as of ${moment(briefing.asOf, locale)}, generated from [\`briefing.json\`](../../apps/command-deck/public/fixtures/briefing.json) by \`pnpm run enterprise:briefing -- --summary\`; the [briefing page](${BRIEFING_URL}) names the source file and the computation of each.`, '')
    lines.push(`Daliesk is a pilot: an organisation of AI agents that changes a codebase through a ticket queue. Each ticket is implemented in its own worktree, passes its acceptance checks, is approved by a reviewer that sees only the diff and the check output, and is pushed as one commit to the development branch, with every step recorded in the repository. The ${n('pilot.operatorShipped')} tickets shipped so far came from shifts the operator started; the scheduler has started ${n('pilot.schedulerCycles')} ${schedulerCycles?.value === 1 ? 'cycle' : 'cycles'}, which shipped ${n('pilot.schedulerShipped')}. This summary states only what the records support.`, '')
    lines.push('## Key figures', '', '| Measure | Value | Source |', '| --- | --- | --- |')
    lines.push(`| Tickets shipped: by units the operator started / by cycles the scheduler started | ${n('pilot.operatorShipped')} / ${n('pilot.schedulerShipped')} | [ledger.jsonl](../../data/enterprise/ledger.jsonl) |`)
    lines.push(`| Cycles run / started by the scheduler | ${n('pilot.cycles')} / ${n('pilot.schedulerCycles')} | [captured scheduler log](../../data/transcripts/live/enterprise-cycles) |`)
    lines.push(`| Shipped commits with a Branch CI run on the exact commit | ${n('ci.exactShipped')} of ${n('tickets.shipped')} | [Branch CI](https://github.com/LBJLincoln/deepseek-harness/actions/workflows/branch-ci.yml) |`)
    lines.push(`| Branch CI runs completed / successful | ${n('ci.completed')} / ${n('ci.success')} | [Branch CI](https://github.com/LBJLincoln/deepseek-harness/actions/workflows/branch-ci.yml) |`)
    lines.push(`| Seats defined (divisions) / occupied by a recorded deliverable | ${n('seats.defined')} (${n('divisions.count')}) / ${n('seats.occupied')} | [roster.json](../../data/enterprise/roster.json) |`)
    lines.push(`| Model tokens and time per shipped ticket (mean of ${economics.length}) | ${n('economics.tokensPerShipped')} tokens, ${n('economics.secondsPerShipped')} s | [ledger.jsonl](../../data/enterprise/ledger.jsonl) |`)
    lines.push(`| Proving Ground frozen paired experiments / decisive | ${n('bench.frozenPairs')} / ${n('bench.decisive')} | [data/proving-ground](../../data/proving-ground/README.md) |`)
    lines.push(`| Security review recall, NodeGoat: documented issues found per review, of ${known ?? 'unknown'}, over ${nodegoat.length} reviews (a finding within three lines of the issue) | ${n('safety.nodegoatMin')} to ${n('safety.nodegoatMax')} | [data/code-safety](../../data/code-safety/README.md) |`)
    lines.push(`| Recall of defects planted in this repository's own code (within three lines) | ${shown(seeded, locale, value => `${value.caught} of ${value.planted}, 95% interval ${value.interval.low.toFixed(2)}–${value.interval.high.toFixed(2)}`)} | [seeded-recall.json](../../data/code-safety/2026-09-28-dsh-self-review/seeded-recall.json) |`)
    lines.push('')
    lines.push('## The pilot, unit by unit', '')
    lines.push(...pilotTable(briefing, locale), '')
    lines.push('## What the evidence shows', '')
    lines.push(`- **Shipped work.** ${shippedSentence(briefing, locale)}`)
    lines.push(`- **Unattended cycles.** ${lostCycle === undefined ? '' : `The cycle \`${lostCycle.id}\` left no record of its shift on the branch; [LOSSES.md](../../data/transcripts/LOSSES.md) states that the 22:07Z container reset erased it. `}No cycle the scheduler started has shipped a ticket yet.`)
    lines.push(`- **Benchmark.** On ${n('bench.environments')} in-house environments, ${opus === undefined ? '' : `a larger model beat the middle one on tier 5 (${opus.candidateCertified} against ${opus.baselineCertified} of ${opus.pairs} cells, ${signed(opus.delta)}, interval ${interval(opus.interval.lower, opus.interval.upper)}); `}${sealed === undefined ? '' : `the harness loop and the product's own loop were level (${sealed.baselineCertified} against ${sealed.candidateCertified} of ${sealed.pairs}, inconclusive); `}${attemptsPair === undefined ? '' : `cutting the attempts from three to one lowered certification (${signed(attemptsPair.delta)}, interval ${interval(attemptsPair.interval.lower, attemptsPair.interval.upper)}). `}No frozen pair has promoted a harness change.`)
    lines.push(`- **Security review.** In the three-tier comparison on NodeGoat, a scanner, one model in one pass and the enterprise found ${tier('semgrep')}, ${tier('single-model')} and ${tier('enterprise')} documented issues, counting a finding within three lines of an issue.${withChecklists.length === 0 ? '' : ` Checklists written from a diagnosis of the enterprise's misses on this application gave ${listed(withChecklists, locale)} in the two runs with them, against ${listed(withoutChecklists, locale)} without; whether they transfer to another codebase is untested.`}${dvja === undefined ? '' : ` On dvja the review found ${dvja.found} of ${dvja.knownIssues}.`}`)
    lines.push('')
    lines.push('## Data flow', '')
    lines.push('- **Model requests.** The departments, reviewers and intake coordinators run through the operator\'s Claude Code login: every model request, with the contents of every file a department reads, goes to Anthropic\'s model API under that account.')
    lines.push(`- **Published records.** Shift records commit every session log, and the live capture commits the operator's and the departments' transcripts every five minutes, to this repository, whose visibility on GitHub is ${visibility}.`)
    lines.push('- **What a client engagement needs.** Before any client code is read: an Anthropic API organisation under a data processing agreement with zero data retention, and a private repository for the records.')
    lines.push('')
    lines.push('## Controls', '')
    lines.push('- **Isolation.** Bench cells run in a sandbox (bubblewrap, then Landlock, on Linux); shift departments do not yet: each works unconfined in its own worktree of a scratch clone that cannot push.')
    lines.push(`- **Separation of duties.** The reviewer is a fresh session with no parent and an empty working directory that reads only the diff, the commit messages and the check output${toolful.length === 0 ? '' : `; the review sessions of shift ${listed(toolful.map(row => row.shift), locale)} still made ${toolful.reduce((sum, row) => sum + row.toolCalls, 0)} tool calls, after which the engine removed every tool from the reviewer`}${toolless.length === 0 ? '' : `, and those of shift ${listed(toolless.map(row => row.shift), locale)} made none`}. Code-safety findings are checked line by line by a committed examiner (exit 0 on ${n('safety.examinerPassed')} of ${n('safety.records')} records).`)
    lines.push(`- **Sign-off.** No person signs a change before it is pushed: the engine decides a shift's spec freeze and release itself.${eventRuns.length === 0 ? '' : ` The sign-off events in ${eventRuns.length} records were written by the engine as the program opened, at most ${spread} ms apart, under ${ticked(events.map(row => row.principal))} of the kind ${ticked(events.map(row => row.kind))}.`}${decisionRuns.length === 0 ? ' No record carries the engine\'s decisions yet.' : ` ${decisionRuns.length} records carry the engine's decisions under the machine principal ${ticked(decisions.map(row => row.principal))}.`}`)
    lines.push('')
    lines.push('## Limits and risks', '')
    lines.push(`- **Scale.** The pilot has shipped ${n('tickets.shipped')} tickets, with ${n('tickets.open')} open, over ${n('shifts.count')} shift records.`)
    lines.push(`- **CI.** Of ${n('ci.completed')} completed Branch CI runs since ${shown(f['ci.first'], locale, value => moment(String(value), locale))}, ${n('ci.success')} succeeded; the newest run with a verdict ${shown(f['ci.latestConclusion'], locale, value => (value === 'success' ? 'passed' : 'failed'))}.`)
    lines.push(`- **Data-use terms.** ${bench === undefined ? '' : `${count(bench.withTerms)} of ${count(bench.sessions)} bench sessions pin data-use terms; `}${listed(unpinned.map(row => `${FAMILY[row.family]?.en ?? row.family} ${count(row.withTerms)} of ${count(row.sessions)}`), locale)}.`)
    lines.push(`- **One vendor.** Recorded sessions by provider route: ${routes.map(row => `${row.route} ${count(row.sessions)}`).join(', ')}.`)
    lines.push('')
    lines.push('## Engagement', '')
    lines.push(`Meet the data-flow requirements above, with data-use terms naming the client, the agreement, the purposes, the residency and the retention pinned on every session; then a code-safety review of a codebase the client selects, each finding checked by the client's own engineers; then supervised shifts on an agreed queue, with a person signing each release; then decide on the measured record. The code-safety records on file review ${listed([...targets, "this repository's own code"], locale)}.`)
  }
  return `${lines.join('\n')}\n`
}

/**
 * Both sides of the summary, for the builder to write. This module imports nothing from the builder at run time,
 * which loads it while its own evaluation is still pending.
 * @param briefing - the built briefing.
 * @returns each side's repository path and content.
 */
export function summaryFiles(briefing: Briefing): { path: string; content: string }[] {
  return [{ path: SUMMARY_PATH, content: renderSummary(briefing, 'en') }, { path: SUMMARY_ZH_PATH, content: renderSummary(briefing, 'zh') }]
}

/**
 * Compare the committed summary with the rendering of a briefing.
 * @param root - repository root.
 * @param briefing - the briefing the summary should render.
 * @returns the paths that differ or are missing; empty when both match.
 */
export function checkSummary(root: string, briefing: Briefing): string[] {
  return summaryFiles(briefing).filter(({ path, content }) => {
    const file = join(root, path)
    return !existsSync(file) || readFileSync(file, 'utf8') !== content
  }).map(({ path }) => path)
}
