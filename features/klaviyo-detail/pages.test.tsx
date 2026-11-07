import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    disconnect() {}
  }
)
const connections = vi.hoisted(() => ({
  rows: null as null | { provider: string; status: string }[],
  tenant: null as unknown,
  mode: 'fake' as 'fake' | 'real',
  denied: false,
  reads: 0
}))
vi.mock('@/lib/env/server', () => ({
  getServerEnvironment: () => ({ ADAPTER_MODE: connections.mode })
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () =>
    connections.rows === null
      ? null
      : {
          from: () => ({
            select: () => ({
              eq: async (column: string, value: unknown) => {
                connections.reads++
                connections.tenant = [column, value]
                return { data: connections.rows, error: null }
              }
            })
          })
        }
}))
vi.mock('@/features/auth/application/request-context', () => ({
  requireRequestContext: async () => {
    if (connections.denied) throw new Error('NEXT_REDIRECT /login')
    return {
      kind: 'client',
      tenantId: 't1',
      tenantName: 'Northwind',
      tenantRole: 'owner',
      timezone: 'Australia/Sydney',
      userId: 'u1'
    }
  }
}))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
  useRouter: () => ({ back: vi.fn() })
}))

const { default: ListPage } = await import('@/app/(client)/lists/[listId]/page')
const { default: SegmentPage } =
  await import('@/app/(client)/segments/[segmentId]/page')
const { default: CampaignPage } =
  await import('@/app/(client)/campaigns/klaviyo/[klaviyoId]/page')
const { default: FlowPage } = await import('@/app/(client)/flows/[flowId]/page')
const { default: MessagePage } =
  await import('@/app/(client)/flow-messages/[messageId]/page')
const { default: MetricPage } =
  await import('@/app/(client)/metrics/[metricId]/page')

const props = (key: string, id: string, from?: string) => ({
  params: Promise.resolve({ [key]: id }) as never,
  searchParams: Promise.resolve(from ? { from } : {})
})

afterEach(() => {
  cleanup()
  connections.rows = null
  connections.tenant = null
  connections.mode = 'fake'
  connections.denied = false
  connections.reads = 0
})

describe('Klaviyo detail pages (§4)', () => {
  it('list: plain sign-up method, back to the Lists tab, sample note', async () => {
    render(await ListPage(props('listId', 'LSTnews01', 'lists')))
    expect(
      screen.getByRole('heading', { level: 1, name: 'Newsletter' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Back to dashboard' })
    ).toHaveAttribute('href', '/dashboard?tab=lists#klaviyo-data')
    expect(screen.getByText('Double opt-in')).toBeInTheDocument()
    expect(screen.getByText(/Sample Klaviyo data/)).toBeInTheDocument()
    const main = screen.getByText('Sign-up method').closest('section')!
    expect(main).not.toHaveTextContent('double_opt_in')
    expect(screen.getByText(/Flow triggers · 1 item/)).toBeInTheDocument()
  })

  it('segment: active and starred pills, rules as a sentence, JSON only in Advanced', async () => {
    render(await SegmentPage(props('segmentId', 'SEGeng030')))
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText('Starred')).toBeInTheDocument()
    const rules = screen.getByRole('region', {
      name: 'How this segment is defined'
    })
    expect(rules).toHaveTextContent('Opened an email in the last 30 days.')
    expect(rules).not.toHaveTextContent('condition_groups')
    expect(
      screen.getByText('Advanced details').closest('details')
    ).toHaveTextContent('condition_groups')
  })

  it('campaign: names not ids, how it did, the time with its timezone, a safe preview', async () => {
    render(await CampaignPage(props('klaviyoId', 'CMPspr001', 'campaigns')))
    const who = screen.getByRole('region', { name: 'Who received this' })
    expect(who).toHaveTextContent('Newsletter')
    expect(who).not.toHaveTextContent('LSTnews01')
    const stats = screen.getByRole('region', { name: 'How it did' })
    expect(stats).toHaveTextContent('Open rate')
    expect(stats).toHaveTextContent('41.0%')
    expect(
      screen.getByRole('region', { name: 'How it was sent' })
    ).toHaveTextContent(/Sent at: .*\(Sydney time\)/)
    const frame = screen.getByTitle('Preview of Spring restock')
    expect(frame.getAttribute('sandbox')).toBe('')
    expect(frame.getAttribute('srcdoc')).not.toContain('unsubscribe')
  })

  it('campaign: says when it sends in local time, and has no stats before sending', async () => {
    render(await CampaignPage(props('klaviyoId', 'CMPhol007')))
    expect(
      screen.getByText(/each recipient's local timezone/)
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('region', { name: 'How it did' })
    ).not.toBeInTheDocument()
  })

  it('flow: warns when a live flow has emails off, waits in words, links each email', async () => {
    render(await FlowPage(props('flowId', 'FLWpst004')))
    expect(screen.getByText('1 of 2 emails is not live.')).toBeInTheDocument()
    expect(screen.getByText('10 days · any day')).toBeInTheDocument()
    expect(screen.getByText('Metric: Placed Order')).toBeInTheDocument()
    expect(
      screen.getAllByRole('link', { name: /Open this email/ })[0]
    ).toHaveAttribute('href', '/flow-messages/FLWpst004M1')
  })

  it('flow message: reply-to shows — when empty, history back, a safe preview', async () => {
    render(
      await MessagePage({
        params: Promise.resolve({ messageId: 'FLWpst004M2' })
      })
    )
    expect(
      screen.getByRole('heading', { level: 1, name: 'How was your coffee?' })
    ).toBeInTheDocument()
    const replyTo = screen.getByText('Reply to').nextElementSibling
    expect(replyTo).toHaveTextContent('—')
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute(
      'href',
      '/flows/FLWpst004?from=flows'
    )
    expect(
      screen
        .getByTitle('Preview of How was your coffee?')
        .getAttribute('sandbox')
    ).toBe('')
  })

  it('metric: what it measures in plain words, and events in the last 30 days', async () => {
    render(await MetricPage(props('metricId', 'METord005')))
    expect(
      screen.getByText('Someone completed a purchase.')
    ).toBeInTheDocument()
    expect(
      within(
        screen.getByText('Events · last 30 days').closest('section')!
      ).getByText('1,380')
    ).toBeInTheDocument()
  })

  it('unknown ids are not found', async () => {
    await expect(ListPage(props('listId', 'nope'))).rejects.toThrow(
      'NEXT_NOT_FOUND'
    )
    await expect(CampaignPage(props('klaviyoId', 'nope'))).rejects.toThrow(
      'NEXT_NOT_FOUND'
    )
    await expect(
      MessagePage({ params: Promise.resolve({ messageId: 'nope' }) })
    ).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('says Klaviyo is not connected instead of showing sample numbers', async () => {
    connections.rows = [{ provider: 'klaviyo', status: 'disconnected' }]
    render(await FlowPage(props('flowId', 'FLWpst004', 'flows')))
    expect(screen.getByText(/Klaviyo is disconnected/)).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 1, name: 'Klaviyo details' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Go to Connections' })
    ).toBeInTheDocument()
    expect(screen.queryByText('Post-purchase')).not.toBeInTheDocument()
  })

  it('campaign: a draft or cancelled campaign never reads "was sent"', async () => {
    render(await CampaignPage(props('klaviyoId', 'CMPdrf008')))
    expect(
      screen.getByRole('region', { name: 'Who it is set to go to' })
    ).toHaveTextContent('Not sent yet')
    expect(screen.getByText('No send time is set yet.')).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(/was sent to|What was sent/)
    cleanup()
    render(await CampaignPage(props('klaviyoId', 'CMPcnl009')))
    expect(
      screen.getByRole('region', { name: 'Who it was set to go to' })
    ).toHaveTextContent('Cancelled before it was sent')
    expect(
      screen.getByRole('region', { name: 'How it was planned' })
    ).toHaveTextContent('Was scheduled for:')
    expect(document.body).not.toHaveTextContent(/was sent to|What was sent/)
  })

  it('flow: Advanced details counts each list once and invents no tags', async () => {
    render(await FlowPage(props('flowId', 'FLWpst004')))
    const linked = screen.getByRole('region', { name: 'Linked resources' })
    expect(linked).toHaveTextContent('Flow actions · 3 items')
    expect(linked).not.toHaveTextContent(/items · \d+ items/)
    expect(linked).not.toHaveTextContent('Tags')
    expect(screen.getByText('1 of 2 emails is not live.').className).toContain(
      'warning'
    )
  })

  it('reads the connection for the signed-in workspace only', async () => {
    connections.rows = [{ provider: 'klaviyo', status: 'connected' }]
    render(await ListPage(props('listId', 'LSTnews01')))
    expect(connections.tenant).toEqual(['tenant_id', 't1'])
  })

  it('says unavailable in real mode, without sending a connected owner to reconnect', async () => {
    connections.mode = 'real'
    render(await MetricPage(props('metricId', 'METord005')))
    expect(
      screen.getByText(/aren't available in this version yet/)
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'Go to Connections' })
    ).not.toBeInTheDocument()
  })

  it('reads nothing when the visitor is not signed in', async () => {
    connections.denied = true
    connections.rows = [{ provider: 'klaviyo', status: 'connected' }]
    await expect(ListPage(props('listId', 'LSTnews01'))).rejects.toThrow(
      'NEXT_REDIRECT'
    )
    expect(connections.reads).toBe(0)
  })
})
