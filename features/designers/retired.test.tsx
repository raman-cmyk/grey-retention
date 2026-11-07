import { beforeEach, describe, expect, it, vi } from 'vitest'

const { notFound } = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  })
}))
vi.mock('next/navigation', () => ({ notFound }))
vi.mock('@/components/auth/sign-in-panel', () => ({ SignInPanel: () => null }))

import { retiredDesignerRoute } from './retired'
import DesignerLoginPage from '@/app/(auth)/designer/login/page'

beforeEach(() => {
  notFound.mockClear()
})

describe('the designer workflow is retired (decision D3)', () => {
  it('answers Not found', () => {
    expect(() => retiredDesignerRoute()).toThrow('NEXT_NOT_FOUND')
    expect(notFound).toHaveBeenCalledOnce()
  })

  it('no longer shows the designer sign-in', () => {
    expect(() => DesignerLoginPage()).toThrow('NEXT_NOT_FOUND')
  })
})
