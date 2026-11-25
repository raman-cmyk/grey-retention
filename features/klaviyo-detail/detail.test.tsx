import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({
  klaviyoData: vi.fn(),
  role: 'owner' as 'owner' | 'staff',
  denied: false
}))
vi.mock('@/features/klaviyo-data/reader', () => ({
  klaviyoData: mocks.klaviyoData
}))
vi.mock('@/features/auth/application/request-context', () => ({
  requireRequestContext: async () => {
    if (mocks.denied) throw new Error('NEXT_REDIRECT /login')
    return {
      kind: 'client',
      userId: 'u1',
      tenantId: 'tenant-1',
      tenantName: 'Cedar Lane',
      tenantSlug: 'cedar-lane',
      tenantRole: mocks.role,
      timezone: 'Australia/Sydney'
    }
  }
}))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  }
}))

import CampaignError from '@/app/(gros)/results/campaigns/[campaignId]/error'
import CampaignLoading from '@/app/(gros)/results/campaigns/[campaignId]/loading'
import CampaignPage from '@/app/(gros)/results/campaigns/[campaignId]/page'
import FlowEmailError from '@/app/(gros)/results/flow-emails/[messageId]/error'
import FlowEmailLoading from '@/app/(gros)/results/flow-emails/[messageId]/loading'
import FlowEmailPage from '@/app/(gros)/results/flow-emails/[messageId]/page'
import FlowError from '@/app/(gros)/results/flows/[flowId]/error'
import FlowLoading from '@/app/(gros)/results/flows/[flowId]/loading'
import FlowPage from '@/app/(gros)/results/flows/[flowId]/page'
import MetricError from '@/app/(gros)/results/metrics/[metricId]/error'
import MetricLoading from '@/app/(gros)/results/metrics/[metricId]/loading'
import MetricPage from '@/app/(gros)/results/metrics/[metricId]/page'
import ResultsNotFound from '@/app/(gros)/results/not-found'
import type { KlaviyoData } from '@/features/klaviyo-data/reader'
import { sampleKlaviyoSnapshot } from '@/lib/providers/fake-klaviyo-read'
import nextConfig from '@/next.config'
import { campaignView, flowEmailView, flowView, metricView } from './detail'

const now = new Date('2026-11-24T03:00:00Z')

afterEach(() => {
  cleanup()
  mocks.klaviyoData.mockReset()
  mocks.role = 'owner'
  mocks.denied = false
})

/** The sample Klaviyo data the fake provider gives every workspace. */
function sample(): KlaviyoData {
  return {
    state: 'sample',
    shopify: 'missing',
    snapshot: sampleKlaviyoSnapshot({ timezone: 'Australia/Sydney', now })
  }
}

const read = (data?: KlaviyoData) => ({
  data: data ?? sample(),
  timezone: 'Australia/Sydney',
  now
})

const campaign = (campaignId: string) =>
  CampaignPage({ params: Promise.resolve({ campaignId }) })
const flow = (flowId: string) =>
  FlowPage({ params: Promise.resolve({ flowId }) })
const flowEmail = (messageId: string) =>
  FlowEmailPage({ params: Promise.resolve({ messageId }) })
const metric = (metricId: string) =>
  MetricPage({ params: Promise.resolve({ metricId }) })

const resultsCurrent = () =>
  expect(
    within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', {
      name: 'Results'
    })
  ).toHaveAttribute('aria-current', 'page')

/** Klaviyo's own ids are not the owner's words (BRAND.md rule 20). */
const noIds = () =>
  expect(document.querySelector('main')).not.toHaveTextContent(
    /\b(CMP|FLW|MET|LST|SEG)[a-z]{3}\d{3}/
  )

describe('the Klaviyo views (UI-KLV)', () => {
  it('a campaign: words that match what happened, audiences by name with their pages', () => {
    const view = campaignView(read(), 'CMPspr001')
    if (view.state !== 'ready') throw new Error(view.state)
    const c = view.item
    expect(view.source).toMatch(/^Sample Klaviyo data/)
    expect(c.status).toBe('Sent')
    expect(c.words.what).toBe('What was sent')
    expect(c.sendTime).toMatch(/^\w{3} \d{1,2}, \d{4} · \d{1,2}:\d{2} [AP]M$/)
    expect(c.zone).toBe('Sydney time')
    expect(c.stats?.opened).toBe('41.0%')
    expect(c.from).toBe('Sample Store <hello@shop.example>')
    expect(c.preview?.html).not.toContain('unsubscribe')
    expect(c.included).toEqual([
      {
        key: 'list-LSTnews01',
        name: 'Newsletter',
        details: ['List', 'Sent to it'],
        href: '/audiences/lists/LSTnews01'
      }
    ])
    expect(c.excluded[0]?.details).toEqual(['Segment', 'Left out'])
    expect(c.excluded[0]?.href).toBe('/audiences/segments/SEGnvr000')
  })

  it('a draft or cancelled campaign never reads "was sent", and has no numbers', () => {
    for (const id of ['CMPdrf008', 'CMPcnl009']) {
      const view = campaignView(read(), id)
      if (view.state !== 'ready') throw new Error(view.state)
      expect(view.item.words.what).not.toBe('What was sent')
      expect(view.item.stats).toBeNull()
    }
    const draft = campaignView(read(), 'CMPdrf008')
    if (draft.state !== 'ready') throw new Error(draft.state)
    expect(draft.item.sendTime).toBeNull()
    expect(draft.item.strategy).toBeNull()
  })

  it('an audience Klaviyo no longer has is named, with no page to open', () => {
    const data = sample()
    if (data.state !== 'sample') throw new Error(data.state)
    data.snapshot.lists = data.snapshot.lists.filter(
      (l) => l.id !== 'LSTnews01'
    )
    const view = campaignView(read(data), 'CMPspr001')
    if (view.state !== 'ready') throw new Error(view.state)
    expect(view.item.included[0]?.href).toBeNull()
  })

  it('a flow: its trigger opens the metric, waits in words, each email its page', () => {
    const view = flowView(read(), 'FLWpst004')
    if (view.state !== 'ready') throw new Error(view.state)
    const f = view.item
    expect(f.notLive).toBe('1 of 2 emails is not live.')
    expect(f.trigger).toMatchObject({
      label: 'Metric: Placed Order',
      href: '/results/metrics/METord005',
      open: 'Open metric'
    })
    expect(f.steps.map((s) => s.kind)).toEqual(['email', 'wait', 'email'])
    expect(f.steps[1]).toMatchObject({ text: '10 days · any day' })
    expect(f.steps[2]).toMatchObject({
      subject: 'How was your coffee?',
      live: false,
      href: '/results/flow-emails/FLWpst004M2'
    })
    const welcome = flowView(read(), 'FLWwel001')
    if (welcome.state !== 'ready') throw new Error(welcome.state)
    expect(welcome.item.trigger.href).toBe('/audiences/lists/LSTnews01')
  })

  it('a flow email: its flow, the wait before it, no reply-to said plainly', () => {
    const view = flowEmailView(read(), 'FLWpst004M2')
    if (view.state !== 'ready') throw new Error(view.state)
    expect(view.item.flow).toEqual({
      name: 'Post-purchase',
      href: '/results/flows/FLWpst004'
    })
    expect(view.item.wait).toBe('10 days · any day')
    expect(view.item.replyTo).toBeNull()
    const first = flowEmailView(read(), 'FLWpst004M1')
    if (first.state !== 'ready') throw new Error(first.state)
    expect(first.item.wait).toBeNull()
  })

  it('a metric: what it counts, where from, and the flows it starts', () => {
    const view = metricView(read(), 'METord005')
    if (view.state !== 'ready') throw new Error(view.state)
    expect(view.item).toMatchObject({
      measures: 'Someone completed a purchase.',
      events: '1,380',
      from: 'Shopify',
      kind: 'Store activity'
    })
    expect(view.item.flows.map((f) => f.href)).toEqual([
      '/results/flows/FLWpst004',
      '/results/flows/FLWwbk005'
    ])
  })

  it('an id Klaviyo does not have is not found; Klaviyo problems say so', () => {
    expect(campaignView(read(), 'nope')).toEqual({ state: 'not_found' })
    expect(flowView(read(), 'CMPspr001')).toEqual({ state: 'not_found' })
    expect(flowEmailView(read(), 'FLWpst004')).toEqual({ state: 'not_found' })
    expect(metricView(read(), 'nope')).toEqual({ state: 'not_found' })
    expect(
      flowView(read({ state: 'not_connected', reason: 'missing' }), 'x')
    ).toEqual({ state: 'not_connected' })
    expect(
      metricView(read({ state: 'not_connected', reason: 'expired' }), 'x')
    ).toEqual({ state: 'reconnect' })
    expect(campaignView(read({ state: 'unavailable' }), 'x')).toEqual({
      state: 'unavailable',
      reason: "Klaviyo numbers aren't available in this version yet.",
      retry: false
    })
  })
})

describe('the Klaviyo pages under Results (UI-KLV)', () => {
  it('a campaign: its name, Results current, Back to Results, its facts and a safe preview', async () => {
    mocks.klaviyoData.mockResolvedValue(sample())
    render(await campaign('CMPspr001'))
    expect(
      screen.getByRole('heading', { level: 1, name: 'Spring restock' })
    ).toBeInTheDocument()
    resultsCurrent()
    expect(
      screen.getByRole('link', { name: 'Back to Results' })
    ).toHaveAttribute('href', '/results')
    expect(
      screen.getByRole('region', { name: 'How it was sent' })
    ).toHaveTextContent('Times in Sydney time')
    const stats = screen.getByRole('region', { name: 'How it did' })
    expect(stats).toHaveTextContent('Open rate')
    expect(stats).toHaveTextContent('41.0%')
    expect(stats).toHaveTextContent(/Sample Klaviyo data/)
    const who = within(
      screen.getByRole('region', { name: 'Who received this' })
    )
    expect(who.getByText('Newsletter')).toBeInTheDocument()
    expect(who.getAllByRole('link', { name: 'Open' })[0]).toHaveAttribute(
      'href',
      '/audiences/lists/LSTnews01'
    )
    const frame = screen.getByTitle('Preview of Spring restock')
    expect(frame.getAttribute('sandbox')).toBe('')
    expect(frame.getAttribute('srcdoc')).not.toContain('unsubscribe')
    noIds()
    // Read for the session's workspace, in its timezone.
    expect(mocks.klaviyoData).toHaveBeenCalledWith(
      'tenant-1',
      'Australia/Sydney',
      expect.any(Number)
    )
  })

  it('a campaign sent in local time says so; a draft has no numbers yet', async () => {
    mocks.klaviyoData.mockResolvedValue(sample())
    render(await campaign('CMPhol007'))
    expect(
      screen.getByText(/each recipient’s own time zone/)
    ).toBeInTheDocument()
    cleanup()
    render(await campaign('CMPdrf008'))
    expect(
      screen.getByRole('region', { name: 'How it did' })
    ).toHaveTextContent('Klaviyo has numbers once it is sent.')
    expect(screen.getByText('No send time is set yet.')).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(/What was sent/)
  })

  it('a flow: what it earned, what starts it, its steps opening each email', async () => {
    mocks.klaviyoData.mockResolvedValue(sample())
    render(await flow('FLWpst004'))
    expect(
      screen.getByRole('heading', { level: 1, name: 'Post-purchase' })
    ).toBeInTheDocument()
    resultsCurrent()
    expect(screen.getByRole('region', { name: 'Sales' })).toHaveTextContent(
      '1 of 2 emails is not live.'
    )
    expect(screen.getByRole('link', { name: 'Open metric' })).toHaveAttribute(
      'href',
      '/results/metrics/METord005'
    )
    const steps = within(screen.getByRole('region', { name: 'Steps' }))
    expect(steps.getByText('10 days · any day')).toBeInTheDocument()
    expect(steps.getAllByRole('link', { name: 'Open' })[1]).toHaveAttribute(
      'href',
      '/results/flow-emails/FLWpst004M2'
    )
    expect(screen.getByRole('region', { name: 'Dates' })).toHaveTextContent(
      /Last changed/
    )
    noIds()
  })

  it('a flow email: its subject, Back to the flow, reply-to said plainly, a safe preview', async () => {
    mocks.klaviyoData.mockResolvedValue(sample())
    render(await flowEmail('FLWpst004M2'))
    expect(
      screen.getByRole('heading', { level: 1, name: 'How was your coffee?' })
    ).toBeInTheDocument()
    resultsCurrent()
    expect(
      screen.getByRole('link', { name: 'Back to the flow' })
    ).toHaveAttribute('href', '/results/flows/FLWpst004')
    const about = within(
      screen.getByRole('region', { name: 'About this email' })
    )
    expect(about.getByText('Reply to').nextElementSibling).toHaveTextContent(
      'Not set'
    )
    expect(about.getByText('Post-purchase')).toBeInTheDocument()
    expect(
      screen
        .getByTitle('Preview of How was your coffee?')
        .getAttribute('sandbox')
    ).toBe('')
    noIds()
  })

  it('a metric: its events in the last 30 days, and the flows it starts', async () => {
    mocks.klaviyoData.mockResolvedValue(sample())
    render(await metric('METord005'))
    resultsCurrent()
    const events = screen.getByRole('region', { name: 'Events' })
    expect(events).toHaveTextContent('1,380')
    expect(events).toHaveTextContent('Someone completed a purchase.')
    expect(
      screen.getByRole('region', { name: 'Where it comes from' })
    ).toHaveTextContent('Store activity')
    expect(
      within(screen.getByRole('region', { name: 'Flows it starts' }))
        .getAllByRole('link', { name: 'Open' })
        .map((l) => l.getAttribute('href'))
    ).toEqual(['/results/flows/FLWpst004', '/results/flows/FLWwbk005'])
    noIds()
  })

  it('an unknown id is not found, with the way back to Results', async () => {
    mocks.klaviyoData.mockResolvedValue(sample())
    await expect(campaign('nope')).rejects.toThrow('NEXT_NOT_FOUND')
    await expect(flow('nope')).rejects.toThrow('NEXT_NOT_FOUND')
    await expect(flowEmail('nope')).rejects.toThrow('NEXT_NOT_FOUND')
    await expect(metric('nope')).rejects.toThrow('NEXT_NOT_FOUND')
    render(<ResultsNotFound />)
    expect(
      screen.getByRole('heading', { name: 'Not found in Klaviyo' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Back to Results' })
    ).toHaveAttribute('href', '/results')
  })

  it('Klaviyo not connected: the owner connects it on Settings, staff are told who does', async () => {
    mocks.klaviyoData.mockResolvedValue({
      state: 'not_connected',
      reason: 'disconnected'
    })
    render(await flow('FLWpst004'))
    expect(
      screen.getByRole('heading', { level: 1, name: 'Flow' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Connect Klaviyo' })
    ).toHaveAttribute('href', '/settings#klaviyo')
    expect(screen.queryByText('Post-purchase')).toBeNull()
    cleanup()
    mocks.role = 'staff'
    render(await metric('METord005'))
    expect(screen.queryByRole('link', { name: 'Connect Klaviyo' })).toBeNull()
    expect(screen.getByRole('region', { name: 'Klaviyo' })).toHaveTextContent(
      'The store’s owner connects Klaviyo.'
    )
  })

  it('a key that stopped working: Reconnect on Settings', async () => {
    mocks.klaviyoData.mockResolvedValue({
      state: 'not_connected',
      reason: 'expired'
    })
    render(await campaign('CMPspr001'))
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Klaviyo key stopped working'
    )
    expect(screen.getByRole('link', { name: 'Reconnect' })).toHaveAttribute(
      'href',
      '/settings#klaviyo'
    )
  })

  it('live mode says so without a Try again; a failed read can be tried again', async () => {
    mocks.klaviyoData.mockResolvedValue({ state: 'unavailable' })
    render(await metric('METord005'))
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Klaviyo numbers aren't available in this version yet."
    )
    expect(screen.queryByRole('link', { name: 'Try again' })).toBeNull()
    cleanup()
    mocks.klaviyoData.mockRejectedValue(new Error('down'))
    render(await flowEmail('M a/b'))
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Klaviyo could not be read just now. Try again in a minute.'
    )
    expect(screen.getByRole('link', { name: 'Try again' })).toHaveAttribute(
      'href',
      '/results/flow-emails/M%20a%2Fb'
    )
  })

  it('reads nothing when the visitor is not signed in', async () => {
    mocks.denied = true
    for (const open of [campaign, flow, flowEmail, metric])
      await expect(open('x')).rejects.toThrow('NEXT_REDIRECT')
    expect(mocks.klaviyoData).not.toHaveBeenCalled()
  })

  it('loading: the bar with Results current, its words, busy, and no main', () => {
    for (const [Loading, words] of [
      [CampaignLoading, 'Opening the campaign'],
      [FlowLoading, 'Opening the flow'],
      [FlowEmailLoading, 'Opening the email'],
      [MetricLoading, 'Opening the metric']
    ] as const) {
      const { container } = render(<Loading />)
      resultsCurrent()
      expect(screen.getByText(words)).toHaveAttribute('aria-live', 'polite')
      expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
      expect(container.querySelector('main')).toBeNull()
      cleanup()
    }
  })

  it('error: what happened, Try again, and the way back to Results', async () => {
    for (const [Error, words] of [
      [CampaignError, 'This campaign did not open'],
      [FlowError, 'This flow did not open'],
      [FlowEmailError, 'This email did not open'],
      [MetricError, 'This metric did not open']
    ] as const) {
      const retry = vi.fn()
      render(<Error retry={retry} />)
      expect(screen.getAllByRole('main')).toHaveLength(1)
      const alert = screen.getByRole('alert')
      expect(alert).toHaveTextContent(words)
      expect(alert).toHaveTextContent('Nothing was changed.')
      await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
      expect(retry).toHaveBeenCalledTimes(1)
      expect(
        screen.getByRole('link', { name: 'Back to Results' })
      ).toHaveAttribute('href', '/results')
      cleanup()
    }
  })
})

describe('the old Klaviyo detail addresses (UI-KLV)', () => {
  const moved: Record<string, string> = {
    '/campaigns/klaviyo/:campaignId': '/results/campaigns/:campaignId',
    '/flows/:flowId': '/results/flows/:flowId',
    '/flow-messages/:messageId': '/results/flow-emails/:messageId',
    '/metrics/:metricId': '/results/metrics/:metricId'
  }

  it('open the GROS page under Results (temporary, query passed on)', async () => {
    const redirects = await nextConfig.redirects!()
    for (const [source, destination] of Object.entries(moved))
      expect(redirects).toContainEqual({
        source,
        destination,
        permanent: false
      })
    // Before /campaigns/:campaignId, which never takes a second segment.
    const at = (source: string) =>
      redirects.findIndex((r) => r.source === source)
    expect(at('/campaigns/klaviyo/:campaignId')).toBeLessThan(
      at('/campaigns/:campaignId')
    )
  })

  it('leave no page at the old address', () => {
    const pages = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) return pages(path)
        return name === 'page.tsx' ? [path] : []
      })
    const app = join(import.meta.dirname, '../../app')
    const addresses = pages(app).map((p) =>
      p
        .slice(app.length)
        .replace(/\/\([^)]+\)/g, '')
        .replace(/\/page\.tsx$/, '')
        .replace(/\[([^\]]+)\]/g, ':$1')
    )
    for (const [source, destination] of Object.entries(moved)) {
      expect(addresses).not.toContain(source)
      expect(addresses).toContain(destination)
    }
  })
})
