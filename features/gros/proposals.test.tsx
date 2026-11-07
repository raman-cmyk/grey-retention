import {
  cleanup,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { installDialogPolyfill } from '@/tests/helpers/dialog-polyfill'

const actions = vi.hoisted(() => ({
  decideProposal: vi.fn(),
  proposeChange: vi.fn()
}))
vi.mock('./actions', () => actions)

import type { GrosProposal } from './data'
import { ProposalList, ProposeChange, proposalText } from './proposals'

beforeAll(installDialogPolyfill)
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const chat = '00000000-0000-4000-8000-000000000901'
const proposal = (over: Partial<GrosProposal> = {}): GrosProposal => ({
  id: '00000000-0000-4000-8000-000000000a01',
  kind: 'edit_goal',
  status: 'pending',
  campaignTitle: 'Spring launch',
  goal: 'Sell more boots',
  referenceSubject: null,
  plannedAt: null,
  hash: 'b'.repeat(64),
  expiresAt: '2026-11-07T10:15:00Z',
  mine: true,
  ...over
})

describe('proposalText', () => {
  it('says exactly what changes', () => {
    expect(proposalText(proposal(), 'UTC')).toBe(
      'Set the goal of “Spring launch” to “Sell more boots”.'
    )
    expect(
      proposalText(
        proposal({ kind: 'select_reference', referenceSubject: 'Autumn sale' }),
        'UTC'
      )
    ).toBe(
      'Use the competitor email “Autumn sale” as the reference for “Spring launch”.'
    )
    expect(
      proposalText(
        proposal({ kind: 'schedule', plannedAt: '2026-11-09T15:00:00Z' }),
        'UTC'
      )
    ).toMatch(/^Schedule “Spring launch” to send on Nov 9, 2026 · 3:00 PM/)
  })
})

describe('ProposalList', () => {
  it('applies only after confirming, with the exact proposal and hash', async () => {
    actions.decideProposal.mockResolvedValue({
      message: 'Applied to the campaign.'
    })
    render(<ProposalList chat={chat} proposals={[proposal()]} timezone="UTC" />)
    expect(screen.getByText('Waiting for you')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Apply change' }))
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Apply this change?'
    })
    expect(dialog).toHaveTextContent(
      'Set the goal of “Spring launch” to “Sell more boots”.'
    )
    expect(actions.decideProposal).not.toHaveBeenCalled()
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Apply change' })
    )
    await waitFor(() => expect(actions.decideProposal).toHaveBeenCalledTimes(1))
    const data = actions.decideProposal.mock.calls[0]![1] as FormData
    expect(Object.fromEntries(data)).toEqual({
      chat,
      proposal: '00000000-0000-4000-8000-000000000a01',
      hash: 'b'.repeat(64),
      decision: 'confirmed'
    })
    expect(await screen.findByText('Applied to the campaign.')).toBeVisible()
  })

  it('a teammate’s proposal and an expired one offer no buttons', () => {
    render(
      <ProposalList
        chat={chat}
        proposals={[
          proposal({ mine: false }),
          proposal({ id: 'p2', status: 'expired' })
        ]}
        timezone="UTC"
      />
    )
    expect(screen.getByText('Waiting for the person who asked')).toBeVisible()
    expect(screen.getByText('Expired')).toBeVisible()
    expect(screen.getByText(/Ask again for a fresh one/)).toBeVisible()
    expect(
      screen.queryByRole('button', { name: /Apply change|Dismiss/ })
    ).toBeNull()
  })
})

describe('ProposeChange', () => {
  const campaigns = [
    { id: '00000000-0000-4000-8000-000000000601', title: 'Spring launch' }
  ]

  it('staff see only the changes they may ask for', async () => {
    render(
      <ProposeChange
        chat={chat}
        campaigns={campaigns}
        references={[]}
        owner={false}
      />
    )
    await userEvent.click(screen.getByText('Propose a change to a campaign'))
    const options = within(screen.getByLabelText('Change'))
      .getAllByRole('option')
      .map((o) => o.textContent)
    expect(options).toEqual(['Change the goal', 'Use a reference email'])
  })

  it('keeps what was typed when GROS refuses', async () => {
    actions.proposeChange.mockResolvedValue({
      error: 'Choose a campaign and say why.'
    })
    render(
      <ProposeChange chat={chat} campaigns={campaigns} references={[]} owner />
    )
    await userEvent.click(screen.getByText('Propose a change to a campaign'))
    await userEvent.selectOptions(
      screen.getByLabelText('Campaign'),
      'Spring launch'
    )
    await userEvent.type(screen.getByLabelText('New goal'), 'Sell more boots')
    await userEvent.type(screen.getByLabelText('Why'), 'Clearer goal')
    await userEvent.click(
      screen.getByRole('button', { name: 'Propose change' })
    )
    expect(
      await screen.findByText('Choose a campaign and say why.')
    ).toBeVisible()
    expect(screen.getByLabelText('New goal')).toHaveValue('Sell more boots')
    expect(screen.getByLabelText('Why')).toHaveValue('Clearer goal')
    expect(screen.getByLabelText('Campaign')).toHaveValue(
      '00000000-0000-4000-8000-000000000601'
    )
  })
})
