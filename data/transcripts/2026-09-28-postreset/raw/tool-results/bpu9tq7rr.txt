#!/usr/bin/env node
// Builds a compact, analysable process dataset from a raw Claude Code
// transcript tree, as written by collect-claude-code-session.mjs. Node
// built-ins only, no dependencies.
//
// Usage: node transcripts-to-dataset.mjs <transcripts-dir> <out-dir>
//
// Inputs under <transcripts-dir>:
//   orchestrator-session.jsonl               - the orchestrating session, or its
//     line-split parts orchestrator-session.part-NN.jsonl
//   subagents/*.jsonl, subagents/*.output    - one file per background task
//     (only files whose every line is JSON and that carry at least one real
//     user/assistant message count as transcripts; see classifyOutputFile)
//
// Outputs under <out-dir>:
//   agents.jsonl    - one record per transcript (orchestrator + subagents)
//   messages.jsonl  - one record per conversational message across all transcripts
//   stats.json      - totals + subagent duration distribution
//   README.md       - provenance and usage note

import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, statSync, lstatSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'

const [transcriptsArg, outputArg] = process.argv.slice(2)
if (transcriptsArg === undefined || outputArg === undefined) {
  throw new Error('usage: node transcripts-to-dataset.mjs <transcripts-dir> <out-dir>')
}
const TRANSCRIPTS_DIR = resolve(transcriptsArg)
const SUBAGENTS_DIR = join(TRANSCRIPTS_DIR, 'subagents')
const OUTPUT_DIR = resolve(outputArg)
const REPO_DIR = resolve(import.meta.dirname, '..', '..', '..')
const TRANSCRIPT_FILE_RE = /\.(?:jsonl|output)$/

const FIRST_PROMPT_EXCERPT_CHARS = 400
const FINAL_ASSISTANT_EXCERPT_CHARS = 600
const MESSAGE_TEXT_TRUNCATE_CHARS = 4000
const TOOL_INPUT_EXCERPT_CHARS = 600
const FILE_EDIT_TOOL_NAMES = new Set(['Edit', 'Write', 'MultiEdit'])

// ---------------------------------------------------------------------------
// Secret masking
//
// Applied to every text field this dataset emits (message text, prompt/
// response excerpts, tool-call input excerpts) - broader than the task's
// literal minimum (which only required it on tool-call input excerpts), on
// the theory that a prompt or response can carry a pasted credential just as
// easily as a tool argument can.
// ---------------------------------------------------------------------------

const PREFIXED_SECRET_PATTERNS = [
  { re: /\bsk-[A-Za-z0-9_-]{6,}/g, replacement: 'sk-[REDACTED]' },
  { re: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, replacement: 'Bearer [REDACTED]' },
  { re: /\bghp_[A-Za-z0-9]{6,}/g, replacement: 'ghp_[REDACTED]' },
  { re: /\bAKIA[A-Z0-9]{6,}/g, replacement: 'AKIA[REDACTED]' },
]
// Bare 32+ character hex/base64-looking run. Requires a mix of a letter and a
// digit so ordinary slash-free English/path text (all-letters, or all-digits)
// does not get eaten; real hashes and tokens virtually always mix both.
const GENERIC_TOKEN_RE = /[A-Za-z0-9+=]{32,}/g

/**
 * Replaces secret-shaped substrings with `[REDACTED]` placeholders.
 * @param {string} input text to scan
 * @returns {string} text with secret-shaped substrings replaced
 */
function maskSecrets(input) {
  if (!input) return input
  let out = input
  for (const { re, replacement } of PREFIXED_SECRET_PATTERNS) {
    out = out.replace(re, replacement)
  }
  out = out.replace(GENERIC_TOKEN_RE, (m) => (/[0-9]/.test(m) && /[A-Za-z]/.test(m) ? '[REDACTED]' : m))
  return out
}

// ---------------------------------------------------------------------------
// Commit-sha extraction (from RAW, pre-mask text - a 40-hex sha is exactly
// the shape the generic secret mask would otherwise eat).
// ---------------------------------------------------------------------------

const COMMIT_SHA_RE = /\b(?:commit|sha)\w*\b[\s\S]{0,24}?\b([0-9a-fA-F]{7,40})\b/gi

/**
 * Finds 7-to-40-hex tokens that follow the literal words "commit" or "sha"
 * within a short glue window (handles phrasing like "commit `abc1234`",
 * "commits `a`+`b`", and JSON-shaped `"commit":{"sha":"..."}`). Does not
 * match camelCase identifiers such as `baseSha` - "sha" must appear as its
 * own word.
 * @param {string} text raw (unmasked) text to scan
 * @returns {string[]} deduplicated, sorted hex tokens found
 */
function extractCommitShas(text) {
  const found = new Set()
  if (!text) return []
  COMMIT_SHA_RE.lastIndex = 0
  let m
  while ((m = COMMIT_SHA_RE.exec(text))) {
    found.add(m[1])
    if (m.index === COMMIT_SHA_RE.lastIndex) COMMIT_SHA_RE.lastIndex++
  }
  return [...found].sort()
}

// ---------------------------------------------------------------------------
// JSONL line shape helpers
// ---------------------------------------------------------------------------

/**
 * Concatenates the "text"-type content blocks of a message (or returns the
 * content directly when it is already a plain string). Ignores "thinking",
 * "tool_use", and "tool_result" blocks.
 * @param {string | Array<Record<string, unknown>> | undefined} content Anthropic-shaped message content
 * @returns {string} the visible text of the message
 */
function extractText(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n')
  }
  return ''
}

/**
 * Sums the serialized size of every tool_result block in a message's content.
 * The bodies themselves are never returned or stored - only their length.
 * @param {string | Array<Record<string, unknown>> | undefined} content Anthropic-shaped message content
 * @returns {number} total character count of tool_result bodies in this message
 */
function toolResultChars(content) {
  if (!Array.isArray(content)) return 0
  let chars = 0
  for (const b of content) {
    if (b && b.type === 'tool_result') {
      const body = b.content !== undefined ? b.content : b
      chars += JSON.stringify(body).length
    }
  }
  return chars
}

/**
 * Classifies one `subagents/*.output` file. Only files where every non-blank
 * line parses as JSON and at least one line is a real user/assistant message
 * are genuine Claude Code subagent transcripts; the rest are background
 * command output (see README for what these turned out to be in this export).
 * @param {string} filePath absolute path to the `.output` file
 * @returns {{ kind: 'empty' | 'non-jsonl' | 'non-transcript-jsonl' | 'transcript', lines: Array<Record<string, unknown>>, byteSize: number }}
 */
function classifyOutputFile(filePath) {
  const raw = readFileSync(filePath, 'utf8')
  const byteSize = Buffer.byteLength(raw, 'utf8')
  const rawLines = raw.split('\n').filter((l) => l.trim().length > 0)
  if (rawLines.length === 0) return { kind: 'empty', lines: [], byteSize }
  const parsed = []
  for (const line of rawLines) {
    try {
      parsed.push(JSON.parse(line))
    } catch {
      return { kind: 'non-jsonl', lines: [], byteSize }
    }
  }
  const looksLikeTranscript = parsed.some((o) => (o.type === 'user' || o.type === 'assistant') && o.message && o.message.role)
  return { kind: looksLikeTranscript ? 'transcript' : 'non-transcript-jsonl', lines: parsed, byteSize }
}

/**
 * True when the last line of a transcript is an assistant message that made
 * a tool call with no accompanying text and no subsequent line - i.e. the
 * transcript was captured mid-action rather than at a natural stopping
 * point (a background agent still running, or one that stopped without a
 * closing report).
 * @param {Array<Record<string, unknown>>} lines every parsed line of the transcript, in file order
 * @returns {boolean} whether the transcript's tail looks mid-action
 */
function endsMidAction(lines) {
  const last = lines[lines.length - 1]
  if (!last || last.type !== 'assistant' || !Array.isArray(last.message?.content)) return false
  const hasToolUse = last.message.content.some((b) => b && b.type === 'tool_use')
  const hasText = last.message.content.some((b) => b && b.type === 'text' && b.text?.trim())
  return hasToolUse && !hasText
}

/**
 * Parses a `.jsonl` file that is already known to be a genuine transcript
 * (the orchestrator session file, which is not subject to classification).
 * @param {string} filePath absolute path to the `.jsonl` file
 * @returns {Array<Record<string, unknown>>} parsed lines in file order
 */
function readJsonlTranscript(filePath) {
  const raw = readFileSync(filePath, 'utf8')
  return raw
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l))
}

/**
 * Reads the orchestrating session: the whole file when present, otherwise its
 * line-split parts in order.
 * @returns {Array<Record<string, unknown>>} parsed lines in file order
 */
function readOrchestratorLines() {
  const whole = join(TRANSCRIPTS_DIR, 'orchestrator-session.jsonl')
  if (existsSync(whole)) return readJsonlTranscript(whole)
  const parts = readdirSync(TRANSCRIPTS_DIR)
    .filter((f) => /^orchestrator-session\.part-\d+\.jsonl$/.test(f))
    .sort()
  if (parts.length === 0) throw new Error(`no orchestrator-session.jsonl or parts under ${TRANSCRIPTS_DIR}`)
  return parts.flatMap((f) => readJsonlTranscript(join(TRANSCRIPTS_DIR, f)))
}

// ---------------------------------------------------------------------------
// Per-transcript aggregation
// ---------------------------------------------------------------------------

/**
 * Builds the agents.jsonl record and the ordered list of conversational
 * messages for one transcript.
 * @param {string} id session id (orchestrator) or agent id (subagent)
 * @param {'orchestrator' | 'subagent'} kind transcript kind
 * @param {Array<Record<string, unknown>>} lines every parsed line of the transcript, in file order
 * @returns {{ agentRecord: Record<string, unknown>, messages: Array<Record<string, unknown>> }}
 */
function buildTranscriptRecord(id, kind, lines) {
  let startedAtMs = null
  let endedAtMs = null
  for (const o of lines) {
    if (typeof o.timestamp === 'string') {
      const t = Date.parse(o.timestamp)
      if (!Number.isNaN(t)) {
        if (startedAtMs === null || t < startedAtMs) startedAtMs = t
        if (endedAtMs === null || t > endedAtMs) endedAtMs = t
      }
    }
  }

  // Turns: total user+assistant messages (each alternating message is one
  // turn) - this also makes sum(agents[].turns) === messages.jsonl line count,
  // which the validation step below checks.
  const messageLines = lines.filter((o) => (o.type === 'user' || o.type === 'assistant') && o.message && o.message.role)

  let toolCallCount = 0
  const toolCallsByName = {}
  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let sawCacheReadField = false
  const filesTouched = new Set()

  for (const m of messageLines) {
    if (m.message.role !== 'assistant') continue
    const usage = m.message.usage || {}
    if (typeof usage.input_tokens === 'number') inputTokens += usage.input_tokens
    if (typeof usage.output_tokens === 'number') outputTokens += usage.output_tokens
    if ('cache_read_input_tokens' in usage) {
      sawCacheReadField = true
      if (typeof usage.cache_read_input_tokens === 'number') cacheReadTokens += usage.cache_read_input_tokens
    }
    const blocks = Array.isArray(m.message.content) ? m.message.content : []
    for (const b of blocks) {
      if (!b || b.type !== 'tool_use') continue
      toolCallCount++
      toolCallsByName[b.name] = (toolCallsByName[b.name] || 0) + 1
      if (FILE_EDIT_TOOL_NAMES.has(b.name)) {
        const p = b.input && (b.input.file_path ?? b.input.path)
        if (typeof p === 'string') filesTouched.add(p)
      }
    }
  }

  const firstUserMessage = messageLines.find((m) => m.message.role === 'user')
  const lastAssistantMessage = [...messageLines].reverse().find((m) => m.message.role === 'assistant')
  const firstUserRawText = firstUserMessage ? extractText(firstUserMessage.message.content) : ''
  const lastAssistantRawText = lastAssistantMessage ? extractText(lastAssistantMessage.message.content) : ''

  const agentRecord = {
    id,
    kind,
    startedAt: startedAtMs !== null ? new Date(startedAtMs).toISOString() : null,
    endedAt: endedAtMs !== null ? new Date(endedAtMs).toISOString() : null,
    durationMs: startedAtMs !== null && endedAtMs !== null ? endedAtMs - startedAtMs : null,
    turns: messageLines.length,
    toolCalls: toolCallCount,
    toolCallsByName,
    inputTokens,
    outputTokens,
    ...(sawCacheReadField ? { cacheReadTokens } : {}),
    firstUserPromptExcerpt: maskSecrets(firstUserRawText).slice(0, FIRST_PROMPT_EXCERPT_CHARS),
    finalAssistantExcerpt: maskSecrets(lastAssistantRawText).slice(0, FINAL_ASSISTANT_EXCERPT_CHARS),
    commitShasMentioned: extractCommitShas(lastAssistantRawText),
    filesTouched: [...filesTouched].sort(),
  }

  const messages = messageLines.map((m, seq) => {
    const content = m.message.content
    const rawText = extractText(content)
    const toolCalls = Array.isArray(content)
      ? content
          .filter((b) => b && b.type === 'tool_use')
          .map((b) => ({
            name: b.name,
            inputExcerpt: maskSecrets(JSON.stringify(b.input ?? {})).slice(0, TOOL_INPUT_EXCERPT_CHARS),
          }))
      : []
    return {
      agentId: id,
      seq,
      role: m.message.role,
      at: typeof m.timestamp === 'string' ? m.timestamp : null,
      textChars: rawText.length,
      text: maskSecrets(rawText).slice(0, MESSAGE_TEXT_TRUNCATE_CHARS),
      toolCalls,
      toolResultChars: toolResultChars(content),
    }
  })

  return { agentRecord, messages }
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

/**
 * Computes count/min/max/mean/percentiles/histogram for a numeric sample.
 * @param {number[]} values duration samples in milliseconds
 * @returns {Record<string, unknown>} distribution summary
 */
function summarizeDurations(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const n = sorted.length
  const percentile = (p) => {
    if (n === 0) return null
    const idx = Math.min(n - 1, Math.max(0, Math.ceil((p / 100) * n) - 1))
    return sorted[idx]
  }
  const bucketEdgesMinutes = [0, 1, 5, 15, 30, 60, 120, Infinity]
  const histogramByMinutes = []
  for (let i = 0; i < bucketEdgesMinutes.length - 1; i++) {
    const loMin = bucketEdgesMinutes[i]
    const hiMin = bucketEdgesMinutes[i + 1]
    const loMs = loMin * 60_000
    const hiMs = hiMin * 60_000
    const count = sorted.filter((v) => v >= loMs && v < hiMs).length
    histogramByMinutes.push({
      rangeMinutes: hiMin === Infinity ? `${loMin}+` : `${loMin}-${hiMin}`,
      count,
    })
  }
  return {
    count: n,
    minMs: n ? sorted[0] : null,
    maxMs: n ? sorted[n - 1] : null,
    meanMs: n ? Math.round(sorted.reduce((s, v) => s + v, 0) / n) : null,
    medianMs: percentile(50),
    p10Ms: percentile(10),
    p25Ms: percentile(25),
    p75Ms: percentile(75),
    p90Ms: percentile(90),
    p95Ms: percentile(95),
    histogramByMinutes,
  }
}

/**
 * Reads the current git branch and HEAD commit of the harness repo, without
 * modifying it, for the dataset README's provenance section.
 * @returns {{ branch: string, headCommit: string }}
 */
function readRepoProvenance() {
  const branch = execFileSync('git', ['-C', REPO_DIR, 'branch', '--show-current'], { encoding: 'utf8' }).trim()
  const headCommit = execFileSync('git', ['-C', REPO_DIR, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  return { branch, headCommit }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true })

  const orchestratorLines = readOrchestratorLines()
  const orchestratorSessionId = orchestratorLines.find((o) => typeof o.sessionId === 'string')?.sessionId ?? 'orchestrator'
  const { agentRecord: orchestratorRecord, messages: orchestratorMessages } = buildTranscriptRecord(
    orchestratorSessionId,
    'orchestrator',
    orchestratorLines,
  )

  const outputFiles = existsSync(SUBAGENTS_DIR)
    ? readdirSync(SUBAGENTS_DIR)
        .filter((f) => TRANSCRIPT_FILE_RE.test(f))
        .sort()
        .map((f) => join(SUBAGENTS_DIR, f))
    : []

  const subagentRecords = []
  const subagentMessagesByAgent = []
  const skipped = { empty: [], 'non-jsonl': [], 'non-transcript-jsonl': [] }
  let symlinkTranscriptCount = 0
  const midActionAgentIds = []

  for (const filePath of outputFiles) {
    const id = filePath
      .slice(filePath.lastIndexOf('/') + 1)
      .replace(TRANSCRIPT_FILE_RE, '')
      .replace(/^agent-/, '')
    const { kind, lines, byteSize } = classifyOutputFile(filePath)
    if (kind !== 'transcript') {
      skipped[kind].push({ id, byteSize })
      continue
    }
    if (lstatSync(filePath).isSymbolicLink()) symlinkTranscriptCount++
    if (endsMidAction(lines)) midActionAgentIds.push(id)
    const { agentRecord, messages } = buildTranscriptRecord(id, 'subagent', lines)
    subagentRecords.push(agentRecord)
    subagentMessagesByAgent.push(messages)
  }

  // Orchestrator first, then subagents in chronological start order.
  const order = subagentRecords
    .map((r, i) => i)
    .sort((a, b) => (subagentRecords[a].startedAt ?? '').localeCompare(subagentRecords[b].startedAt ?? ''))
  const orderedSubagentRecords = order.map((i) => subagentRecords[i])
  const orderedSubagentMessages = order.map((i) => subagentMessagesByAgent[i])

  const allAgentRecords = [orchestratorRecord, ...orderedSubagentRecords]
  const allMessages = [orchestratorMessages, ...orderedSubagentMessages].flat()

  // --- write agents.jsonl ---
  const agentsPath = join(OUTPUT_DIR, 'agents.jsonl')
  writeFileSync(agentsPath, allAgentRecords.map((r) => JSON.stringify(r)).join('\n') + '\n')

  // --- write messages.jsonl ---
  const messagesPath = join(OUTPUT_DIR, 'messages.jsonl')
  writeFileSync(messagesPath, allMessages.map((m) => JSON.stringify(m)).join('\n') + '\n')

  // --- stats.json ---
  const toolCallsByNameTotal = {}
  let inputTokensTotal = 0
  let outputTokensTotal = 0
  let cacheReadTokensTotal = 0
  let minStart = null
  let maxEnd = null
  for (const r of allAgentRecords) {
    for (const [name, count] of Object.entries(r.toolCallsByName)) {
      toolCallsByNameTotal[name] = (toolCallsByNameTotal[name] || 0) + count
    }
    inputTokensTotal += r.inputTokens
    outputTokensTotal += r.outputTokens
    cacheReadTokensTotal += r.cacheReadTokens ?? 0
    if (r.startedAt && (minStart === null || r.startedAt < minStart)) minStart = r.startedAt
    if (r.endedAt && (maxEnd === null || r.endedAt > maxEnd)) maxEnd = r.endedAt
  }
  const toolCallsByNameSorted = Object.fromEntries(Object.entries(toolCallsByNameTotal).sort((a, b) => b[1] - a[1]))

  const { branch, headCommit } = readRepoProvenance()

  const stats = {
    generatedAt: new Date().toISOString(),
    totals: {
      transcripts: allAgentRecords.length,
      messages: allMessages.length,
      toolCallsByName: toolCallsByNameSorted,
      tokensByKind: {
        input: inputTokensTotal,
        output: outputTokensTotal,
        cacheRead: cacheReadTokensTotal,
      },
      wallTimeMs: minStart && maxEnd ? Date.parse(maxEnd) - Date.parse(minStart) : null,
      wallTimeStart: minStart,
      wallTimeEnd: maxEnd,
    },
    subagentDurations: summarizeDurations(orderedSubagentRecords.map((r) => r.durationMs).filter((v) => typeof v === 'number')),
    sourceDataQuality: {
      subagentOutputFilesFound: outputFiles.length,
      subagentTranscriptsIncluded: orderedSubagentRecords.length,
      subagentNonJsonlFilesExcluded: skipped['non-jsonl'].length,
      subagentEmptyFilesExcluded: skipped.empty.length,
      subagentNonTranscriptJsonlFilesExcluded: skipped['non-transcript-jsonl'].length,
      subagentExcludedFilesTotalBytes: [...skipped.empty, ...skipped['non-jsonl'], ...skipped['non-transcript-jsonl']].reduce(
        (s, f) => s + f.byteSize,
        0,
      ),
      subagentTranscriptsBackedBySymlink: symlinkTranscriptCount,
      subagentTranscriptsEndingMidAction: midActionAgentIds,
      note:
        'Only subagents/ files whose every line parses as JSON and that carry at least one real user/assistant ' +
        'message were counted as transcripts; the rest are subagent descriptors or captured tool output. ' +
        'subagentTranscriptsBackedBySymlink counts transcript files that were symlinks into a live Claude Code ' +
        'project directory rather than frozen copies. subagentTranscriptsEndingMidAction lists agent ids whose ' +
        'last recorded line is a tool call with no accompanying text and no result - captured mid-action rather ' +
        'than at a natural stopping point. See README.md next to this file.',
    },
  }
  const statsPath = join(OUTPUT_DIR, 'stats.json')
  writeFileSync(statsPath, JSON.stringify(stats, null, 2) + '\n')

  // --- README.md + README.zh.md (a bilingual pair; re-record it after regeneration) ---
  const readme = {
    subagents: orderedSubagentRecords.length,
    files: outputFiles.length,
    nonJsonl: skipped['non-jsonl'].length,
    nonTranscript: skipped['non-transcript-jsonl'].length,
    empty: skipped.empty.length,
    symlinks: symlinkTranscriptCount,
    midAction: midActionAgentIds.length,
    midActionIds: midActionAgentIds.map((id) => `\`${id}\``).join(', ') || 'none',
    sessionId: orchestratorSessionId,
    rawDir: relative(REPO_DIR, TRANSCRIPTS_DIR),
    exportDate: new Date().toISOString().slice(0, 10),
    branch,
    headCommit,
  }
  const readmePath = join(OUTPUT_DIR, 'README.md')
  writeFileSync(
    readmePath,
    `# Process transcript dataset

English | [中文](README.zh.md)

## What this is

This dataset is the process transcripts of an AI-assisted build of the DeepSeek Harness fork, produced by Claude Code sessions: one orchestrating session (\`agents.jsonl\` record with \`kind: "orchestrator"\`) plus ${readme.subagents} background subagent sessions it spawned (\`kind: "subagent"\`), covering every message, tool call, and token count either session logged.

- \`agents.jsonl\` - one record per transcript: timing, turn/tool-call counts and breakdown, token usage, prompt/response excerpts, commit shas mentioned in the final assistant message, and files touched via Edit/Write/MultiEdit.
- \`messages.jsonl\` - one record per conversational message across every transcript, in order, with per-message text, tool calls, and tool-result sizes.
- \`stats.json\` - corpus totals (transcripts, messages, tool calls by name, tokens by kind, wall time) and the distribution of subagent durations.

## What was removed

- **Tool result bodies.** \`messages.jsonl\` records only the character count of each tool result (\`toolResultChars\`), never its content; the raw tree next to this dataset keeps the bodies.
- **Secrets.** Any value shaped like a credential - an \`sk-\`, \`ghp_\`, or \`AKIA\`-prefixed token, a \`Bearer \` header value, or any other 32-or-more character hex/base64-looking run - is replaced with \`[REDACTED]\` everywhere this dataset includes text: message text, prompt/response excerpts, and tool-call input excerpts.
- **Non-transcript files.** \`subagents/\` held ${readme.files} transcript-shaped files; ${readme.subagents} of them are genuine Claude Code JSONL subagent transcripts (every line parses as JSON and at least one line is a real user/assistant message). ${readme.nonJsonl} were plain-text captures of other tool output, ${readme.nonTranscript} were JSON without any conversation, and ${readme.empty} were empty. None of these is represented in \`agents.jsonl\` or \`messages.jsonl\`.

## Data quality notes

- ${readme.symlinks} of the ${readme.subagents} subagent transcript files were symlinks into a live Claude Code project directory rather than frozen copies; a subagent still running at export time shows more lines on a later re-run of \`transcripts-to-dataset.mjs\` than it did here.
- ${readme.midAction} subagent transcript(s) end mid-action: the last recorded line is a tool call with no accompanying text and no result, rather than a closing report - id(s): ${readme.midActionIds}. For these, \`finalAssistantExcerpt\` and \`commitShasMentioned\` reflect that the transcript stops there, not that the agent produced no final report.

## Provenance

- Build/session id: \`${readme.sessionId}\`
- Raw transcripts: \`${readme.rawDir}\`
- Export date: ${readme.exportDate}
- Harness repo branch at export time: \`${readme.branch}\`
- Harness repo HEAD commit at export time: \`${readme.headCommit}\`

## Usage

These transcripts are Claude outputs. Under Anthropic's usage policy they may not be used to train or fine-tune a competing model; keep them for analysis, process mining, failure taxonomies, and environment synthesis with invented entities. The RLVR corpus for the Daliesk model comes from the harness's own certified runs on routes whose terms allow it.
`,
  )
  const readmeZhPath = join(OUTPUT_DIR, 'README.zh.md')
  writeFileSync(
    readmeZhPath,
    `# 过程 transcript 数据集

[English](README.md) | 中文

## 这是什么

本数据集是 DeepSeek Harness 分支一次 AI 辅助构建的过程 transcript（文本记录），由 Claude Code 会话产生：一个编排会话（\`agents.jsonl\` 中 \`kind: "orchestrator"\` 的记录）加上它派生的 ${readme.subagents} 个后台 subagent 会话（\`kind: "subagent"\`），覆盖两类会话记录下的每条消息、每次工具调用和每个 token 计数。

- \`agents.jsonl\` - 每份 transcript 一条记录：时间、轮次与工具调用计数及其分解、token 用量、提示与回复摘录、最后一条助手消息提到的提交 sha，以及通过 Edit/Write/MultiEdit 触及的文件。
- \`messages.jsonl\` - 所有 transcript 中每条会话消息一条记录，按顺序排列，含每条消息的文本、工具调用和工具结果大小。
- \`stats.json\` - 语料总计（transcript 数、消息数、按名称统计的工具调用、按类别统计的 token、挂钟时间）以及 subagent 时长分布。

## 移除了什么

- **工具结果正文。** \`messages.jsonl\` 只记录每个工具结果的字符数（\`toolResultChars\`），从不记录其内容；正文保留在本数据集旁边的原始目录树中。
- **密钥。** 任何形似凭证的值——以 \`sk-\`、\`ghp_\` 或 \`AKIA\` 开头的令牌、\`Bearer \` 头部值，或任何其他 32 个字符以上的十六进制或 base64 样式串——在本数据集包含文本的所有位置都替换为 \`[REDACTED]\`：消息文本、提示与回复摘录，以及工具调用输入摘录。
- **非 transcript 文件。** \`subagents/\` 中有 ${readme.files} 个 transcript 形态的文件；其中 ${readme.subagents} 个是真正的 Claude Code JSONL subagent transcript（每一行都能解析为 JSON，且至少一行是真实的用户或助手消息）。${readme.nonJsonl} 个是其他工具输出的纯文本捕获，${readme.nonTranscript} 个是不含任何对话的 JSON，${readme.empty} 个为空。这些都不会出现在 \`agents.jsonl\` 或 \`messages.jsonl\` 中。

## 数据质量说明

- ${readme.subagents} 个 subagent transcript 文件中有 ${readme.symlinks} 个是指向活动 Claude Code 项目目录的符号链接而非冻结副本；导出时仍在运行的 subagent，在稍后重新运行 \`transcripts-to-dataset.mjs\` 时会显示比这里更多的行。
- ${readme.midAction} 个 subagent transcript 在动作中途结束：最后记录的一行是一次没有伴随文本也没有结果的工具调用，而不是收尾报告——id：${readme.midActionIds}。对这些 transcript，\`finalAssistantExcerpt\` 和 \`commitShasMentioned\` 反映的是 transcript 在此处停止，而不是该 agent 没有产出最终报告。

## 来源

- 构建/会话 id：\`${readme.sessionId}\`
- 原始 transcript：\`${readme.rawDir}\`
- 导出日期：${readme.exportDate}
- 导出时 harness 仓库分支：\`${readme.branch}\`
- 导出时 harness 仓库 HEAD 提交：\`${readme.headCommit}\`

## 使用

这些 transcript 是 Claude 的输出。根据 Anthropic 的使用政策，它们不得用于训练或微调竞争模型；请将其用于分析、过程挖掘、失败分类，以及使用虚构实体的环境合成。Daliesk 模型的 RLVR 语料来自 harness 自身在条款允许的路由上完成的经认证运行。
`,
  )

  // --- validate ---
  const agentsLines = readFileSync(agentsPath, 'utf8').split('\n').filter((l) => l.trim())
  const parsedAgents = agentsLines.map((l) => JSON.parse(l))
  const messagesLines = readFileSync(messagesPath, 'utf8').split('\n').filter((l) => l.trim())
  const parsedMessages = messagesLines.map((l) => JSON.parse(l))
  const parsedStats = JSON.parse(readFileSync(statsPath, 'utf8'))

  assert.equal(agentsLines.length, allAgentRecords.length, 'agents.jsonl line count mismatch')
  assert.equal(messagesLines.length, allMessages.length, 'messages.jsonl line count mismatch')
  assert.equal(parsedStats.totals.transcripts, agentsLines.length, 'stats.totals.transcripts mismatch')
  assert.equal(parsedStats.totals.messages, messagesLines.length, 'stats.totals.messages mismatch')
  const sumTurns = parsedAgents.reduce((s, r) => s + r.turns, 0)
  assert.equal(sumTurns, messagesLines.length, 'sum(agents[].turns) must equal messages.jsonl line count')
  const sumToolCallsFromAgents = parsedAgents.reduce((s, r) => s + r.toolCalls, 0)
  const sumToolCallsFromMessages = parsedMessages.reduce((s, m) => s + m.toolCalls.length, 0)
  assert.equal(sumToolCallsFromAgents, sumToolCallsFromMessages, 'tool call counts disagree between agents.jsonl and messages.jsonl')
  const sumToolCallsFromStats = Object.values(parsedStats.totals.toolCallsByName).reduce((s, v) => s + v, 0)
  assert.equal(sumToolCallsFromStats, sumToolCallsFromAgents, 'stats.totals.toolCallsByName total mismatch')
  assert.equal(parsedStats.subagentDurations.count, orderedSubagentRecords.length, 'subagentDurations.count mismatch')

  const sizes = {
    'agents.jsonl': statSync(agentsPath).size,
    'messages.jsonl': statSync(messagesPath).size,
    'stats.json': statSync(statsPath).size,
    'README.md': statSync(readmePath).size,
    'README.zh.md': statSync(readmeZhPath).size,
  }

  console.log('Validation passed.')
  console.log('Transcripts:', allAgentRecords.length, '(1 orchestrator +', orderedSubagentRecords.length, 'subagents)')
  console.log('Messages:', allMessages.length)
  console.log(
    'Skipped subagents/ files:',
    outputFiles.length - orderedSubagentRecords.length,
    JSON.stringify({
      'non-jsonl': skipped['non-jsonl'].length,
      empty: skipped.empty.length,
      'non-transcript-jsonl': skipped['non-transcript-jsonl'].length,
    }),
  )
  console.log('File sizes (bytes):', sizes)
  console.log('Subagent transcripts backed by a live symlink:', symlinkTranscriptCount, '/', orderedSubagentRecords.length)
  console.log('Subagent transcripts ending mid-action (no closing text/result):', midActionAgentIds)
  console.log('Top tool calls by name:', Object.entries(toolCallsByNameSorted).slice(0, 10))
  console.log('Tokens by kind:', stats.totals.tokensByKind)
}

main()
