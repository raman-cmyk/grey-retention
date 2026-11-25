import { expect, test } from '@playwright/test'
import { login } from './accounts'

test('Klaviyo pages render with a heading and no overflow', async ({
  page
}) => {
  await login(page)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  // UI-AUDc: a list's and a segment's page are GROS pages under Audiences,
  // and their old addresses open them.
  for (const [old, moved] of [
    ['/lists/LSTnews01?from=lists', '/audiences/lists/LSTnews01?from=lists'],
    [
      '/segments/SEGeng030?from=segments',
      '/audiences/segments/SEGeng030?from=segments'
    ]
  ] as const) {
    await page.goto(old)
    await expect(page).toHaveURL(new RegExp(`${moved.replace('?', '\\?')}$`))
    await expect(
      page
        .getByRole('navigation', { name: 'Main' })
        .getByRole('link', { name: 'Audiences', exact: true })
    ).toHaveAttribute('aria-current', 'page')
  }
  // UI-KLV: a Klaviyo campaign's, a flow's, a flow email's and a metric's
  // page are GROS pages under Results, and their old addresses open them.
  for (const [old, moved] of [
    [
      '/campaigns/klaviyo/CMPspr001?from=campaigns',
      '/results/campaigns/CMPspr001?from=campaigns'
    ],
    ['/flows/FLWpst004?from=flows', '/results/flows/FLWpst004?from=flows'],
    ['/flow-messages/FLWpst004M2', '/results/flow-emails/FLWpst004M2'],
    [
      '/metrics/METord005?from=metrics',
      '/results/metrics/METord005?from=metrics'
    ]
  ] as const) {
    await page.goto(old)
    await expect(page).toHaveURL(new RegExp(`${moved.replace('?', '\\?')}$`))
    await expect(
      page
        .getByRole('navigation', { name: 'Main' })
        .getByRole('link', { name: 'Results', exact: true })
    ).toHaveAttribute('aria-current', 'page')
  }
  for (const path of [
    '/audiences/lists/LSTnews01',
    '/audiences/segments/SEGeng030',
    '/results/campaigns/CMPspr001',
    '/results/flows/FLWpst004',
    '/results/flow-emails/FLWpst004M2',
    '/results/metrics/METord005'
  ]) {
    await page.goto(path)
    // Sample data when the workspace's Klaviyo is connected, otherwise
    // Klaviyo not connected; each has one page heading.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      ),
      path
    ).toBe(true)
  }
  expect(errors).toEqual([])
})

test('core workspace surfaces render without overflow', async ({
  page
}, info) => {
  await login(page)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  for (const [path, heading] of [
    ['/home', /^Good (morning|afternoon|evening), /],
    ['/plan', 'Plan'],
    ['/brand', 'Brand'],
    ['/brand/book', 'Brand book'],
    ['/brand/assets', 'Brand assets'],
    ['/gros', 'Ask GROS'],
    ['/inspiration', 'Inspiration'],
    ['/results', 'Results'],
    ['/settings', 'Settings']
  ] as [string, string | RegExp][]) {
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
      ['/home', '/plan', '/brand/assets', '/gros', '/results'].includes(path)
    ) {
      await page.screenshot({
        path: `.audit/ui-002-${path.slice(1).replaceAll('/', '-')}-${info.project.name}.png`,
        fullPage: path === '/home' || path === '/gros'
      })
    }
  }
  expect(errors).toEqual([])
})

test('the old guided setup address opens Setup (UI-OLDc)', async ({ page }) => {
  await login(page)
  // A finished workspace's /setup goes on to Home.
  await page.goto('/get-started?step=brand')
  await expect(page).toHaveURL(/\/(setup|home)(\?|$)/)
})
