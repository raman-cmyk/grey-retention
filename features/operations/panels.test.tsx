import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const supabase = vi.hoisted(() => ({ createClient: vi.fn() }))
const auth = vi.hoisted(() => ({ requireRequestContext: vi.fn() }))
const live = vi.hoisted(() => ({ liveSwitches: vi.fn() }))
const watch = vi.hoisted(() => ({
  modelsInUseNow: vi.fn(() => ({ inUse: [], unpriced: [] })),
  retirementWatch: vi.fn()
}))
vi.mock('@/lib/supabase/server', () => supabase)
vi.mock('@/features/auth/application/request-context', () => auth)
vi.mock('./actions', () => ({
  operationAction: vi.fn(async () => ({})),
  acceptInvite: vi.fn(async () => ({}))
}))
vi.mock('./live-switches', () => live)
vi.mock('@/features/ai/retirement-watch', () => watch)
vi.mock('@/features/email-generation/config', () => ({
  rewriteAvailability: () => ({
    ready: false,
    sample: false,
    reason: 'missing_key'
  })
}))

import {
  LiveSwitchesPanel,
  OperatorPanel,
  RetirementWatchPanel,
  SupportPanel
} from './panels'

const cedar = '00000000-0000-4000-8000-000000000101'
const ticket = '00000000-0000-4000-8000-0000000000b1'
const diagnostics = {
  tenants: [
    {
      id: cedar,
      name: 'Cedar Lane',
      status: 'active',
      timezone: 'Europe/London',
      package: 'Starter',
      usedMicro: 1500000,
      reservedMicro: 0,
      allocationMicro: 20000000
    }
  ],
  jobs: [
    {
      id: '00000000-0000-4000-8000-0000000000c1',
      tenant_id: cedar,
      kind: 'calendar.plan',
      status: 'failed',
      attempt: 4,
      error_code: 'timeout'
    },
    {
      id: '00000000-0000-4000-8000-0000000000c2',
      tenant_id: cedar,
      kind: 'email.build',
      status: 'running',
      attempt: 1,
      error_code: null
    }
  ],
  connections: [],
  assignmentRequests: [],
  chats: { count: 7, privateCount: 2 }
}

/** A Supabase stand-in: each table answers once its chain is awaited. */
function database(
  tables: Record<string, { data: unknown; error: unknown }>,
  rpc: { data: unknown; error: unknown } = { data: diagnostics, error: null }
) {
  const chain = (result: { data: unknown; error: unknown }) => {
    const link: Record<string, unknown> = {}
    for (const step of ['select', 'eq', 'in', 'order', 'limit'])
      link[step] = () => link
    link.then = (done: (value: unknown) => unknown) => done(result)
    return link
  }
  const db = {
    rpc: vi.fn(async () => rpc),
    from: vi.fn((table: string) =>
      chain(tables[table] ?? { data: [], error: null })
    )
  }
  supabase.createClient.mockResolvedValue(db)
  return db
}

const tickets = {
  data: [
    {
      id: ticket,
      tenant_id: cedar,
      subject: 'Klaviyo drafts',
      kind: 'support',
      state: 'open',
      revision: 2
    }
  ],
  error: null
}
const messages = {
  data: [{ id: 'm1', ticket_id: ticket, body: 'Where do my drafts go?' }],
  error: null
}

beforeEach(() => {
  auth.requireRequestContext.mockResolvedValue({
    kind: 'admin',
    userId: 'u',
    adminRole: 'super_admin'
  })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Operations cards (UI-ADM)', () => {
  it('lists the go-live switches, and marks only the one that needs the admin', async () => {
    live.liveSwitches.mockReturnValue([
      { label: 'Real AI', state: 'on', detail: 'On: Gemini.' },
      {
        label: 'Klaviyo drafts',
        state: 'attention',
        detail: 'Set, but it cannot work.'
      },
      { label: 'Inbox', state: 'off', detail: 'Off: sample inbox.' }
    ])
    render(await LiveSwitchesPanel())
    expect(auth.requireRequestContext).toHaveBeenCalledWith('admin')
    expect(
      screen.getByRole('heading', { name: 'Go-live switches' })
    ).toBeInTheDocument()
    const rows = within(
      screen.getByRole('list', { name: 'Go-live switches' })
    ).getAllByRole('listitem')
    expect(rows.map((r) => r.textContent)).toEqual([
      'Real AIOn: Gemini.',
      'Klaviyo draftsSet, but it cannot work.Needs you',
      'InboxOff: sample inbox.'
    ])
  })

  it('says when no AI model is in use, and marks a model that shuts down', async () => {
    watch.retirementWatch.mockReturnValue([])
    render(await RetirementWatchPanel())
    expect(screen.getByText(/No AI model is in use/)).toBeInTheDocument()
    cleanup()
    watch.retirementWatch.mockReturnValue([
      { name: 'gemini-x', state: 'soon', detail: 'Shuts down on 1 Dec.' }
    ])
    render(await RetirementWatchPanel())
    expect(
      within(screen.getByRole('list', { name: 'Models in use' })).getByText(
        'Needs you'
      )
    ).toBeInTheDocument()
  })

  it('shows workspaces with counts, jobs with their state, and the super admin’s package tools', async () => {
    database({ packages: { data: [], error: null } })
    render(await OperatorPanel())
    expect(screen.getByText('Conversations').nextSibling).toHaveTextContent('7')
    const workspace = within(
      screen.getByRole('list', { name: 'Workspaces' })
    ).getByRole('listitem')
    expect(workspace).toHaveTextContent(
      'active · Europe/London · Starter · $1.50 used of $20.00 synthetic allowance'
    )
    const assign = within(workspace).getByRole('button', {
      name: 'Assign fixture package: Cedar Lane'
    })
    const form = assign.closest('form')!
    expect(form.querySelector('input[name="kind"]')).toHaveValue(
      'assign_package'
    )
    expect(form.querySelector('input[name="tenant"]')).toHaveValue(cedar)
    expect(
      within(workspace).getByLabelText('Fixture package for Cedar Lane')
    ).toBeInTheDocument()
    const [failed, running] = within(
      screen.getByRole('list', { name: 'Sanitized durable jobs' })
    ).getAllByRole('listitem')
    expect(failed).toHaveTextContent(
      'Cedar Lane · Failed · 4/4 tries · Code timeout'
    )
    expect(within(failed!).getByText('Needs you')).toBeInTheDocument()
    expect(within(running!).getByText('Running')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Save fixture package revision' })
    ).toBeInTheDocument()
  })

  it('gives a plain admin no package tools', async () => {
    auth.requireRequestContext.mockResolvedValue({
      kind: 'admin',
      userId: 'u',
      adminRole: 'admin'
    })
    database({ packages: { data: [], error: null } })
    render(await OperatorPanel())
    expect(screen.queryByRole('button', { name: /fixture package/ })).toBeNull()
    expect(
      screen.queryByRole('heading', { name: 'Fixture packages' })
    ).toBeNull()
  })

  it('says when the diagnostics cannot be read, with a way to try again', async () => {
    database(
      { packages: { data: [], error: null } },
      {
        data: null,
        error: { code: '42501' }
      }
    )
    render(await OperatorPanel())
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Sanitized diagnostics unavailable.'
    )
    expect(screen.getByRole('link', { name: 'Try again' })).toHaveAttribute(
      'href',
      '/admin/operations'
    )
  })
})

describe('the support queue (UI-ADM)', () => {
  it('shows each thread as a tile with its messages and a reply that sets its state', async () => {
    database({ support_tickets: tickets, support_messages: messages })
    render(await SupportPanel())
    expect(auth.requireRequestContext).toHaveBeenCalledWith('admin')
    const thread = within(screen.getByRole('list', { name: 'Support threads' }))
      .getAllByRole('listitem')
      .find((li) => within(li).queryByRole('heading'))!
    expect(
      within(thread).getByRole('heading', { name: 'Klaviyo drafts' })
    ).toBeInTheDocument()
    expect(thread).toHaveTextContent('Support · Open')
    expect(within(thread).getByText('Needs you')).toBeInTheDocument()
    expect(thread).toHaveTextContent('Where do my drafts go?')
    expect(within(thread).getByLabelText('Thread reply')).toBeRequired()
    expect(within(thread).getByLabelText('Ticket state')).toHaveValue('open')
    const save = within(thread).getByRole('button', {
      name: 'Save thread reply: Klaviyo drafts'
    })
    const form = save.closest('form')!
    for (const [name, value] of [
      ['surface', 'admin'],
      ['kind', 'reply_ticket'],
      ['tenant', cedar],
      ['id', ticket],
      ['revision', '2']
    ])
      expect(form.querySelector(`input[name="${name}"]`)).toHaveValue(value)
  })

  it('says when there are no threads, or when they cannot be read', async () => {
    database({ support_tickets: { data: [], error: null } })
    render(await SupportPanel())
    expect(screen.getByText('No support threads yet.')).toBeInTheDocument()
    cleanup()
    database({ support_tickets: { data: null, error: { code: '42501' } } })
    render(await SupportPanel())
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Support data unavailable.'
    )
  })
})
