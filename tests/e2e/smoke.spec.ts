import { expect, test } from '@playwright/test'
import { login } from './accounts'

test('client login presents a labelled access form', async ({ page }) => {
  await page.goto('/login')
  await expect(
    page.getByRole('heading', { name: 'Return to the work.' })
  ).toBeVisible()
  await expect(page.getByLabel('Email')).toBeVisible()
  await expect(page.getByLabel('Password')).toBeVisible()
})

test('Home adapts to desktop and mobile viewports (UI-HOMEb)', async ({
  page
}) => {
  await login(page)
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: /^Good (morning|afternoon|evening), /
    })
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Your next 15 days' })
  ).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Next emails' })).toBeVisible()
  // The GROS top bar wraps on a phone; nothing hides behind a menu button.
  await expect(
    page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Home', exact: true })
  ).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
})

test('authenticated identities remain separated by role surface', async ({
  page
}) => {
  const cases = [
    {
      surface: 'client',
      path: '/home',
      heading: /^Good (morning|afternoon|evening), /
    },
    {
      surface: 'admin',
      path: '/admin/dashboard',
      heading: 'Platform operations'
    }
  ] as const

  for (const account of cases) {
    await page.context().clearCookies()
    await login(page, account.surface === 'client' ? 'owner' : account.surface)
    await expect(
      page.getByRole('heading', { name: account.heading })
    ).toBeVisible()
    const response = await page.request.get(
      `/api/v1/me?surface=${account.surface}`
    )
    expect(response.ok()).toBe(true)
    expect((await response.json()).data.kind).toBe(account.surface)
  }

  const invalid = await page.request.get('/api/v1/me?surface=unknown')
  expect(invalid.status()).toBe(400)
})

test('RET-001 the designer workflow is retired (decision D3)', async ({
  page
}) => {
  for (const path of [
    '/designer/login',
    '/designer/dashboard',
    '/designer/help',
    '/designer/assignments/33333333-3333-4333-8333-333333333333'
  ])
    expect((await page.request.get(path)).status(), path).toBe(404)
  await login(page, 'admin')
  expect((await page.request.get('/admin/designers')).status()).toBe(404)
  await expect(page.getByRole('link', { name: 'Designers' })).toHaveCount(0)
})

test('RET-002 the weekly copy review is retired (decision D17)', async ({
  page
}) => {
  await login(page)
  for (const path of ['/copy-review', '/copy-review?week=2026-11-09'])
    expect((await page.request.get(path)).status(), path).toBe(404)
  await page.goto('/campaign-agent')
  await expect(page.locator('a[href^="/copy-review"]')).toHaveCount(0)
})

test('RET-002 admins read the fallback log on Operations (decision D16)', async ({
  page
}) => {
  await login(page, 'admin')
  await page.goto('/admin/operations')
  await expect(
    page.getByRole('heading', { name: 'Fallback log', exact: true })
  ).toBeVisible()
  await expect(page.getByText('No fallbacks yet.')).toBeVisible()
})
