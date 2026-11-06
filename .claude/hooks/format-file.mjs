// PostToolUse hook: runs Prettier on the file Claude just edited so
// `pnpm format:check` (CI) stays green. Never blocks; formatting errors are ignored.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd()

let input = {}
try {
  input = JSON.parse(readFileSync(0, 'utf8') || '{}')
} catch {
  process.exit(0)
}

const filePath = input?.tool_input?.file_path
if (typeof filePath !== 'string' || filePath === '') process.exit(0)

const absolute = path.resolve(projectDir, filePath)
const relative = path.relative(projectDir, absolute)
if (relative.startsWith('..') || !existsSync(absolute)) process.exit(0)

const prettier = path.join(projectDir, 'node_modules', '.bin', 'prettier')
if (!existsSync(prettier)) process.exit(0)

// Prettier respects .prettierignore and skips unknown file types.
spawnSync(
  prettier,
  ['--write', '--ignore-unknown', '--log-level', 'silent', absolute],
  {
    cwd: projectDir,
    stdio: 'ignore',
    timeout: 20000
  }
)

process.exit(0)
