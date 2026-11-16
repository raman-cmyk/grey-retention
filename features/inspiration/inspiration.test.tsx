import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({
  referenceLibrary: vi.fn(),
  readCompetitorSuggestions: vi.fn(),
  setBrandHidden: vi.fn(),
  createClient: vi.fn(),
  createServiceClient: vi.fn(),
  requireRequestContext: vi.fn(),
  revalidatePath: vi.fn()
}))
vi.mock('@/features/library/reference-library/data', async (original) => ({
  ...(await original<
    typeof import('@/features/library/reference-library/data')
  >()),
  referenceLibrary: mocks.referenceLibrary
}))
vi.mock('@/features/onboarding/suggested-competitors', () => ({
  readCompetitorSuggestions: mocks.readCompetitorSuggestions,
  setBrandHidden: mocks.setBrandHidden
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: mocks.createServiceClient
}))
vi.mock('@/features/auth/application/request-context', () => ({
  requireRequestContext: mocks.requireRequestContext
}))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/features/library/inspirations/actions', () => ({
  trackDomain: vi.fn(async () => ({})),
  stopTracking: vi.fn(async () => ({}))
}))

import type { ReferenceLibraryData } from '@/features/library/reference-library/data'
import { hideBrand } from './actions'
import {
  inspirationReadModel,
  inspirationView,
  type InspirationInput
} from './read-model'
import { InspirationScreen } from './screen'

afterEach(cleanup)
beforeEach(() => vi.resetAllMocks())

const context = {
  kind: 'client' as const,
  userId: 'u1',
  tenantId: 'tenant-1',
  tenantRole: 'owner' as const,
  tenantName: 'Cedar Lane',
  tenantSlug: 'cedar-lane',
  timezone: 'UTC'
}

const item = (
  id: string,
  at: string,
  over: Partial<ReferenceLibraryData['items'][number]> = {}
) => ({
  id,
  tab: 'competitors' as const,
  source: 'competitor' as const,
  format: 'design' as const,
  title: `Email ${id}`,
  domain: 'northwind.example',
  from: 'Northwind',
  at,
  preview: null,
  text: 'Hello',
  sample: true,
  screenshot: null,
  ...over
})

const library = (
  over: Partial<ReferenceLibraryData> = {}
): ReferenceLibraryData => ({
  items: [
    item('a', '2026-11-10T10:00:00Z', {
      screenshot: { url: 'https://cdn.example/a.jpg', width: 600, height: 1800 }
    }),
    item('b', '2026-11-12T10:00:00Z'),
    item('t', '2026-11-13T10:00:00Z', {
      source: 'template',
      tab: 'best'
    }),
    item('i', '2026-11-11T10:00:00Z', {
      source: 'import',
      tab: 'yours',
      from: 'You'
    })
  ],
  tracked: [
    {
      subscriptionId: 's1',
      revision: 3,
      domain: 'northwind.example',
      label: 'Northwind',
      status: 'live',
      emails: 10,
      sample: true
    }
  ],
  uploadsCapped: false,
  factsByDomain: {},
  ...over
})

const suggestions = [
  {
    captureId: 'c1',
    domain: 'bark.example',
    name: 'Bark Co',
    industry: 'pet' as const,
    reason: 'Also a pet brand, and sent 3 emails in the last 30 days.'
  },
  {
    captureId: 'c2',
    domain: 'wild.test',
    name: 'Wild Paws',
    industry: 'pet' as const,
    reason: 'Also a pet brand.'
  },
  {
    captureId: 'c3',
    domain: 'northwind.example',
    name: 'Northwind',
    industry: 'pet' as const,
    reason: 'Followed already.'
  }
]

const input = (over: Partial<InspirationInput> = {}): InspirationInput => ({
  context,
  library: library(),
  suggestions,
  ...over
})

describe('inspirationView (UI-INSa)', () => {
  it('lists followed brands, suggestions not yet followed and the newest emails', () => {
    const view = inspirationView(input())
    expect(view.owner).toBe(true)
    expect([view.limit, view.slotsLeft]).toEqual([10, 9])
    expect(view.suggestions.map((s) => [s.domain, s.followable])).toEqual([
      ['bark.example', true],
      // A real brand: suggested and hideable, not followable yet (REAL-01b).
      ['wild.test', false]
    ])
    // Saved templates live in the email library; newest first.
    expect(view.emails.map((e) => e.id)).toEqual(['b', 'i', 'a'])
    expect(view.unread).toEqual([])
  })

  it('marks what it could not read', () => {
    const view = inspirationView(input({ library: null, suggestions: null }))
    expect(view.unread).toEqual(['library', 'suggestions'])
    expect(view.tracked).toEqual([])
    expect(view.emails).toEqual([])
    expect(view.slotsLeft).toBe(10)
  })
})

describe('inspirationReadModel (UI-INSa)', () => {
  it('reads the library for the session’s workspace and the suggestions after its own profile read', async () => {
    const db = { member: true }
    const service = { service: true }
    mocks.createClient.mockResolvedValue(db)
    mocks.createServiceClient.mockReturnValue(service)
    mocks.referenceLibrary.mockResolvedValue(library())
    mocks.readCompetitorSuggestions.mockResolvedValue(suggestions)
    const view = await inspirationReadModel(context)
    expect(mocks.referenceLibrary).toHaveBeenCalledWith('tenant-1')
    expect(mocks.readCompetitorSuggestions).toHaveBeenCalledWith(
      db,
      'tenant-1',
      { service }
    )
    expect(view.suggestions).toHaveLength(2)
  })

  it('shows no suggestions without the server’s client, and survives failed reads', async () => {
    mocks.createClient.mockResolvedValue({})
    mocks.createServiceClient.mockReturnValue(null)
    mocks.referenceLibrary.mockRejectedValue(new Error('down'))
    const view = await inspirationReadModel(context)
    expect(mocks.readCompetitorSuggestions).not.toHaveBeenCalled()
    expect(view.unread).toEqual(['library', 'suggestions'])
    mocks.createServiceClient.mockReturnValue({})
    mocks.referenceLibrary.mockResolvedValue(library())
    mocks.readCompetitorSuggestions.mockRejectedValue(new Error('42501'))
    expect((await inspirationReadModel(context)).unread).toEqual([
      'suggestions'
    ])
  })
})

describe('hideBrand (UI-INSa)', () => {
  const form = (capture: string) => {
    const f = new FormData()
    f.set('capture', capture)
    return f
  }
  const id = '00000000-0000-4000-8000-0000000000c1'

  it('hides a brand for the owner, in the owner’s workspace', async () => {
    const db = {}
    mocks.requireRequestContext.mockResolvedValue(context)
    mocks.createClient.mockResolvedValue(db)
    expect(await hideBrand({}, form(id))).toEqual({})
    expect(mocks.setBrandHidden).toHaveBeenCalledWith(db, 'tenant-1', id, true)
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/inspiration')
  })

  it('refuses staff and a bad brand id, and says when it failed', async () => {
    mocks.requireRequestContext.mockResolvedValue({
      ...context,
      tenantRole: 'staff'
    })
    expect((await hideBrand({}, form(id))).error).toMatch(/owner/)
    mocks.requireRequestContext.mockResolvedValue(context)
    expect((await hideBrand({}, form('not-an-id'))).error).toMatch(/Reload/)
    mocks.createClient.mockResolvedValue(null)
    expect((await hideBrand({}, form(id))).error).toBe('Please sign in again.')
    mocks.createClient.mockResolvedValue({})
    // The database's own refusals, in the owner's words.
    for (const [code, words] of [
      ['42501', 'Only the workspace owner can hide a brand.'],
      ['23514', 'That brand is no longer suggested. Open Inspiration again.'],
      ['XX000', 'That brand could not be hidden. Try again.']
    ]) {
      mocks.setBrandHidden.mockRejectedValueOnce({ code })
      expect((await hideBrand({}, form(id))).error).toBe(words)
    }
    expect(mocks.setBrandHidden).toHaveBeenCalledTimes(3)
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it('keeps nothing in the demo', async () => {
    vi.stubEnv('AUTH_MODE', 'demo')
    try {
      mocks.requireRequestContext.mockResolvedValue(context)
      mocks.createClient.mockResolvedValue({})
      expect((await hideBrand({}, form(id))).error).toBe(
        'Please sign in again.'
      )
      expect(mocks.setBrandHidden).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

const region = (name: string) => screen.getByRole('region', { name })

describe('Inspiration screen (UI-INSa)', () => {
  it('shows the owner the brands, suggestions and emails with their actions', () => {
    render(<InspirationScreen view={inspirationView(input())} timezone="UTC" />)
    expect(
      screen.getByRole('heading', { level: 1, name: 'Inspiration' })
    ).toBeInTheDocument()
    expect(
      within(screen.getByRole('navigation', { name: 'Main' })).getByRole(
        'link',
        { name: 'Inspiration' }
      )
    ).toHaveAttribute('aria-current', 'page')
    const followed = region('Brands you follow')
    expect(followed).toHaveTextContent('Northwind')
    expect(followed).toHaveTextContent('northwind.example · 10 emails · Sample')
    const stop = within(followed).getByRole('button', { name: 'Stop' })
    expect(
      Object.fromEntries(
        new FormData(stop.closest('form')!) as unknown as [string, string][]
      )
    ).toEqual({
      subscription: 's1',
      revision: '3',
      domain: 'northwind.example'
    })
    expect(within(followed).getByLabelText('Brand website')).toBeInTheDocument()

    const [sample, real] = within(region('Brands like yours')).getAllByRole(
      'listitem'
    )
    const follow = within(sample!).getByRole('button', { name: 'Follow' })
    expect(
      Object.fromEntries(
        new FormData(follow.closest('form')!) as unknown as [string, string][]
      )
    ).toEqual({ domain: 'bark.example' })
    expect(
      within(sample!).getByRole('button', { name: 'Hide' })
    ).toBeInTheDocument()
    expect(within(real!).queryByRole('button', { name: 'Follow' })).toBeNull()
    const hide = within(real!).getByRole('button', { name: 'Hide' })
    expect(
      Object.fromEntries(
        new FormData(hide.closest('form')!) as unknown as [string, string][]
      )
    ).toEqual({ capture: 'c2' })

    const rows = within(region('Latest emails')).getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(
      within(rows[0]!).getByRole('link', { name: 'Use this design' })
    ).toHaveAttribute('href', '/first-draft?reference=b')
    expect(rows[1]).toHaveTextContent('Added by you')
    expect(
      within(rows[1]!).getByRole('link', { name: 'Use this design' })
    ).toHaveAttribute('href', '/first-draft?imported=i')
    expect(
      within(rows[2]!).getByRole('img', { name: 'Screenshot of Email a' })
    ).toHaveAttribute('src', 'https://cdn.example/a.jpg')
  })

  it('gives staff the same screen without the owner’s actions', () => {
    render(
      <InspirationScreen
        view={inspirationView(
          input({ context: { ...context, tenantRole: 'staff' } })
        )}
        timezone="UTC"
      />
    )
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByLabelText('Brand website')).toBeNull()
    expect(screen.queryByRole('link', { name: 'Use this design' })).toBeNull()
    // Following is not an email: no status pill, for staff either.
    expect(region('Brands you follow')).not.toHaveTextContent(
      /Planned|In Klaviyo|Working|Needs you/
    )
  })

  it('says in words, for everyone, how following each brand is going', () => {
    const tracked = library().tracked[0]!
    const view = (tenantRole: 'owner' | 'staff') =>
      inspirationView(
        input({
          context: { ...context, tenantRole },
          library: library({
            tracked: [
              { ...tracked, subscriptionId: 'live', status: 'live' },
              {
                ...tracked,
                subscriptionId: 'new',
                domain: 'new.example',
                label: 'new.example',
                status: 'pending',
                emails: 0
              },
              {
                ...tracked,
                subscriptionId: 'bad',
                domain: 'bad.example',
                label: 'Bad Co',
                status: 'error',
                emails: 0
              }
            ]
          })
        })
      )
    for (const role of ['owner', 'staff'] as const) {
      render(<InspirationScreen view={view(role)} timezone="UTC" />)
      const [live, pending, failed] = within(
        region('Brands you follow')
      ).getAllByRole('listitem')
      expect(live).toHaveTextContent('northwind.example · 10 emails · Sample')
      // A brand named after its website says it once.
      expect(pending).toHaveTextContent(
        '0 emails · Waiting for its first email · Sample'
      )
      expect(pending).not.toHaveTextContent('new.example · 0')
      expect(failed).toHaveTextContent(
        'bad.example · 0 emails · Its emails could not be brought in'
      )
      cleanup()
    }
  })

  it('says when nothing is followed, suggested or read, and when every slot is used', () => {
    render(
      <InspirationScreen
        view={inspirationView(
          input({
            library: library({ items: [], tracked: [] }),
            suggestions: []
          })
        )}
        timezone="UTC"
      />
    )
    expect(region('Brands you follow')).toHaveTextContent(
      'No brands followed yet.'
    )
    expect(region('Brands like yours')).toHaveTextContent('No suggestions yet.')
    expect(region('Latest emails')).toHaveTextContent('No emails yet.')
    cleanup()
    render(
      <InspirationScreen
        view={inspirationView(input({ library: null, suggestions: null }))}
        timezone="UTC"
      />
    )
    expect(region('Brands you follow')).toHaveTextContent('could not be read')
    expect(region('Brands like yours')).toHaveTextContent('could not be read')
    expect(screen.queryByLabelText('Brand website')).toBeNull()
    cleanup()
    const full = library({
      tracked: Array.from({ length: 10 }, (_, i) => ({
        ...library().tracked[0]!,
        subscriptionId: `s${i}`,
        domain: `brand${i}.example`
      }))
    })
    render(
      <InspirationScreen
        view={inspirationView(input({ library: full }))}
        timezone="UTC"
      />
    )
    expect(region('Brands you follow')).toHaveTextContent(
      'You follow 10 brands, the most at a time.'
    )
    expect(screen.queryByLabelText('Brand website')).toBeNull()
    expect(
      within(region('Brands like yours')).queryByRole('button', {
        name: 'Follow'
      })
    ).toBeNull()
  })
})
