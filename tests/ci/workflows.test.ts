// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(import.meta.dirname, '..', '..')
const dir = join(root, '.github', 'workflows')
const read = (name: string) => readFileSync(join(dir, name), 'utf8')
const workflows = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))

/** Every `paths:` entry in a workflow, quoted or not, in order. */
function pathFilters(text: string) {
  return [...text.matchAll(/\n( +)paths:\n((?:\1 {2}- .+\n)+)/g)].flatMap(
    (block) =>
      [...block[2]!.matchAll(/- '?([^'\n]+?)'?\n/g)].map((m) => m[1]!.trim())
  )
}
/** GitHub-style glob: `**` crosses folders, `*` stays inside one. */
function matches(glob: string, file: string) {
  const pattern = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '\u0001')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0001/g, '(?:.*/)?')
    .replace(/\u0000/g, '.*')
  return new RegExp(`^${pattern}$`).test(file)
}
const supabaseStart = (text: string) =>
  text.match(/supabase start -x ([a-z,-]+)/)?.[1]?.split(',') ?? null
const tracked = execFileSync('git', ['ls-files'], {
  cwd: root,
  encoding: 'utf8'
})
  .split('\n')
  .filter(Boolean)

/** Tracked files that cannot change what the browser journeys do. */
const noJourneyEffect = [
  '**/*.md',
  'docs/**',
  '.claude/**',
  '.impeccable/**',
  '.github/**',
  'tests/ci/**',
  'scripts/github/**',
  'scripts/*.test.ts',
  'scripts/*.d.mts',
  'eslint.config.mjs',
  'vitest.config.ts',
  'vitest.setup.ts',
  'next-env.d.ts',
  'vercel.json',
  '.env.example',
  '.gitignore',
  '.prettierignore',
  '.prettierrc.json',
  '.vercelignore'
]

describe('CI workflows', () => {
  it('runs the required verify check on every pull request and push to main', () => {
    const ci = read('ci.yml')
    expect(ci).toMatch(
      /\non:\n {2}pull_request:\n {2}push:\n {4}branches: \[main\]\n/
    )
    expect(pathFilters(ci)).toEqual([])
    // Branch protection requires the job by this exact id, unconditionally.
    expect(ci).toMatch(/\njobs:\n(?: {2}#.*\n)* {2}verify:\n {4}runs-on: /)
    expect(ci).not.toMatch(/\n {4}if: /)
    for (const step of [
      'pnpm install --frozen-lockfile',
      'pnpm format:check',
      'pnpm lint',
      'pnpm typecheck',
      'pnpm test',
      'pnpm build'
    ])
      expect(ci).toContain(`- run: ${step}\n`)
  })

  it('gives every job a time limit and every workflow explicit permissions', () => {
    for (const name of workflows) {
      const text = read(name)
      const jobs = (text.match(/\n {4}runs-on: /g) ?? []).length
      expect(jobs, name).toBeGreaterThan(0)
      expect(
        (text.match(/\n {4}timeout-minutes: \d+\n/g) ?? []).length,
        name
      ).toBe(jobs)
      expect(text, name).toMatch(/\npermissions:/)
    }
  })

  it('matches globs the way GitHub does', () => {
    expect(matches('**/*.md', 'AGENTS.md')).toBe(true)
    expect(matches('**/*.md', 'docs/a/b.md')).toBe(true)
    expect(matches('scripts/*.mjs', 'scripts/local-runtime.mjs')).toBe(true)
    expect(matches('scripts/*.mjs', 'scripts/github/sync-project.mjs')).toBe(
      false
    )
    expect(matches('app/**', 'app/(client)/page.tsx')).toBe(true)
    expect(matches('package.json', 'docs/package.json')).toBe(false)
  })

  it('reads quoted and unquoted path filters', () => {
    expect(
      pathFilters(
        "on:\n  push:\n    paths:\n      - .github/project/**\n      - 'docs/x'\n"
      )
    ).toEqual(['.github/project/**', 'docs/x'])
  })

  it('only filters on paths that match tracked files, so a typo cannot skip a check', () => {
    for (const name of ['database.yml', 'browser.yml']) {
      const filters = pathFilters(read(name))
      expect(filters.length, name).toBeGreaterThan(1)
      for (const filter of filters)
        expect(
          tracked.some((file) => matches(filter, file)),
          `${name}: ${filter}`
        ).toBe(true)
    }
  })

  it('runs browser journeys for every tracked file that can affect them', () => {
    const filters = pathFilters(read('browser.yml'))
    const uncovered = tracked.filter(
      (file) =>
        !filters.some((glob) => matches(glob, file)) &&
        !noJourneyEffect.some((glob) => matches(glob, file))
    )
    // A new file or folder must be added to browser.yml or, if it truly
    // cannot change a journey, to noJourneyEffect above.
    expect(uncovered).toEqual([])
    for (const file of [
      'app/layout.tsx',
      'features/cron/scheduler.ts',
      'supabase/seed.sql',
      'scripts/local-runtime.mjs',
      'tests/e2e/accounts.ts',
      'tests/helpers/asset-zip.ts',
      'pnpm-workspace.yaml'
    ])
      expect(
        filters.some((glob) => matches(glob, file)),
        file
      ).toBe(true)
  })

  it('runs database checks for schema, tests and Supabase CLI changes', () => {
    const filters = pathFilters(read('database.yml'))
    for (const file of [
      'supabase/migrations/20260914000000_foundation.sql',
      'supabase/tests/references.test.sql',
      'package.json',
      'pnpm-lock.yaml'
    ])
      expect(
        filters.some((glob) => matches(glob, file)),
        file
      ).toBe(true)
  })

  it('starts the same lean Supabase stack for database and browser checks', () => {
    const database = supabaseStart(read('database.yml'))
    const browser = supabaseStart(read('browser.yml'))
    expect(database).toEqual(browser)
    // Verified locally: 600/600 pgTAP, 80/80 journeys and the three
    // concurrency scripts without these services.
    expect(database).toEqual([
      'studio',
      'logflare',
      'vector',
      'imgproxy',
      'edge-runtime',
      'realtime',
      'postgres-meta',
      'supavisor'
    ])
    for (const needed of [
      'postgres',
      'gotrue',
      'postgrest',
      'storage-api',
      'kong',
      'mailpit'
    ])
      expect(database).not.toContain(needed)
  })

  it('skips drafts for the slow checks and starts them when marked ready', () => {
    for (const name of ['database.yml', 'browser.yml']) {
      const text = read(name)
      expect(text).toContain('if: github.event.pull_request.draft != true')
      expect(text).toContain(
        'types: [opened, synchronize, reopened, ready_for_review]'
      )
    }
  })

  it('keeps a failed browser run debuggable', () => {
    const browser = read('browser.yml')
    // A step limit below the job limit turns a slow run into a failure, so
    // the failure-only upload still runs.
    expect(browser).toMatch(/- run: pnpm test:e2e\n {8}timeout-minutes: 30\n/)
    expect(browser).toMatch(/\n {4}timeout-minutes: 40\n/)
    expect(browser).toContain('if: failure()')
    expect(readFileSync(join(root, 'playwright.config.ts'), 'utf8')).toContain(
      "['html', { open: 'never' }]"
    )
  })

  it('keeps the scheduled-jobs workflow opt-in and at most twice an hour', () => {
    const text = read('scheduled-jobs.yml')
    expect(text).toContain("if: vars.SCHEDULED_JOBS_ENABLED == 'true'")
    expect(text).toContain("--proto '=https'")
    const crons = [...text.matchAll(/- cron: '([^']+)'/g)].map((m) => m[1]!)
    expect(crons).toEqual(['3,33 * * * *'])
    const [minute, ...rest] = crons[0]!.split(' ')
    // Owner decision: about 1,500 Actions minutes a month at most.
    expect(minute!.split(',')).toHaveLength(2)
    expect(rest).toEqual(['*', '*', '*', '*'])
  })

  it('keeps the inbox screenshot workflow opt-in, HTTPS-only and cheap when idle', () => {
    const text = read('inbox-screenshots.yml')
    expect(text).toContain("if: vars.SCHEDULED_JOBS_ENABLED == 'true'")
    expect(text).toContain("--proto '=https'")
    expect(text).toMatch(/\npermissions:\n {2}contents: read\n/)
    const crons = [...text.matchAll(/- cron: '([^']+)'/g)].map((m) => m[1]!)
    expect(crons).toEqual(['18,48 * * * *'])
    // Nothing is checked out or installed until the app says work is waiting.
    const steps = `\n${text.split('\n    steps:\n')[1]!}`
      .split(/\n {6}- /)
      .slice(1)
    expect(steps[0]).toContain('?peek=1')
    for (const step of steps.slice(1))
      expect(step).toContain("if: steps.peek.outputs.waiting != '0'")
    // The secret only reaches the steps that call the app.
    expect(text.match(/secrets\.CRON_SECRET/g)).toHaveLength(2)
  })
})
