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

test('workspace overview adapts to desktop and mobile viewports', async ({
  page
}, testInfo) => {
  await login(page)
  await expect(
    page.getByRole('heading', { name: 'Dashboard', exact: true })
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Campaign workspace' })
  ).toBeVisible()

  if (testInfo.project.name === 'mobile-chromium') {
    await expect(page.getByText('Autumn field notes').first()).toBeVisible()
    await page.getByRole('button', { name: 'Open navigation' }).click()
    await expect(
      page.getByRole('navigation', {
        name: 'Client workspace mobile navigation'
      })
    ).toBeVisible()
  } else {
    await expect(
      page
        .getByRole('navigation', { name: 'Client workspace navigation' })
        .getByRole('link', { name: 'Dashboard', exact: true })
    ).toHaveAttribute('aria-current', 'page')
  }
})

test('authenticated identities remain separated by role surface', async ({
  page
}) => {
  const cases = [
    { surface: 'client', path: '/dashboard', heading: 'Dashboard' },
    {
      surface: 'admin',
      path: '/admin/dashboard',
      heading: 'Platform operations'
    },
    {
      surface: 'designer',
      path: '/designer/dashboard',
      heading: 'Assignment desk'
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
