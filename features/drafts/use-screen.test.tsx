import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('./actions', () => ({ createFirstDraft: vi.fn(async () => ({})) }))

import UseDesignError from '@/app/(gros)/inspiration/use/error'
import UseDesignLoading from '@/app/(gros)/inspiration/use/loading'
import { startDraftHref, draftHref } from './href'
import type { DraftReference, ImportedDraftReference } from './sources'
import { UseDesignScreen } from './use-screen'
import { draftStartView } from './use-view'

afterEach(cleanup)

const reference: DraftReference = {
  id: 'e1',
  subject: 'Spring sale starts now',
  safe_html: '<p>Hello</p>',
  received_at: '2026-11-10T09:00:00Z'
}
const imported: ImportedDraftReference = {
  id: 'i1',
  subject: 'Our winter letter',
  readable_text: 'Dear reader <b>hi</b>',
  source_description: '',
  source_url: null,
  structure: ['Hero', 'Products'],
  created_at: '2026-11-11T09:00:00Z'
}
const input = (over: Partial<Parameters<typeof draftStartView>[0]> = {}) => ({
  owner: true,
  readable: true,
  references: [reference],
  imported: [imported],
  requestKey: '6f1c1d1e-2a3b-4c5d-8e9f-001122334455',
  brandName: 'Cedar Lane',
  defaultDate: '2026-12-01T10:00',
  timezone: 'Europe/London',
  audiences: [{ id: 'a1', label: 'Past buyers' }],
  ...over
})

describe('draft addresses', () => {
  it('starts from an email and opens the saved draft on GROS pages', () => {
    expect(startDraftHref({ reference: 'e1' })).toBe(
      '/inspiration/use?reference=e1'
    )
    expect(startDraftHref({ imported: 'a b' })).toBe(
      '/inspiration/use?imported=a+b'
    )
    expect(startDraftHref()).toBe('/inspiration/use')
    expect(draftHref('c1')).toBe('/plan/draft/c1')
  })
})

describe('what "Use this design" shows', () => {
  it('finds the chosen email; an added email wins', () => {
    const v = draftStartView(input(), { reference: 'e1' })
    expect(v.kind === 'form' && v.reference?.id).toBe('e1')
    const both = draftStartView(input(), { reference: 'e1', imported: 'i1' })
    expect(both.kind === 'form' && both.imported?.id).toBe('i1')
    expect(both.kind === 'form' && both.reference).toBeNull()
  })

  it('starts from scratch with no email chosen', () => {
    const v = draftStartView(input(), {})
    expect(v.kind).toBe('form')
    expect(v.kind === 'form' && v.defaultTitle).toBe('Cedar Lane · new email')
  })

  it('says an unknown email is gone, staff cannot create, a failed read errs', () => {
    expect(draftStartView(input(), { reference: 'zz' }).kind).toBe('missing')
    expect(draftStartView(input(), { imported: 'zz' }).kind).toBe('missing')
    expect(draftStartView(input({ owner: false }), {}).kind).toBe('staff')
    expect(
      draftStartView(input({ readable: false }), { reference: 'e1' }).kind
    ).toBe('error')
  })
})

describe('the "Use this design" screen', () => {
  it('shows the chosen email in a sandbox and the draft form', () => {
    render(
      <UseDesignScreen view={draftStartView(input(), { reference: 'e1' })} />
    )
    expect(
      screen.getByRole('heading', { level: 1, name: 'Use this design' })
    ).toBeInTheDocument()
    const frame = screen.getByTitle('The email: Spring sale starts now')
    expect(frame).toHaveAttribute('sandbox', '')
    const form = screen
      .getByRole('button', { name: 'Create draft' })
      .closest('form')!
    expect(
      form.querySelector('input[name="source"]')!.getAttribute('value')
    ).toBe('e1')
    expect(
      form.querySelector('input[name="requestKey"]')!.getAttribute('value')
    ).toBe('6f1c1d1e-2a3b-4c5d-8e9f-001122334455')
    expect(
      within(form).getByLabelText('What should this email do?')
    ).toBeRequired()
    expect(within(form).getByLabelText('Name')).toHaveValue(
      'Cedar Lane · new email'
    )
    expect(
      within(form).getByRole('option', { name: 'Past buyers' })
    ).toBeInTheDocument()
  })

  it('shows an added email as text only, with its sections', () => {
    render(
      <UseDesignScreen view={draftStartView(input(), { imported: 'i1' })} />
    )
    expect(screen.getByText('Dear reader <b>hi</b>')).toBeInTheDocument()
    expect(
      screen.getByText(/follows its sections \(Hero, Products\)/)
    ).toBeInTheDocument()
    expect(
      screen
        .getByRole('button', { name: 'Create draft' })
        .closest('form')!
        .querySelector('input[name="source"]')!
        .getAttribute('value')
    ).toBe('imported:i1')
  })

  it('from scratch is a new draft with no email shown', () => {
    render(<UseDesignScreen view={draftStartView(input(), {})} />)
    expect(
      screen.getByRole('heading', { level: 1, name: 'New draft' })
    ).toBeInTheDocument()
    expect(screen.queryByTitle(/The email/)).toBeNull()
  })

  it('has its gone, staff, error, loading and error-page states', () => {
    const { unmount } = render(<UseDesignScreen view={{ kind: 'missing' }} />)
    expect(screen.getByRole('alert')).toHaveTextContent('This email is gone')
    expect(
      screen.getByRole('link', { name: 'Open Inspiration' })
    ).toHaveAttribute('href', '/inspiration')
    unmount()
    const staff = render(<UseDesignScreen view={{ kind: 'staff' }} />)
    expect(
      screen.getByText('Only the owner creates drafts')
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create draft' })).toBeNull()
    staff.unmount()
    const failed = render(<UseDesignScreen view={{ kind: 'error' }} />)
    expect(screen.getByRole('alert')).toHaveTextContent(
      'This page did not open'
    )
    failed.unmount()
    const loading = render(<UseDesignLoading />)
    expect(screen.getByText('Opening the email')).toBeInTheDocument()
    loading.unmount()
    render(<UseDesignError retry={() => {}} />)
    expect(
      screen.getByRole('button', { name: 'Try again' })
    ).toBeInTheDocument()
  })
})
