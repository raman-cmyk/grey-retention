import { spawn } from 'node:child_process'
import { prepareAccounts, localEnvironment } from './local-runtime.mjs'
const local = await prepareAccounts()
const child = spawn(
  'pnpm',
  ['exec', 'playwright', 'test', ...process.argv.slice(2)],
  { env: localEnvironment(local), stdio: 'inherit' }
)
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => child.kill(signal))
child.on('exit', (code) => {
  process.exitCode = code ?? 1
})
