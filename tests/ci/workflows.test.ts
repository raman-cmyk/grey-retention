// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
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

  it('keeps the local stack’s fixed ports out of the outgoing-connection range before it starts (CI-006)', () => {
    for (const name of ['database.yml', 'browser.yml']) {
      const text = read(name)
      const range = /net\.ipv4\.ip_local_port_range="(\d+) (\d+)"/.exec(text)
      expect(range, name).not.toBeNull()
      // Every port supabase/config.toml binds lies above the range.
      const ports = [
        ...readFileSync(join(root, 'supabase', 'config.toml'), 'utf8').matchAll(
          /^(?:port|shadow_port) = (\d+)$/gm
        )
      ].map((m) => Number(m[1]))
      expect(ports.length).toBeGreaterThan(4)
      for (const port of ports.filter((p) => p >= 32768))
        expect(port, `${name}: ${port}`).toBeGreaterThan(Number(range![2]))
      // Set before the stack starts (the image pulls open the connections).
      expect(text.indexOf('ip_local_port_range'), name).toBeLessThan(
        text.indexOf('supabase start')
      )
    }
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

  it('installs browser system packages best effort, so a mirror outage is not a failed run', () => {
    for (const name of [
      'browser.yml',
      'inbox-screenshots.yml',
      'design-engine.yml',
      'design-copies.yml'
    ]) {
      const text = read(name)
      expect(text).not.toContain('playwright install --with-deps')
      expect(text).toContain('pnpm exec playwright install chromium')
      expect(text).toContain(
        'apt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=20 update'
      )
      // A timeout or failure in that step never fails the job.
      expect(text).toMatch(
        /continue-on-error: true\n\s+timeout-minutes: [56]\n/
      )
      expect(text).toContain('pnpm exec playwright install-deps chromium')
      expect(text).toContain(
        "::warning::apt unavailable; using the runner's preinstalled libraries"
      )
    }
    expect(read('browser.yml')).toMatch(/for attempt in 1 2; do/)
  })

  it('runs the design engine golden set in the browser and always keeps its pictures (DES-ENGINE-001)', () => {
    const text = read('design-engine.yml')
    expect(pathFilters(text)).toContain('features/design-engine/**')
    for (const filter of pathFilters(text))
      expect(
        tracked.some((file) => matches(filter, file)),
        filter
      ).toBe(true)
    expect(text).toContain("DESIGN_ENGINE_BROWSER: 'on'")
    // DES-ENGINE-002: the engine loaded as the blueprint job loads it.
    expect(text).toContain('node --import ./scripts/ts-register.mjs -e')
    for (const path of [
      'scripts/inbox-blueprints.mjs',
      'scripts/ts-hooks.mjs',
      'scripts/ts-register.mjs'
    ])
      expect(pathFilters(text)).toContain(path)
    expect(text).toContain('run: pnpm exec vitest run features/design-engine\n')
    // DES-ENGINE-002b2: the copies through the email's hard checks.
    expect(text).toContain(
      'run: pnpm exec vitest run features/email-build/library-copy.browser.test.ts\n'
    )
    expect(text).toContain("await import('./scripts/design-copies.mjs')")
    // The owner looks at the pictures whether the run passed or not.
    expect(text).toMatch(
      /- if: always\(\)\n {8}uses: actions\/upload-artifact@v4\n {8}with:\n {10}name: design-golden\n/
    )
    // No secret and no app: the golden set needs neither.
    expect(text).not.toMatch(/secrets\.|APP_URL|supabase start/)
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
      expect(step).toMatch(
        /if: (?:\$\{\{ !cancelled\(\) && )?steps\.peek\.outputs\.waiting != '0'/
      )
    // The secret only reaches the steps that call the app.
    expect(text.match(/secrets\.CRON_SECRET/g)).toHaveLength(3)
    // DES-ENGINE-002: blueprints waiting wake the run too; their peek
    // failing never stops the screenshots.
    expect(text).toContain(
      "if ! call '/api/internal/inbox/blueprints?peek=1' blueprints.json 30; then"
    )
    expect(text).toContain('waiting=$((shots + blueprints))')
    expect(text).toContain(
      'run: node --import ./scripts/ts-register.mjs scripts/inbox-blueprints.mjs'
    )
  })
  it('keeps the studio render workflow opt-in, HTTPS-only and cheap when idle (DST-001c)', () => {
    const text = read('studio-renders.yml')
    expect(text).toContain("if: vars.SCHEDULED_JOBS_ENABLED == 'true'")
    expect(text).toContain("--proto '=https'")
    expect(text).toMatch(/\npermissions:\n {2}contents: read\n/)
    const crons = [...text.matchAll(/- cron: '([^']+)'/g)].map((m) => m[1]!)
    expect(crons).toEqual(['5-55/10 * * * *'])
    expect(text).toContain('/api/internal/studio/renders?peek=1')
    // DST-005b: the emails' views waiting wake the run too.
    expect(text).toContain('/api/internal/studio/previews?peek=1')
    expect(text).toContain('waiting=$((sections + views))')
    // Its peek failing never stops the sections.
    expect(text).toContain(
      "if ! call '/api/internal/studio/previews?peek=1' views.json 30; then"
    )
    expect(text).toContain('node scripts/studio-renders.mjs')
    // Nothing is checked out or installed until the app says work is waiting.
    const steps = `\n${text.split('\n    steps:\n')[1]!}`
      .split(/\n {6}- /)
      .slice(1)
    expect(steps[0]).toContain('?peek=1')
    // DST-006b: with nothing to draw, the peek itself carries the waiting
    // designs on, before anything is checked out.
    expect(steps[0]).toContain(
      `if [ "$waiting" = "0" ]; then\n            call '/api/internal/studio/builds' builds.json 130 || exit 1`
    )
    for (const step of steps.slice(1))
      expect(step).toMatch(
        /if: (?:\$\{\{ !cancelled\(\) && )?steps\.peek\.outputs\.waiting != '0'/
      )
    // The secret only reaches the steps that call the app; no artifacts (a
    // public repository's logs and artifacts are public).
    expect(text.match(/secrets\.CRON_SECRET/g)).toHaveLength(2)
    expect(text).not.toContain('upload-artifact')
  })
  it('keeps the design copies workflow opt-in, HTTPS-only and cheap when idle (DES-ENGINE-002b2)', () => {
    const text = read('design-copies.yml')
    expect(text).toContain("if: vars.SCHEDULED_JOBS_ENABLED == 'true'")
    expect(text).toContain("--proto '=https'")
    expect(text).toMatch(/\npermissions:\n {2}contents: read\n/)
    const crons = [...text.matchAll(/- cron: '([^']+)'/g)].map((m) => m[1]!)
    expect(crons).toEqual(['8-58/10 * * * *'])
    expect(text).toContain(
      "call '/api/internal/design/copies?peek=1' peek.json 30 || exit 1"
    )
    expect(text).toContain(
      'run: node --import ./scripts/ts-register.mjs scripts/design-copies.mjs'
    )
    // DES-ENGINE-003: the uploads are peeked at and measured in the same run.
    expect(text).toContain(
      "call '/api/internal/design/uploads?peek=1' uploads.json 30 || exit 1"
    )
    expect(text).toContain(
      'run: node --import ./scripts/ts-register.mjs scripts/design-uploads.mjs'
    )
    // Nothing is checked out or installed until the app says work is waiting.
    const steps = `\n${text.split('\n    steps:\n')[1]!}`
      .split(/\n {6}- /)
      .slice(1)
    expect(steps[0]).toContain('?peek=1')
    for (const step of steps.slice(1))
      expect(step).toMatch(/if: steps\.peek\.outputs\.waiting != '0'/)
    // No token left on the runner the browser draws on.
    expect(text).toContain('persist-credentials: false')
    // The secret only reaches the steps that call the app (the peek, the
    // copies and the uploads); no artifacts.
    expect(text.match(/secrets\.CRON_SECRET/g)).toHaveLength(3)
    expect(text).not.toContain('upload-artifact')
  })
  it('keeps the onboarding readers workflow opt-in, HTTPS-only and one small request when idle', () => {
    const text = read('onboarding-readers.yml')
    expect(text).toContain("if: vars.SCHEDULED_JOBS_ENABLED == 'true'")
    expect(text).toContain("--proto '=https'")
    expect(text).toMatch(/\npermissions: \{\}\n/)
    const crons = [...text.matchAll(/- cron: '([^']+)'/g)].map((m) => m[1]!)
    expect(crons).toEqual(['7,22,37,52 * * * *'])
    expect(text).not.toContain('actions/checkout')
    expect(text).not.toContain('pnpm install')
    expect(text).toContain('/api/internal/onboarding/readers')
    // It asks first and stops when nothing is waiting.
    const peek = text.indexOf("call '/api/internal/onboarding/readers?peek=1' ")
    expect(peek).toBeGreaterThan(-1)
    expect(peek).toBeLessThan(
      text.indexOf("call '/api/internal/onboarding/readers' run.json ")
    )
    expect(text).toContain('if [ "$waiting" = "0" ]; then exit 0; fi')
    expect(text.match(/secrets\.CRON_SECRET/g)).toHaveLength(1)
  })

  it('keeps the Klaviyo results workflow opt-in, HTTPS-only, hourly and one small request when idle', () => {
    const text = read('klaviyo-results.yml')
    expect(text).toContain("if: vars.SCHEDULED_JOBS_ENABLED == 'true'")
    expect(text).toContain("--proto '=https'")
    expect(text).toMatch(/\npermissions: \{\}\n/)
    const crons = [...text.matchAll(/- cron: '([^']+)'/g)].map((m) => m[1]!)
    expect(crons).toEqual(['44 * * * *'])
    expect(text).not.toContain('actions/checkout')
    expect(text).not.toContain('pnpm install')
    expect(text).toContain('/api/internal/klaviyo/results')
    const peek = text.indexOf("call '/api/internal/klaviyo/results?peek=1' ")
    expect(peek).toBeGreaterThan(-1)
    expect(peek).toBeLessThan(
      text.indexOf("call '/api/internal/klaviyo/results' run.json ")
    )
    expect(text).toContain('if [ "$waiting" = "0" ]; then exit 0; fi')
    expect(text.match(/secrets\.CRON_SECRET/g)).toHaveLength(1)
  })

  it('keeps the inbox tagging workflow opt-in, HTTPS-only and one request a run', () => {
    const text = read('inbox-tagging.yml')
    expect(text).toContain("if: vars.SCHEDULED_JOBS_ENABLED == 'true'")
    expect(text).toContain("--proto '=https'")
    expect(text).toMatch(/\npermissions: \{\}\n/)
    const crons = [...text.matchAll(/- cron: '([^']+)'/g)].map((m) => m[1]!)
    expect(crons).toEqual(['10,25,40,55 * * * *'])
    // Nothing is checked out or installed: one call to the app.
    expect(text).not.toContain('actions/checkout')
    expect(text).not.toContain('pnpm install')
    expect(text).toContain('/api/internal/inbox/tags')
    expect(text.match(/secrets\.CRON_SECRET/g)).toHaveLength(1)
  })
  it('tries each scheduled call once more after 2 minutes and says the app’s error (CI-005)', () => {
    const scheduled = [
      ['scheduled-jobs.yml', 7],
      ['onboarding-readers.yml', 10],
      ['inbox-tagging.yml', 6],
      ['inbox-screenshots.yml', 30],
      ['klaviyo-results.yml', 10],
      ['studio-renders.yml', 18],
      ['design-copies.yml', 30]
    ] as const
    for (const [name, minutes] of scheduled) {
      const text = read(name)
      // The secret is trimmed and sent through stdin, never as a curl
      // config line (a pasted line break broke every call).
      expect(text, name).not.toContain('--config -')
      expect(text, name).toContain("tr -d '\\r\\n'")
      expect(text, name).toContain(
        'printf \'Authorization: Bearer %s\\n\' "$secret" |'
      )
      expect(text, name).toContain("curl -H @- --proto '=https'")
      // Two tries, 2 minutes apart; red only when both fail, with the reason.
      expect(text, name).toContain('for try in 1 2; do')
      expect(text, name).toContain('sleep 120')
      expect(text, name).toContain('.error // .code // .message // empty')
      expect(text, name).toContain('on both tries.')
      expect(text, name).toMatch(
        new RegExp(`\\n {4}timeout-minutes: ${minutes}\\n`)
      )
    }
  })

  it('runs the call: one retry after 2 minutes, red only when both fail, with the app’s words (CI-005)', () => {
    // The real step script of Scheduled jobs, with curl and sleep stood in.
    const lines = read('scheduled-jobs.yml').split('\n')
    const start = lines.findIndex((l) => l.trim() === 'run: |')
    const body: string[] = []
    for (const l of lines.slice(start + 1)) {
      if (l !== '' && !l.startsWith(' '.repeat(10))) break
      body.push(l.slice(10))
    }
    const dir = mkdtempSync(join(tmpdir(), 'ci005-'))
    writeFileSync(join(dir, 'step.sh'), body.join('\n'))
    writeFileSync(
      join(dir, 'curl'),
      [
        '#!/bin/bash',
        'out=""',
        'while [ $# -gt 0 ]; do case "$1" in --output) out="$2"; shift 2;; --write-out|--max-time|--proto|-H) shift 2;; *) shift;; esac; done',
        'hdr=$(cat)',
        'n=$(( $(cat "$STUB/n" 2>/dev/null || echo 0) + 1 )); echo $n > "$STUB/n"',
        // A reply's line breaks are written \\n in the plan.
        'line=$(sed -n "${n}p" "$STUB/plan"); status=${line%% *}; body=$(printf "%b" "${line#* }")',
        '[ "$hdr" = "Authorization: Bearer $WANT" ] || { status=401; body=\'{"error":"Unauthorized"}\'; }',
        'printf "%s" "$body" > "$out"; printf "%s" "$status"'
      ].join('\n'),
      { mode: 0o755 }
    )
    writeFileSync(
      join(dir, 'sleep'),
      '#!/bin/sh\necho "$1" >> "$STUB/slept"\n',
      {
        mode: 0o755
      }
    )
    const want = 'synthetic-cron-secret-0123456789-0123456789'
    const runWith = (plan: string[]) => {
      writeFileSync(join(dir, 'plan'), plan.join('\n') + '\n')
      rmSync(join(dir, 'n'), { force: true })
      rmSync(join(dir, 'slept'), { force: true })
      const result = spawnSync('bash', ['-e', join(dir, 'step.sh')], {
        cwd: dir,
        encoding: 'utf8',
        env: {
          NODE_ENV: 'test',
          PATH: `${dir}:${process.env.PATH}`,
          STUB: dir,
          WANT: want,
          // A pasted secret with a line break at the end.
          CRON_SECRET: `${want}\n`,
          APP_URL: 'https://app.example'
        }
      })
      return {
        code: result.status,
        out: result.stdout,
        slept: existsSync(join(dir, 'slept'))
          ? readFileSync(join(dir, 'slept'), 'utf8').trim()
          : ''
      }
    }
    try {
      const flaky = runWith([
        '500 {"error":"Job run failed"}',
        '200 {"live":false,"failed":0}'
      ])
      expect(flaky.code).toBe(0)
      expect(flaky.out).toContain(
        '::warning::The app returned HTTP 500 (Job run failed). Trying again in 2 minutes.'
      )
      expect(flaky.out).toContain('{"live":false,"failed":0}')
      expect(flaky.slept).toBe('120')
      // The trimmed secret is masked, never printed bare.
      expect(flaky.out.replace(`::add-mask::${want}`, '')).not.toContain(want)
      const down = runWith([
        '502 <html>Bad\\ngateway</html>',
        '503 {"code":"setup"}'
      ])
      expect(down.code).toBe(1)
      expect(down.out).toContain('HTTP 502 (<html>Bad gateway</html>)')
      expect(down.out).toContain(
        '::error::The app returned HTTP 503 (setup) on both tries.'
      )
      const fine = runWith(['200 {"live":false,"failed":0}'])
      expect(fine).toMatchObject({ code: 0, slept: '' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
