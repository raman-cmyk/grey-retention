import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('./actions', () => ({
  saveCampaignDefaults: vi.fn(async () => ({
    message: 'Defaults saved. New campaigns will start with them.'
  }))
}))

import { DefaultsForm, TimezoneCard } from './settings-form'
import { emptyDefaults } from './defaults'

afterEach(cleanup)

const props = {
  defaults: {
    ...emptyDefaults,
    senderName: 'Cedar Lane',
    sendTo: ['list_1'],
    revision: 3
  },
  products: [
    { id: '00000000-0000-4000-8000-000000000301', title: 'Field overshirt' }
  ],
  audiences: [
    { id: 'list_1', name: 'Newsletter', kind: 'list' as const },
    { id: 'seg_9', name: 'Unsubscribed', kind: 'segment' as const }
  ],
  audienceSource: 'sample' as const
}

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
    expect(screen.getByLabelText('Sender name')).toBeVisible()
    expect(screen.getByLabelText('Sender name')).toHaveValue('Cedar Lane')
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Primary Link' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
  })

  it('saves every tab at once, even the hidden ones', async () => {
    render(<DefaultsForm {...props} owner />)
    const form = screen
      .getByRole('button', { name: 'Save defaults' })
      .closest('form')!
    const data = new FormData(form)
    expect(data.get('revision')).toBe('3')
    expect(data.get('sender_name')).toBe('Cedar Lane')
    expect(data.getAll('send_to')).toEqual(['list_1'])
    expect(data.get('include_footer')).toBe('on')
    expect(data.get('footer_source')).toBe('auto')
    expect(screen.getByText('Applies to new campaigns only.')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Save defaults' }))
    expect(
      await screen.findByText(
        'Defaults saved. New campaigns will start with them.'
      )
    ).toBeVisible()
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
    expect(
      screen.getByText(/once Klaviyo is\s+connected for real/)
    ).toBeVisible()
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
    expect(screen.getByText(/same timezone the Dashboard uses/)).toBeVisible()
  })
})
