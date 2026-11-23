import {
  cleanup,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

import InspirationError from '@/app/(gros)/inspiration/error'
import InspirationLoading from '@/app/(gros)/inspiration/loading'
import { stopTracking } from '@/features/library/inspirations/actions'
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
    // Unknown while unread: no Follow is offered anywhere (UI-INSb review).
    expect(view.slotsLeft).toBe(0)
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
    expect(await hideBrand({}, form(id))).toEqual({
      message: 'Hidden. GROS won’t suggest this brand again.'
    })
    const named = form(id)
    named.set('name', 'Bark Co')
    expect(await hideBrand({}, named)).toEqual({
      message: 'Hidden. GROS won’t suggest Bark Co again.'
    })
    expect(mocks.setBrandHidden).toHaveBeenCalledWith(db, 'tenant-1', id, true)
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/inspiration')
  })

  it('never refuses the hide because of the name, and cuts a long one whole', async () => {
    mocks.requireRequestContext.mockResolvedValue(context)
    mocks.createClient.mockResolvedValue({})
    // A brand with no name is shown by its domain, which can be 253 long.
    const long = form(id)
    long.set('name', `${'a'.repeat(240)}.example`)
    expect(await hideBrand({}, long)).toEqual({
      message: `Hidden. GROS won’t suggest ${'a'.repeat(120)} again.`
    })
    // 119 letters and an emoji are 120 characters but 121 UTF-16 units.
    const emoji = form(id)
    emoji.set('name', `${'b'.repeat(119)}🐾 and more`)
    expect(await hideBrand({}, emoji)).toEqual({
      message: `Hidden. GROS won’t suggest ${'b'.repeat(119)}🐾 again.`
    })
    const blank = form(id)
    blank.set('name', '   ')
    expect(await hideBrand({}, blank)).toEqual({
      message: 'Hidden. GROS won’t suggest this brand again.'
    })
    expect(mocks.setBrandHidden).toHaveBeenCalledTimes(3)
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
    ).toEqual({ capture: 'c2', name: 'Wild Paws' })

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

describe('Inspiration states (UI-INSb)', () => {
  const later = 'Open Inspiration again in a minute.'

  it('says which part could not be read, what to do, and still shows the rest', () => {
    render(
      <InspirationScreen
        view={inspirationView(input({ library: null }))}
        timezone="UTC"
      />
    )
    expect(region('Brands you follow')).toHaveTextContent(
      `The brands you follow could not be read just now. ${later}`
    )
    expect(region('Latest emails')).toHaveTextContent(
      `The emails could not be read just now. ${later}`
    )
    // Nothing to follow into while the followed brands are unread.
    expect(screen.queryByLabelText('Brand website')).toBeNull()
    expect(region('Brands like yours')).toHaveTextContent('Bark Co')
    cleanup()
    render(
      <InspirationScreen
        view={inspirationView(input({ suggestions: null }))}
        timezone="UTC"
      />
    )
    expect(region('Brands like yours')).toHaveTextContent(
      `Suggestions could not be read just now. ${later}`
    )
    expect(region('Brands you follow')).toHaveTextContent('Northwind')
    expect(screen.getByLabelText('Brand website')).toBeInTheDocument()
  })

  it('is one error with Try again when nothing could be read', () => {
    render(
      <InspirationScreen
        view={inspirationView(input({ library: null, suggestions: null }))}
        timezone="UTC"
      />
    )
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Inspiration did not open')
    expect(alert).toHaveTextContent(
      'Nothing was changed. Try again in a minute.'
    )
    expect(screen.getByRole('link', { name: 'Try again' })).toHaveAttribute(
      'href',
      '/inspiration'
    )
    for (const name of [
      'Brands you follow',
      'Brands like yours',
      'Latest emails'
    ])
      expect(screen.queryByRole('region', { name })).toBeNull()
  })

  it('tells staff only that no emails came yet: following is the owner’s', () => {
    const empty = (tenantRole: 'owner' | 'staff') =>
      inspirationView(
        input({
          context: { ...context, tenantRole },
          library: library({ items: [], tracked: [] }),
          suggestions: []
        })
      )
    render(<InspirationScreen view={empty('staff')} timezone="UTC" />)
    expect(region('Latest emails')).toHaveTextContent(
      /^Latest emailsNo emails yet\.$/
    )
    cleanup()
    render(<InspirationScreen view={empty('owner')} timezone="UTC" />)
    expect(region('Latest emails')).toHaveTextContent(
      'No emails yet. Follow a brand and its emails arrive here.'
    )
  })

  it('shows long brand names, subjects and their details whole, never cut to one line', () => {
    const long = 'The Northwind Outdoor Supply Company and Friends'
    const subject =
      'Our autumn walking boots are back, and this time they come in three new colours'
    const tracked = library().tracked[0]!
    render(
      <InspirationScreen
        view={inspirationView(
          input({
            library: library({
              tracked: [{ ...tracked, label: long }],
              items: [item('long', '2026-11-12T10:00:00Z', { title: subject })]
            }),
            suggestions: [{ ...suggestions[0]!, name: `${long} Two` }]
          })
        )}
        timezone="UTC"
      />
    )
    for (const [card, words] of [
      ['Brands you follow', long],
      ['Brands like yours', `${long} Two`],
      ['Latest emails', subject]
    ] as const) {
      const title = within(region(card)).getByText(words)
      expect(title).not.toHaveClass('truncate')
      expect(title).toHaveClass('break-words')
      const details = title.nextElementSibling
      expect(details).not.toHaveClass('truncate')
      expect(details).toHaveClass('break-words')
    }
  })

  it('opens on the loading page: the bar with Inspiration current, its words, busy, and no main', () => {
    const { container } = render(<InspirationLoading />)
    expect(
      within(screen.getByRole('navigation', { name: 'Main' })).getByRole(
        'link',
        { name: 'Inspiration' }
      )
    ).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText('Opening Inspiration')).toHaveAttribute(
      'aria-live',
      'polite'
    )
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
    // The page brings the one main while it streams in.
    expect(container.querySelector('main')).toBeNull()
  })

  it('says plainly when the page did not open, with Try again and the bar as a way out', async () => {
    const retry = vi.fn()
    render(<InspirationError retry={retry} />)
    expect(screen.getAllByRole('main')).toHaveLength(1)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Inspiration did not open')
    expect(alert).toHaveTextContent('Nothing was changed.')
    expect(alert).not.toHaveTextContent(/Something went wrong|error/i)
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(retry).toHaveBeenCalledTimes(1)
    const menu = within(screen.getByRole('navigation', { name: 'Main' }))
    expect(menu.getByRole('link', { name: 'Home' })).toHaveAttribute(
      'href',
      '/home'
    )
    expect(menu.getByRole('link', { name: 'Inspiration' })).toHaveAttribute(
      'aria-current',
      'page'
    )
  })
})

describe('Inspiration answers (UI-INSb review)', () => {
  it('offers no Follow on a suggestion while the followed brands are unread, only Hide', () => {
    render(
      <InspirationScreen
        view={inspirationView(input({ library: null }))}
        timezone="UTC"
      />
    )
    const suggested = region('Brands like yours')
    expect(
      within(suggested).queryByRole('button', { name: 'Follow' })
    ).toBeNull()
    // Followed brands unknown: every suggestion stays, each only hideable.
    expect(
      within(suggested).getAllByRole('button', { name: 'Hide' })
    ).toHaveLength(3)
  })

  it('keeps saying Stop’s answer in its card when the brand’s row leaves', async () => {
    const user = userEvent.setup()
    vi.mocked(stopTracking).mockResolvedValue({
      message: 'Stopped following Northwind. Its emails left your library.'
    })
    const { rerender } = render(
      <InspirationScreen view={inspirationView(input())} timezone="UTC" />
    )
    const stop = within(region('Brands you follow')).getByRole('button', {
      name: 'Stop'
    })
    await waitFor(() => expect(stop).toBeEnabled())
    await user.click(stop)
    const answer = await within(region('Brands you follow')).findByText(
      'Stopped following Northwind. Its emails left your library.'
    )
    // The refreshed page has no followed brand: the answer stays, read out.
    rerender(
      <InspirationScreen
        view={inspirationView(
          input({ library: library({ tracked: [], items: [] }) })
        )}
        timezone="UTC"
      />
    )
    expect(region('Brands you follow')).toHaveTextContent(
      'No brands followed yet.'
    )
    expect(answer).toBeInTheDocument()
    expect(answer).toHaveAttribute('aria-live', 'polite')
  })

  it('says Hide’s answer in plain words, and keeps it when the brand leaves the suggestions', async () => {
    const user = userEvent.setup()
    mocks.requireRequestContext.mockResolvedValue(context)
    mocks.createClient.mockResolvedValue({})
    mocks.setBrandHidden.mockResolvedValue(undefined)
    // A real suggestion's id is a capture's uuid.
    const wild = {
      ...suggestions[1]!,
      captureId: '00000000-0000-4000-8000-0000000000c2'
    }
    const { rerender } = render(
      <InspirationScreen
        view={inspirationView(input({ suggestions: [suggestions[0]!, wild] }))}
        timezone="UTC"
      />
    )
    const [, real] = within(region('Brands like yours')).getAllByRole(
      'listitem'
    )
    const hide = within(real!).getByRole('button', { name: 'Hide' })
    await waitFor(() => expect(hide).toBeEnabled())
    await user.click(hide)
    const answer = await within(region('Brands like yours')).findByText(
      'Hidden. GROS won’t suggest Wild Paws again.'
    )
    rerender(
      <InspirationScreen
        view={inspirationView(input({ suggestions: [suggestions[0]!] }))}
        timezone="UTC"
      />
    )
    expect(region('Brands like yours')).not.toHaveTextContent('Wild Paws Also')
    expect(answer).toBeInTheDocument()
  })
})
