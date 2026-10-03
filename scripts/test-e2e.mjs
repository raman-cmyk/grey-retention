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
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => child.kill(signal))
child.on('exit', (code) => {
  process.exitCode = code ?? 1
})
