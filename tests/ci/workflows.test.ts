// @vitest-environment node
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(import.meta.dirname, '..', '..')
const dir = join(root, '.github', 'workflows')
const read = (name: string) => readFileSync(join(dir, name), 'utf8')
const workflows = readdirSync(dir).filter((f) => f.endsWith('.yml'))

/** `paths:` entries of the pull_request trigger, in order. */
function pathFilters(text: string) {
  const block = text.match(/\n {4}paths:\n((?: {6}- .+\n)+)/)
  return block ? [...block[1]!.matchAll(/- '([^']+)'/g)].map((m) => m[1]!) : []
}
const supabaseStart = (text: string) =>
  text.match(/supabase start -x ([a-z,-]+)/)?.[1]?.split(',') ?? null

describe('CI workflows', () => {
  it('runs the required verify check on every pull request and push to main', () => {
    const ci = read('ci.yml')
    expect(ci).toMatch(
      /\non:\n {2}pull_request:\n {2}push:\n {4}branches: \[main\]\n/
    )
    expect(pathFilters(ci)).toEqual([])
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

  it('only filters on paths that exist, so a typo cannot silently skip a check', () => {
    for (const name of ['database.yml', 'browser.yml']) {
      const filters = pathFilters(read(name))
      expect(filters.length, name).toBeGreaterThan(1)
      for (const filter of filters)
        expect(
          existsSync(join(root, filter.replace(/\/\*\*$/, ''))),
          filter
        ).toBe(true)
    }
  })

  it('covers every app, test and schema directory in the browser filter', () => {
    const filters = pathFilters(read('browser.yml'))
    for (const folder of [
      'app',
      'components',
      'features',
      'lib',
      'supabase',
      'scripts',
      'tests/e2e'
    ])
      expect(filters).toContain(`${folder}/**`)
    expect(pathFilters(read('database.yml'))).toContain('supabase/**')
  })

  it('starts the same lean Supabase stack for database and browser checks', () => {
    const database = supabaseStart(read('database.yml'))
    const browser = supabaseStart(read('browser.yml'))
    expect(database).toEqual(browser)
    // Verified locally: 600/600 pgTAP and 80/80 journeys without these.
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
    for (const needed of ['postgres', 'gotrue', 'postgrest', 'storage-api'])
      expect(database).not.toContain(needed)
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

  it('skips draft pull requests for the slow checks', () => {
    for (const name of ['database.yml', 'browser.yml'])
      expect(read(name)).toContain(
        'if: github.event.pull_request.draft != true'
      )
  })
})
