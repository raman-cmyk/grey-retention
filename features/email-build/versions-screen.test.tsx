import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

import { emailScreen, versionPreview } from './email-screen'
import { loadEmailScreen } from './email-screen-load'
import { EmailScreen } from './screen'
import { versionsView, type VersionRow } from './versions'

afterEach(cleanup)

const tenant = '00000000-0000-4000-8000-000000000101'
const buildId = '00000000-0000-4000-8000-0000000000bb'
const runId = '00000000-0000-4000-8000-0000000000aa'
const email = (over: Record<string, unknown> = {}) => ({
  sample: false,
  ai: true,
  name: 'Bestseller: Cedar candle',
  subject: 'Our cedar candle is back',
  preheader: 'Warm nights start here.',
  html: '<p>B</p>',
  approach: 'A',
  copy: 'written',
  plannedSendAt: '2026-11-20T18:00:00Z',
  audienceId: 'a1',
  productIds: ['p1'],
  code: null,
  changes: [],
  ...over
})
const now = Date.parse('2026-11-27T15:00:00Z')
const rows: VersionRow[] = [
  {
    number: 2,
    how: 'try_again',
    restoredFrom: null,
    subject: 'Our cedar candle is back',
    createdAt: '2026-11-27T10:40:00Z'
  },
  {
    number: 1,
    how: 'scratch',
    restoredFrom: null,
    subject: 'Cedar, for cold nights',
    createdAt: '2026-11-26T09:05:00Z'
  }
]
const panel = (
  over: { shown?: number; drafted?: boolean; preview?: unknown } = {}
) => ({
  ...versionsView(rows, { timezone: 'UTC', shown: over.shown ?? 1, now })!,
  buildId,
  drafted: over.drafted ?? true,
  preview: versionPreview(
    'preview' in over
      ? over.preview
      : email({ subject: 'Cedar, for cold nights', html: '<p>one</p>' })
  )
})
const view = () =>
  emailScreen({
    id: buildId,
    state: 'drafted',
    step: 'push',
    email: email(),
    format: 'designed',
    klaviyoCampaignId: 'kc1',
    sampleDraft: false,
    reason: null
  })

describe('the versions on an email’s page (PICK-106)', () => {
  it('lists every version, the current one named, and previews the one chosen', () => {
    render(<EmailScreen view={view()} versions={panel()} owner />)
    const list = screen.getByRole('region', { name: 'Versions' })
    const links = within(list).getAllByRole('link')
    expect(links.map((l) => l.textContent)).toEqual([
      'Version 2 · Today 10:40 · Made again with Try again · CurrentOur cedar candle is back',
      'Version 1 · Yesterday 9:05 · Made from scratchCedar, for cold nights'
    ])
    expect(links[0]).toHaveAttribute('href', `/plan/email/${buildId}#versions`)
    expect(links[1]).toHaveAttribute(
      'href',
      `/plan/email/${buildId}?version=1#versions`
    )
    expect(links[1]).toHaveAttribute('aria-current', 'true')
    expect(
      screen.getByRole('heading', { name: 'Version 1' })
    ).toBeInTheDocument()
    expect(
      screen.getByTitle('Version 1, the email, desktop view')
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Use this version' })
    ).toBeInTheDocument()
    expect(screen.getByText(/Nothing is scheduled or sent/)).toBeInTheDocument()
    // The form names the build, the version and the newest the page showed.
    const form = screen
      .getByRole('button', { name: 'Use this version' })
      .closest('form')!
    const fields = Object.fromEntries(
      [...form.querySelectorAll('input[type=hidden]')].map((i) => [
        (i as HTMLInputElement).name,
        (i as HTMLInputElement).value
      ])
    )
    expect(fields).toEqual({ build: buildId, version: '1', shown: '2' })
  })

  it('offers Use this version to the owner only, and only on a draft', () => {
    render(<EmailScreen view={view()} versions={panel()} />)
    expect(
      screen.queryByRole('button', { name: 'Use this version' })
    ).toBeNull()
    cleanup()
    render(
      <EmailScreen view={view()} versions={panel({ drafted: false })} owner />
    )
    expect(
      screen.queryByRole('button', { name: 'Use this version' })
    ).toBeNull()
    expect(
      screen.getByText(
        'An older version can be used once the email is a draft again.'
      )
    ).toBeInTheDocument()
  })

  it('shows no second preview of the current version', () => {
    render(<EmailScreen view={view()} versions={panel({ shown: 2 })} owner />)
    expect(screen.queryByRole('heading', { name: 'Version 2' })).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'Use this version' })
    ).toBeNull()
  })

  it('says when a version cannot be shown, and offers nothing for it', () => {
    render(
      <EmailScreen
        view={view()}
        versions={panel({ preview: { html: '<p>old</p>' } })}
        owner
      />
    )
    expect(
      screen.getByText(/kept by an older version of the app/)
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Use this version' })
    ).toBeNull()
  })

  it('opens an email made before version history as before', () => {
    render(<EmailScreen view={view()} versions={null} owner />)
    expect(screen.queryByRole('region', { name: 'Versions' })).toBeNull()
    expect(screen.getByText('Our cedar candle is back')).toBeInTheDocument()
  })
})

/** A member's client: each table read answers in turn. */
function fakeDb(results: Record<string, { data: unknown; error: unknown }[]>) {
  const eqs: [string, unknown[]][] = []
  const db = {
    from: (table: string) => {
      const result = results[table]?.shift() ?? { data: null, error: null }
      const query: Record<string, unknown> = {
        then: (done: (r: unknown) => unknown) =>
          Promise.resolve(result).then(done),
        maybeSingle: () => Promise.resolve(result)
      }
      for (const name of ['select', 'eq', 'like', 'order', 'limit'])
        query[name] = (...args: unknown[]) => {
          if (name === 'eq') eqs.push([table, args])
          return query
        }
      return query
    }
  }
  return { db: db as never, eqs }
}
const build = {
  data: {
    id: buildId,
    run_id: runId,
    slot: 1,
    state: 'drafted',
    step: 'push',
    email: email(),
    klaviyo_campaign_id: 'kc1',
    sample_draft: false,
    error_code: null,
    push_key: '00000000-0000-4000-8000-0000000000cc'
  },
  error: null
}
const plan = { data: { plan: { slots: [] } }, error: null }
const none = { data: [], error: null }

describe('loading the versions (PICK-106)', () => {
  it('reads the planned email’s versions and the chosen one’s email, in the workspace', async () => {
    const { db, eqs } = fakeDb({
      email_builds: [build],
      strategy_runs: [plan],
      agent_fallbacks: [none, none],
      email_versions: [
        {
          data: rows.map((r) => ({
            number: r.number,
            how: r.how,
            restored_from: r.restoredFrom,
            subject: r.subject,
            created_at: r.createdAt
          })),
          error: null
        },
        {
          data: { email: email({ subject: 'Cedar, for cold nights' }) },
          error: null
        }
      ]
    })
    const out = await loadEmailScreen(db, tenant, buildId, 'UTC', 1)
    if (!out.ok || !out.versions) throw new Error('expected versions')
    expect(out.versions.newest).toBe(2)
    expect(out.versions.lines.find((l) => l.shown)?.number).toBe(1)
    expect(out.versions.preview?.subject).toBe('Cedar, for cold nights')
    expect(out.versions.drafted).toBe(true)
    expect(eqs.filter(([t]) => t === 'email_versions')).toEqual([
      ['email_versions', ['tenant_id', tenant]],
      ['email_versions', ['run_id', runId]],
      ['email_versions', ['slot', 1]],
      ['email_versions', ['tenant_id', tenant]],
      ['email_versions', ['run_id', runId]],
      ['email_versions', ['slot', 1]],
      ['email_versions', ['number', 1]]
    ])
  })

  it('opens an old build with no versions, or when they cannot be read', async () => {
    for (const kept of [none, { data: null, error: { message: 'x' } }]) {
      const { db } = fakeDb({
        email_builds: [build],
        strategy_runs: [plan],
        agent_fallbacks: [none, none],
        email_versions: [kept]
      })
      const out = await loadEmailScreen(db, tenant, buildId)
      expect(out).toMatchObject({
        ok: true,
        versions: null,
        screen: { kind: 'email', subject: 'Our cedar candle is back' }
      })
    }
  })
})
