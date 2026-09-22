#!/usr/bin/env node
// Reads a code-safety record's session logs and emits two things the raw
// findings do not carry: the trajectory behind each finding (which department
// agent read the finding's file, over how many steps and tool calls, before it
// reported), and the record's provenance (how much work the agents did on their
// own against how many times a human acted). Both come from the committed
// session logs, so the record proves who did the work rather than asserting it.
//
// A department session file is named `program-<hash>-<dept>.jsonl`; the lead is
// `program-<hash>.jsonl` and the integration `...-~0040integration.jsonl`
// (`~0040` is the encoded `@`). A finding is attributed to its department by an
// explicit `department` field or by its id prefix (`injection-...`), the same
// rule the feed uses. A read counts as touching a finding's file when the read
// target path ends with the finding's repo-relative file.
//
// Usage: node trajectory.mjs <record dir> [--json]
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const [recordDir, ...flags] = process.argv.slice(2)
if (!recordDir) {
  console.error('usage: node trajectory.mjs <record dir> [--json]')
  process.exit(2)
}
const asJson = flags.includes('--json')

const findings = (() => {
  const raw = JSON.parse(readFileSync(join(recordDir, 'findings.json'), 'utf8'))
  return Array.isArray(raw) ? raw : raw.findings ?? []
})()

const sessionsDir = join(recordDir, 'sessions')
const files = readdirSync(sessionsDir).filter(name => name.endsWith('.jsonl'))

/** The department a session file names: `-injection` → injection, the encoded `-~0040integration` → integration, the bare lead file → lead. */
function departmentOf(name) {
  const match = /^program-[0-9a-f]+(?:-(.+))?\.jsonl$/.exec(name)
  const suffix = match?.[1]
  if (suffix === undefined) return 'lead'
  return suffix.replaceAll(/~([0-9a-f]{4})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16))).replace(/^@/, '')
}

/** Parse a session file into the facts the digest needs: steps, tool calls by name, files read, human turns, whether it certified. */
function foldSession(path) {
  const lines = readFileSync(path, 'utf8').trim().split('\n')
  const tools = {}
  const filesRead = new Set()
  let steps = 0
  let certified = false
  for (const line of lines) {
    let event
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    const type = event.type
    if (type === 'step/start') steps += 1
    else if (type === 'verification/certificate') certified = true
    else if (type === 'tool/call') {
      const name = event.data?.name ?? 'tool'
      tools[name] = (tools[name] ?? 0) + 1
      if (name === 'read') {
        try {
          const path = JSON.parse(event.data?.arguments ?? '{}').file_path
          if (typeof path === 'string') filesRead.add(path)
        } catch {
          // A read whose arguments did not parse contributes no file, not an error.
        }
      }
    }
  }
  const toolCalls = Object.values(tools).reduce((sum, n) => sum + n, 0)
  return { steps, toolCalls, tools, filesRead: [...filesRead], certified }
}

const departments = files
  .map(name => ({ name, department: departmentOf(name), ...foldSession(join(sessionsDir, name)) }))
  .sort((a, b) => a.department.localeCompare(b.department))

/** The department a finding belongs to: its explicit field, else its id prefix. */
function findingDepartment(finding) {
  if (typeof finding.department === 'string') return finding.department
  const id = typeof finding.id === 'string' ? finding.id : ''
  const known = departments.map(d => d.department).filter(d => d !== 'lead' && d !== 'integration')
  return known.find(d => id.startsWith(`${d}-`)) ?? 'unknown'
}

const readsByDepartment = new Map(departments.map(d => [d.department, d.filesRead]))
const trajectories = findings.map(finding => {
  const department = findingDepartment(finding)
  const reads = readsByDepartment.get(department) ?? []
  const readItsFile = typeof finding.file === 'string' && reads.some(path => path.endsWith(`/${finding.file}`) || path.endsWith(finding.file))
  return { id: finding.id, department, file: finding.file, line: finding.line, severity: finding.severity, readItsFile }
})

const agentSessions = departments.filter(d => d.steps > 0)
const provenance = {
  // One operator command starts the program; the lead fans it out to the
  // departments and the integration, so every session below the lead is an
  // agent the run created, not a person. This count is the record's own fact.
  operatorCommands: 1,
  agentSessions: agentSessions.length,
  autonomousSteps: departments.reduce((sum, d) => sum + d.steps, 0),
  autonomousToolCalls: departments.reduce((sum, d) => sum + d.toolCalls, 0),
  departmentsCertified: departments.filter(d => d.certified).length,
  findingsWithReadTrail: trajectories.filter(t => t.readItsFile).length,
  findings: trajectories.length,
}

const digest = {
  record: recordDir.split('/').pop(),
  provenance,
  departments: departments.map(({ name: _name, filesRead, ...rest }) => ({ ...rest, filesRead: filesRead.length })),
  trajectories,
}

if (asJson) {
  console.log(JSON.stringify(digest, null, 2))
} else {
  console.log(`record ${digest.record}`)
  console.log(`provenance: ${provenance.agentSessions} agent sessions, ${provenance.autonomousSteps} steps, ${provenance.autonomousToolCalls} tool calls, ${provenance.departmentsCertified} certified; ${provenance.findingsWithReadTrail}/${provenance.findings} findings on a file their department read`)
  for (const d of departments) console.log(`  ${d.department.padEnd(13)} ${String(d.steps).padStart(3)} steps ${String(d.toolCalls).padStart(3)} tools ${String(d.filesRead.length).padStart(3)} files read${d.certified ? ' certified' : ''}`)
}
