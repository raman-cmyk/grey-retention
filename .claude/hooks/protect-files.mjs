// PreToolUse hook: stops Claude from editing files that must never be hand-edited.
// Exit code 2 blocks the tool call and shows the message to Claude.
import { execFileSync } from 'node:child_process'
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

const relative = path
  .relative(projectDir, path.resolve(projectDir, filePath))
  .split(path.sep)
  .join('/')

if (relative.startsWith('..')) process.exit(0)

function block(message) {
  process.stderr.write(`${message}\n`)
  process.exit(2)
}

function isTracked(file) {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', file], {
      cwd: projectDir,
      stdio: 'ignore'
    })
    return true
  } catch {
    return false
  }
}

if (relative.startsWith('.audit/')) {
  block(
    'Blocked: .audit/ holds local passwords, cron secrets and proof logs. Do not read or write it.'
  )
}

const baseName = path.posix.basename(relative)
if (
  !relative.includes('/') &&
  baseName.startsWith('.env') &&
  baseName !== '.env.example'
) {
  block(
    `Blocked: ${relative} holds secrets. Only .env.example may be edited, and only with placeholder values.`
  )
}

if (relative === 'lib/supabase/database.types.ts') {
  block(
    'Blocked: database.types.ts is generated. Run `pnpm supabase:types` then `pnpm format` instead of editing it.'
  )
}

if (
  /^supabase\/migrations\/[^/]+\.sql$/.test(relative) &&
  existsSync(path.join(projectDir, relative)) &&
  isTracked(relative)
) {
  block(
    `Blocked: ${relative} is a committed migration. Never edit or renumber committed migrations. Create a new migration in your domain range instead (see /new-migration).`
  )
}

process.exit(0)
