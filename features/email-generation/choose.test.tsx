import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChooseOutcome } from './choose'

const { emailChoice, rewriteAvailability, chooseEmailOutcome } = vi.hoisted(
  () => ({
    emailChoice: vi.fn(),
    rewriteAvailability: vi.fn(),
    chooseEmailOutcome: vi.fn()
  })
)
vi.mock('server-only', () => ({}))
vi.mock('./data', () => ({ emailChoice }))
vi.mock('./config', () => ({ rewriteAvailability }))
vi.mock('./actions', () => ({ chooseEmailOutcome }))
vi.mock('@/features/email-import/data', () => ({
  fileForReference: vi.fn()
}))

const tenantId = '00000000-0000-4000-8000-000000000001'
const importId = '00000000-0000-4000-8000-000000000002'
const attempt = '00000000-0000-4000-8000-000000000003'

beforeEach(() => {
  emailChoice.mockResolvedValue({
    data: {
      imported: {
        subject: 'Spring edit',
        original_body: 'Hello there',
        file_import_id: null
      },
      brand: { domain: 'https://brand.example' },
      products: [],
      offers: [],
      results: []
    },
    error: null
  })
  rewriteAvailability.mockReturnValue({
    ready: true,
    sample: true,
    reason: null
  })
})
afterEach(cleanup)

async function show(preferred?: 'copy' | 'rewrite') {
  render(
    await ChooseOutcome({ tenantId, importId, attempt, owner: true, preferred })
  )
}

describe('ChooseOutcome with a composer choice', () => {
  it('marks the chosen outcome and makes its button the main one', async () => {
    await show('copy')
    const copy = screen.getByRole('region', { name: 'Copy this email' })
    expect(within(copy).getByText('Your choice in the composer')).toBeVisible()
    expect(
      within(copy).getByRole('button', { name: 'Copy this email' }).className
    ).toContain('bg-[var(--brand-primary)]')
    const rewrite = screen.getByRole('region', { name: 'Rewrite for my brand' })
    expect(
      within(rewrite).queryByText('Your choice in the composer')
    ).not.toBeInTheDocument()
    expect(
      within(rewrite).getByRole('button', { name: 'Rewrite for my brand' })
        .className
    ).toContain('bg-[var(--surface-hover)]')
  })

  it('only marks; it never starts a copy or rewrite on its own', async () => {
    await show('rewrite')
    expect(chooseEmailOutcome).not.toHaveBeenCalled()
  })

  it('makes Copy the main action when rewriting is not available', async () => {
    rewriteAvailability.mockReturnValue({
      ready: false,
      sample: false,
      reason: 'not configured'
    })
    await show('rewrite')
    expect(
      screen.getByRole('button', { name: 'Copy this email' }).className
    ).toContain('bg-[var(--brand-primary)]')
    expect(screen.getByText(/Rewriting is not set up yet/)).toBeVisible()
  })

  it('keeps the original order and look without a composer choice', async () => {
    await show()
    expect(
      screen.queryByText('Your choice in the composer')
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Rewrite for my brand' }).className
    ).toContain('bg-[var(--brand-primary)]')
  })
})
