import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./actions', () => ({ inboxAdminAction: vi.fn() }))
import type { DirectoryBrand, OpsTask } from './data'
import { BrandDirectory, OpsQueue, taskWords } from './views'

afterEach(cleanup)

const northwind: DirectoryBrand = {
  id: '00000000-0000-4000-8000-000000000b01',
  domain: 'northwind.com',
  name: 'Northwind Outdoor',
  niche: 'apparel',
  aliasSlug: 'northwind',
  address: 'inbox+northwind@gmail.com',
  subscription: 'unsubscribed',
  lastEmailAt: '2026-11-05T15:00:00Z',
  emails: 12,
  senders: ['mail.northwind.com'],
  sample: false
}
const juniper: DirectoryBrand = {
  ...northwind,
  id: '00000000-0000-4000-8000-000000000b02',
  domain: 'juniper.example',
  name: 'Juniper',
  aliasSlug: 'juniper',
  address: 'capture+juniper@inbox.example',
  subscription: 'pending',
  lastEmailAt: null,
  emails: 0,
  senders: [],
  sample: true
}
const task = (kind: string, detail: Record<string, unknown> = {}): OpsTask => ({
  id: `00000000-0000-4000-8000-${String(kind.length).padStart(12, '0')}`,
  kind,
  occurrences: 1,
  createdAt: '2026-11-06T10:00:00Z',
  detail,
  email: null
})

describe('taskWords', () => {
  it('says what every kind of task asks a person to do', () => {
    const brands = [northwind]
    const words = (t: OpsTask) => taskWords(t, brands)
    expect(
      words({
        ...task('inbox_unknown_sender', { fromDomain: 'news.cedar.com' }),
        occurrences: 3
      }).title
    ).toBe('Email from an unknown sender: news.cedar.com (3 emails)')
    expect(
      words(
        task('inbox_unknown_sender', {
          reason: 'sender_not_registered',
          aliasSlug: 'northwind',
          fromDomain: 'evil.test'
        })
      ).title
    ).toBe(
      'Email to +northwind from evil.test, a sender not registered for that brand'
    )
    expect(
      words({
        ...task('inbox_parse_failure'),
        email: {
          id: 'm',
          subject: 'Broken',
          fromDomain: 'x.com',
          aliasSlug: null,
          receivedAt: '2026-11-06T10:00:00Z',
          state: 'parse_failed'
        }
      }).title
    ).toBe('An email could not be read: “Broken”')
    expect(words(task('inbox_too_large', { bytes: 31457280 })).title).toBe(
      'An email was too large to keep (30 MB)'
    )
    expect(
      words(task('inbox_opt_in', { brand: northwind.id, reason: 'refused' }))
    ).toMatchObject({
      title: 'Confirm a subscription by hand: Northwind Outdoor',
      help: expect.stringContaining('so it was not opened')
    })
    expect(
      words(
        task('inbox_opt_in', {
          fromDomain: 'new.example',
          reason: 'unknown_brand'
        })
      ).help
    ).toMatch(/sender we do not know, so nothing was opened/)
    expect(
      words(task('inbox_opt_in', { brand: northwind.id, reason: 'no_link' }))
        .help
    ).toMatch(/could not find the confirm link/)
    expect(
      words(task('inbox_opt_in', { brand: northwind.id, reason: 'failed' }))
        .help
    ).toMatch(/opened but did not answer as expected/)
    expect(words(task('inbox_unsubscribed', { brand: northwind.id }))).toEqual({
      title: 'Northwind Outdoor unsubscribed us',
      help: 'Sign up again on northwind.com with inbox+northwind@gmail.com, then mark this done. The brand then waits for its first newsletter.'
    })
    expect(
      words(task('inbox_pending_subscription', { brand: northwind.id })).title
    ).toBe('No newsletter yet from Northwind Outdoor after a week')
    expect(
      taskWords(task('inbox_unsubscribed', { brand: northwind.id }), [
        { ...northwind, address: null }
      ]).help
    ).toBe(
      'Sign up again on northwind.com with its +northwind address (the inbox address shows here once INBOX_IMAP_USER is set in Vercel), then mark this done. The brand then waits for its first newsletter.'
    )
    expect(words(task('inbox_auth_failed')).title).toBe(
      'Gmail refused the inbox login'
    )
    expect(
      words(task('job_failed', { kind: 'inbox.assets', code: 'timeout' }))
    ).toEqual({
      title: 'A background job stopped after four tries (inbox.assets)',
      help: 'Its last error code was timeout. Tell the developers, then mark this done once it is fixed.'
    })
  })
})

describe('OpsQueue', () => {
  it('lists the tasks with Mark done and Dismiss, and offers a brand only for an unknown sender', () => {
    render(
      <OpsQueue
        tasks={[
          task('inbox_unknown_sender', { fromDomain: 'news.cedar.com' }),
          task('inbox_unsubscribed', { brand: northwind.id })
        ]}
        brands={[northwind, juniper]}
      />
    )
    expect(
      screen.getByRole('heading', { name: 'Needs a person (2)' })
    ).toBeTruthy()
    const [unknown, unsubscribed] = within(
      screen.getByRole('list', { name: 'Inbox tasks' })
    ).getAllByRole('listitem')
    const brand = within(unknown!).getByLabelText('Brand for news.cedar.com')
    expect(
      within(brand)
        .getAllByRole('option')
        .map((o) => o.textContent)
    ).toEqual([
      // A real sender is offered real brands only (sample ones end .example).
      'Choose a brand',
      'Northwind Outdoor (northwind.com)'
    ])
    expect(
      within(unknown!).getByRole('button', { name: 'Assign to this brand' })
    ).toBeTruthy()
    expect(within(unsubscribed!).queryByLabelText(/Brand for/)).toBeNull()
    for (const item of [unknown!, unsubscribed!]) {
      expect(
        within(item).getByRole('button', { name: 'Mark done' })
      ).toBeTruthy()
      expect(within(item).getByRole('button', { name: 'Dismiss' })).toBeTruthy()
    }
  })

  it('says when there is nothing to do', () => {
    render(<OpsQueue tasks={[]} brands={[]} />)
    expect(
      screen.getByText('Nothing to do. The inbox is handling everything.')
    ).toBeTruthy()
  })
})

describe('BrandDirectory', () => {
  it('shows each brand with the address to subscribe with, its status and last email', () => {
    render(<BrandDirectory brands={[northwind, juniper]} />)
    const table = screen.getByRole('table', { name: 'Competitor brands' })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows[0]!.textContent).toContain('inbox+northwind@gmail.com')
    expect(rows[0]!.textContent).toContain('unsubscribed')
    expect(rows[0]!.textContent).toContain('5 Nov 2026')
    expect(rows[0]!.textContent).toContain('mail.northwind.com')
    expect(within(rows[0]!).queryByText('Sample')).toBeNull()
    expect(rows[1]!.textContent).toContain('capture+juniper@inbox.example')
    expect(within(rows[1]!).getByText('Sample')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save brand' })).toBeTruthy()
  })
})
