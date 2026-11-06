import { expect, test } from '@playwright/test'
import { login } from './accounts'

test('workspace navigation, page search and account actions work with keyboard and short screens', async ({
  page
}, info) => {
  await login(page)
  await expect(
    page.getByRole('heading', { name: 'Workspace overview', exact: true })
  ).toBeVisible()
  const store = page.getByTestId('shell-workspace')
  await expect(store).toBeVisible()
  await expect(store).toContainText('Store')
  expect((await store.innerText()).trim().split('\n').length).toBeGreaterThan(1)
  const trigger = page.getByRole('button', { name: 'Search workspace' })
  await trigger.click()
  const search = page.getByRole('dialog', { name: 'Find a page' })
  await expect(search).toBeVisible()
  await expect(page.getByLabel('Search pages')).toBeFocused()
  await page.getByLabel('Search pages').fill('copy')
  await expect(
    search.getByRole('link', { name: 'Copy review', exact: true })
  ).toBeVisible()
  await page.getByLabel('Search pages').fill('no page with this name')
  await expect(search.getByRole('status')).toContainText('No pages match')
  await page.keyboard.press('Escape')
  await expect(search).not.toBeVisible()
  await expect(trigger).toBeFocused()
  await page.keyboard.press('Control+k')
  await expect(search).toBeVisible()
  await page.getByLabel('Search pages').fill('assets')
  await search.getByRole('link', { name: 'Assets', exact: true }).click()
  await expect(page).toHaveURL(/\/assets$/)
  await expect(search).not.toBeVisible()

  const account = page.locator('summary[aria-label^="Open account menu"]')
  await account.click()
  await expect(
    page.getByRole('link', { name: 'Workspace settings', exact: true })
  ).toBeVisible()
  await page
    .getByRole('link', { name: 'Workspace settings', exact: true })
    .focus()
  await page.keyboard.press('Escape')
  await expect(account).toBeFocused()
  await expect(
    page.getByRole('link', { name: 'Workspace settings', exact: true })
  ).not.toBeVisible()

  if (info.project.name === 'mobile-chromium') {
    await page.setViewportSize({ width: 390, height: 568 })
    const menu = page.getByRole('button', { name: 'Open navigation' })
    await menu.click()
    const dialog = page.getByRole('dialog', {
      name: 'Client workspace navigation menu'
    })
    await expect(dialog).toBeVisible()
    const dimensions = await dialog.evaluate((element) => ({
      height: element.getBoundingClientRect().height,
      viewport: innerHeight
    }))
    expect(dimensions.height).toBeLessThanOrEqual(dimensions.viewport)
    await dialog.locator('summary').filter({ hasText: 'Manage' }).click()
    await dialog
      .getByRole('link', { name: 'Settings', exact: true })
      .scrollIntoViewIfNeeded()
    await expect(
      dialog.getByRole('link', { name: 'Settings', exact: true })
    ).toBeInViewport()
    await page.keyboard.press('Escape')
    await expect(menu).toBeFocused()
    await menu.click()
    await dialog.getByRole('button', { name: 'Sign out', exact: true }).click()
    await expect(page).toHaveURL(/\/login$/)
  }
})

test('core workspace surfaces render without overflow and invalid review dates recover', async ({
  page
}, info) => {
  await login(page)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  for (const [path, heading] of [
    ['/dashboard', 'Workspace overview'],
    ['/campaign-agent', 'Campaign calendar'],
    ['/copy-review?week=2026-99-99', 'Weekly copy review'],
    ['/copy-review?week=2026-02-31', 'Weekly copy review'],
    ['/brand', 'Brand and store'],
    ['/assets', 'Brand assets'],
    ['/gros', 'Ask GROS'],
    ['/competitor-agent', 'Competitor intelligence'],
    ['/reports', 'Results & learning'],
    ['/email-library', 'Subscribed email library'],
    ['/connections', 'Connections'],
    ['/optimizer', 'Bill optimizer'],
    ['/team', 'Team'],
    ['/support', 'Support'],
    ['/settings', 'Workspace settings']
  ]) {
    await page.goto(path)
    await expect(
      page.getByRole('heading', { name: heading, exact: true })
    ).toBeVisible()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      ),
      path
    ).toBe(true)
    if (
      [
        '/dashboard',
        '/campaign-agent',
        '/assets',
        '/gros',
        '/reports'
      ].includes(path)
    ) {
      await page.screenshot({
        path: `.audit/ui-002-${path.slice(1)}-${info.project.name}.png`,
        fullPage: path === '/dashboard' || path === '/gros'
      })
    }
  }
  expect(errors).toEqual([])
})

test('guided setup can be revisited without changing saved brand details', async ({
  page
}) => {
  await login(page)
  await page.goto('/get-started?step=brand')
  await expect(
    page.getByRole('heading', { name: 'Which store is yours?' })
  ).toBeVisible()
  await expect(
    page.getByRole('navigation', { name: 'Setup progress' })
  ).toBeVisible()
  await expect(page.getByLabel('Brand name')).not.toHaveValue('')
  await expect(page.getByText('Brand voice and rules · optional')).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
  await page.getByRole('link', { name: 'Exit setup' }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
})
