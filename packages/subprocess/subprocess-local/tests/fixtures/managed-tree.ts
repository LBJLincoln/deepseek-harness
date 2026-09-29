import { spawn } from 'node:child_process'
import { rename, writeFile } from 'node:fs/promises'

const [statePath] = process.argv.slice(2)
if (statePath === undefined) throw new Error('usage: managed-tree.ts <state-path>')

process.on('SIGTERM', () => {})
process.on('SIGHUP', () => {})
const descendant = spawn(process.execPath, [
  '-e',
  'process.on("SIGTERM",()=>{});process.on("SIGHUP",()=>{});setInterval(()=>{},60_000)',
], { stdio: 'ignore' })
if (descendant.pid === undefined) throw new Error('managed descendant did not publish a pid')

// The host parses the state as soon as the path exists, so it appears only
// complete: `writeFile` creates the file empty before it writes the ids.
await writeFile(`${statePath}.partial`, JSON.stringify({ root: process.pid, descendant: descendant.pid }))
await rename(`${statePath}.partial`, statePath)
setInterval(() => {}, 60_000)
