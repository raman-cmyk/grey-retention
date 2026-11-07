import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const actions = vi.hoisted(() => ({
  saveCampaignDefaults: vi.fn(async () => ({
    message: 'Defaults saved. The new campaign editor will use them.'
  }))
}))
vi.mock('./actions', () => actions)
const timezoneActions = vi.hoisted(() => ({
  saveBrandTimezone: vi.fn(async () => ({
    message: 'Saved. Every date and time now uses Europe/London.'
  })),
  switchToKlaviyoTimezone: vi.fn(async () => ({
    message: 'Saved. The brand timezone now follows Klaviyo.'
  }))
}))
vi.mock('./timezone-actions', () => timezoneActions)

import { DefaultsForm, TimezoneCard } from './settings-form'
import { emptyDefaults } from './defaults'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const props = {
  defaults: {
    ...emptyDefaults,
    senderName: 'Cedar Lane',
    sendTo: ['LSTnews01'],
    revision: 3
  },
  products: [
    { id: '00000000-0000-4000-8000-000000000301', title: 'Field overshirt' }
  ],
  audiences: [
    { id: 'LSTnews01', name: 'Newsletter', kind: 'list' as const },
    { id: 'SEGeng030', name: 'Engaged 30 days', kind: 'segment' as const }
  ],
  audienceSource: 'sample' as const
}
const formOf = () =>
  screen.getByRole('button', { name: 'Save defaults' }).closest('form')!

describe('DefaultsForm', () => {
  it('opens on Featured Product and switches tabs on the page', async () => {
    render(<DefaultsForm {...props} owner />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual([
      'Featured Product',
      'Sender Name',
      'Primary Link',
      'Audience',
      'Email Settings'
    ])
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('radio', { name: /Field overshirt/ })).toBeVisible()
    await userEvent.click(screen.getByRole('tab', { name: 'Sender Name' }))
    const sender = screen.getByRole('textbox', { name: 'Sender name' })
    expect(sender).toBeVisible()
    expect(sender).toHaveValue('Cedar Lane')
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Primary Link' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await userEvent.keyboard('{End}')
    expect(screen.getByRole('tab', { name: 'Email Settings' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await userEvent.keyboard('{Home}')
    expect(
      screen.getByRole('tab', { name: 'Featured Product' })
    ).toHaveAttribute('aria-selected', 'true')
  })

  it('saves every tab at once, even the hidden ones', async () => {
    render(<DefaultsForm {...props} owner />)
    const data = new FormData(formOf())
    expect(data.get('revision')).toBe('3')
    expect(data.get('sender_name')).toBe('Cedar Lane')
    expect(data.getAll('send_to')).toEqual(['LSTnews01'])
    expect(data.get('include_footer')).toBe('on')
    expect(data.get('footer_source')).toBe('auto')
    expect(screen.getByText('Applies to new campaigns only.')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Save defaults' }))
    expect(
      await screen.findByText(
        'Defaults saved. The new campaign editor will use them.'
      )
    ).toBeVisible()
  })

  it('lets our checks run on save instead of the browser’s (hidden tabs)', () => {
    render(<DefaultsForm {...props} owner />)
    expect(formOf()).toHaveAttribute('novalidate')
  })

  it('opens the tab of a refused field, marks it and puts focus on it', async () => {
    actions.saveCampaignDefaults.mockResolvedValueOnce({
      error: 'Primary link: use a full address that starts with https://',
      field: 'primary_link'
    } as never)
    render(<DefaultsForm {...props} owner />)
    await userEvent.click(screen.getByRole('tab', { name: 'Email Settings' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save defaults' }))
    const link = await screen.findByRole('textbox', { name: 'Primary link' })
    expect(screen.getByRole('tab', { name: 'Primary Link' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(link).toBeVisible()
    expect(link).toHaveAttribute('aria-invalid', 'true')
    expect(link).toHaveAccessibleDescription(
      'Primary link: use a full address that starts with https://'
    )
    await vi.waitFor(() => expect(link).toHaveFocus())
  })

  it('keeps saved audiences when Klaviyo is not connected', () => {
    render(
      <DefaultsForm
        {...props}
        audiences={[]}
        audienceSource="not_connected"
        owner
      />
    )
    expect(new FormData(formOf()).getAll('send_to')).toEqual(['LSTnews01'])
    expect(
      screen.getByText(/Your saved choices are kept when you save/)
    ).toBeInTheDocument()
  })

  it('keeps the saved product when the catalogue could not load', () => {
    render(
      <DefaultsForm
        {...props}
        defaults={{
          ...props.defaults,
          featuredProductId: '00000000-0000-4000-8000-000000000301'
        }}
        products={[]}
        productsState="error"
        owner
      />
    )
    expect(new FormData(formOf()).get('featured_product')).toBe(
      '00000000-0000-4000-8000-000000000301'
    )
  })

  it('says the defaults are not used yet, in the future tense', () => {
    render(<DefaultsForm {...props} owner />)
    expect(
      screen.getByText(/New campaigns will start with these/)
    ).toBeVisible()
    expect(screen.getByText(/Saved now, used soon/)).toBeVisible()
    expect(screen.queryByText(/These pre-fill every new campaign/)).toBeNull()
  })

  it('labels sample audiences and the only footer source honestly', async () => {
    render(<DefaultsForm {...props} owner />)
    await userEvent.click(screen.getByRole('tab', { name: 'Email Settings' }))
    const footer = screen.getByLabelText('Footer source')
    expect(
      within(footer)
        .getAllByRole('option')
        .map((o) => o.textContent)
    ).toEqual(['Auto — built from my brand settings'])
    expect(screen.getByText(/once Klaviyo is connected for real/)).toBeVisible()
  })

  it('is read-only for everyone but the owner, but tabs still switch', async () => {
    render(<DefaultsForm {...props} owner={false} />)
    expect(
      screen.getByText('Only the workspace owner can change these.')
    ).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Save defaults' })).toBeNull()
    expect(
      screen.getByRole('group', { name: 'Campaign defaults' })
    ).toBeDisabled()
    await userEvent.click(screen.getByRole('tab', { name: 'Sender Name' }))
    expect(screen.getByRole('textbox', { name: 'Sender name' })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: 'Sender name' })).toBeVisible()
  })
})

describe('TimezoneCard', () => {
  it('shows the brand timezone with its offset and the local time', () => {
    render(
      <TimezoneCard
        timezone="US/Pacific"
        initialNow={Date.parse('2026-11-06T17:07:00Z')}
      />
    )
    expect(screen.getByText('US/Pacific (UTC-08:00)')).toBeVisible()
    expect(screen.getByText('Fri, Nov 6 2026 · 9:07 AM')).toBeVisible()
    expect(
      screen.getByText(
        /Every date and time in the app uses your brand’s timezone/
      )
    ).toBeVisible()
    // Read-only without the owner.
    expect(screen.queryByLabelText('Change timezone')).toBeNull()
  })

  it('says where the timezone came from', () => {
    const { rerender } = render(
      <TimezoneCard timezone="UTC" initialNow={0} source="klaviyo" />
    )
    expect(
      screen.getByText('From your Klaviyo account (sample connection).')
    ).toBeVisible()
    rerender(<TimezoneCard timezone="UTC" initialNow={0} source="owner" />)
    expect(screen.getByText('Chosen by you.')).toBeVisible()
    rerender(<TimezoneCard timezone="UTC" initialNow={0} source="setup" />)
    expect(
      screen.getByText('Set when the workspace was created.')
    ).toBeVisible()
  })

  it('lets the owner pick a timezone and keeps the choice after saving', async () => {
    render(
      <TimezoneCard
        timezone="Asia/Kathmandu"
        initialNow={Date.parse('2026-11-06T17:07:00Z')}
        source="setup"
        owner
      />
    )
    const select = screen.getByLabelText('Change timezone')
    // The workspace's own zone is offered even if the runtime names it otherwise.
    expect(select).toHaveValue('Asia/Kathmandu')
    await userEvent.selectOptions(select, 'Europe/London')
    await userEvent.click(screen.getByRole('button', { name: 'Save timezone' }))
    expect(
      await screen.findByText(
        'Saved. Every date and time now uses Europe/London.'
      )
    ).toBeVisible()
    const sent = (
      timezoneActions.saveBrandTimezone.mock.calls[0] as unknown[]
    )[1] as FormData
    expect(sent.get('timezone')).toBe('Europe/London')
    expect(sent.get('expected')).toBe('Asia/Kathmandu')
    expect(select).toHaveValue('Europe/London')
  })

  it('offers Klaviyo’s timezone when it differs, to the owner only', async () => {
    const { rerender } = render(
      <TimezoneCard
        timezone="Europe/London"
        initialNow={Date.parse('2026-11-06T17:07:00Z')}
        source="owner"
        klaviyoTimezone="America/New_York"
        owner
      />
    )
    expect(screen.getByText('America/New_York (UTC-05:00)')).toBeVisible()
    await userEvent.click(
      screen.getByRole('button', { name: 'Use Klaviyo’s timezone' })
    )
    expect(
      await screen.findByText('Saved. The brand timezone now follows Klaviyo.')
    ).toBeVisible()
    rerender(
      <TimezoneCard
        timezone="Europe/London"
        initialNow={0}
        klaviyoTimezone="America/New_York"
      />
    )
    expect(
      screen.queryByRole('button', { name: 'Use Klaviyo’s timezone' })
    ).toBeNull()
    expect(
      screen.getByText(/The workspace owner can switch to it/)
    ).toBeVisible()
    rerender(
      <TimezoneCard
        timezone="America/New_York"
        initialNow={0}
        klaviyoTimezone="America/New_York"
        owner
      />
    )
    expect(screen.queryByText(/Your Klaviyo account uses/)).toBeNull()
  })

  it('shows a refusal and keeps the picked timezone', async () => {
    timezoneActions.saveBrandTimezone.mockResolvedValueOnce({
      error:
        'The timezone changed in another window. Reload the page, then try again.'
    } as never)
    render(<TimezoneCard timezone="UTC" initialNow={0} owner />)
    await userEvent.selectOptions(
      screen.getByLabelText('Change timezone'),
      'Asia/Tokyo'
    )
    await userEvent.click(screen.getByRole('button', { name: 'Save timezone' }))
    expect(await screen.findByText(/changed in another window/)).toBeVisible()
    expect(screen.getByLabelText('Change timezone')).toHaveValue('Asia/Tokyo')
  })
})
