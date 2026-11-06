import { expect, test } from '@playwright/test'
import { login } from './accounts'

test('workspace sidebar, account menu and mobile drawer work with keyboard and short screens', async ({
  page
}, info) => {
  await login(page)
  await expect(
    page.getByRole('heading', { name: 'Dashboard', exact: true })
  ).toBeVisible()
  const mobile = info.project.name === 'mobile-chromium'

  if (!mobile) {
    const store = page.getByTestId('shell-workspace')
    await expect(store).toBeVisible()
    expect((await store.innerText()).trim().split('\n').length).toBeGreaterThan(
      1
    )
    const nav = page.getByRole('navigation', {
      name: 'Client workspace navigation'
    })
    await expect(
      nav.getByRole('link', { name: 'Dashboard', exact: true })
    ).toHaveAttribute('aria-current', 'page')
    const agents = nav.getByRole('button', { name: 'Agents', exact: true })
    await agents.click()
    await expect(agents).toHaveAttribute('aria-expanded', 'true')
    await expect(nav.getByText('List Health')).toBeVisible()
    await expect(nav.getByRole('link', { name: 'List Health' })).toHaveCount(0)

    // Collapse to the icon rail; the choice survives a reload.
    const toggle = page.getByRole('button', { name: 'Toggle sidebar' })
    await toggle.click()
    await page.reload()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    const rail = page.getByRole('link', { name: 'Dashboard', exact: true })
    await expect(rail).toHaveAttribute('aria-current', 'page')
    await rail.hover()
    await expect(page.getByTestId('rail-tooltip')).toHaveText('Dashboard')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    // The open Agents group survived the reload.
    await expect(agents).toHaveAttribute('aria-expanded', 'true')

    // Keyboard only: open the menu, Tab into it, Escape returns to the button.
    const account = page.getByRole('button', { name: /^Open account menu/ })
    await account.focus()
    await page.keyboard.press('Enter')
    const menu = page.locator(
      `[id="${await account.getAttribute('aria-controls')}"]`
    )
    const logOut = menu.getByRole('button', { name: 'Log out', exact: true })
    await expect(logOut).toBeVisible()
    // Profile Update (UIR-014), then Log out.
    await page.keyboard.press('Tab')
    await expect(
      menu.getByRole('link', { name: 'Profile Update', exact: true })
    ).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(logOut).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(account).toBeFocused()
    await expect(logOut).not.toBeVisible()
  }

  if (mobile) {
    await page.setViewportSize({ width: 390, height: 568 })
    const menu = page.getByRole('button', { name: 'Open navigation' })
    await menu.click()
    const dialog = page.getByRole('dialog', {
      name: 'Client workspace navigation menu'
    })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByTestId('shell-workspace-mobile')).toBeVisible()
    const dimensions = await dialog.evaluate((element) => ({
      height: element.getBoundingClientRect().height,
      viewport: innerHeight
    }))
    expect(dimensions.height).toBeLessThanOrEqual(dimensions.viewport)
    const settings = dialog.getByRole('link', { name: 'Settings', exact: true })
    if (!(await settings.isVisible()))
      await dialog
        .getByRole('button', { name: 'Workspace', exact: true })
        .click()
    await settings.scrollIntoViewIfNeeded()
    await expect(settings).toBeInViewport()
    await page.keyboard.press('Escape')
    await expect(menu).toBeFocused()
    await menu.click()
    await dialog.getByRole('button', { name: 'Log out', exact: true }).click()
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
    ['/dashboard', 'Dashboard'],
    ['/campaign-agent', 'Campaigns'],
    ['/copy-review?week=2026-99-99', 'Weekly copy review'],
    ['/copy-review?week=2026-02-31', 'Weekly copy review'],
    ['/brand', 'Brand and store'],
    ['/assets', 'Brand assets'],
    ['/gros', 'Ask GROS'],
    ['/competitor-agent', 'Competitor intelligence'],
    ['/reports', 'Results & learning'],
    ['/email-library', 'Subscribed email library'],
    ['/connections', 'Fixture connections'],
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
