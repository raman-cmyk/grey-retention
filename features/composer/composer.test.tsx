import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Composer } from './composer'

const { composeEmail } = vi.hoisted(() => ({
  composeEmail: vi.fn<(state: unknown, form: FormData) => Promise<object>>(
    async () => ({})
  )
}))
vi.mock('./actions', () => ({ composeEmail }))

afterEach(() => {
  cleanup()
  composeEmail.mockClear()
})

function renderComposer(rewriteReady = true) {
  render(
    <Composer
      requestKey="00000000-0000-4000-8000-000000000999"
      brandName="Northwind"
      productCount={3}
      rewriteReady={rewriteReady}
    />
  )
}

describe('Composer', () => {
  it('offers a labelled paste box, three modes and one key action', () => {
    renderComposer()
    expect(screen.getByLabelText('Paste a competitor email')).toBeRequired()
    expect(screen.getByRole('radio', { name: 'Rebrand' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Exact' })).not.toBeChecked()
    expect(screen.getByRole('radio', { name: 'Adapt' })).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Create my version' })
    ).toBeEnabled()
  })

  it('describes the chosen mode and that nothing is sent', async () => {
    renderComposer()
    expect(screen.getByText(/rewrites the words for your brand/)).toBeVisible()
    await userEvent.click(screen.getByText('Exact'))
    expect(screen.getByText(/exact copy\. Nothing is rewritten/)).toBeVisible()
    expect(screen.getByText(/We save it to your workspace/)).toBeVisible()
    expect(screen.getByText(/Nothing is sent/)).toBeVisible()
  })

  it('shows the real brand, product and footer state', () => {
    renderComposer()
    expect(screen.getByRole('link', { name: 'Northwind' })).toHaveAttribute(
      'href',
      '/brand'
    )
    expect(screen.getByRole('link', { name: '3 saved' })).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Not set up yet' })
    ).toHaveAttribute('href', '/connections')
  })

  it('blocks a pasted link and explains why', async () => {
    renderComposer()
    await userEvent.type(
      screen.getByLabelText('Paste a competitor email'),
      'https://brand.example/email'
    )
    expect(screen.getByText(/link is not available yet/)).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Create my version' })
    ).toBeDisabled()
  })

  it('submits the paste and mode with Ctrl+Enter', async () => {
    renderComposer()
    const box = screen.getByLabelText('Paste a competitor email')
    await userEvent.type(box, 'Spring sale starts now')
    await userEvent.click(screen.getByText('Exact'))
    box.focus()
    await userEvent.keyboard('{Control>}{Enter}{/Control}')
    await vi.waitFor(() => expect(composeEmail).toHaveBeenCalled())
    const data = composeEmail.mock.calls[0][1]
    expect(data.get('body')).toBe('Spring sale starts now')
    expect(data.get('mode')).toBe('exact')
    expect(data.get('requestKey')).toBe('00000000-0000-4000-8000-000000000999')
  })

  it('defaults to Exact and explains Rebrand when rewriting is not set up', () => {
    renderComposer(false)
    expect(screen.getByRole('radio', { name: 'Exact' })).toBeChecked()
    const rebrand = screen.getByRole('radio', { name: 'Rebrand' })
    expect(rebrand).toBeDisabled()
    expect(rebrand).toHaveAccessibleDescription(
      'Rebrand: not available yet — Rewriting is not set up for this workspace yet'
    )
  })

  it('warns about an oversized paste instead of cutting it', () => {
    renderComposer()
    fireEvent.change(screen.getByLabelText('Paste a competitor email'), {
      target: { value: 'x'.repeat(100_001) }
    })
    expect(screen.getByText(/longer than 100,000 characters/)).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Create my version' })
    ).toBeDisabled()
  })

  it('does not submit a link with the keyboard shortcut', async () => {
    renderComposer()
    const box = screen.getByLabelText('Paste a competitor email')
    await userEvent.type(box, 'https://brand.example/email')
    await userEvent.keyboard('{Control>}{Enter}{/Control}')
    expect(composeEmail).not.toHaveBeenCalled()
    expect(box).toHaveAttribute('aria-keyshortcuts', 'Control+Enter Meta+Enter')
  })
})
