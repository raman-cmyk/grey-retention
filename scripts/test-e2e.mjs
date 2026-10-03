import { stopProcessTree } from './process-tree.mjs'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { sanitizeLog } from './sanitize-log.mjs'
import { prepareAccounts, localEnvironment } from './local-runtime.mjs'
const local = await prepareAccounts()
const child = spawn(
  'pnpm',
  ['exec', 'playwright', 'test', ...process.argv.slice(2)],
  { env: localEnvironment(local), stdio: ['inherit', 'pipe', 'pipe'] }
)
for (const [input, output] of [
  [child.stdout, process.stdout],
  [child.stderr, process.stderr]
]) {
  createInterface({ input }).on('line', (line) =>
    output.write(`${sanitizeLog(line)}\n`)
  )
}
let stopping
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    if (!stopping && child.pid)
      stopping = stopProcessTree(child.pid, signal).catch(() => {
        process.exitCode = 1
      })
  })
child.on('exit', (code) => {
  process.exitCode = code ?? 1
})
