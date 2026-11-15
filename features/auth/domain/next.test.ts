import { describe, expect, it } from 'vitest'
import { safeNext } from './next'

describe('the page to go back to after signing in', () => {
  it('keeps a page of the area, with its query', () => {
    expect(safeNext('client', '/plan')).toBe('/plan')
    expect(safeNext('client', '/campaigns/klaviyo/C1?tab=results')).toBe(
      '/campaigns/klaviyo/C1?tab=results'
    )
    expect(safeNext('admin', '/admin/clients')).toBe('/admin/clients')
    expect(safeNext('designer', '/designer/dashboard')).toBe(
      '/designer/dashboard'
    )
  })

  it.each([
    'https://evil.example/plan',
    '//evil.example/plan',
    '/\\evil.example',
    '/plan\\..\\x',
    'plan',
    '',
    '/',
    '/plan\n',
    '/pl an',
    '/login',
    '/login?next=/plan',
    '/signup',
    '/reset-password',
    '/auth/callback?next=/plan',
    '/admin/login',
    '/..//evil.example',
    '/%2e%2e//evil.example',
    '/plan/..//evil.example',
    '/plan/../admin/clients',
    '/./plan',
    `/${'a'.repeat(512)}`
  ])('never leads an owner to %j', (value) => {
    expect(safeNext('client', value)).toBeNull()
  })

  it('never leads to another area', () => {
    expect(safeNext('client', '/admin/clients')).toBeNull()
    expect(safeNext('client', '/designer/dashboard')).toBeNull()
    expect(safeNext('admin', '/plan')).toBeNull()
    expect(safeNext('admin', '/administrator')).toBeNull()
    expect(safeNext('designer', '/admin/clients')).toBeNull()
  })

  it('ignores anything but text', () => {
    expect(safeNext('client', null)).toBeNull()
    expect(safeNext('client', ['/plan'])).toBeNull()
  })
})
